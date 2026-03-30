import { App, Vault, Notice, Modal, requestUrl } from "obsidian";
import QRCode from "qrcode";
import * as dataUtil from "./data";
import * as cookieUtil from "./cookies";
import { loadSettings, saveSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;

export class QRCodeModal extends Modal {
    private link: string;
    private canvas: HTMLCanvasElement | null = null;
    onCloseCallback: (() => void) | null = null;

    constructor(app: any, link: string) {
        super(app);
        this.link = link;
    }
    async onOpen() {
        this.modalEl.addClass("zhihu-qrcode-modal");
        const { contentEl } = this;
        const titleContainer = contentEl.createEl("div", {
            cls: "qrcode-title",
        });
        titleContainer.createEl("span", { text: locale.ui.scanLoginToZhihu });
        contentEl.classList.add("zhihu-qrcode-modal");
        this.canvas = contentEl.createEl("canvas");
        await this.renderQRCode(this.link);
    }

    async renderQRCode(link: string) {
        if (!this.canvas) return;
        try {
            await QRCode.toCanvas(this.canvas, link, {
                width: 256,
                margin: 2,
                color: {
                    dark: "#3274ee",
                    light: "#00000000",
                },
            });
        } catch (err) {
            const { contentEl } = this;
            contentEl.createEl("p", {
                text: locale.ui.generateQRCodeFailed + err,
            });
        }
    }

    async updateQRCode(newLink: string) {
        this.link = newLink;
        await this.renderQRCode(newLink);
    }

    showSuccess() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("div", {
            text: "✅" + locale.ui.scanSuccess,
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    setOnCloseCallback(callback: () => void) {
        this.onCloseCallback = callback;
    }
}

export async function zhihuQRcodeLogin(app: App) {
    const vault = app.vault;
    await initCookies(vault);
    await signInNext(vault);
    await initUdidCookies(vault);
    await scProfiler(vault);
    const login = await getLoginLink(vault);
    await captchaSignIn(vault);
    const modal = new QRCodeModal(app, login.link);
    modal.open();
    let token = login.token;
    const interval = setInterval(async () => {
        const response = await fetchQRcodeStatus(vault, token);
        const res = response?.json;
        if ("status" in res) {
            if (res.status === 1) {
                modal.showSuccess();
            } else if (res.status === 5) {
                if (res.new_token) {
                    const newToken = res.new_token.Token;
                    const newLink = loginLinkBuilder(newToken);
                    modal.updateQRCode(newLink);
                    token = newToken;
                    new Notice(`${locale.notice.QRCodeRefreshed}`);
                }
            }
        } else {
            const zc0_cookie = cookieUtil.getCookiesFromHeader(response);
            await dataUtil.updateData(vault, { cookies: zc0_cookie });
            await dataUtil.updateData(vault, { bearer: res });
            await signInZhihu(vault);
            await prodTokenRefresh(vault);
            await getUserInfo(vault);
            modal.close();
            clearInterval(interval);
        }
    }, 2000);
    // 确保手动关闭modal也能清除轮询
    modal.setOnCloseCallback(() => {
        clearInterval(interval);
    });
}

const ZHIHU_EXAMPLE_QUESTION_URL = "https://www.zhihu.com/question/19550225";
const ZHIHU_LOGIN_URL = "https://www.zhihu.com/signin";

/**
 * 核心模块：通用 Zhihu Cookie 提取器
 * 负责创建 Electron 窗口、管理 session 分区、监听页面加载并提取所需 Cookie
 */
async function extractZhihuCookiesViaWindow(
    partition: string,
    windowOptions: { width: number; height: number },
    initialUrl: string,
    isLoginFlow: boolean,
): Promise<Record<string, string>> {
    const remote = window.require("@electron/remote");
    const { BrowserWindow, session } = remote;

    // 为无痕登录窗创建独立的非持久分区
    // 非持久化，会在窗口全关后销毁
    const ses = session.fromPartition(partition);

    // 只清理这个分区，避免：
    // DOMException: Failed to execute 'transaction' on 'IDBDatabase':
    // The database connection is closing.
    await ses.clearStorageData({
        origin: "https://www.zhihu.com",
        storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"],
    });

    return new Promise<Record<string, string>>((resolve, reject) => {
        const win = new BrowserWindow({
            width: windowOptions.width,
            height: windowOptions.height,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition,
            },
        });

        win.loadURL(initialUrl).catch(reject);

        win.webContents.on("did-finish-load", async () => {
            try {
                const url = win.webContents.getURL();

                // 仅在登录流程下，如果重定向到了首页，则跳转到示例问题页
                if (isLoginFlow && url === "https://www.zhihu.com/") {
                    await win.loadURL(ZHIHU_EXAMPLE_QUESTION_URL);
                    return;
                }

                if (url.startsWith(ZHIHU_EXAMPLE_QUESTION_URL)) {
                    // 从“无痕分区”的 cookies 取值
                    // 此时只会有三个cookie：_xsrf、BEC、__zse_ck (刷新时)
                    // 最重要的是__zse_ck cookie
                    const cookies = await ses.cookies.get({
                        url: "https://www.zhihu.com",
                    });
                    const zse = cookies.find((c: any) => c.name === "__zse_ck");
                    if (!zse) {
                        new Notice(`${locale.notice.zseckFetchFailed}`);
                        return;
                    }

                    // 将获取的 cookie 转换成 JSON 形式
                    const cookieObj: Record<string, string> = {};
                    cookies.forEach((c: { name: string; value: string }) => {
                        cookieObj[c.name] = c.value;
                    });

                    win.close();
                    resolve(cookieObj);
                }
            } catch (e) {
                reject(e);
            }
        });

        win.on("closed", () => reject(new Error("用户关闭了登录窗口")));
    });
}

export async function zhihuWebLogin(app: App, isNew = false): Promise<void> {
    const vault = app.vault;
    const settings = await loadSettings(vault);

    // 如果是新的登录窗口，则创建一个新分区，否则使用已有的，已经登录账号的分区。
    const newPartition = `zhihu-login-${new Date().getTime()}`;
    const partition = isNew ? newPartition : settings.partition;

    // 调用公共模块获取 Cookie
    const cookies = await extractZhihuCookiesViaWindow(
        partition,
        { width: 800, height: 600 },
        ZHIHU_LOGIN_URL,
        true, // 标记为登录流程，开启重定向判定
    );

    new Notice(`${locale.notice.loginSuccess}`);

    // Cookie 获取成功后的业务逻辑
    await dataUtil.updateData(vault, { cookies });
    await getUserInfo(vault);

    if (isNew) {
        await saveSettings(vault, { partition: newPartition });
    }
}

let refreshCookiesPromise: Promise<void> | null = null;

// 这个函数用于自动刷新zse_ck cookie，因为它会定时失效
export async function zhihuRefreshZseCookies(app: App): Promise<void> {
    if (refreshCookiesPromise) {
        return refreshCookiesPromise;
    }

    // 只有第一次触发时才弹出通知
    new Notice(locale.notice.refreshCookies);

    refreshCookiesPromise = (async () => {
        const vault = app.vault;
        const settings = await loadSettings(vault);
        const partition = settings.partition;

        // 调用公共模块获取 Cookie (小窗、直接跳转目标页)
        const cookies = await extractZhihuCookiesViaWindow(
            partition,
            { width: 100, height: 100 },
            ZHIHU_EXAMPLE_QUESTION_URL,
            false, // 标记为非登录流程，直接提取
        );

        await dataUtil.updateData(vault, { cookies });
        new Notice(`${locale.notice.refreshCookiesSuccess}`);
    })();

    // 无论最终 Promise 是成功还是失败，都要将其置空，保证不影响未来的正常刷新
    refreshCookiesPromise.finally(() => {
        refreshCookiesPromise = null;
    });

    return refreshCookiesPromise;
}

export async function checkIsUserLogin(vault: Vault) {
    const data = await dataUtil.loadData(vault);
    if (data && "userInfo" in data && data.userInfo) {
        return true;
    } else {
        return false;
    }
}

async function initCookies(vault: Vault) {
    try {
        const settings = await loadSettings(vault);
        const response = await requestUrl({
            url: "https://www.zhihu.com",
            headers: {
                "User-Agent": settings.user_agent,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                DNT: "1",
                "Sec-GPC": "1",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                Priority: "u=0, i",
            },
            method: "GET",
        });
        const cookies = cookieUtil.getCookiesFromHeader(response);
        new Notice(`${locale.notice.fetchInitCookiesSuccess}`);
        await dataUtil.updateData(vault, { cookies: cookies });
    } catch (error) {
        new Notice(`${locale.notice.fetchInitCookiesFailed},${error}`);
    }
}

async function signInNext(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
        ]);
        await requestUrl({
            url: "https://www.zhihu.com/signin?next=%2F",
            headers: {
                "User-Agent": settings.user_agent,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                DNT: "1",
                "Sec-GPC": "1",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                Priority: "u=0, i",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
    } catch (error) {
        new Notice(`${locale.notice.redirectionToSigninFailed}`);
    }
}

// 可获得cookie d_c0
async function initUdidCookies(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
        ]);
        const xsrftoken = data.cookies._xsrf;
        const response = await requestUrl({
            url: "https://www.zhihu.com/udid",
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                Referer: "https://www.zhihu.com/signin?next=%2F",
                "x-xsrftoken": xsrftoken,
                "x-zse-93": "101_3_3.0",
                // 'x-zse-96': '2.0_WOZM=RCjY6RrNnbgjIrINcDa+pa2jlkfC8fA11VI+YGer2mtT/pKtc7Cb6AHkT1G',
                Origin: "https://www.zhihu.com",
                DNT: "1",
                "Sec-GPC": "1",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                Priority: "u=4",
                Cookie: cookiesHeader,
            },
            method: "POST",
        });
        const udid_cookies = cookieUtil.getCookiesFromHeader(response);
        await dataUtil.updateData(vault, { cookies: udid_cookies });
    } catch (error) {
        new Notice(`${locale.notice.fetchUDIDFailed},${error}`);
    }
}

