import * as cookies from "./cookies";
import * as dataUtil from "./data";
import { Vault, Notice, requestUrl } from "obsidian";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;
export async function touchToRead(vault: Vault, type: string, id: string) {
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
        if (type === "article") {
            type = "post";
        }
        const response = await requestUrl({
            url: "https://www.zhihu.com/lastread/touch",
            headers: {
                "User-Agent": settings.user_agent,
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: "https://www.zhihu.com/",
                "x-requested-with": "fetch",
                origin: "https://www.zhihu.com",
                // dnt: "1",
                // "sec-gpc": "1",
                // "sec-fetch-dest": "empty",
                // "sec-fetch-mode": "cors",
                // "sec-fetch-site": "same-origin",
                // priority: "u=4",
                Cookie: cookiesHeader,
            },
            method: "POST",
            body: JSON.stringify({
                items: [[type, id, "read"]],
            }),
        });
        return response.json;
    } catch {
        new Notice(`${locale.notice.touchToReadFailed}`);
    }
}
