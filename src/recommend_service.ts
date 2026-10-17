import * as cookies from "./cookies";
import * as dataUtil from "./data";
import { Vault, Notice, requestUrl } from "obsidian";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale = i18n.current;
export interface Recommendation {
    id: string;
    type: string;
    title: string;
    excerpt: string;
    author_name: string;
    url: string;
    content: string;
    updated_time: number;
    created_time: number;
    visited_count: number;
    voteup_count: number;
    thanks_count: number;
    favorite_count: number;
}

export async function getRecommend(vault: Vault, url: string) {
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
            url: url,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: "https://www.zhihu.com/",
                "x-api-version": "3.0.53",
                "x-requested-with": "fetch",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.fetchRecommendFailed}`);
    }
}

interface ZhihuRecommendTarget {
    id: string;
    type: string;
    title: string;
    excerpt: string;
    excerpt_new: string;
    author: { name: string };
    question: { id: string; title: string };
    content: unknown;
    update: number;
    created: number;
    updated_time: number;
    created_time: number;
    visited_count: number;
    voteup_count: number;
    thanks_count: number;
    favorite_count: number;
}

interface ZhihuRecommendItem {
    type: string;
    target: ZhihuRecommendTarget;
}

export function loadRecommendations(response: { data: ZhihuRecommendItem[] }) {
    try {
        const filteredData = response.data.filter(
            (item) =>
                item.type !== "feed_advert" &&
                item.target &&
                Object.keys(item.target).length > 0,
        );
        return filteredData.map((item) => ({
            id: item.target.id,
            type: item.target.type,
            title:
                item.target.type === "article"
                    ? item.target.title
                    : item.target.question.title,
            excerpt: item.target.excerpt_new || item.target.excerpt,
            author_name: item.target.author.name,
            url:
                item.target.type === "article"
                    ? `https://zhuanlan.zhihu.com/p/${item.target.id}`
                    : `https://www.zhihu.com/question/${item.target.question.id}/answer/${item.target.id}`,
            content: item.target.content,
            updated_time:
                item.target.type === "article"
                    ? item.target.update
                    : item.target.updated_time,
            created_time:
                item.target.type === "article"
                    ? item.target.created
                    : item.target.created_time,
            visited_count: item.target.visited_count,
            voteup_count: item.target.voteup_count,
            thanks_count: item.target.thanks_count,
            favorite_count: item.target.favorite_count,
        })) as [Recommendation];
    } catch (error) {
        console.error(locale.error.loadRecommendFailed, error);
        return [];
    }
}
