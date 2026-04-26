import { App, Vault, Notice, Platform, requestUrl } from "obsidian";
import * as dataUtil from "./data";
import * as cookieUtil from "./cookies";
import { ConfirmationModal } from "./settings";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;

const ZHIHU_EXAMPLE_QUESTION_URL = "https://www.zhihu.com/question/19550225";
const ZHIHU_LOGIN_URL = "https://www.zhihu.com/signin";
const WEBVIEWER_PLUGIN_ID = "webviewer";
const WEBVIEWER_VIEW_TYPE = "webviewer";
const WAIT_TIMEOUT_MS = 120000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getWebviewerInstance(app: App): any {
    const internalPlugins = (app as any).internalPlugins;
    const plugin = internalPlugins?.getPluginById?.(WEBVIEWER_PLUGIN_ID);
    if (!plugin?.enabled || !plugin?.instance) {
        return null;
    }
    return plugin.instance;
}

function showEnableWebviewerModal(app: App): void {
    const language = (window.localStorage.getItem("language") ?? "en").toLowerCase();
    const webviewerKeywordMap: Record<string, string> = {
        "zh": "网页浏览器",
        "zh-tw": "網頁檢視器",
    };
    const webviewerKeyword = webviewerKeywordMap[language] ?? "web viewer";

    new ConfirmationModal(
        app,
        locale.settings.enableWebviewerWarning,
        (button) => {
            button
                .setButtonText(locale.settings.enableWebviewerButton)
                .setCta();
        },
        async () => {
            const setting = (app as any).setting;
            setting?.open?.();

            (app as any).commands?.executeCommandById?.("app:open-settings");
            window.setTimeout(() => {
                const tabEls = Array.from(
                    document.querySelectorAll<HTMLElement>(
                        ".vertical-tab-nav-item",
                    ),
                );
                const target = tabEls.find((el) => {
                    const id = (
                        el.getAttribute("data-setting-id") ?? ""
                    ).toLowerCase();
                    return id.includes("plugins");
                });
                target?.click();

                window.setTimeout(() => {
                    const searchInput = document.querySelector<HTMLInputElement>(
                        '.setting-group-search input[type="search"]',
                    );
                    if (!searchInput) return;
                    searchInput.focus();
                    searchInput.value = webviewerKeyword;
                    searchInput.dispatchEvent(
                        new Event("input", { bubbles: true }),
                    );
                    searchInput.dispatchEvent(
                        new Event("change", { bubbles: true }),
                    );
                }, 120);
            }, 120);
        },
    ).open();
}

async function waitForWebviewerLeaf(
    app: App,
    leavesBeforeOpen: Set<any>,
): Promise<any> {
    const startAt = Date.now();
    while (Date.now() - startAt < WAIT_TIMEOUT_MS) {
        const leaves = app.workspace.getLeavesOfType(
            WEBVIEWER_VIEW_TYPE as any,
        );
        const newLeaf = leaves.find((leaf: any) => !leavesBeforeOpen.has(leaf));
        if (newLeaf) {
            return newLeaf;
        }
        if (leaves.length > 0) {
            return leaves[leaves.length - 1];
        }
        await sleep(100);
    }
    throw new Error(locale.error.waitWebviewerOpenTimeout);
}

async function waitForWebviewEl(leaf: any): Promise<any> {
    const startAt = Date.now();
    while (Date.now() - startAt < WAIT_TIMEOUT_MS) {
        const webviewEl = leaf?.view?.contentEl?.querySelector?.("webview");
        if (webviewEl) {
            return webviewEl;
        }
        await sleep(100);
    }
    throw new Error(locale.error.waitWebviewInitTimeout);
}

async function waitForWebviewDomReady(webviewEl: any): Promise<void> {
    const canUseWebContents = () => {
        try {
            return Boolean(webviewEl?.getWebContentsId?.());
        } catch {
            return false;
        }
    };

    if (canUseWebContents()) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            cleanup();
            reject(new Error(locale.error.waitWebviewDomReadyTimeout));
        }, WAIT_TIMEOUT_MS);

        const cleanup = () => {
            window.clearTimeout(timer);
            webviewEl.removeEventListener("dom-ready", onDomReady);
        };

        const onDomReady = () => {
            cleanup();
            resolve();
        };

        webviewEl.addEventListener("dom-ready", onDomReady, { once: true });
    });
}

