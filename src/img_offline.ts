import { App, normalizePath, requestUrl } from "obsidian";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import MagicString from "magic-string";
import { fileTypeFromBuffer } from "file-type";
import { md5Hex } from "./hash";

type MdastImage = {
    type: "image";
    url: string;
    alt?: string | null;
    position?: {
        start?: { offset?: number };
        end?: { offset?: number };
    };
};

function isHttpUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
    const p = normalizePath(folderPath);
    const existing = app.vault.getAbstractFileByPath(p);
    if (existing) return;
    await app.vault.createFolder(p);
}

// 图片基于md5+通过文件内容推断出的后缀名存储
function md5HexFromArrayBuffer(buf: ArrayBuffer): string {
    return md5Hex(buf);
}

async function inferExt(arrayBuffer: ArrayBuffer): Promise<string> {
    const ft = await fileTypeFromBuffer(new Uint8Array(arrayBuffer));
    return ft?.ext ?? "bin";
}

async function downloadArrayBuffer(url: string): Promise<ArrayBuffer> {
    const resp = await requestUrl({ url });
    return resp.arrayBuffer;
}

// 图片按照md5分桶存储，两级桶：00/ab/...
function bucketPath(destFolder: string, md5: string): string {
    const b1 = md5.slice(0, 2);
    const b2 = md5.slice(2, 4);
    return normalizePath(`${destFolder}/${b1}/${b2}`);
}

async function saveByMd5Bucketed(opts: {
    app: App;
    arrayBuffer: ArrayBuffer;
    destFolder: string;
}): Promise<string> {
    const { app, arrayBuffer, destFolder } = opts;

    const md5 = md5HexFromArrayBuffer(arrayBuffer);
    const ext = await inferExt(arrayBuffer);

    const folder = bucketPath(destFolder, md5);
    await ensureFolder(app, folder);

    const vaultPath = normalizePath(`${folder}/${md5}.${ext}`);

    const existing = app.vault.getAbstractFileByPath(vaultPath);
    if (!existing) {
        await app.vault.createBinary(vaultPath, arrayBuffer);
    }
    return vaultPath;
}

export async function turnImgOffline(opts: {
    app: App;
    markdown: string;
    destFolder: string;
}): Promise<string> {
    const { app, markdown, destFolder } = opts;

    const tree = unified().use(remarkParse).parse(markdown);

    const ms = new MagicString(markdown);

    const tasks: Array<
        Promise<{ start: number; end: number; replacement: string } | null>
    > = [];

    visit(tree, "image", (node: MdastImage) => {
        const url = node.url;
        if (!url || !isHttpUrl(url)) return;

        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (typeof start !== "number" || typeof end !== "number") return;

        const caption = (node.alt ?? "").trim();

        tasks.push(
            (async () => {
                try {
                    const arrayBuffer = await downloadArrayBuffer(url);
                    const localPath = await saveByMd5Bucketed({
                        app,
                        arrayBuffer,
                        destFolder,
                    });
                    const embed = `![[${localPath}${caption ? `|${caption}` : ""}]]`;
                    return { start, end, replacement: embed };
                } catch {
                    // 下载失败就不替换
                    return null;
                }
            })(),
        );
    });

    const results = (await Promise.all(tasks)).filter(Boolean) as Array<{
        start: number;
        end: number;
        replacement: string;
    }>;

    // 关键：从后往前改，避免前面替换改变后面 offset
    results.sort((a, b) => b.start - a.start);

    for (const r of results) {
        ms.overwrite(r.start, r.end, r.replacement);
    }

    return ms.toString();
}
