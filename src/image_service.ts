import { Vault, Notice, requestUrl } from "obsidian";
import * as fs from "fs";
import { fileTypeFromBuffer } from "file-type";
import * as cookies from "./cookies";
import * as dataUtil from "./data";
import * as file from "./files";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
import { App } from "obsidian";
import sizeOf from "image-size";
import { md5Hex, hmacSha1Base64 } from "./hash";

const locale: Lang = i18n.current;

type ImgStatus = {
    status: "success" | "processing" | "init";
    src: string;
    watermark: string;
    watermark_hash: string;
    watermark_src: string;
    original_hash: string;
    original_src: string;
    fallback?: true;
};

// ================================================
// https://zhuanlan.zhihu.com/p/1986773875875403109
// 知乎在我发布的一篇吐槽文章后更新了上传GIF的步骤
// 从阿里云OSS的：完整上传GIF -> 分片上传GIF
// 解决了 GIF 体积膨胀数十倍的问题
// 下面的代码复现了这一步骤
// ================================================

function buildOssSignatureString(
    method: string,
    contentType: string,
    date: string,
    securityToken: string,
    userAgent: string,
    resourcePath: string, // 例如: /zhihu-pics/v2-{hash}
    subResource = "", // 例如: ?uploads 或 ?partNumber=1&uploadId=...
): string {
    // 阿里云 OSS 规范头: x-oss-date, x-oss-security-token, x-oss-user-agent
    // 必须按字母顺序排列
    const canonicalizedOssHeaders =
        `x-oss-date:${date}\n` +
        `x-oss-security-token:${securityToken}\n` +
        `x-oss-user-agent:${userAgent}\n`;

    // CanonicalizedResource = /BucketName/ObjectKey + SubResource
    const canonicalizedResource = `${resourcePath}${subResource}`;

    // 注意：Content-MD5 这里留空，因为知乎的抓包中只有部分请求带了，通常非必须
    return `${method}\n\n${contentType}\n${date}\n${canonicalizedOssHeaders}${canonicalizedResource}`;
}

