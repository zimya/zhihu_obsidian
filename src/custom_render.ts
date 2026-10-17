import { Vault, Notice, App, TFile, requestUrl } from "obsidian";
import { unified, Plugin, Transformer } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { wikiLink, wikiImgLink } from "micromark-extension-wiki-link";
import * as muwl from "mdast-util-wiki-link";
import { visit } from "unist-util-visit";
import { u } from "unist-builder";
import type { Element } from "hast";
import type {
    Link,
    Image,
    Text,
    Code,
    Root,
    Table,
    FootnoteReference,
    Heading,
    Blockquote,
    Paragraph,
} from "mdast";
import type { Options as RemarkRehypeOptions } from "remark-rehype";
import type { Parent, Node } from "unist";
import { loadSettings, ZhihuSettings } from "./settings";
import { getOnlineImg, getZhihuImg, getImgDimensions } from "./image_service";
import * as file from "./files";
import * as path from "path";
import remarkCallout from "@r4ai/remark-callout";
import { mathPlugin, zhihuEquation } from "./math";
import {
    prepareMathTables,
    renderZhihuTable,
    type MathTableResult,
    type MathTableFallback,
} from "./math_table";
import { validateEquation } from "./math_table_validation";
import * as mermaid from "./mermaid";
import { typst2tex } from "tex2typst";
import i18n, { type Lang } from "../locales";
import rehypeRaw from "rehype-raw";
import { typstCode2Img } from "./typst";
import { isWebUrl, toArrayBuffer } from "./utilities";
import { fileTypeFromBuffer } from "file-type";
import type { State } from "mdast-util-to-hast";

const locale: Lang = i18n.current;

// edit from `https://github.com/landakram/mdast-util-wiki-link/blob/master/src/from-markdown.ts`
// line 20-28
interface WikiImgLinkNode extends Node {
    type: "wikiImgLink";
    value: string;
    data: {
        alias: string;
        permalink: string;
        exists: boolean;
        hName?: string;
        hProperties?: {
            src: string;
            "data-caption": string;
            "data-size": string;
            "data-rawwidth": string;
            "data-rawheight": string;
            "data-watermark": string;
            "data-original-src": string;
            "data-watermark-src": string;
            "data-private-watermark-src": string;
        };
        hChildren: [];
    };
}

interface WikiLinkNode extends Node {
    type: "wikiLink";
    value: string;
    data: {
        alias: string;
        permalink: string;
        exists: boolean;
    };
}

interface RenderNode extends Node {
    value?: string;
    lang?: string | null;
    identifier?: string;
    depth?: number;
    url?: string;
    title?: string;
    tagName?: string;
    children?: RenderNode[];
    data?: {
        hName?: string;
        hProperties?: Record<string, unknown>;
        alias?: string;
        permalink?: string;
        exists?: boolean;
    };
}

function wikiLinkPlugin(this: import("unified").Processor, opts: object = {}) {
    const data = this.data() as unknown as Record<string, unknown>;

    function add(field: string, value: unknown) {
        const extensions = data[field];
        if (Array.isArray(extensions)) extensions.push(value);
        else data[field] = [value];
    }

    add("micromarkExtensions", wikiLink(opts)); // 处理 [[...]]
    add("micromarkExtensions", wikiImgLink(opts)); // 处理 ![[...]]
    add("fromMarkdownExtensions", muwl.fromMarkdownWikiLink(opts));
    add("fromMarkdownExtensions", muwl.fromMarkdownWikiImgLink(opts));
}
// ===================================================
// 获取![alt](link)格式的图片，先下载到本地，
// 再上传到知乎，获得链接URL，最后转换为知乎HTML
// 获取![[link|alt]]格式的本地图片，再上传到知乎
// ===================================================
export const remarkZhihuImgs: Plugin<[App], Parent, Parent> = (app) => {
    const vault = app.vault;
    const transformer: Transformer<Parent, Parent> = async (tree) => {
        const settings = await loadSettings(vault);
        const tasks: Promise<void>[] = [];

        visit(tree, "image", (node: Image) => {
            // remarkTypst 生成的图片已上传到知乎图床，无需再次下载
            if (node.data?.hName) return;
            tasks.push(handleMdImage(app, vault, settings, node));
        });

        visit(tree, "wikiImgLink", (node, idx, par) => {
            tasks.push(handleWikiImg(app, vault, settings, node, par, idx));
        });

        visit(tree, "code", (node, idx, par) => {
            tasks.push(handleMermaid(vault, settings, node, par, idx));
        });

        await Promise.all(tasks);
    };
    return transformer;
};

