import * as cookies from "./cookies";
import * as dataUtil from "./data";
import { Vault, Notice, requestUrl } from "obsidian";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";

const locale = i18n.current;

export interface Follow {
    id: string;
    type: string;
    title: string;
    excerpt: string;
    author_name: string;
    updated_time: number;
    created_time: number;
    url: string;
    content: string;
    action_text: string;
}

export async function getFollows(vault: Vault, url: string) {
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
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                referer: "https://www.zhihu.com/follow",
                "x-api-version": "3.0.53",
                "x-requested-with": "fetch",
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.fetchFollowsFailed},${error}`);
    }
}

interface ZhihuFollowTarget {
    id: string;
    type: string;
    title: string;
    excerpt: string;
    excerpt_title: string;
    content: unknown;
    content_html: string;
    created_time: number;
    created: number;
    detail: string;
    author: { name: string };
    question: { id: string; title: string };
}

interface ZhihuFollowItem {
    type: string;
    action_text: string;
    target: ZhihuFollowTarget;
}

export function loadFollows(response: { data: ZhihuFollowItem[] }) {
    try {
        const filteredData = response.data.filter(
            (item) =>
                item.type !== "feed_advert" &&
                item.target &&
                Object.keys(item.target).length > 0,
        );
        return filteredData.map((item) => fromTypeGetProperty(item)) as [
            Follow,
        ];
    } catch (error) {
        console.error(locale.error.loadFollowsFailed, error);
        return [];
    }
}

function fromTypeGetProperty(item: ZhihuFollowItem) {
    switch (item.target.type) {
        case "article":
            return {
                id: item.target.id,
                type: item.target.type,
                title: item.target.title,
                excerpt: item.target.excerpt,
                author_name: item.target.author.name,
                created_time: item.target.created_time,
                url: `https://zhuanlan.zhihu.com/p/${item.target.id}`,
                content: item.target.content,
                action_text: item.action_text,
            };
        case "question":
            return {
                id: item.target.id,
                type: item.target.type,
                title: item.target.title,
                excerpt: item.target.excerpt,
                author_name: item.target.author.name,
                created_time: item.target.created,
                url: `https://www.zhihu.com/question/${item.target.id}`,
                content: item.target.detail,
                action_text: item.action_text,
            };
        case "answer":
            return {
                id: item.target.id,
                type: item.target.type,
                title: item.target.question.title,
                excerpt: item.target.excerpt,
                author_name: item.target.author.name,
                created_time: item.target.created_time,
                url: `https://www.zhihu.com/question/${item.target.question.id}/answer/${item.target.id}`,
                content: item.target.content,
                action_text: item.action_text,
            };
        case "pin":
            return {
                id: item.target.id,
                type: item.target.type,
                title: truncateString(
                    stripHtmlTags(
                        (item.target.content as { content: string }[])[0]
                            .content,
                    ),
                ),
                excerpt: item.target.excerpt_title,
                author_name: item.target.author.name,
                created_time: item.target.created,
                url: `https://www.zhihu.com/pin/${item.target.id}`,
                content: item.target.content_html,
                action_text: item.action_text,
            };
        default:
            return "Unknown Item Type";
    }
}

function stripHtmlTags(input: string): string {
    return input.replace(/<[^>]*>/g, "");
}

function truncateString(str: string, maxLength = 100): string {
    if (str.length <= maxLength) {
        return str;
    }
    return str.slice(0, maxLength) + "...";
}
