import {
    App,
    MarkdownView,
    Notice,
    TFile,
    requestUrl,
    Platform,
    Modal,
    TextComponent,
    ButtonComponent,
    ToggleComponent,
} from "obsidian";
import ZhihuObPlugin from "./main";
import * as dataUtil from "./data";
import * as cookies from "./cookies";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;
import { htmlToMd } from "./html_to_markdown";
import { StateField } from "@codemirror/state";
import { ViewUpdate, EditorView } from "@codemirror/view";
import { zhihuRefreshZseCookies } from "./login_service";
import { turnImgOffline } from "./img_offline";
import { loadSettings, saveSettings } from "./settings";
import { FolderSuggestModal } from "./utilities";

//====================================================================
// 下面是2025年12月30日采用GPT 5.2重构后的open_service代码
// 原版过于臃肿，函数的传参层层嵌套
// ====================================================================

/**
 * =========================
 * Editor Cursor Trace
 * =========================
 */
export const pluginField = StateField.define<ZhihuObPlugin | null>({
    create: () => null,
    update: (value) => value,
});

export class CursorPosTrace {
    plugin: ZhihuObPlugin | null;

    constructor(view: EditorView) {
        this.plugin = view.state.field(pluginField);
    }

    update(update: ViewUpdate) {
        if (!this.plugin) {
            this.plugin = update.view.state.field(pluginField);
            if (!this.plugin) return;
        }
        if (update.selectionSet) this.updateCursor(update);
    }

    updateCursor(update: ViewUpdate) {
        if (this.plugin) {
            this.plugin.lastCursorPos = update.startState.selection.main.head;
        }
    }
}

/**
 * =========================
 * Types
 * =========================
 */
export type ZhihuType = "article" | "question" | "answer" | "pin";

export function asZhihuType(type: string): ZhihuType | null {
    switch (type) {
        case "article":
        case "question":
        case "answer":
        case "pin":
            return type;
        default:
            return null;
    }
}

export type ZhihuOpenRequest = {
    url: string;
    type?: ZhihuType; // 不传则自动识别
    destFolder?: string; // vault 内目录，默认 "zhihu"
    offlineImages?: boolean; // 覆盖全局 settings.turnImgOffline
    overwrite?: boolean; // 是否覆盖已有文件（默认 true）
};

type ParsedZhihu = {
    type: ZhihuType;
    url: string;
    title: string;
    author: string;
    html: string;
};

type ResolvedOpenOptions = {
    destFolder: string;
    offlineImages: boolean;
    overwrite: boolean;
};

/**
 * =========================
 * Public Click Hooks
 * =========================
 */
export async function clickInReadMode(app: App, evt: MouseEvent) {
    const target = evt.target as HTMLElement;
    if (
        !(target instanceof HTMLAnchorElement) ||
        !target.classList.contains("external-link")
    ) {
        return;
    }

    const link = target.href;
    const targetContent = target.textContent;
    if (!targetContent) return;

    // 跳过特殊链接：我的 Zhihu on Obsidian 推广文章
    if (link === "https://zhuanlan.zhihu.com/p/1901622331102696374") return;

    const type = detectZhihuType(link);
    if (!type) return;

    evt.preventDefault();
    evt.stopPropagation();

    await new ZhihuOpener(app).open({ url: link, type });
}

export async function clickInPreview(plugin: ZhihuObPlugin, evt: MouseEvent) {
    interface CMEditorWrapper {
        cm: EditorView;
    }
    const app = plugin.app;
    const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) return;

    const editor = markdownView.editor;
    const cmEditor = (editor as unknown as CMEditorWrapper).cm;
    if (!cmEditor) return;

    const pos = cmEditor.posAtCoords({ x: evt.clientX, y: evt.clientY });
    if (!pos) return;

    const state = cmEditor.state;
    const doc = state.doc;
    const line = doc.lineAt(pos);
    const text = line.text;

    // 正则匹配 Markdown 链接 [title](url)
    const match = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let found: RegExpExecArray | null;

    while ((found = match.exec(text))) {
        const linkStart = line.from + found.index;
        const linkEnd = linkStart + found[0].length;

        if (pos > linkStart && pos < linkEnd) {
            const lastPos = plugin.lastCursorPos;

            // 上次光标在链接内则认为是在编辑链接，不拦截
            const wasLastCursorInside =
                lastPos !== null && lastPos >= linkStart && lastPos <= linkEnd;
            if (wasLastCursorInside) return;

            const link = found[2];
            const type = detectZhihuType(link);
            if (!type) return;

            evt.preventDefault();
            evt.stopPropagation();

            await new ZhihuOpener(app).open({ url: link, type });
            return;
        }
    }
}