async function bufferToZhihuImageNode(
    vault: Vault,
    imgArrayBuffer: ArrayBuffer,
    alt: string,
): Promise<Image> {
    const imgRes = await getZhihuImg(vault, imgArrayBuffer);
    const fileType = await fileTypeFromBuffer(new Uint8Array(imgArrayBuffer));
    if (!fileType) {
        new Notice("无法识别图片类型");
        throw new Error("无法识别图片类型");
    }

    const ext = fileType.ext;
    const { width, height } = getImgDimensions(imgArrayBuffer);
    const url = `${imgRes.original_src}.${ext}`;

    return {
        type: "image",
        url,
        alt,
        data: {
            hName: "img",
            hProperties: {
                src: url,
                "data-caption": alt,
                "data-size": "normal",
                "data-rawwidth": `${width}`,
                "data-rawheight": `${height}`,
                "data-watermark": `${imgRes.watermark}`,
                "data-original-src": url,
                "data-watermark-src": `${imgRes.watermark_src}.${ext}`,
                "data-private-watermark-src": "",
            },
            hChildren: [],
        },
    };
}

function replaceNode(
    parent: Parent | null,
    index: number | null,
    oldNode: Node,
    newNode: Node,
) {
    if (parent && typeof index === "number") {
        parent.children[index] = newNode;
    } else {
        Object.assign(oldNode, newNode);
    }
}
// 处理 markdown 格式的图片
async function handleMdImage(
    app: App,
    vault: Vault,
    settings: ZhihuSettings,
    node: Image,
) {
    let alt = node.alt;
    const decodedUrl = decodeURIComponent(node.url ?? "");

    let imgArrayBuffer: ArrayBuffer;

    if (isWebUrl(decodedUrl)) {
        imgArrayBuffer = await getOnlineImg(vault, decodedUrl);
    } else {
        imgArrayBuffer = await file.getImgBufferFromName(app, decodedUrl);
    }

    if (!alt) {
        alt = settings.useImgNameDefault ? decodedUrl : "";
    }

    const imageNode = await bufferToZhihuImageNode(vault, imgArrayBuffer, alt);

    node.url = imageNode.url;
    node.data = imageNode.data;
}
// 处理 ![[link]] 图片
async function handleWikiImg(
    app: App,
    vault: Vault,
    settings: ZhihuSettings,
    node: WikiImgLinkNode,
    parent: Parent | null,
    index: number | null,
) {
    let alt = node.data.alias;
    const imgName = node.value;

    if (alt === imgName) {
        alt = settings.useImgNameDefault ? path.basename(imgName) : "";
    }

    const imgData = await file.getImgBufferFromName(app, imgName);
    const imageNode = await bufferToZhihuImageNode(vault, imgData, alt);

    replaceNode(parent, index, node, imageNode);
}
// 处理mermaid图片
async function handleMermaid(
    vault: Vault,
    settings: ZhihuSettings,
    node: Code,
    parent: Parent | null,
    index: number | null,
) {
    if (node.lang !== "mermaid") return;

    const svg = mermaid.cleanSvg(await mermaid.renderMermaid(node.value));
    const imgData = await mermaid.svgToPngBuffer(svg, settings.mermaidScale);
    const imgArrayBuffer = toArrayBuffer(imgData);

    const imageNode = await bufferToZhihuImageNode(vault, imgArrayBuffer, "");
    replaceNode(parent, index, node, imageNode);
}