function getZhihuSessionFromWebview(webviewEl: any): any {
    const remote = (window as any).require?.("@electron/remote");
    const webContents = remote?.webContents;
    if (!webContents) {
        throw new Error(locale.error.cannotAccessElectronWebContents);
    }
    const webContentsId = webviewEl?.getWebContentsId?.();
    if (!webContentsId) {
        throw new Error(locale.error.cannotGetWebviewWebContentsId);
    }
    const wc = webContents.fromId(webContentsId);
    if (!wc?.session) {
        throw new Error(locale.error.cannotGetWebviewerSession);
    }
    return wc.session;
}

function isIgnorableNavigationError(error: unknown): boolean {
    const message =
        error instanceof Error ? error.message : String(error ?? "");
    return message.includes("(-3)") || message.includes("ERR_ABORTED");
}

function normalizeCookiePath(path: string | undefined): string {
    if (!path || path === "") {
        return "/";
    }
    return path.startsWith("/") ? path : `/${path}`;
}

function buildCookieRemovalUrl(cookie: any): string | null {
    const domain = String(cookie?.domain ?? "").replace(/^\./, "");
    if (!domain) {
        return null;
    }
    const protocol = cookie?.secure ? "https" : "http";
    const path = normalizeCookiePath(cookie?.path);
    return `${protocol}://${domain}${path}`;
}

async function clearZhihuSessionData(webviewEl: any): Promise<void> {
    const ses = getZhihuSessionFromWebview(webviewEl);

    const cookieCandidates: any[] = [];
    for (const url of ["https://www.zhihu.com", "https://zhihu.com"]) {
        const cookies = await ses.cookies.get({ url });
        cookieCandidates.push(...cookies);
    }

    const uniqueCookies = new Map<string, any>();
    cookieCandidates.forEach((cookie) => {
        const key = [
            String(cookie?.domain ?? ""),
            String(cookie?.path ?? ""),
            String(cookie?.name ?? ""),
            String(cookie?.secure ?? ""),
        ].join("|");
        uniqueCookies.set(key, cookie);
    });

    const removeTasks: Promise<void>[] = [];
    uniqueCookies.forEach((cookie) => {
        const url = buildCookieRemovalUrl(cookie);
        if (!url || !cookie?.name) {
            return;
        }
        removeTasks.push(ses.cookies.remove(url, cookie.name));
    });
    await Promise.allSettled(removeTasks);

    const clearStorageTasks = [
        ses.clearStorageData({
            origin: "https://www.zhihu.com",
            storages: [
                "cookies",
                "localstorage",
                "serviceworkers",
                "cachestorage",
            ],
        }),
        ses.clearStorageData({
            origin: "https://zhihu.com",
            storages: [
                "cookies",
                "localstorage",
                "serviceworkers",
                "cachestorage",
            ],
        }),
    ];
    await Promise.allSettled(clearStorageTasks);
}

async function extractCookiesAfterNavigation(
    webviewEl: any,
    isLoginFlow: boolean,
): Promise<Record<string, string>> {
    return new Promise<Record<string, string>>((resolve, reject) => {
        let finished = false;
        let pollingTimer: number | null = null;
        const timer = window.setTimeout(() => {
            cleanup();
            reject(new Error(locale.error.waitLoginAndExtractCookiesTimeout));
        }, WAIT_TIMEOUT_MS);

        const cleanup = () => {
            window.clearTimeout(timer);
            if (pollingTimer !== null) {
                window.clearInterval(pollingTimer);
                pollingTimer = null;
            }
            webviewEl.removeEventListener("did-finish-load", onLoad);
            webviewEl.removeEventListener("did-navigate", onLoad);
            webviewEl.removeEventListener("did-navigate-in-page", onLoad);
        };

        const finishWithError = (error: unknown) => {
            if (finished) return;
            finished = true;
            cleanup();
            reject(error);
        };

        const finishWithCookies = (cookies: Record<string, string>) => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve(cookies);
        };

        const tryExtractCookies = async () => {
            const ses = getZhihuSessionFromWebview(webviewEl);
            const cookies = await ses.cookies.get({
                url: "https://www.zhihu.com",
            });
            const zse = cookies.find((c: any) => c.name === "__zse_ck");
            if (!zse) {
                return;
            }

            const cookieObj: Record<string, string> = {};
            cookies.forEach((c: { name: string; value: string }) => {
                cookieObj[c.name] = c.value;
            });
            finishWithCookies(cookieObj);
        };

        const onLoad = async () => {
            try {
                const url = webviewEl.getURL?.() ?? "";

                if (isLoginFlow && url === "https://www.zhihu.com/") {
                    // 登录后的重定向与主动跳转可能互相中断，忽略 -3/ERR_ABORTED
                    await webviewEl
                        .loadURL(ZHIHU_EXAMPLE_QUESTION_URL)
                        .catch((error: unknown) => {
                            if (!isIgnorableNavigationError(error)) {
                                throw error;
                            }
                        });
                    return;
                }

                if (!url.startsWith(ZHIHU_EXAMPLE_QUESTION_URL)) {
                    return;
                }

                await tryExtractCookies();
                if (!finished && pollingTimer === null) {
                    // 某些情况下 __zse_ck 会晚于页面加载事件写入，这里短轮询等待
                    pollingTimer = window.setInterval(() => {
                        if (finished) return;
                        void tryExtractCookies().catch(finishWithError);
                    }, 800);
                }
            } catch (error) {
                if (isIgnorableNavigationError(error)) {
                    return;
                }
                finishWithError(error);
            }
        };

        webviewEl.addEventListener("did-finish-load", onLoad);
        webviewEl.addEventListener("did-navigate", onLoad);
        webviewEl.addEventListener("did-navigate-in-page", onLoad);
    });
}