async function scProfiler(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
        ]);
        await requestUrl({
            url: "https://www.zhihu.com/sc-profiler",
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                Referer: "https://www.zhihu.com/signin?next=%2F",
                Origin: "https://www.zhihu.com",
                DNT: "1",
                "Sec-GPC": "1",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                Cookie: cookiesHeader,
            },
            body: JSON.stringify([
                [
                    "i",
                    "production.heifetz.desktop.v1.za_helper.init.count",
                    1,
                    1,
                ],
            ]),
            method: "POST",
        });
    } catch (error) {
        new Notice(`${locale.notice.requestSCprofilerFailed},${error}`);
    }
}

async function getLoginLink(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
        ]);
        const response = await requestUrl({
            url: "https://www.zhihu.com/api/v3/account/api/login/qrcode",
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                Referer: "https://www.zhihu.com/signin?next=%2F",
                Origin: "https://www.zhihu.com",
                DNT: "1",
                "Sec-GPC": "1",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                Priority: "u=4",
                Cookie: cookiesHeader,
            },
            method: "POST",
        });
        new Notice(`${locale.notice.getLoginLinkSuccess}`);
        await dataUtil.updateData(vault, { login: response.json });
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.getLoginLinkFailed},${error}`);
    }
}

// 可获得cookie captcha_session_v2
async function captchaSignIn(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
        ]);
        const response = await requestUrl({
            url: "https://www.zhihu.com/api/v3/oauth/captcha/v2?type=captcha_sign_in",
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                Referer: "https://www.zhihu.com/signin?next=%2F",
                "x-requested-with": "fetch",
                DNT: "1",
                "Sec-GPC": "1",
                "Sec-Fetch-Dest": "empty",
                // 'Sec-Fetch-Mode': 'cors',
                "Sec-Fetch-Site": "same-origin",
                Priority: "u=4",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        const cap_cookies = cookieUtil.getCookiesFromHeader(response);
        await dataUtil.updateData(vault, { cookies: cap_cookies });
    } catch (error) {
        new Notice(`${locale.notice.fetchCaptchaFailed},${error}`);
    }
}

// 可获得z_c0 cookie，这是身份识别的重要凭证
async function fetchQRcodeStatus(vault: Vault, token: string) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "captcha_session_v2",
        ]);
        const url = `https://www.zhihu.com/api/v3/account/api/login/qrcode/${token}/scan_info`;
        const response = await requestUrl({
            url: url,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                Referer: "https://www.zhihu.com/signin?next=%2F",
                DNT: "1",
                "Sec-GPC": "1",
                "Sec-Fetch-Dest": "empty",
                // 'Sec-Fetch-Mode': 'cors',
                "Sec-Fetch-Site": "same-origin",
                Priority: "u=4",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        new Notice(`${locale.notice.scanStatus},${response.json.status}`);
        return response;
    } catch (error) {
        new Notice(`${locale.notice.getScanStatusFailed}`);
    }
}

