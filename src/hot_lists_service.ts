import * as cookies from "./cookies";
import * as dataUtil from "./data";
import { Vault, Notice, requestUrl } from "obsidian";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;
export interface HotList {
    id: string;
    link: string;
    title: string;
    detail_text: string;
    excerpt: string;
    answer_count: number;
    follower_count: number;
    type: string;
    author: string;
}

async function getHotLists(vault: Vault) {
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
        const response = await requestUrl({
            url: `https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true`,
            headers: {
                "User-Agent": settings.user_agent,
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                "accept-encoding": "gzip, deflate, br, zstd",
                referer: "https://www.zhihu.com/follow",
                "x-api-version": "3.0.53",
                "x-requested-with": "fetch",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.fetchHotlistFailed},${error}`);
    }
}

interface ZhihuHotListItem {
    type: string;
    detail_text: string;
    target: {
        id: string;
        title: string;
        excerpt: string;
        url: string;
        answer_count: number;
        follower_count: number;
        type: string;
        author: { name: string };
    };
}

interface ZhihuHotListsResponse {
    data: ZhihuHotListItem[];
    fresh_text: string;
}

export async function loadHotList(vault: Vault) {
    try {
        const response: ZhihuHotListsResponse = await getHotLists(vault);
        const filteredData = response.data.filter(
            (item) =>
                item.type === "hot_list_feed" &&
                item.target &&
                Object.keys(item.target).length > 0,
        );
        new Notice(response.fresh_text);
        return filteredData.map((item) => ({
            id: item.target.id,
            title: item.target.title,
            excerpt: item.target.excerpt,
            detail_text: item.detail_text,
            link: item.target.url.replace(
                "https://api.zhihu.com/questions/",
                "https://www.zhihu.com/question/",
            ),
            answer_count: item.target.answer_count,
            follower_count: item.target.follower_count,
            type: item.target.type,
            author: item.target.author.name,
        })) as [HotList];
    } catch (error) {
        console.error(locale.error.loadHotlistFailed, error);
        return [];
    }
}