/**
 * =========================
 * Main Opener Service
 * =========================
 */
export class ZhihuOpener {
    constructor(private app: App) {}

    async open(req: ZhihuOpenRequest): Promise<void> {
        const type = req.type ?? detectZhihuType(req.url);
        if (!type) {
            new Notice(locale.notice.linkInvalid);
            return;
        }

        const parsed = await parseByType(this.app, req.url, type);
        const opt = await resolveOpenOptions(this.app, req);

        await this.saveAndOpen(parsed, opt);
    }

    async openParsed(
        parsed: ParsedZhihu,
        opt?: Partial<ResolvedOpenOptions>,
    ): Promise<void> {
        const settings = await loadSettings(this.app.vault);
        const resolved = {
            // 默认保存文件夹
            destFolder: opt?.destFolder ?? settings.defaultSaveFolder,
            offlineImages: opt?.offlineImages ?? settings.turnImgOffline,
            overwrite: opt?.overwrite ?? true, // 默认覆盖
        };
        await this.saveAndOpen(parsed, resolved);
    }

    private async saveAndOpen(
        parsed: ParsedZhihu,
        opt: ResolvedOpenOptions,
    ): Promise<void> {
        const app = this.app;
        const typeStr = fromTypeGetStr(parsed.type);

        const safeTitle = stripHtmlTags(parsed.title);
        const safeAuthor = parsed.author || "知乎用户";
        const fileName = removeSpecialChars(
            `${safeTitle}-${safeAuthor}的${typeStr}.md`,
        );
        const filePath = `${opt.destFolder}/${fileName}`;

        await ensureFolder(app, opt.destFolder);

        const existed = app.vault.getAbstractFileByPath(filePath);
        if (existed instanceof TFile) {
            // 不覆盖：直接打开旧文件
            if (!opt.overwrite) {
                await app.workspace.getLeaf().openFile(existed);
                return;
            }

            // 覆盖：重写内容 + 更新 frontmatter
            new Notice(locale.notice.overwritingExistingFiles);

            let markdown = htmlToMd(parsed.html);
            if (opt.offlineImages) {
                markdown = await turnImgOffline({
                    app,
                    markdown,
                    destFolder: `${opt.destFolder}/images`,
                });
            }

            await app.vault.process(existed, () => markdown);
            await app.fileManager.processFrontMatter(existed, (fm) => {
                fm.tags = `zhihu-${parsed.type}`;
                fm["zhihu-title"] = parsed.title;
                fm["zhihu-link"] = parsed.url;
            });

            await app.workspace.getLeaf().openFile(existed);
            return;
        } else if (existed) {
            console.error(`Path ${filePath} exists but is not a file`);
            return;
        }

        // 原逻辑：不存在则创建
        new Notice(locale.notice.openingFiles);
        let markdown = htmlToMd(parsed.html);

        if (opt.offlineImages) {
            markdown = await turnImgOffline({
                app,
                markdown,
                destFolder: `${opt.destFolder}/images`,
            });
        }

        const newFile = await app.vault.create(filePath, markdown);
        await app.fileManager.processFrontMatter(newFile, (fm) => {
            fm.tags = `zhihu-${parsed.type}`;
            fm["zhihu-title"] = parsed.title;
            fm["zhihu-link"] = parsed.url;
        });

        await app.workspace.getLeaf().openFile(newFile);
    }
}

/**
 * =========================
 * Option Resolution / Folder
 * =========================
 */