// 成功请求可获得 3个BEC cookie，和q_c1 cookie
// 3个BEC cookies中，通常用最后一个进行下一步请求, 即token refresh
async function signInZhihu(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "captcha_session_v2",
            "z_c0",
        ]);
        const response = await requestUrl({
            url: `https://www.zhihu.com`,
            headers: {
                "User-Agent": settings.user_agent,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: "https://www.zhihu.com/signin?next=%2F",
                dnt: "1",
                "sec-gpc": "1",
                "upgrade-insecure-requests": "1",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                priority: "u=0, i",
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        const new_cookies = cookieUtil.getCookiesFromHeader(response);
        await dataUtil.updateData(vault, { cookies: new_cookies });
        return response;
    } catch (error) {
        new Notice(`${locale.notice.fetchQC1Failed},${error}`);
    }
}

// 这里响应头的BEC会用于commercial API，所以不会存储
async function prodTokenRefresh(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "captcha_session_v2",
            "z_c0",
            "q_c1",
        ]);
        await requestUrl({
            url: `https://www.zhihu.com/api/account/prod/token/refresh`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: "https://www.zhihu.com/",
                "x-requested-with": "fetch",
                origin: "https://www.zhihu.com",
                dnt: "1",
                "sec-gpc": "1",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                priority: "u=4",
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "POST",
        });
    } catch (error) {
        new Notice(`${locale.notice.requestProdTokenRefreshFailed},${error}`);
    }
}

