import { execFile } from "child_process";
import { App, Notice, FuzzySuggestModal, TFolder } from "obsidian";

type RequestOptions = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};

export function toCurl(options: RequestOptions): string {
    const { url, method = "GET", headers = {}, body } = options;

    const headerParts = Object.entries(headers).map(
        ([key, value]) => `-H "${key}: ${value}"`,
    );

    const methodPart =
        method.toUpperCase() === "GET" ? "" : `-X ${method.toUpperCase()}`;

    const bodyPart = body ? `-d '${body.replace(/'/g, `'\\''`)}'` : "";

    const parts = [
        "curl",
        methodPart,
        `"${url}"`,
        ...headerParts,
        bodyPart,
    ].filter(Boolean); // remove empty strings

    return parts.join(" \\\n  ");
}

export function normalizeStr(str: string | string[] | undefined): string[] {
    if (!str) return [];
    if (typeof str === "string") {
        return [str];
    }
    return str;
}

export function fmtDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 执行命令并等待
export function execFileAsync(cmd: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
        execFile(cmd, args, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export function isWebUrl(url: string): boolean {
    try {
        const parsed = new URL(url, "file://"); // 基于 file:// 解析相对路径
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false; // URL 解析失败
    }
}

export async function pickDirectoryDesktop(): Promise<string | null> {
    let electron: any;
    try {
        // Obsidian 桌面端才能 require('electron')
        electron = require("electron");
    } catch {
        new Notice("当前环境不支持系统文件夹选择器（仅桌面端可用）");
        return null;
    }

    const dialog = electron?.remote?.dialog ?? electron?.dialog;
    if (!dialog?.showOpenDialog) {
        new Notice("无法调用系统文件夹选择器");
        return null;
    }

    const result = await dialog.showOpenDialog({
        title: "选择存储目录",
        properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled) return null;
    const dirPath = result.filePaths?.[0];
    return dirPath ?? null;
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    onChoose: (folder: TFolder) => void;

    constructor(app: App, onChoose: (folder: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
    }

    getItems(): TFolder[] {
        const files = this.app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];

        for (const file of files) {
            if (file instanceof TFolder) {
                folders.push(file);
            }
        }
        return folders;
    }

    getItemText(item: TFolder): string {
        return item.path; // 显示文件夹路径
    }

    onChooseItem(item: TFolder, evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}

export function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data;
    }
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
}
