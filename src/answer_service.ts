import { App, TextComponent, Vault, Modal, Notice, requestUrl } from "obsidian";
import * as dataUtil from "./data";
import * as fm from "./frontmatter";
import * as render from "./custom_render";
import { v4 as uuidv4 } from "uuid";
import * as cookies from "./cookies";
import { addPopularizeStr } from "./popularize";
import { loadSettings } from "./settings";
import { fmtDate } from "./utilities";
import i18n, { type Lang } from "../locales";
import { parseDisclaimer } from "./disclaimer";

const locale: Lang = i18n.current;

export class ZhihuQuestionLinkModal extends Modal {
    inputEl: TextComponent;
    onSubmit: (input: string) => void;

    constructor(app: App, onSubmit: (input: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: locale.ui.enterQuestionLink });

        this.inputEl = new TextComponent(contentEl);
        this.inputEl.inputEl.addClass("zhihu-question-input");
        this.inputEl.setPlaceholder(
            locale.ui.forExample + "https://www.zhihu.com/question/407774459",
        );

        // 添加键盘事件监听
        this.inputEl.inputEl.addEventListener(
            "keydown",
            (event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    const value = this.inputEl.getValue().trim();
                    if (!isZhihuQuestionLink(value)) {
                        new Notice(`${locale.notice.questionLinkInvalid}`);
                        return;
                    }
                    this.close();
                    this.onSubmit(value);
                }
            },
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}

export async function publishCurrentAnswer(app: App, toDraft = false) {
    const activeFile = app.workspace.getActiveFile();
    const locale = i18n.current;
    const vault = app.vault;
    const settings = await loadSettings(vault);
    if (!activeFile) {
        console.error(locale.error.noActiveFileFound);
        return;
    }
    const fileCache = app.metadataCache.getFileCache(activeFile);
    const frontmatter = fileCache?.frontmatter;
    if (!frontmatter) {
        new Notice(`${locale.notice.noFrontmatter}`);
        return;
    }
    const questionLink = frontmatter["zhihu-question"];
    if (!isZhihuQuestionLink(questionLink)) {
        new Notice(`${locale.notice.questionLinkInvalid}`);
        return;
    }
    const questionId = extractQuestionId(questionLink);
    const status = publishStatus(frontmatter["zhihu-link"]);
    const toc = !!frontmatter["zhihu-toc"];
    const disclaimer = frontmatter["zhihu-disclaimer"];
    const rawContent = await app.vault.read(activeFile);
    const rmFmContent = fm.removeFrontmatter(rawContent);

    let answerId = "";
    switch (status) {
        case 0:
            break;
        case 1:
            answerId = frontmatter["zhihu-link"].replace(
                `https://www.zhihu.com/question/${questionId}/answer/`,
                "",
            );
            break;
        case 3:
            new Notice(`${locale.notice.linkInvalid}`);
            return;
        default:
            new Notice(`${locale.error.unknownError}`);
            return;
    }
    let zhihuHTML = await render.remarkMdToHTML(app, rmFmContent);
    if (settings.popularize) {
        zhihuHTML = addPopularizeStr(zhihuHTML);
    }
    const patchBody = {
        content: zhihuHTML,
        draft_type: "normal",
        delta_time: 30,
        settings: {
            reshipment_settings: "allowed",
            comment_permission: "all",
            can_reward: false,
            tagline: "",
            disclaimer_status: "close",
            disclaimer_type: "none",
            commercial_report_info: {
                is_report: true,
            },
            push_activity: false,
            table_of_contents_enabled: toc,
            thank_inviter_status: "close",
            thank_inviter: "",
        },
    };

    await patchDraft(app.vault, questionId!, answerId, patchBody);

    if (toDraft) return; // 如果是发布为草稿，就不需要下面的步骤了

    const publishResult = await publishAnswerDraft(
        app.vault,
        questionId!,
        answerId,
        toc,
        zhihuHTML,
        disclaimer,
        status === 1,
    );
    answerId = publishResult.publish.id;
    const url = `https://www.zhihu.com/question/${questionId}/answer/${answerId}`;

    switch (status) {
        case 0:
            await app.fileManager.processFrontMatter(activeFile, (fm) => {
                fm["zhihu-link"] = url;
                fm["zhihu-created-at"] = fmtDate(new Date());
            });
            new Notice(`${locale.notice.publishAnswerSuccess}`);
            break;
        case 1:
            await app.fileManager.processFrontMatter(activeFile, (fm) => {
                fm["zhihu-updated-at"] = fmtDate(new Date());
            });
            new Notice(`${locale.notice.updateAnswerSuccess}`);
            break;
        default:
            new Notice(`${locale.error.unknownError}`);
            return;
    }
}