// 更新函数签名
async function uploadMultipart(
    vault: Vault,
    imgArrayBuffer: ArrayBuffer,
    uploadToken: any,
    imgHash: string,
    imageId: string,
) {
    const settings = await loadSettings(vault);
    const bucketName = "zhihu-pics";
    const objectKey = `v2-${imgHash}`;
    const requestUrlBase = `https://zhihu-pics-upload.zhimg.com/${objectKey}`;
    const resourcePath = `/${bucketName}/${objectKey}`;
    const data = await dataUtil.loadData(vault);
    const cookiesHeader = cookies.cookiesHeaderBuilder(data, [
        "_zap",
        "_xsrf",
        "BEC",
        "d_c0",
        "captcha_session_v2",
        "z_c0",
    ]);
    const ua = settings.user_agent;
    const date = new Date().toUTCString();

    try {
        // ==========================================
        // Step 1: 初始化分片上传 (OSS)
        // ==========================================
        const initSubResource = "?uploads";
        const initContentType = "image/gif";

        const initStringToSign = buildOssSignatureString(
            "POST",
            initContentType,
            date,
            uploadToken.access_token,
            ua,
            resourcePath,
            initSubResource,
        );
        const initSignature = await calculateSignature(
            uploadToken.access_key,
            initStringToSign,
        );

        const initRes = await requestUrl({
            url: `${requestUrlBase}${initSubResource}`,
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Content-Type": initContentType,
                "x-oss-date": date,
                "x-oss-user-agent": ua,
                "x-oss-security-token": uploadToken.access_token,
                Authorization: `OSS ${uploadToken.access_id}:${initSignature}`,
            },
        });

        if (initRes.status !== 200)
            throw new Error(`Init failed: ${initRes.status}`);
        const parser = new DOMParser();
        const initDoc = parser.parseFromString(initRes.text, "application/xml");
        const uploadId = initDoc.querySelector("UploadId")?.textContent;
        if (!uploadId) throw new Error("Failed to retrieve UploadId");

        // ==========================================
        // Step 2: 上传分片 (OSS)
        // ==========================================
        const chunkSize = 1024 * 1024; // 1MB
        const partCount = Math.ceil(imgArrayBuffer.byteLength / chunkSize);
        const partsETags: { partNumber: number; eTag: string }[] = [];
        const partContentType = "application/octet-stream";

        for (let i = 0; i < partCount; i++) {
            const partNumber = i + 1;
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, imgArrayBuffer.byteLength);
            const chunkArrayBuffer = imgArrayBuffer.slice(start, end);

            const partSubResource = `?partNumber=${partNumber}&uploadId=${uploadId}`;
            const partStringToSign = buildOssSignatureString(
                "PUT",
                partContentType,
                date,
                uploadToken.access_token,
                ua,
                resourcePath,
                partSubResource,
            );
            const partSignature = await calculateSignature(
                uploadToken.access_key,
                partStringToSign,
            );

            const partRes = await requestUrl({
                url: `${requestUrlBase}${partSubResource}`,
                method: "PUT",
                headers: {
                    "User-Agent": ua,
                    "Content-Type": partContentType,
                    "x-oss-date": date,
                    "x-oss-user-agent": ua,
                    "x-oss-security-token": uploadToken.access_token,
                    Authorization: `OSS ${uploadToken.access_id}:${partSignature}`,
                },
                body: chunkArrayBuffer,
            });

            if (partRes.status !== 200)
                throw new Error(`Part ${partNumber} failed`);
            const eTag = partRes.headers["etag"] || partRes.headers["ETag"];
            partsETags.push({ partNumber, eTag });
        }

        // ==========================================
        // Step 3: 完成上传 (OSS)
        // ==========================================
        const completeSubResource = `?uploadId=${uploadId}`;
        const completeContentType = "application/xml";

        let xmlBody =
            '<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n';
        partsETags.forEach((p) => {
            xmlBody += `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.eTag}</ETag></Part>\n`;
        });
        xmlBody += "</CompleteMultipartUpload>";

        const completeStringToSign = buildOssSignatureString(
            "POST",
            completeContentType,
            date,
            uploadToken.access_token,
            ua,
            resourcePath,
            completeSubResource,
        );
        const completeSignature = await calculateSignature(
            uploadToken.access_key,
            completeStringToSign,
        );

        const completeRes = await requestUrl({
            url: `${requestUrlBase}${completeSubResource}`,
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Content-Type": completeContentType,
                "x-oss-date": date,
                "x-oss-user-agent": ua,
                "x-oss-security-token": uploadToken.access_token,
                Authorization: `OSS ${uploadToken.access_id}:${completeSignature}`,
            },
            body: xmlBody,
        });

        if (completeRes.status !== 200) throw new Error("Complete OSS failed");

        // ==========================================
        // Step 4: 通知知乎服务器上传成功
        // ==========================================
        const notifyUrl = `https://api.zhihu.com/images/${imageId}/uploading_status`;

        const notifyRes = await requestUrl({
            url: notifyUrl,
            method: "PUT",
            headers: {
                "User-Agent": settings.user_agent,
                Cookie: cookiesHeader,
                "Content-Type": "application/json",
                Referer: "https://zhuanlan.zhihu.com/",
                Origin: "https://zhuanlan.zhihu.com",
            },
            body: JSON.stringify({ upload_result: "success" }),
        });

        if (notifyRes.status !== 200) {
            console.error("Notify failed", notifyRes);
            throw new Error(`Failed to notify Zhihu: ${notifyRes.status}`);
        }

        new Notice("上传 GIF 成功!");
    } catch (error) {
        console.error("GIF Multipart Upload Error:", error);
        throw error;
    }
}

