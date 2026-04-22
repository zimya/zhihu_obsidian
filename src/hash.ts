// 为了兼容 iPad，iPad 没有 Node.js 环境
// 所以这里重新实现了 crypto 库的 md5 和 sha1 算法的实现，保证全平台一致

function leftRotate(value: number, shift: number): number {
    return (value << shift) | (value >>> (32 - shift));
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data;
    }
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
}

function wordToHexLE(word: number): string {
    let hex = "";
    for (let i = 0; i < 4; i++) {
        const byte = (word >>> (i * 8)) & 0xff;
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

const S: number[] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
];

const K: number[] = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000),
);

const SHA1_H: number[] = [
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0,
];

const BASE64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function md5Hex(data: ArrayBuffer | Uint8Array): string {
    const sourceBuffer = toArrayBuffer(data);
    const source = new Uint8Array(sourceBuffer);
    const sourceLength = source.length;
    const bitLength = sourceLength * 8;

    const totalLength = Math.ceil((sourceLength + 1 + 8) / 64) * 64;
    const padded = new Uint8Array(totalLength);
    padded.set(source);
    padded[sourceLength] = 0x80;

    const view = new DataView(padded.buffer);
    view.setUint32(totalLength - 8, bitLength >>> 0, true);
    view.setUint32(totalLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < totalLength; offset += 64) {
        const m: number[] = new Array(16);
        for (let j = 0; j < 16; j++) {
            m[j] = view.getUint32(offset + j * 4, true);
        }

        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        for (let i = 0; i < 64; i++) {
            let f = 0;
            let g = 0;

            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) % 16;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) % 16;
            }

            const temp = d;
            d = c;
            c = b;

            const rotated = leftRotate((a + f + K[i] + m[g]) >>> 0, S[i]);
            b = (b + rotated) >>> 0;
            a = temp;
        }

        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    return (
        wordToHexLE(a0) + wordToHexLE(b0) + wordToHexLE(c0) + wordToHexLE(d0)
    );
}

function sha1Bytes(data: Uint8Array): Uint8Array {
    const sourceLength = data.length;
    const bitLength = sourceLength * 8;
    const totalLength = Math.ceil((sourceLength + 1 + 8) / 64) * 64;
    const padded = new Uint8Array(totalLength);
    padded.set(data);
    padded[sourceLength] = 0x80;

    const view = new DataView(padded.buffer);
    view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(totalLength - 4, bitLength >>> 0, false);

    let h0 = SHA1_H[0];
    let h1 = SHA1_H[1];
    let h2 = SHA1_H[2];
    let h3 = SHA1_H[3];
    let h4 = SHA1_H[4];

    for (let offset = 0; offset < totalLength; offset += 64) {
        const w: number[] = new Array(80);
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 80; i++) {
            w[i] = leftRotate(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;

        for (let i = 0; i < 80; i++) {
            let f = 0;
            let k = 0;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }

            const temp = (leftRotate(a, 5) + f + e + k + (w[i] >>> 0)) >>> 0;
            e = d;
            d = c;
            c = leftRotate(b, 30) >>> 0;
            b = a;
            a = temp;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
    }

    const out = new Uint8Array(20);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, h0, false);
    outView.setUint32(4, h1, false);
    outView.setUint32(8, h2, false);
    outView.setUint32(12, h3, false);
    outView.setUint32(16, h4, false);
    return out;
}

function toBase64(data: Uint8Array): string {
    let result = "";
    for (let i = 0; i < data.length; i += 3) {
        const b0 = data[i];
        const b1 = i + 1 < data.length ? data[i + 1] : 0;
        const b2 = i + 2 < data.length ? data[i + 2] : 0;

        const triple = (b0 << 16) | (b1 << 8) | b2;
        result += BASE64_ALPHABET[(triple >>> 18) & 0x3f];
        result += BASE64_ALPHABET[(triple >>> 12) & 0x3f];
        result +=
            i + 1 < data.length ? BASE64_ALPHABET[(triple >>> 6) & 0x3f] : "=";
        result += i + 2 < data.length ? BASE64_ALPHABET[triple & 0x3f] : "=";
    }
    return result;
}

export function hmacSha1Base64(key: string, message: string): string {
    const encoder = new TextEncoder();
    let keyBytes: Uint8Array = encoder.encode(key);
    if (keyBytes.length > 64) {
        keyBytes = sha1Bytes(keyBytes);
    }

    const normalizedKey = new Uint8Array(64);
    normalizedKey.set(keyBytes);

    const oKeyPad = new Uint8Array(64);
    const iKeyPad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
        oKeyPad[i] = normalizedKey[i] ^ 0x5c;
        iKeyPad[i] = normalizedKey[i] ^ 0x36;
    }

    const msgBytes = encoder.encode(message);
    const innerData = new Uint8Array(iKeyPad.length + msgBytes.length);
    innerData.set(iKeyPad, 0);
    innerData.set(msgBytes, iKeyPad.length);
    const innerHash = sha1Bytes(innerData);

    const outerData = new Uint8Array(oKeyPad.length + innerHash.length);
    outerData.set(oKeyPad, 0);
    outerData.set(innerHash, oKeyPad.length);
    const hmac = sha1Bytes(outerData);

    return toBase64(hmac);
}
