import { App, Notice, FileSystemAdapter, TFile, normalizePath } from "obsidian";
import i18n, { type Lang } from "../locales";

const locale: Lang = i18n.current;

async function getImgFileFromName(
    app: App,
    fileName: string,
): Promise<TFile | null> {
    const cleanName = fileName.trim();
    const normalizedName = normalizePath(cleanName);
    const lowerName = normalizedName.toLowerCase();

    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
    const hasExtension = imageExtensions.some((ext) => lowerName.endsWith(ext));

    let targetFile: TFile | null = null;
    const activeFile = app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : "";

    // 处理相对路径
    if (cleanName.startsWith("../") || cleanName.startsWith("./")) {
        if (activeFile && activeFile.parent) {
            const parentPath =
                activeFile.parent.path === "/" ? "" : activeFile.parent.path;
            const parts = parentPath ? parentPath.split("/") : [];
            const relativeParts = normalizedName.split("/");

            for (const part of relativeParts) {
                if (part === "..") {
                    parts.pop();
                } else if (part !== "." && part !== "") {
                    parts.push(part);
                }
            }

            const vaultPath = normalizePath(parts.join("/"));

            const abstractFile = app.vault.getAbstractFileByPath(vaultPath);
            if (abstractFile instanceof TFile) {
                targetFile = abstractFile;
            } else if (!abstractFile && !hasExtension) {
                for (const ext of imageExtensions) {
                    const fileWithExt = app.vault.getAbstractFileByPath(
                        vaultPath + ext,
                    );
                    if (fileWithExt instanceof TFile) {
                        targetFile = fileWithExt;
                        break;
                    }
                }
            }
        }
    }

    // 利用缓存系统查找
    if (!targetFile) {
        targetFile = app.metadataCache.getFirstLinkpathDest(
            normalizedName,
            sourcePath,
        );
    }

    // 裸文件名查找
    if (!targetFile && !hasExtension) {
        for (const ext of imageExtensions) {
            const tempFile = app.metadataCache.getFirstLinkpathDest(
                normalizedName + ext,
                sourcePath,
            );
            if (tempFile) {
                targetFile = tempFile;
                break;
            }
        }
    }

    if (!targetFile) {
        new Notice(`${locale.notice.imgSearchFailed}: ${fileName}`);
        return null;
    }

    return targetFile;
}

export async function getImgBufferFromName(
    app: App,
    fileName: string,
): Promise<ArrayBuffer> {
    const targetFile = await getImgFileFromName(app, fileName);
    if (!targetFile) {
        throw new Error(`Img file not found: ${fileName}`);
    }
    const arrayBuffer = await app.vault.readBinary(targetFile);
    return arrayBuffer;
}

/**
 * 通过文件名（不含扩展名.md）在整个仓库中查找文件。
 * @param fileName 文件名，例如 "这次化债是不是意味未来大通胀？-黑桦的回答"
 * @returns TFile 对象或 null
 */
export function getFilePathFromName(app: App, fileName: string): TFile | null {
    const allFiles = app.vault.getMarkdownFiles();
    const targetFile = allFiles.find(
        (file: TFile) => file.basename === fileName,
    );
    return targetFile || null;
}
