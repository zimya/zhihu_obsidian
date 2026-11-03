export interface EquationResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
}

export function isRenderedEquation(response: EquationResponse): boolean {
    const contentType = Object.entries(response.headers).find(
        ([key]) => key.toLowerCase() === "content-type",
    )?.[1] || "";
    if (response.status !== 200 || !/^image\/svg\+xml(?:;|$)/i.test(contentType.trim())) return false;
    const svg = response.text.trim();
    if (!/^<svg\b/i.test(svg) || !/<\/svg>$/i.test(svg)) return false;
    // Zhihu's MathJax endpoint returns an error *image* with HTTP 200 for
    // invalid TeX. Do not mistake that response for a successful rendering.
    return !/<(?:merror|parsererror)\b|class=["'][^"']*\bmjx-error\b/i.test(svg) &&
        !/<rect\b[^>]*\bfill=["']rgba\(247,\s*86,\s*89,\s*0\.08\)["']/i.test(svg);
}

/** Bound validation time without leaving a timer running after success. */
export async function validateEquation(
    request: () => Promise<EquationResponse>,
    timeoutMs = 10000,
): Promise<boolean> {
    let timer: number | undefined;
    try {
        return await Promise.race([
            request().then(isRenderedEquation),
            new Promise<boolean>((resolve) => { timer = window.setTimeout(() => resolve(false), timeoutMs); }),
        ]);
    } catch {
        return false;
    } finally {
        if (timer !== undefined) window.clearTimeout(timer);
    }
}