async function patchDraft(
    vault: Vault,
    questionId: string,
    answerId: string,
    patchBody: unknown,
) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookies.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "captcha_session_v2",
            "z_c0",
        ]);
        const xsrftoken = data.cookies?._xsrf ?? "";
        const url = `https://www.zhihu.com/api/v4/questions/${questionId}/draft`;
        await requestUrl({
            url: url,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: `https://www.zhihu.com/question/${questionId}/answer/${answerId}`,
                "x-requested-with": "fetch",
                "x-xsrftoken": xsrftoken,
                // 'x-zst-81': '3_2.0aR_sn77yn6O92wOB8hPZniUZo02x-7om0CNMDrxTrR2xQRY01T2Z-we8gGHPDRFZG0Y0jQgM7A2pr6P0mRPO7HoY70SfquPmz93mhDQyiqV9ebO1hwOYiiR0ELYuUrxmtDomqU7ynXtOnAoTh_PhRDSTFRC_EqXMywpykbOfrJHMoC2B8XxMSeVO6LosB9OGYUXYJUHq3UwprcxL7UeTvTrf9CCBicS8hggKgCeY68XsagpMBXLKwhO1xJO96LpGADwmDJSfVgcYbLeVmU3MJbO03qtLPD3M2CtKb4omVBS8ave87ggfu9eq1wtVpCYytCL_8vxmCqkw3BYL6gpKJULLhgpK2cfyJhXC6CHMogp1oH39RJSMSqH_QJN_CBFCQqHYwrrCih3__rx1K0tKbCLYIg3XhgcCZuFKzUH9hgHKarLO8MF0ST9ZQXLKeXYC',
                origin: "https://www.zhihu.com",
                // 'dnt': '1',
                // 'sec-gpc': '1',
                // 'sec-fetch-dest': 'empty',
                // 'sec-fetch-mode': 'cors',
                // 'sec-fetch-site': 'same-origin',
                // 'priority': 'u=4',
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "POST",
            body: JSON.stringify(patchBody),
        });
        new Notice(`${locale.notice.patchAnswerSuccess}`);
    } catch (error) {
        new Notice(`${locale.notice.patchAnswerFailed},${error}`);
    }
}

async function publishAnswerDraft(
    vault: Vault,
    id: string,
    answerId: string,
    toc: boolean,
    html: string,
    disclaimer: unknown,
    isPublished: boolean,
) {
    const { type: disclaimerType, status: disclaimerStatus } =
        parseDisclaimer(disclaimer);
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookies.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "captcha_session_v2",
            "z_c0",
            "q_c1",
        ]);
        const xsrftoken = data.cookies?._xsrf ?? "";
        const traceId = `${Date.now()},${uuidv4()}`;
        const response = await requestUrl({
            url: `https://www.zhihu.com/api/v4/content/publish`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                // 'referer': `https://zhuanlan.zhihu.com/p/${id}/edit`,
                "x-requested-with": "fetch",
                "x-xsrftoken": xsrftoken,
                // 'x-zse-93': '101_3_3.0',
                // 'x-zse-96': '2.0_LR8Q6m9DRDr5V67FbmueqQC2WpP4haQauHp/y0C25HxTT6Hw5+5hLKca68OOHRKY',
                // 'x-zst-81': '3_2.0aR_sn77yn6O92wOB8hPZniUZo02x-7om0CNMDrxTrR2xQRY01T2Z-we8gGHPDRFZG0Y0jQgM7A2pr6P0mRPO7HoY70SfquPmz93mhDQyiqV9ebO1hwOYiiR0ELYuUrxmtDomqU7ynXtOnAoTh_PhRDSTFTYO8Ug1sR316cH0fBV8jug87CtOAgNmkvx_VhFCUUCGFJemtGxfBBV0YCSTvTrf9CCBicS8hggKgCeY68XsagpMBXLKwhO1xJO96LpGADwmDJSfVgcYbLeVmU3MJbO03qtLPD3M2CtKb4omVBS8ave87ggfu9eq1wtVpCYytCL_8vxmCqkw3BYL6gpKJULLhgpK2cfyJhXC6CHMogp1oH39RJSMSqH_QJN_CBFCQqHYwrrCih3__rx1K0tKbCLYIg3XhgcCZuFKzUH9hgHKarLO8MF0ST9ZQXLKeXYC',
                // 'origin': 'https://zhuanlan.zhihu.com',
                // 'dnt': '1',
                // 'sec-gpc': '1',
                // 'sec-fetch-dest': 'empty',
                // 'sec-fetch-mode': 'cors',
                // 'sec-fetch-site': 'same-site',
                // 'priority': 'u=0',
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "POST",
            body: JSON.stringify({
                action: "answer",
                data: {
                    publish: {
                        traceId: traceId,
                    },
                    hybridInfo: {},
                    draft: isPublished
                        ? {
                              contentId: answerId,
                              isPublished: isPublished,
                              disabled: 1,
                          }
                        : {
                              isPublished: isPublished,
                              disabled: 1,
                          },
                    extra_info: {
                        question_id: id,
                        publisher: "pc",
                        include:
                            "is_visible,paid_info,paid_info_content,has_column,admin_closed_comment,reward_info,annotation_action,annotation_detail,collapse_reason,is_normal,is_sticky,collapsed_by,suggest_edit,comment_count,thanks_count,favlists_count,can_comment,content,editable_content,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt,attachment,content_source,is_labeled,endorsements,reaction_instruction,ip_info,relationship.is_authorized,voting,is_thanked,is_author,is_nothelp,is_favorited;author.vip_info,kvip_info,badge[*].topics;settings.table_of_content.enabled",
                        pc_business_params: `{"reshipment_settings":"allowed","comment_permission":"all","reward_setting":{"can_reward":false},"disclaimer_status":"close","disclaimer_type":"none","commercial_report_info":{"is_report":false},"commercial_zhitask_bind_info":null,"is_report":false,"table_of_contents_enabled":${toc},"thank_inviter_status":"close","thank_inviter":""}`,
                    },
                    hybrid: {
                        html: html,
                    },
                    reprint: {
                        reshipment_settings: "allowed",
                    },
                    commentsPermission: {
                        comment_permission: "all",
                    },
                    appreciate: {
                        can_reward: false,
                    },
                    publishSwitch: {
                        draft_type: "normal",
                    },
                    creationStatement: {
                        disclaimer_status: disclaimerStatus,
                        disclaimer_type: disclaimerType,
                    },
                    commercialReportInfo: {
                        isReport: 0,
                    },
                    toFollower: {},
                    contentsTables: {
                        table_of_contents_enabled: toc,
                    },
                    thanksInvitation: {
                        thank_inviter_status: "close",
                        thank_inviter: "",
                    },
                },
            }),
        });
        if (response.json.message === "success") {
            const result = JSON.parse(response.json.data.result);
            return result;
        } else if (response.json.code === 103003) {
            // 已回答过该问题，创建回答失败
            new Notice(response.json.message);
        }
    } catch (error) {
        new Notice(`${locale.notice.publishAnswerFailed},${error}`);
    }
}