/**
 * 核心模块：通用 Zhihu Cookie 提取器（基于 Obsidian Web viewer）
 * 打开 Web viewer 页签、监听页面状态并提取所需 Cookie
 */
async function extractZhihuCookiesViaWebviewer(
    app: App,
    initialUrl: string,
    isLoginFlow: boolean,
): Promise<Record<string, string>> {
    const webviewer = getWebviewerInstance(app);
    if (!webviewer) {
        showEnableWebviewerModal(app);
        throw new Error(locale.notice.enableWebviewerFirst);
    }

    const leavesBeforeOpen = new Set(
        app.workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE as any),
    );

    webviewer.openUrl(initialUrl, true, true);

    const leaf = await waitForWebviewerLeaf(app, leavesBeforeOpen);
    const webviewEl = await waitForWebviewEl(leaf);
    await waitForWebviewDomReady(webviewEl);

    try {
        return await extractCookiesAfterNavigation(webviewEl, isLoginFlow);
    } finally {
        await leaf?.detach?.();
    }
}

export async function zhihuWebLogin(app: App): Promise<void> {
    const vault = app.vault;

    // 调用公共模块获取 Cookie
    const cookies = await extractZhihuCookiesViaWebviewer(
        app,
        ZHIHU_LOGIN_URL,
        true,
    );

    new Notice(`${locale.notice.loginSuccess}`);

    // Cookie 获取成功后的业务逻辑
    await dataUtil.updateData(vault, { cookies });
    await getUserInfo(vault);
}

export async function zhihuClearLoginInfo(app: App): Promise<void> {
    const webviewer = getWebviewerInstance(app);
    if (!webviewer) {
        showEnableWebviewerModal(app);
        throw new Error(locale.notice.enableWebviewerFirst);
    }

    const leavesBeforeOpen = new Set(
        app.workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE as any),
    );
    webviewer.openUrl("about:blank", true, true);

    const leaf = await waitForWebviewerLeaf(app, leavesBeforeOpen);
    const webviewEl = await waitForWebviewEl(leaf);
    await waitForWebviewDomReady(webviewEl);

    try {
        await clearZhihuSessionData(webviewEl);
    } finally {
        await leaf?.detach?.();
    }

    const vault = app.vault;
    await dataUtil.deleteData(vault, "cookies");
    await dataUtil.deleteData(vault, "userInfo");
}

let refreshCookiesPromise: Promise<void> | null = null;

// 这个函数用于自动刷新zse_ck cookie，因为它会定时失效
export async function zhihuRefreshZseCookies(app: App): Promise<void> {
    if (Platform.isMobile) {
        new Notice(locale.notice.mobileRefreshCookieInDesktop);
        return;
    }

    if (refreshCookiesPromise) {
        return refreshCookiesPromise;
    }

    // 只有第一次触发时才弹出通知
    new Notice(locale.notice.refreshCookies);

    refreshCookiesPromise = (async () => {
        const vault = app.vault;

        // 调用公共模块获取 Cookie（已登录状态下，直接打开目标页刷新）
        const cookies = await extractZhihuCookiesViaWebviewer(
            app,
            ZHIHU_EXAMPLE_QUESTION_URL,
            false,
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