// 这里得到的BEC才会被用于后续请求。
export async function getUserInfo(vault: Vault) {
    try {
        const data = await dataUtil.loadData(vault);
        const settings = await loadSettings(vault);
        const cookiesHeader = cookieUtil.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "z_c0",
            "q_c1",
        ]);
        const response = await requestUrl({
            url: `https://www.zhihu.com/api/v4/me?include=is_realname`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: "https://www.zhihu.com/",
                "x-requested-with": "fetch",
                "x-zse-93": "101_3_3.0",
                // 'x-zse-96': '2.0_uomb2nYm99nKWMHwGgFO3jv3IaI27H1sOu7Hok/0M/oD=+VeYt0cQgS7=ddu+mT/',
                // 'dnt': '1',
                // 'sec-gpc': '1',
                // 'sec-fetch-dest': 'empty',
                // 'sec-fetch-mode': 'cors',
                // 'sec-fetch-site': 'same-origin',
                // 'priority': 'u=4',
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        const new_BEC = cookieUtil.getCookiesFromHeader(response);
        const userInfo = response.json;
        new Notice(`${locale.notice.welcome} ${userInfo.name}`);
        await dataUtil.updateData(vault, { cookies: new_BEC });
        await dataUtil.updateData(vault, { userInfo: userInfo });
    } catch (error) {
        new Notice(`${locale.notice.getUserInfoFailed},${error}`);
    }
}

function loginLinkBuilder(token: string): string {
    return `https://www.zhihu.com/account/scan/login/${token}?/api/login/qrcode`;
}
