export function getCookiesFromHeader(response: {
    headers: Record<string, string | string[] | undefined>;
}): { [key: string]: string } {
    let new_cookies: string[] = [];
    const res_cookies = response.headers["set-cookie"];
    if (Array.isArray(res_cookies)) {
        new_cookies = res_cookies;
    } else if (typeof res_cookies === "string") {
        new_cookies = [res_cookies];
    }

    const result: { [key: string]: string } = {};

    new_cookies.forEach((cookieStr) => {
        const [keyValuePair] = cookieStr.split(";");
        const separatorIndex = keyValuePair.indexOf("=");
        if (separatorIndex !== -1) {
            const key = keyValuePair.substring(0, separatorIndex).trim();
            const value = keyValuePair.substring(separatorIndex + 1).trim();
            result[key] = value;
        }
    });

    return result;
}

export function cookiesHeaderBuilder(
    data: { cookies?: Record<string, string> },
    keys: string[],
): string {
    // if key is empty: return all cookies
    if (keys.length === 0) {
        return Object.entries(data.cookies ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .join("; ");
    }
    // else: return only the specified cookies
    return Object.entries(data.cookies ?? {})
        .filter(([key]) => keys.includes(key))
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
}
