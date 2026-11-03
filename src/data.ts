import { Vault } from "obsidian";
const DATA_FILE = "zhihu-data.json";

export interface ZhihuData {
    cookies?: Record<string, string>;
    userInfo?: { avatar_url: string; name: string; headline?: string };
    [key: string]: unknown;
}

export async function loadData(vault: Vault): Promise<ZhihuData> {
    const filePath = `${vault.configDir}/${DATA_FILE}`;

    try {
        const exists = await vault.adapter.exists(filePath);

        if (exists) {
            const fileContent = await vault.adapter.read(filePath);
            try {
                return JSON.parse(fileContent);
            } catch (e) {
                console.error(`Error parsing ${DATA_FILE}:`, e);
                return {};
            }
        } else {
            const defaultData = {};
            await vault.adapter.write(
                filePath,
                JSON.stringify(defaultData, null, 2),
            );
            return defaultData;
        }
    } catch (e) {
        console.error(`Error accessing ${DATA_FILE}:`, e);
        return {};
    }
}

export async function saveData(vault: Vault, data: unknown): Promise<void> {
    const filePath = `${vault.configDir}/${DATA_FILE}`;

    try {
        const content = JSON.stringify(data, null, 2);
        await vault.adapter.write(filePath, content);
    } catch (e) {
        console.error("Failed to save data:", e);
        throw e; // 可根据需求决定是否抛出错误
    }
}

export async function updateData(
    vault: Vault,
    patch: Record<string, unknown>,
): Promise<void> {
    const oldData = (await loadData(vault)) || {};
    const newData = deepMerge(oldData, patch);
    await saveData(vault, newData);
}

export async function deleteData(vault: Vault, key: string): Promise<void> {
    const data = (await loadData(vault)) || {};
    if (key in data) {
        delete data[key];
        await saveData(vault, data);
    } else {
        console.warn(`Key "${key}" not found in ${DATA_FILE}`);
    }
}

function deepMerge(target: unknown, source: unknown): unknown {
    if (typeof target !== "object" || target === null) return source;
    if (typeof source !== "object" || source === null) return source;

    const merged: Record<string, unknown> = { ...target };

    for (const key of Object.keys(source)) {
        const targetVal = (target as Record<string, unknown>)[key];
        const sourceVal = (source as Record<string, unknown>)[key];

        if (
            typeof targetVal === "object" &&
            targetVal !== null &&
            typeof sourceVal === "object" &&
            sourceVal !== null &&
            !Array.isArray(sourceVal)
        ) {
            merged[key] = deepMerge(targetVal, sourceVal);
        } else {
            merged[key] = sourceVal;
        }
    }

    return merged;
}
