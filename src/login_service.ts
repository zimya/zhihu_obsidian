import { App, Vault, Notice, requestUrl } from "obsidian";
import * as dataUtil from "./data";
import * as cookieUtil from "./cookies";
import { loadSettings, saveSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;

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
