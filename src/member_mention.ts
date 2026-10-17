import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestTriggerInfo,
    EditorSuggestContext,
    requestUrl,
    Notice,
    Vault,
    TFile,
} from "obsidian";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale = i18n.current;
// 定义 autoCompletePeople 返回的数据结构
interface PeopleEntry {
    type: string;
    name: string;
    id: string;
    avatarUrl: string;
    hash: string;
    description: string;
    numbers: number[];
    empty: string;
}

export interface MentionSuggestion {
    displayText: string;
    replacementText: string;
    avatarUrl: string;
}

export async function autoCompletePeople(
    vault: Vault,
    people: string,
): Promise<PeopleEntry[]> {
    try {
        const settings = await loadSettings(vault);
        const response = await requestUrl({
            url: `https://www.zhihu.com/people/autocomplete?token=${encodeURI(people)}&max_matches=10&use_similar=0`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
            },
            method: "GET",
        });
        // 解析数据，提取 people 条目
        const entries = response.json[0].slice(1) as [
            string,
            string,
            string,
            string,
            string,
            string,
            number[],
            string,
        ][];
        return entries.map((entry) => ({
            type: entry[0],
            name: entry[1],
            id: entry[2],
            avatarUrl: entry[3],
            hash: entry[4],
            description: entry[5],
            numbers: entry[6],
            empty: entry[7],
        }));
    } catch (error) {
        new Notice(`${locale.notice.fetchMembersFailed}`);
        return [];
    }
}

export class MentionSuggest extends EditorSuggest<MentionSuggestion> {
    constructor(app: App) {
        super(app);
    }

    onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        file: TFile | null,
    ): EditorSuggestTriggerInfo | null {
        // Check if note has 'zhihu-' str in frontmatter when restrictToZhihuFM is enabled
        if (file) {
            const metadata = this.app.metadataCache.getFileCache(file);
            const fm = metadata?.frontmatter || [];
            const hasZhihuKey = Object.keys(fm).some((key) =>
                key.startsWith("zhihu-"),
            );
            if (!hasZhihuKey) {
                return null;
            }
        }

        const line = editor.getLine(cursor.line);
        const beforeCursor = line.slice(0, cursor.ch);

        const match = beforeCursor.match(/@(\S+?)$/);
        if (!match) return null;
        return {
            start: {
                line: cursor.line,
                ch: beforeCursor.length - match[0].length,
            },
            end: cursor,
            query: match[1] || "",
        };
    }

    async getSuggestions(
        context: EditorSuggestContext,
    ): Promise<MentionSuggestion[]> {
        const query = context.query;
        const people = await autoCompletePeople(this.app.vault, query);

        return people.map((person) => ({
            displayText: person.name,
            replacementText: `[@${person.name}](https://www.zhihu.com/people/${person.id} "member_mention_${person.hash}")`,
            avatarUrl: person.avatarUrl,
        }));
    }

    renderSuggestion(suggestion: MentionSuggestion, el: HTMLElement): void {
        el.addClass("mention-suggestion");
        const container = el.createDiv({ cls: "suggestion-content" });

        if (suggestion.avatarUrl) {
            const img = container.createEl("img", { cls: "suggestion-avatar" });
            img.src = suggestion.avatarUrl;
        }

        container.createSpan({ text: suggestion.displayText });
    }

    selectSuggestion(
        suggestion: MentionSuggestion,
        evt: KeyboardEvent | MouseEvent,
    ): void {
        if (!this.context) return;
        const { editor, start, end } = this.context;
        if (!editor) return;

        editor.replaceRange(suggestion.replacementText, start, end);
    }
}