export const remarkTypst: Plugin<[App], Parent, Parent> = (app) => {
    const vault = app.vault;
    const transformer: Transformer<Parent, Parent> = async (tree) => {
        const settings = await loadSettings(vault);
        const tasks: Promise<void>[] = [];
        if (settings.typstMode === false) {
            return;
        }
        visit(tree, "inlineMath", (node) => {
            const mathNode = node as RenderNode;
            const typst = mathNode.value ?? "";
            try {
                const tex = typst2tex(typst);
                mathNode.value = tex;
            } catch {
                console.error(`Typst inline math ${typst} conversion failed`);
                new Notice(`${locale.notice.inlineTypstConvertFailed}`);
            }
        });
        visit(tree, "math", (node) => {
            const mathNode = node as RenderNode;
            const typstEq = mathNode.value ?? "";
            const toPicTask = async () => {
                try {
                    const presetStyle = settings.typstPresetStyle;
                    const typstContent = `${presetStyle}\n$ ${typstEq} $`;
                    const imgArrayBuffer = await typstCode2Img(
                        typstContent,
                        vault,
                    );
                    Object.assign(
                        mathNode,
                        await bufferToZhihuImageNode(vault, imgArrayBuffer, ""),
                    );
                } catch (e) {
                    console.error("Typst display math conversion failed:", e);
                    new Notice(`${locale.notice.typstConvertImgFailed}`);
                    return;
                }
            };

            const toTeXTask = async () => {
                try {
                    const tex = typst2tex(typstEq);
                    mathNode.value = tex;
                } catch {
                    console.error(
                        `Typst display math ${typstEq} conversion failed`,
                    );
                    new Notice(`${locale.notice.displayTypstConvertFailed}`);
                    return;
                }
            };
            // 在设置中查看如何处理行间公式
            settings.typstDisplayToTeX
                ? tasks.push(toTeXTask()) // 转换成TeX
                : tasks.push(toPicTask()); // 转换成图片
        });
        visit(tree, "code", (node) => {
            const codeNode = node as RenderNode;
            const typstCode = codeNode.value ?? "";
            const lang = codeNode.lang;
            if (lang !== "typrender") {
                return;
            }
            const task = (async () => {
                try {
                    const presetStyle = settings.typstPresetStyle;
                    const typstContent = `${presetStyle}\n${typstCode}`;
                    const imgArrayBuffer = await typstCode2Img(
                        typstContent,
                        vault,
                    );
                    Object.assign(
                        codeNode,
                        await bufferToZhihuImageNode(vault, imgArrayBuffer, ""),
                    );
                } catch (error) {
                    console.error("Typst code conversion failed:", error);
                    new Notice("Typst 转换图片失败，请检查语法是否正确");
                    return;
                }
            })();
            tasks.push(task);
        });
        await Promise.all(tasks);
    };
    return transformer;
};

