import { Vault } from "obsidian";

const TYPES_FILE = "types.json";

const ZHIHU_FRONTMATTER_TYPES: Record<string, string> = {
    "zhihu-title": "text",
    "zhihu-link": "text",
    "zhihu-cover": "text",
    "zhihu-question": "text",
    "zhihu-author": "text",
    "zhihu-topics": "multitext",
    "zhihu-disclaimer": "multitext",
    "zhihu-content-updated": "datetime",
    "zhihu-content-created": "datetime",
    "zhihu-updated-at": "datetime",
    "zhihu-created-at": "datetime",
    "zhihu-likes": "number",
    "zhihu-comments": "number",
    "zhihu-favorites": "number",
    "zhihu-toc": "checkbox",
    "zhihu-answers": "number",
    "zhihu-visits": "number",
    "zhihu-upVotes": "number",
    "zhihu-downVotes": "number",
    "zhihu-followers": "number",
};

export async function ensureZhihuFrontmatterTypes(vault: Vault): Promise<{
    updated: boolean;
    added: string[];
    changed: string[];
}> {
    const filePath = `${vault.configDir}/${TYPES_FILE}`;

    try {
        const exists = await vault.adapter.exists(filePath);
        let root: Record<string, unknown> = {};
        if (exists) {
            const raw = await vault.adapter.read(filePath);
            const parsed: unknown = JSON.parse(raw);
            root =
                parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? (parsed as Record<string, unknown>)
                    : {};
        }

        const existingTypes =
            root.types &&
            typeof root.types === "object" &&
            !Array.isArray(root.types)
                ? (root.types as Record<string, string>)
                : {};

        const nextTypes: Record<string, string> = { ...existingTypes };
        const added: string[] = [];
        const changed: string[] = [];
        let updated = !exists;

        for (const [key, desiredType] of Object.entries(
            ZHIHU_FRONTMATTER_TYPES,
        )) {
            const current = nextTypes[key];
            if (current !== desiredType) {
                if (key in nextTypes) changed.push(key);
                else added.push(key);
                nextTypes[key] = desiredType;
                updated = true;
            }
        }

        if (updated) {
            const nextRoot = { ...root, types: nextTypes };
            await vault.adapter.write(
                filePath,
                JSON.stringify(nextRoot, null, 2),
            );
        }

        return { updated, added, changed };
    } catch (e) {
        console.error(`Error accessing ${TYPES_FILE}:`, e);
        return { updated: false, added: [], changed: [] };
    }
}

export function removeFrontmatter(content: string) {
    return content.replace(/^---\n[\s\S]*?\n---\n*/, "");
}