async function getImgIdFromHash(vault: Vault, imgHash: string) {
    try {
        const data = await dataUtil.loadData(vault);
        const cookiesHeader = cookies.cookiesHeaderBuilder(data, [
            "_zap",
            "_xsrf",
            "BEC",
            "d_c0",
            "captcha_session_v2",
            "z_c0",
        ]);
        const response = await requestUrl({
            url: `https://api.zhihu.com/images`,
            headers: {
                "Content-Type": "application/json",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                // 'referer': `https://zhuanlan.zhihu.com/p/${id}/edit`,
                // 'origin': 'https://zhuanlan.zhihu.com',
                // 'dnt': '1',
                // 'sec-gpc': '1',
                // 'sec-fetch-dest': 'empty',
                // 'sec-fetch-mode': 'cors',
                // 'sec-fetch-site': 'same-site',
                // 'priority': 'u=4',
                Cookie: cookiesHeader,
            },
            method: "POST",
            body: JSON.stringify({
                image_hash: imgHash,
                source: "article",
            }),
        });
        new Notice(`${locale.notice.getImageIdSuccess}`);
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.getImageIdFailed},${error}`);
    }
}

export async function uploadCover(app: App, cover: string) {
    const match = cover.match(/\[\[(.*?)\]\]/);
    if (!match) {
        new Notice(`${locale.notice.coverSyntaxInvalid}`);
        return;
    } else {
        const imgName = match[1];
        const imgData = await file.getImgBufferFromName(app, imgName);
        const imgRes = await getZhihuImg(app.vault, imgData);
        const imgOriginalPath = imgRes.original_src;
        return imgOriginalPath;
    }
}

async function uploadImg(
    vault: Vault,
    imgId: string,
    imgArrayBuffer: ArrayBuffer,
    uploadToken: any,
) {
    try {
        const settings = await loadSettings(vault);
        const imgHash = md5Hex(imgArrayBuffer);
        const fileType = await fileTypeFromBuffer(
            new Uint8Array(imgArrayBuffer),
        );
        if (!fileType) throw new Error(locale.error.recognizeFileTypeFailed);
        const mimeType = fileType?.mime;
        // 如果是 GIF，调用新的分片上传函数，否则 GIF 的体积会膨胀十倍
        if (fileType?.mime === "image/gif") {
            await uploadMultipart(
                vault,
                imgArrayBuffer,
                uploadToken,
                imgHash,
                imgId,
            );
            return;
        }
        const requestTime = Date.now();
        const UTCDate = new Date(requestTime).toUTCString();
        const ua = "aliyun-sdk-js/6.8.0 Firefox 137.0 on OS X 10.15";
        const stringToSign = stringToSignBuilder(
            mimeType,
            UTCDate,
            uploadToken.access_token,
            ua,
            imgHash,
        );
        const signature = await calculateSignature(
            uploadToken.access_key,
            stringToSign,
        );
        const request = {
            url: `https://zhihu-pics-upload.zhimg.com/v2-${imgHash}`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": mimeType,
                "Accept-Language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                "x-oss-date": UTCDate,
                "x-oss-user-agent": ua,
                "x-oss-security-token": uploadToken.access_token,
                authorization: `OSS ${uploadToken.access_id}:${signature}`,
                // 'Origin': 'https://zhuanlan.zhihu.com',
                // 'DNT': '1',
                // 'Sec-GPC': '1',
                // 'Referer': 'https://zhuanlan.zhihu.com/',
                // 'Sec-Fetch-Dest': 'empty',
                // 'Sec-Fetch-Mode': 'cors',
                // 'Sec-Fetch-Site': 'cross-site'
            },
            method: "PUT",
            body: imgArrayBuffer,
        };
        await requestUrl(request);
        new Notice(`${locale.notice.imageUploadSuccess}`);
    } catch (error) {
        new Notice(`${locale.notice.imageUploadFailed},${error}`);
    }
}

async function fetchImgStatus(vault: Vault, imgId: string) {
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
        ]);
        const response = await requestUrl({
            url: `https://api.zhihu.com/images/${imgId}`,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
                // 'referer': `https://zhuanlan.zhihu.com/p/${id}/edit`,
                // 'content-type': 'application/json',
                // 'origin': 'https://zhuanlan.zhihu.com',
                // 'dnt': '1',
                // 'sec-gpc': '1',
                // 'sec-fetch-dest': 'empty',
                // 'sec-fetch-mode': 'cors',
                // 'sec-fetch-site': 'same-site',
                // 'priority': 'u=4',
                // 'te': 'trailers',
                Cookie: cookiesHeader,
            },
            method: "GET",
        });
        // new Notice(`${locale.notice.getImageStatusSuccess}`);
        return response.json;
    } catch (error) {
        new Notice(`${locale.notice.getImageStatusFailed},${error}`);
    }
}