export async function remarkMdToHTML(app: App, md: string) {
    const idMap = new Map<string, number>(); // 原始id → 新编号
    const mathTableFallbacks = new Set<MathTableFallback>();
    let preparedTables = new Map<Table, MathTableResult>();
    const settings = await loadSettings(app.vault);
    const zhihuHandlers = {
        link(state: State, node: Link): Element {
            const properties: { [key: string]: string } = {};
            if (node.title === "card") {
                // EXAMPLE:
                // [Github](https://github.com/ "card")
                // <a data-draft-node="block" data-draft-type="link-card" href="https://github.com/">Github</a>
                properties.href = node.url;
                properties["data-draft-node"] = "block";
                properties["data-draft-type"] = "link-card";
                properties["data-draft-title"] = getLinkText(node);
                properties["data-draft-cover"] = "";
            } else if (node.title && node.title.includes("member_mention")) {
                // EXAMPLE:
                // [@Dong](https://www.zhihu.com/people/dong-jun-kai "member_mention_ed006411b00ce202f72d45c413246050")
                // <a class="member_mention" href="/people/dong-jun-kai" data-hash="ed006411b00ce202f72d45c413246050">@Dong</a>
                const hash = node.title.replace("member_mention_", "");
                const peopleId = node.url.replace(
                    "https://www.zhihu.com/people/",
                    "",
                );
                properties.class = "member_mention";
                properties.href = `/people/${peopleId}`;
                properties["data-hash"] = hash;
            } else {
                // EXAMPLE:
                // [Github](https://github.com/)
                // <a href="https://github.com/">Github</a>
                properties.href = node.url;
            }

            return {
                type: "element",
                tagName: "a",
                properties,
                children: state.all(node),
            };
        },
        inlineMath(state: State, node: RenderNode): Element {
            return zhihuEquation(node.value ?? "", false);
        },
        math(state: State, node: RenderNode): Element {
            return zhihuEquation(node.value ?? "", true);
        },
        // EXAMPLE:
        // ```python
        // print("hello")
        // ```
        // <pre lang="python">
        // print("hello")
        // </pre>
        code(state: State, node: RenderNode): Element {
            const lang = node.lang || "";
            const code = node.value ? node.value.trim() : "";
            return {
                type: "element",
                tagName: "pre",
                properties: { lang: lang },
                children: [u("text", code)],
            };
        },
        table(state: State, node: Table): Element | Element[] {
            return renderZhihuTable(
                state,
                node,
                (reason) => {
                    mathTableFallbacks.add(reason);
                },
                preparedTables.get(node),
            );
        },
        // EXAMPLE:
        // <sup data-text="注释文本" data-url="https://www.github.com"
        // data-draft-node="inline" data-draft-type="reference"
        // data-numero="1">[1]</sup>
        footnoteReference(state: State, node: FootnoteReference): Element {
            const rawId = String(node.identifier).toUpperCase(); // 标准化 id（内部存的是大写）
            // 分配新编号
            let numero = idMap.get(rawId);
            if (!numero) {
                numero = idMap.size + 1;
                idMap.set(rawId, numero);
            }
            // 从 state.footnoteById 拿到 FootnoteDefinition 节点
            const def = state.footnoteById.get(rawId);
            if (!def) {
                // 没找到定义就直接渲染一个普通的 [1]
                return {
                    type: "element",
                    tagName: "sup",
                    properties: {},
                    children: [{ type: "text", value: `[${numero}]` }],
                };
            }

            // 解析 def.children[0]（第一个段落）里的文本和链接
            const para = def.children.find(
                (child) => child.type === "paragraph",
            );
            let text = "";
            let url = "";
            for (const child of para?.children ?? []) {
                if (child.type === "text") text += child.value.trim();
                if (child.type === "link") url = child.url;
            }

            return {
                type: "element",
                tagName: "sup",
                properties: {
                    "data-text": text,
                    "data-url": url,
                    "data-draft-node": "inline",
                    "data-draft-type": "reference",
                    "data-numero": String(numero),
                },
                children: [u("text", `[${numero}]`)],
            };
        },

        footnoteDefinition(): undefined {
            return;
        },
        // 如果是一个#，则是二级标题<h2>
        // 如果是两个#，则是三级标题<h3>
        // 如果是三个及以上的#，则是加粗处理
        heading(state: State, node: Heading): Element {
            const children = state.all(node) as Element[];
            // 如果不使用知乎特色的标题，那么直接几级就转换成几级的HTML
            if (!settings.useZhihuHeadings) {
                return {
                    type: "element",
                    tagName: "h" + node.depth,
                    properties: {},
                    children,
                };
            }
            switch (node.depth) {
                case 1:
                    return {
                        type: "element",
                        tagName: "h2",
                        properties: {},
                        children,
                    };
                case 2:
                    return {
                        type: "element",
                        tagName: "h3",
                        properties: {},
                        children,
                    };
                default:
                    return {
                        type: "element",
                        tagName: "p",
                        properties: {},
                        children: [
                            {
                                type: "element",
                                tagName: "strong",
                                properties: {},
                                children,
                            },
                        ],
                    };
            }
        },
        // Obsidian callout语法支持
        blockquote(state: State, node: Blockquote): Element {
            // 如果不存在callout，说明是普通引用块，则返回原本结果
            if (node.data?.hProperties?.dataCallout === undefined) {
                return {
                    type: "element",
                    tagName: "blockquote",
                    properties: {},
                    children: state.all(node),
                };
            }
            const props = node.data?.hProperties || {};
            // ignore类型直接返回空 p
            // EXAMPLE:
            // > [!ignore] Title
            // > some text
            const ignoreType = ["ignore", "忽略", "注释"];
            if (ignoreType.includes(String(props.dataCalloutType))) {
                return {
                    type: "element",
                    tagName: "p",
                    properties: {},
                    children: [],
                };
            }

            // 找到标题段落（带有 dataCalloutTitle）
            const titleParagraph = node.children.find(
                (child) => child.data?.hProperties?.dataCalloutTitle,
            );

            // 提取标题文本
            const titleChild =
                titleParagraph && "children" in titleParagraph
                    ? titleParagraph.children[0]
                    : undefined;
            const titleText =
                titleChild && "value" in titleChild
                    ? String(titleChild.value ?? "")
                    : "";

            // 提取正文（去掉 title 节点和嵌套 blockquote）
            const contentNodes = node.children
                .filter((child) => {
                    const hName = child.data?.hName;
                    return (
                        hName !== "div" ||
                        !child.data?.hProperties?.dataCalloutTitle
                    );
                })
                .flatMap((child) => {
                    // 若是嵌套 blockquote 包含 dataCalloutBody，取其子项
                    if (
                        child.type === "blockquote" &&
                        child.data?.hProperties?.dataCalloutBody
                    ) {
                        return child.children;
                    }
                    return [child];
                });

            return {
                type: "element",
                tagName: "p",
                properties: {},
                children: [
                    {
                        type: "element",
                        tagName: "strong",
                        properties: {},
                        children: [u("text", titleText)],
                    },
                    ...state.all({
                        type: "root",
                        children: contentNodes,
                    }),
                ],
            };
        },
        // 处理 obsidian 内链，如果内链是一篇知乎文章，则会提取链接和文件名作为知乎链接
        // 否则就是普通的下划线文字
        wikiLink(state: State, node: WikiLinkNode): Element {
            const name = node.value;
            const alias = node.data.alias;
            const alt = alias ? alias : name; // 一般来说`alias`都是存在的
            const mdFile = file.getFilePathFromName(app, name);

            if (mdFile instanceof TFile) {
                const metadata = app.metadataCache.getFileCache(mdFile);
                const fm = metadata?.frontmatter;
                // 如果zhihu-link链接存在，则说明是知乎文章，进一步处理内链
                if (fm && fm["zhihu-link"]) {
                    const properties: { [key: string]: string } = {};
                    properties.href = fm["zhihu-link"];
                    const source = String(state.options.file?.value ?? "");
                    if (isNodeAloneInLine(node, source)) {
                        // 如果内链前没有任何内容，视为另起一行，做成card链接
                        properties["data-draft-node"] = "block";
                        properties["data-draft-type"] = "link-card";
                        properties["data-draft-title"] = alias;
                        properties["data-draft-cover"] = "";
                    }
                    return {
                        type: "element",
                        tagName: "a",
                        properties,
                        children: [u("text", alt)],
                    };
                }
            }
            return {
                type: "element",
                tagName: "u",
                properties: {},
                children: [u("text", name)],
            };
        },
        // 如果是卡片链接，那么不需要被p标签包裹，否则在知乎卡片视图下会变成普通链接。
        paragraph(state: State, node: Paragraph): Element | Element[] {
            if (
                node.children?.length === 1 &&
                node.children[0]?.type === "link" &&
                node.children[0]?.title === "card"
            ) {
                return state.all(node)[0] as Element;
            }

            return {
                type: "element",
                tagName: "p",
                properties: {},
                children: state.all(node),
            };
        },
    };
    const rehypeOpts: RemarkRehypeOptions = {
        allowDangerousHtml: true,
        handlers: zhihuHandlers,
    };
    const output = await unified()
        .use(remarkParse)
        .use(remarkGfm) // 解析脚注、表格等
        .use(mathPlugin) // 解析数学公式
        .use(wikiLinkPlugin) // 解析 Obsidian 风格的图片链接
        .use(remarkCallout) // 解析 Obsidian 风格的 Callout
        .use(remarkSplitLinesToParagraphs) // 换行符换行
        .use(remarkTypst, app) // 将数学公式转换为 Typst 或者图片节点
        .use(remarkZhihuImgs, app) // 将上面解析的图片节点和维基链接节点转换为知乎图片
        .use(() => async (tree: Root) => {
            preparedTables = await prepareMathTables(tree, (url) =>
                validateEquation(() => requestUrl({ url, throw: false })),
            );
        })
        .use(remarkRehype, undefined, rehypeOpts) // 转换其余不需要异步的节点
        .use(rehypeRaw) // 解析 HTML 标签
        // .use(rehypeFormat, { indent: 0 }) // 会导致行内公式被强制换行
        .use(rehypeRemoveBlockNewlines) // 去除HTML中的换行，避免在知乎网页端编辑的时候会出现大量换行
        .use(rehypeStringify)
        .process(md);

    const htmlOutput = String(output);
    for (const reason of mathTableFallbacks) {
        const message =
            reason === "size"
                ? locale.notice.mathTableTooLarge
                : reason === "render"
                  ? locale.notice.mathTableRenderFailed
                  : locale.notice.mathTableKeptNative;
        new Notice(message, 10000);
    }
    console.log(htmlOutput);
    return htmlOutput;
}
// 检测node是否单独一行
function isNodeAloneInLine(node: RenderNode, source: string): boolean {
    const pos = node.position;
    if (!pos?.start || !pos?.end) return false;
    const { start, end } = pos;
    if (start.line !== end.line) return false;

    const line = source.split(/\r?\n/)[start.line - 1] ?? "";
    const before = line.slice(0, start.column - 1).trim();
    const after = line.slice(end.column - 1).trim();
    return before === "" && after === "";
}