export async function createNewZhihuAnswer(app: App, questionLink: string) {
    const { vault, workspace, fileManager } = app;

    let fileName = "untitled";
    let filePath = `${fileName}.md`;
    let counter = 1;

    // 检查文件是否存在，如果存在则递增数字
    while (vault.getAbstractFileByPath(filePath)) {
        fileName = `untitled ${counter}`;
        filePath = `${fileName}.md`;
        counter++;
    }

    try {
        const settings = await loadSettings(vault);
        const newFile = await vault.create(filePath, "");
        await fileManager.processFrontMatter(newFile, (fm) => {
            fm["zhihu-question"] = questionLink;
        });
        if (settings.setTocDefault) {
            await fileManager.processFrontMatter(newFile, (fm) => {
                fm["zhihu-toc"] = true;
            });
        }
        const leaf = workspace.getLeaf(false);
        await leaf.openFile(newFile);
        return filePath;
    } catch (error) {
        console.error(locale.error.createModifyFileFailed, error);
        throw error;
    }
}
export async function convertToNewZhihuAnswer(app: App, questionLink: string) {
    const { vault, workspace, fileManager } = app;

    // 获取当前活动文件
    const activeFile = workspace.getActiveFile();
    if (!activeFile) {
        new Notice("未找到当前活动文件");
        return;
    }

    try {
        const settings = await loadSettings(vault); // 给当前文件添加/更新 frontmatter 信息
        await fileManager.processFrontMatter(activeFile, (fm) => {
            fm["zhihu-question"] = questionLink;
        });
        if (settings.setTocDefault) {
            await fileManager.processFrontMatter(activeFile, (fm) => {
                fm["zhihu-toc"] = true;
            });
        }
        // 重新打开当前文件以刷新显示
        const leaf = workspace.getLeaf(false);
        await leaf.openFile(activeFile);

        new Notice("已将当前文件转换为知乎回答格式");
        return activeFile.path;
    } catch (error) {
        console.error(locale.error.createModifyFileFailed, error);
        new Notice("添加知乎回答元信息失败，请重试。");
    }
}

function publishStatus(link: string): number {
    if (typeof link === "undefined" || link === null) {
        // 如果链接为空或者不存在link这个属性
        // 说明未发表
        return 0;
    } else if (isZhihuAnswerLink(link)) {
        // 如果通过了知乎回答链接的正则匹配
        // 说明已经发表
        return 1;
    } else {
        return 3;
    }
}

function isZhihuAnswerLink(link: string): boolean {
    const pattern = /^https:\/\/www\.zhihu\.com\/question\/\d+\/answer\/\d+$/;
    return pattern.test(link);
}

function isZhihuQuestionLink(link: string): boolean {
    const pattern = /^https:\/\/www\.zhihu\.com\/question\/\d+\/?$/;
    return pattern.test(link);
}

function extractQuestionId(url: string): string | null {
    const match = url.match(/zhihu\.com\/question\/(\d+)/);
    return match ? match[1] : "";
}
