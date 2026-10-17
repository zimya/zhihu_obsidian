import { Vault, Notice, requestUrl } from "obsidian";
import * as dataUtil from "./data";
import * as cookies from "./cookies";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;
export async function autoCompleteTopic(
    vault: Vault,
    id: string,
    topic: string,
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
        const response = await requestUrl({
            url: encodeURI(
                `https://zhuanlan.zhihu.com/api/autocomplete/topics?token=${topic}&max_matches=5&use_similar=0&topic_filter=1`,
            ),
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: `https://zhuanlan.zhihu.com/p/${id}/edit`,
                "x-requested-with": "fetch",
                // 'x-zse-93': '101_3_3.0',
                // 'x-zse-96': '2.0_XG+DQ3XSgsFurS0dDNCjVCj7C4W4dIeeopGJ18N1LcupsmTKxdk7gvhgHYvBIdW/',
                // 'x-zst-81': '3_2.0aR_sn77yn6O92wOB8hPZniUZo02x-7om0CNMDrxTrR2xQRY01T2Z-we8gGHPDRFZG0Y0jQgM7A2pr6P0mRPO7HoY70SfquPmz93mhDQyiqV9ebO1hwOYiiR0ELYuUrxmtDomqU7ynXtOnAoTh_PhRDSTFTYO8Ug1sR316cH0fBV8jug87CtOAgNmkvx_VhFCUUCGFJemtGxfBBV0YCSTvTrf9CCBicS8hggKgCeY68XsagpMBXLKwhO1xJO96LpGADwmDJSfVgcYbLeVmU3MJbO03qtLPD3M2CtKb4omVBS8ave87ggfu9eq1wtVpCYytCL_8vxmCqkw3BYL6gpKJULLhgpK2cfyJhXC6CHMogp1oH39RJSMSqH_QJN_CBFCQqHYwrrCih3__rx1K0tKbCLYIg3XhgcCZuFKzUH9hgHKarLO8MF0ST9ZQXLKeXYC',
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
        new Notice(`${locale.notice.fetchTopicSuccess}`);
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.fetchTopicFailed},${error}`);
    }
}

export async function topics2Draft(vault: Vault, id: string, topics: unknown) {
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
        await requestUrl({
            url: `https://zhuanlan.zhihu.com/api/articles/${id}/topics`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: `https://zhuanlan.zhihu.com/p/${id}/edit`,
                "x-requested-with": "fetch",
                "x-xsrftoken": xsrftoken,
                origin: "https://zhuanlan.zhihu.com",
                // 'dnt': '1',
                // 'sec-gpc': '1',
                // 'sec-fetch-dest': 'empty',
                // 'sec-fetch-mode': 'cors',
                // 'sec-fetch-site': 'same-origin',
                // 'priority': 'u=0',
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "POST",
            body: JSON.stringify(topics),
        });
        new Notice(`${locale.notice.giveTopicSuccess}`);
        // return response.json
    } catch {
        new Notice(`${locale.notice.giveTopicFailed}`);
    }
}
