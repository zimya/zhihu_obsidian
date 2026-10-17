import React, { useState } from "react";
import IconCopy from "@theme/Icon/Copy";

const DISCLAIMER_LIST = [
    "包含剧透",
    "包含医疗建议",
    "虚构创作",
    "包含理财内容",
    "包含 AI 辅助创作",
];

export default function DisclaimerTable() {
    const [copied, setCopied] = useState<string | null>(null);

    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        window.setTimeout(() => {
            setCopied((cur) => (cur === text ? null : cur));
        }, 1000);
    };

    return (
        <table>
            <thead>
                <tr>
                    <th>支持的创作声明</th>
                    <th>复制</th>
                </tr>
            </thead>
            <tbody>
                {DISCLAIMER_LIST.map((item) => (
                    <tr key={item}>
                        <td>{item}</td>
                        <td style={{ textAlign: "center" }}>
                            <button
                                type="button"
                                onClick={() => handleCopy(item)}
                                aria-label={copied === item ? "已复制" : "复制"}
                                title={copied === item ? "已复制" : "复制"}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    padding: 4,
                                    fontSize: "1rem",
                                }}
                            >
                                {copied === item ? (
                                    "✔️"
                                ) : (
                                    <IconCopy width={18} height={18} />
                                )}
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