// 提取[link_text](link_url)中的`link_text`
function getLinkText(node: Link): string {
    return node.children
        .filter((child): child is Text => child.type === "text")
        .map((child) => child.value)
        .join("");
}

// 将remark break替换成如下自定义插件
// 因为remark break不会将单独一行作为一个p标签，而是会用一个大的p标签包裹，加<br>
// 但知乎是每一行都是被一个p标签包裹的
function remarkSplitLinesToParagraphs() {
    return (tree: Parent) => {
        visit(
            tree,
            "paragraph",
            (
                node: RenderNode,
                index: number | undefined,
                parent: Parent | undefined,
            ) => {
                if (!parent || index === undefined) return;

                const groups: RenderNode[][] = [[]];

                for (const child of node.children ?? []) {
                    if (child.type === "break") {
                        groups.push([]);
                        continue;
                    }
                    if (child.type === "text") {
                        const parts = (child.value ?? "").split(/\n/);
                        for (let i = 0; i < parts.length; i++) {
                            if (i > 0) groups.push([]);
                            if (parts[i]) {
                                groups[groups.length - 1].push({
                                    type: "text",
                                    value: parts[i],
                                });
                            }
                        }
                        continue;
                    }
                    groups[groups.length - 1].push(child);
                }

                const nonEmptyGroups = groups.filter((g) => g.length > 0);

                if (nonEmptyGroups.length <= 1) return;

                const newNodes = nonEmptyGroups.map((children) => ({
                    type: "paragraph",
                    children,
                }));

                parent.children.splice(index, 1, ...newNodes);

                return index + newNodes.length;
            },
        );
    };
}

// 去除多余的空行
function rehypeRemoveBlockNewlines() {
    return (tree: Parent) => {
        visit(
            tree,
            (
                node: RenderNode,
                index: number | undefined,
                parent: Parent | undefined,
            ) => {
                // 遇到代码块 <pre> 或 <code>，跳过其子节点的遍历，防止破坏代码格式
                if (
                    node.type === "element" &&
                    (node.tagName === "pre" || node.tagName === "code")
                ) {
                    return "skip";
                }

                // 如果当前节点是单纯的换行符文本，且它不是代码块内部的内容，将其删除
                if (
                    node.type === "text" &&
                    node.value === "\n" &&
                    parent &&
                    index !== undefined
                ) {
                    parent.children.splice(index, 1);
                    // 返回当前索引，避免因为数组截断导致遍历跳过下一个节点
                    return index;
                }
            },
        );
    };
}