// 查询imgStatus失败后的默认URL
// 一般来说只要上传了图片，图片就在这个URL里
function getDefaultImgStatus(hash: string): ImgStatus {
    const src = `https://picx.zhimg.com/v2-${hash}`;
    return {
        status: "processing",
        src,
        watermark: "original",
        watermark_hash: `v2-${hash}`,
        watermark_src: src,
        original_hash: `v2-${hash}`,
        original_src: src,
        fallback: true,
    };
}
// 轮询图片URL
async function pollImgStatus(
    vault: Vault,
    imgId: string,
    imgHash: string,
    maxRetry = 10,
    intervalMs = 2000,
): Promise<ImgStatus> {
    for (let i = 0; i < maxRetry; i++) {
        try {
            const status = await fetchImgStatus(vault, imgId);

            if (status.status === "success") {
                return status;
            }
        } catch (err) {
            console.error("fetchImgStatus error:", err);
            break;
        }

        await new Promise((r) => setTimeout(r, intervalMs));
    }

    return getDefaultImgStatus(imgHash);
}

export async function getZhihuImg(
    vault: Vault,
    imgArrayBuffer: ArrayBuffer,
): Promise<ImgStatus> {
    const data = await dataUtil.loadData(vault);
    const cache: Record<string, ImgStatus> = data.cache ?? {};
    const hash = md5Hex(imgArrayBuffer);

    if (!cache[hash]) {
        const getImgIdRes = await getImgIdFromHash(vault, hash);
        const imgId = getImgIdRes.upload_file.image_id;
        const imgState = getImgIdRes.upload_file.state;
        const uploadToken = getImgIdRes.upload_token;

        if (imgState === 2) {
            await uploadImg(vault, imgId, imgArrayBuffer, uploadToken);
        }
        // 轮询imgStatus，可以得到img的src和watermark src
        const imgStatus = await pollImgStatus(vault, imgId, hash, 10, 2000);
        // 如果当前还是processing，说明前面的轮询失败
        // 或者：该图片是第一次上传的GIF，包含了一些expiration和auth_key
        // 不储存缓存，直接返回默认结果
        if (imgStatus.fallback || imgStatus.src.contains("auth_key")) {
            return imgStatus;
        }
        // 存储缓存
        await dataUtil.updateData(vault, {
            cache: {
                ...cache,
                [hash]: imgStatus,
            },
        });
        return imgStatus;
    }

    return cache[hash];
}

export async function getOnlineImg(vault: Vault, url: string) {
    try {
        const settings = await loadSettings(vault);
        const response = requestUrl({
            url: url,
            headers: {
                "User-Agent": settings.user_agent,
                "Accept-Encoding": "gzip, deflate, br, zstd",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-language":
                    "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
            },
            method: "GET",
            contentType: undefined,
        });
        const arrayBuffer = await response.arrayBuffer;
        return arrayBuffer;
    } catch (err) {
        new Notice(`failed to fetch image:${err}`);
        return new ArrayBuffer(0);
    }
}

function stringToSignBuilder(
    mimeType: string,
    date: string,
    securityToken: string,
    ua: string,
    imgHash: string,
): string {
    const stringToSign = `PUT\n\n${mimeType}\n${date}\nx-oss-date:${date}\nx-oss-security-token:${securityToken}\nx-oss-user-agent:${ua}\n/zhihu-pics/v2-${imgHash}`;
    return stringToSign;
}

async function calculateSignature(
    accessKeySecret: string,
    stringToSign: string,
): Promise<string> {
    return hmacSha1Base64(accessKeySecret, stringToSign);
}

export function getImgDimensions(imgArrayBuffer: ArrayBuffer): {
    width: number;
    height: number;
} {
    const dimensions = sizeOf(new Uint8Array(imgArrayBuffer));
    return { width: dimensions.width, height: dimensions.height };
}
