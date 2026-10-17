import { loadMermaid } from "obsidian";
import i18n, { type Lang } from "../locales";

const locale: Lang = i18n.current;

/**
 * Renders Mermaid code into an SVG string.
 * @param mermaidCode The Mermaid diagram syntax.
 * @returns The SVG markup.
 */
export async function renderMermaid(mermaidCode: string): Promise<string> {
    const mermaid = await loadMermaid(); // 1. 加载 Obsidian 内置的 Mermaid 渲染器
    const elementId = "mermaid-svg-" + Math.random().toString(36).substring(2); // 创建唯一的 ID
    const { svg } = await mermaid.render(elementId, mermaidCode);
    // 标签内容是 HTML（如 &nbsp;、<br>），SVG 按 XML 解析会失败，因此先用 HTML 解析再序列化为合法 XML
    const doc = new DOMParser().parseFromString(svg, "text/html");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) throw new Error("Mermaid did not return an SVG element");
    return new XMLSerializer().serializeToString(svgEl);
}

export function svgToDataURL(svgString: string): string {
    // 对SVG字符串进行URI编码，以处理特殊字符
    const encodedSvg = encodeURIComponent(svgString);
    return `data:image/svg+xml;charset=utf-8,${encodedSvg}`;
}

export function cleanSvg(svgString: string): string {
    const cssVarRegex = /var\((--[\w-]+)\)/g;
    const computedStyle = getComputedStyle(document.body);
    return svgString.replace(cssVarRegex, (match, varName) => {
        return computedStyle.getPropertyValue(varName).trim();
    });
}
/**
 * 将SVG字符串转换为高清晰度的PNG格式的Node.js Buffer对象。
 * @param svgString SVG原始内容
 * @param scaleFactor 缩放因子。例如，2代表2倍分辨率。建议值为 2 或 3。
 * @returns 一个解析为Buffer对象的Promise
 */
export async function svgToPngBuffer(
    svgString: string,
    scaleFactor: number,
): Promise<Buffer> {
    const dataUrl = svgToDataURL(svgString);

    const image = new Image();

    return new Promise((resolve, reject) => {
        image.onload = () => {
            // 图片加载成功后，获取其原始（自然）尺寸
            const originalWidth = image.naturalWidth;
            const originalHeight = image.naturalHeight;

            if (originalWidth === 0 || originalHeight === 0) {
                URL.revokeObjectURL(dataUrl); // 释放之前创建的URL对象
                return reject(new Error(locale.error.identifySVGFailed));
            }

            // 创建一个临时的Canvas
            const canvas = document.createElement("canvas");

            // 关键步骤：根据缩放因子设置Canvas的像素尺寸
            canvas.width = originalWidth * scaleFactor;
            canvas.height = originalHeight * scaleFactor;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                URL.revokeObjectURL(dataUrl);
                return reject(new Error(locale.error.fetchContextFailed));
            }

            // 关键步骤：缩放Canvas的坐标系
            // 这样后续的绘制操作都会被放大
            ctx.scale(scaleFactor, scaleFactor);

            // 将原始SVG图像绘制到被放大的Canvas上
            ctx.drawImage(image, 0, 0, originalWidth, originalHeight);

            // 从高分辨率的Canvas导出Blob
            canvas.toBlob((blob) => {
                // 释放之前创建的URL对象，避免内存泄漏
                URL.revokeObjectURL(dataUrl);

                if (!blob) {
                    return reject(new Error(locale.error.generateBlobFailed));
                }
                void blob
                    .arrayBuffer()
                    .then((arrayBuffer) => resolve(Buffer.from(arrayBuffer)))
                    .catch(reject);
            }, "image/png");
        };

        image.onerror = (error) => {
            URL.revokeObjectURL(dataUrl);
            reject(new Error(`${locale.error.loadSVGFailed}: ${error}`));
        };

        image.src = dataUrl;
    });
}