async function resolveOpenOptions(
    app: App,
    req: ZhihuOpenRequest,
): Promise<ResolvedOpenOptions> {
    const settings = await loadSettings(app.vault);

    const destFolderRaw = (req.destFolder ?? settings.defaultSaveFolder).trim();
    const destFolder = destFolderRaw.replace(/^\/+|\/+$/g, "");
    if (!destFolder) throw new Error(locale.error.destFolderEmpty);

    const offlineImages = req.offlineImages ?? settings.turnImgOffline;
    const overwrite = req.overwrite ?? true; // 默认覆盖

    return { destFolder, offlineImages, overwrite };
}

async function ensureFolder(app: App, folderPath: string) {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!folder) await app.vault.createFolder(folderPath);
}

/**
 * =========================
 * Type Detection / Normalize
 * =========================
 */
function detectZhihuType(url: string): ZhihuType | null {
    try {
        new URL(url);
    } catch {
        return null;
    }

    const patterns: Record<ZhihuType, RegExp> = {
        answer: /zhihu\.com\/question\/\d+\/answer\/\d+/,
        article: /zhuanlan\.zhihu\.com\/p\/\d+/,
        question: /zhihu\.com\/question\/\d+$/,
        pin: /zhihu\.com\/pin\/\d+/,
    };

    for (const [t, re] of Object.entries(patterns) as [ZhihuType, RegExp][]) {
        if (re.test(url)) return t;
    }
    return null;
}

/**
 * =========================
 * Parsing Dispatcher
 * =========================
 */
async function parseByType(
    app: App,
    url: string,
    type: ZhihuType,
): Promise<ParsedZhihu> {
    switch (type) {
        case "article": {
            const [title, html, author] = await phaseArticle(app, url);
            return { type, url, title, html, author };
        }
        case "question": {
            const [title, html, author] = await phaseQuestion(app, url);
            return { type, url, title, html, author };
        }
        case "answer": {
            const [title, html, author] = await phaseAnswer(app, url);
            return { type, url, title, html, author };
        }
        case "pin": {
            const [title, html, author] = await phasePin(app, url);
            return { type, url, title, html, author };
        }
    }
}

/**
 * =========================
 * Fetch + JSON helpers
 * =========================
 */
async function getZhihuContentHTML(app: App, zhihuLink: string) {
    async function fetchWithCookies() {
        const data = await dataUtil.loadData(app.vault);
        const cookiesHeader = cookies.cookiesHeaderBuilder(data, []);
        const response = await requestUrl({
            url: zhihuLink,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:138.0) Gecko/20100101 Firefox/138.0",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                "upgrade-insecure-requests": "1",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "sec-fetch-user": "?1",
                priority: "u=0, i",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        return response.text;
    }

    try {
        return await fetchWithCookies();
    } catch (error) {
        console.warn(error);
        try {
            //  即使并发调用，也只会生成一个窗口
            await zhihuRefreshZseCookies(app);
            return await fetchWithCookies();
        } catch (error2: any) {
            console.error(locale.notice.requestAnswerFailed, error2);
            new Notice(
                `${locale.notice.requestAnswerFailed}, ${error2?.message ?? error2}`,
            );
            return "";
        }
    }
}

function parseInitialDataJsonFromHtml(htmlText: string): any {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const scriptTag = doc.querySelector(
        'script#js-initialData[type="text/json"]',
    );
    if (!scriptTag) throw new Error("js-initialData script tag not found");
    const jsonText = scriptTag.textContent;
    if (!jsonText) throw new Error("js-initialData is empty");
    return JSON.parse(jsonText);
}

/**
 * =========================
 * Phase Parsers
 * =========================
 */
async function phaseAnswer(
    app: App,
    zhihuLink: string,
): Promise<[string, string, string]> {
    const [questionId, answerId] = getQuestionAndAnswerId(zhihuLink);
    const htmlText = await getZhihuContentHTML(app, zhihuLink);
    const jsonData = parseInitialDataJsonFromHtml(htmlText);

    const data = jsonData?.initialState?.entities?.answers?.[answerId];
    const writerName = data?.author?.name || "知乎用户";
    const content = data?.content || "";
    const title = data?.question?.title || `知乎问题${questionId}`;

    return [title, content, writerName];
}

async function phaseArticle(
    app: App,
    zhihuLink: string,
): Promise<[string, string, string]> {
    const articleId = getArticleId(zhihuLink);
    const htmlText = await getZhihuContentHTML(app, zhihuLink);
    const jsonData = parseInitialDataJsonFromHtml(htmlText);

    const data = jsonData?.initialState?.entities?.articles?.[articleId];
    const writerName = data?.author?.name || "知乎用户";
    const content = data?.content || "";
    const title = data?.title || `知乎文章${articleId}`;

    return [title, content, writerName];
}

export async function phaseQuestion(
    app: App,
    zhihuLink: string,
): Promise<[string, string, string]> {
    const questionId = getQestionId(zhihuLink);
    const htmlText = await getZhihuContentHTML(app, zhihuLink);

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const jsonData = (() => {
        const scriptTag = doc.querySelector(
            'script#js-initialData[type="text/json"]',
        );
        if (!scriptTag) throw new Error("js-initialData script tag not found");
        const jsonText = scriptTag.textContent;
        if (!jsonText) throw new Error("js-initialData is empty");
        return JSON.parse(jsonText);
    })();

    const quesData = jsonData?.initialState?.entities?.questions?.[questionId];
    const asker = quesData?.author?.name || "知乎用户";
    const questionDetail = quesData?.detail || "";
    const title = quesData?.title || `知乎问题${questionId}`;

    // 附上问题回答（遍历 initialData answers）
    const answerData = jsonData?.initialState?.entities?.answers || {};
    const answerContainer = doc.createElement("div");

    for (const key in answerData) {
        const answer = answerData[key];
        const header = doc.createElement("h1");
        const link = doc.createElement("a");
        link.href = `https://www.zhihu.com/question/${questionId}/answer/${answer?.id}`;
        link.textContent = `${answer?.author?.name || "知乎用户"}的回答`;
        header.appendChild(link);

        const content = doc.createElement("div");
        content.innerHTML = answer?.content || "";

        answerContainer.appendChild(header);
        answerContainer.appendChild(content);
    }

    const container = doc.createElement("div");
    container.innerHTML = questionDetail;
    container.appendChild(answerContainer);

    return [title, container.innerHTML, asker];
}

async function phasePin(
    app: App,
    zhihuLink: string,
): Promise<[string, string, string]> {
    const pinId = getPinId(zhihuLink);
    const htmlText = await getZhihuContentHTML(app, zhihuLink);
    const jsonData = parseInitialDataJsonFromHtml(htmlText);

    const pinData = jsonData?.initialState?.entities?.pins?.[pinId];
    const users = jsonData?.initialState?.entities?.users || {};
    const title = `想法${pinId}`;

    // author：遍历 users 找一个 name
    let author = "知乎用户";
    for (const key in users) {
        const user = users[key];
        if (user && typeof user.name === "string") {
            author = user.name;
            break;
        }
    }

    // contentHtml 很可能是 string，别当 DOM 用
    const contentHtmlStr: string =
        typeof pinData?.contentHtml === "string" ? pinData.contentHtml : "";

    // 附加图片（拼 HTML）
    const content = Array.isArray(pinData?.content) ? pinData.content : [];
    const imgs: string[] = [];
    for (const entry of content) {
        if (entry?.type === "image" && entry?.originalUrl) {
            const w = entry.width ? ` width="${entry.width}"` : "";
            const h = entry.height ? ` height="${entry.height}"` : "";
            imgs.push(`<img src="${entry.originalUrl}" alt=""${w}${h} />`);
        }
    }
    const imgsHtml = imgs.length ? `<div>${imgs.join("\n")}</div>` : "";

    return [title, `${contentHtmlStr}\n${imgsHtml}`, author];
}

/**
 * =========================
 * Helpers
 * =========================
 */
function fromTypeGetStr(type: ZhihuType) {
    switch (type) {
        case "article":
            return "文章";
        case "question":
            return "提问";
        case "answer":
            return "回答";
        case "pin":
            return "想法";
    }
}

function removeSpecialChars(input: string): string {
    // 删除让链接无法工作的符号：# ^ [ ] |
    input = input.replace(/[#^[\]|]/g, "");
    if (Platform.isMacOS) {
        // macOS 不允许：\ / :
        input = input.replace(/[\\/ :]/g, "");
    } else {
        // Windows/Android 等：/ \ " * : | ? < >
        input = input.replace(/[/\\<>"*:|]/g, "");
        input = input.replace(/\?/g, "？");
    }
    return input;
}

function stripHtmlTags(input: string): string {
    return input.replace(/<[^>]*>/g, "");
}

function getQuestionAndAnswerId(link: string): [string, string] {
    const match = link.match(
        /^https?:\/\/www\.zhihu\.com\/question\/(\d+)\/answer\/(\d+)/,
    );
    if (match) return [match[1], match[2]];
    return ["", ""];
}

function getArticleId(link: string): string {
    const match = link.match(/^https:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)$/);
    if (match) return match[1];
    return "";
}

function getPinId(link: string): string {
    const match = link.match(/^https:\/\/www\.zhihu\.com\/pin\/(\d+)$/);
    if (match) return match[1];
    return "";
}

function getQestionId(link: string): string {
    const match = link.match(/^https:\/\/www\.zhihu\.com\/question\/(\d+)$/);
    if (match) return match[1];
    return "";
}

export class ZhihuInputLinkModal extends Modal {
    inputEl: TextComponent;
    private overwrite = true; // 默认覆盖

    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: locale.ui.enterZhihuLink });

        // 单链接输入框
        this.inputEl = new TextComponent(contentEl);
        this.inputEl.inputEl.addClass("zhihu-link-input");
        this.inputEl.setPlaceholder(locale.ui.enterZhihuLinkPlaceholder);

        // 添加键盘事件监听
        this.inputEl.inputEl.addEventListener(
            "keydown",
            async (event: KeyboardEvent) => {
                if (event.key !== "Enter") return;
                const value = this.inputEl.getValue().trim();
                await new ZhihuOpener(this.app).open({
                    url: value,
                    overwrite: this.overwrite,
                });
                this.close();
            },
        );

        // ===== 纯 HTML 行 =====
        const row = contentEl.createDiv();
        row.addClass("open-link-model-raw");

        // 批量打开链接按钮
        const batchBtn = new ButtonComponent(row);
        batchBtn.setButtonText(locale.ui.batchOpenBtn);
        batchBtn.onClick(() => {
            new ZhihuBatchLinkModal(this.app).open();
        });

        // 弹性空白
        const spacer = row.createDiv();
        spacer.addClass("open-link-model-spacer");

        // 覆盖已有文件
        const owLabel = row.createSpan({
            text: locale.ui.overwriteExistingFiles,
        });
        owLabel.addClass("open-link-model-label");

        const owToggle = new ToggleComponent(row);
        owToggle.setValue(true); // 默认覆盖
        owToggle.onChange((v) => {
            this.overwrite = v;
        });

        // 保存图片
        const label = row.createSpan({ text: locale.ui.saveImages });
        label.addClass("open-link-model-label");

        const toggle = new ToggleComponent(row);

        // 初始化 toggle
        (async () => {
            try {
                const settings = await loadSettings(this.app.vault);
                toggle.setValue(!!settings.turnImgOffline);
            } catch (e) {
                console.error("load settings failed:", e);
            }
        })();

        toggle.onChange(async (value) => {
            try {
                await saveSettings(this.app.vault, { turnImgOffline: value });
            } catch (e) {
                console.error("save settings failed:", e);
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class ZhihuBatchLinkModal extends Modal {
    private textareaEl!: HTMLTextAreaElement;

    private folderPathRel: string; // vault 内相对路径（真正用于写入）
    private offline = false; // 本次批量开关（覆盖全局）
    private overwrite = true; // 默认覆盖

    constructor(app: App) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: locale.ui.batchOpenTitle });

        // 默认 offline 取全局设置
        const settings = await loadSettings(this.app.vault);
        this.offline = !!settings.turnImgOffline;
        this.folderPathRel = settings.defaultSaveFolder;

        /**
         * =========
         * 第一行：目录
         * =========
         */
        const dirRow = contentEl.createDiv({ cls: "zhihu-batch-dir-row" });
        dirRow.addClass("open-link-batch-model-dir");
        dirRow.createSpan({ text: locale.ui.saveDir });

        const dirValueEl = dirRow.createSpan({
            text: `${this.folderPathRel}/`,
        });
        dirValueEl.addClass("open-link-batch-model-dir-value");

        // 弹性空白
        const spacer = dirRow.createDiv();
        spacer.addClass("open-link-model-spacer");

        const pickBtn = new ButtonComponent(dirRow);
        pickBtn.setButtonText(locale.ui.choose);
        pickBtn.onClick(() => {
            // 打开文件夹选择器
            new FolderSuggestModal(this.app, (folder) => {
                this.folderPathRel = folder.path;
                // if (this.folderPathRel === "/")

                // 更新 UI
                const displayPath = folder.path === "/" ? "" : folder.path;
                dirValueEl.setText(`${displayPath}/`);
            }).open();
        });
        // 在下面展示绝对路径，便于用户确认
        const absHint = contentEl.createDiv({ cls: "zhihu-batch-abs-hint" });
        absHint.addClass("open-link-batch-model-path-hint");
        absHint.setText(locale.ui.asbPathHint);

        /**
         * =========
         * 第二行：保存图片
         * =========
         */
        const offlineRow = contentEl.createDiv({
            cls: "zhihu-batch-offline-row",
        });
        offlineRow.addClass("open-link-batch-model-row");
        offlineRow.createSpan({ text: locale.ui.saveImages });

        const offlineSpacer = offlineRow.createDiv();
        offlineSpacer.addClass("open-link-model-spacer");

        const offlineToggle = new ToggleComponent(offlineRow);
        offlineToggle.setValue(this.offline);
        offlineToggle.onChange((v) => {
            this.offline = v;
        });

        /**
         * =========
         * 第三行：覆盖已有文件
         * =========
         */
        const overwriteRow = contentEl.createDiv({
            cls: "zhihu-batch-overwrite-row",
        });
        overwriteRow.addClass("open-link-batch-model-row");
        overwriteRow.createSpan({ text: locale.ui.overwriteExistingFiles });

        const overwriteSpacer = overwriteRow.createDiv();
        overwriteSpacer.addClass("open-link-model-spacer");

        const overwriteToggle = new ToggleComponent(overwriteRow);
        overwriteToggle.setValue(true); // 默认覆盖
        overwriteToggle.onChange((v) => (this.overwrite = v));

        /**
         * =========
         * Textarea
         * =========
         */
        this.textareaEl = contentEl.createEl("textarea");
        this.textareaEl.addClass("open-link-batch-model-text-area");
        this.textareaEl.placeholder = locale.ui.textAreaPlaceHolder;

        /**
         * =========
         * Footer buttons
         * =========
         */
        const footer = contentEl.createDiv({ cls: "zhihu-batch-footer" });
        footer.addClass("open-link-batch-model-footer");

        const cancelBtn = new ButtonComponent(footer);
        cancelBtn.setButtonText(locale.ui.cancel);
        cancelBtn.onClick(() => this.close());

        const startBtn = new ButtonComponent(footer);
        startBtn.setButtonText(locale.ui.begin);
        startBtn.setCta();
        startBtn.onClick(async () => {
            await this.runBatch();
        });
    }

    private async runBatch() {
        const raw = this.textareaEl?.value ?? "";
        const links = raw
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

        if (links.length === 0) {
            new Notice(locale.notice.cantFindLinks);
            return;
        }

        const opener = new ZhihuOpener(this.app);

        let ok = 0;
        let bad = 0;

        for (const url of links) {
            try {
                await opener.open({
                    url,
                    destFolder: this.folderPathRel,
                    offlineImages: this.offline,
                    overwrite: this.overwrite,
                });
                ok++;
            } catch (e) {
                console.error(locale.error.batchOpenFailed, url, e);
                bad++;
            }
        }

        new Notice(
            `${locale.notice.batchOpenComplete}\n
${locale.ui.success} ${ok}\n
${locale.ui.failed} ${bad}`,
        );
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}
