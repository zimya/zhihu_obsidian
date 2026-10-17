import type { Element } from "hast";
import type { PhrasingContent, Root, Table } from "mdast";
import { visit } from "unist-util-visit";
import { zhihuEquation, zhihuEquationUrl } from "./math";

const TEXT_WIDTH = 28; // Roughly 14 CJK characters per column.
// Zhihu returned HTTP 414 for an 8,470-character URL in live testing. Keep
// headroom and limit height as well; repeat the header in each continuation.
export const MAX_TABLE_URL_LENGTH = 7500;
const MAX_CHUNK_ROWS = 30; // Including the header.
export type MathTableFallback = "unsupported" | "size" | "render";
export type MathTableResult = { equations: string[]; reason?: never } |
    { equations?: never; reason: MathTableFallback };
type Part = {
    tex: string;
    width: number;
    break?: boolean;
    text?: string;
    style?: Style;
};
type Style = { bold?: boolean; italic?: boolean; code?: boolean };
// Keep combining accents, emoji modifiers/ZWJ sequences and flag pairs
// together when a cell wraps. Older hosts may lack Intl.Segmenter.
const Segmenter = (Intl as any).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : undefined;
function graphemes(text: string): string[] {
    return segmenter ? Array.from(segmenter.segment(text), (part: { segment: string }) => part.segment) :
        text.match(/\p{Regional_Indicator}{2}|\P{M}[\p{M}\p{Emoji_Modifier}]*(?:\u200d\P{M}[\p{M}\p{Emoji_Modifier}]*)*|\p{M}+/gu) || [];
}

function textTokens(text: string): string[] {
    const tokens: string[] = [];
    let word = "";
    for (const part of graphemes(text)) {
        if (/^[A-Za-z0-9_.:/+-]/.test(part)) word += part;
        else {
            if (word) tokens.push(word);
            word = "";
            tokens.push(part);
        }
    }
    if (word) tokens.push(word);
    return tokens;
}

function textWidth(text: string): number {
    return Array.from(text).reduce(
        (width, char) => width + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1),
        0,
    );
}

function textTex(text: string, style: Style): string {
    const symbols: Record<string, string> = {
        "\\": "\\backslash",
        "{": "\\{",
        "}": "\\}",
        "$": "\\$",
        "&": "\\&",
        "#": "\\#",
        "%": "\\%",
        "_": "\\_",
    };
    // Zhihu's equation server does not parse nested text macros or escaped
    // symbols inside \text. Emit those symbols in math mode between text runs.
    // Literal ^ and ~ are supported inside its text macros.
    return text.split(/([\\{}$&#%_])/g).map((part) => {
        if (!part) return "";
        if (symbols[part]) return `{${symbols[part]}}`;
        const command = style.code ? "texttt" : style.italic ? "textit" : style.bold ? "textbf" : "text";
        let tex = `\\${command}{${part}}`;
        if (style.bold && (style.code || style.italic)) tex = `\\boldsymbol{${tex}}`;
        if (style.italic && style.code) tex = `\\mathit{${tex}}`;
        return tex;
    }).join("");
}

function inlineParts(nodes: PhrasingContent[], style: Style = {}): Part[] | undefined {
    const parts: Part[] = [];
    for (const node of nodes) {
        switch (node.type) {
            case "text":
            case "inlineCode": {
                const currentStyle = {
                    ...style,
                    code: style.code || node.type === "inlineCode",
                };
                // Keep ordinary words together, but allow CJK text and very long
                // words to wrap. Math is always an indivisible part.
                const tokens = textTokens(node.value);
                for (const token of tokens) {
                    if (token === "\n") {
                        parts.push({ tex: "", width: 0, break: true });
                        continue;
                    }
                    const chunks = textWidth(token) > TEXT_WIDTH ? graphemes(token) : [token];
                    for (const chunk of chunks) {
                        parts.push({
                            tex: "",
                            text: chunk,
                            style: currentStyle,
                            width: textWidth(chunk),
                        });
                    }
                }
                break;
            }
            case "inlineMath":
                // End a possible trailing % comment before our closing brace.
                // Without the newline, one valid formula can break the array.
                parts.push({
                    tex: `{${node.value}\n}`,
                    width: textWidth(node.value.replace(/\\[a-zA-Z]+/g, "x")),
                });
                break;
            case "strong":
            case "emphasis": {
                const children = inlineParts(node.children, {
                    ...style,
                    bold: style.bold || node.type === "strong",
                    italic: style.italic || node.type === "emphasis",
                });
                if (!children) return;
                parts.push(...children);
                break;
            }
            case "break":
                parts.push({ tex: "", width: 0, break: true });
                break;
            case "html":
                if (!/^<br\s*\/?\s*>$/i.test(node.value.trim())) return;
                parts.push({ tex: "", width: 0, break: true });
                break;
            default:
                // Links, images, footnotes, wiki links, and arbitrary HTML must
                // retain their behavior. Never silently discard them in TeX.
                return;
        }
    }
    return parts;
}

function renderLine(parts: Part[]): string {
    let output = "";
    let text = "";
    let style: Style = {};
    const flush = () => {
        if (text) output += textTex(text, style);
        text = "";
    };
    for (const part of parts) {
        if (part.text !== undefined) {
            const nextStyle = part.style || {};
            if (
                style.bold !== nextStyle.bold ||
                style.italic !== nextStyle.italic ||
                style.code !== nextStyle.code
            ) flush();
            style = nextStyle;
            text += part.text;
        } else {
            flush();
            output += part.tex;
        }
    }
    flush();
    return output || "\\text{ }";
}

function renderCell(parts: Part[], alignment: string): string {
    const lines: string[] = [];
    let line: Part[] = [];
    let width = 0;
    for (const part of parts) {
        if (part.break || (width > 0 && width + part.width > TEXT_WIDTH)) {
            lines.push(renderLine(line));
            line = [];
            width = 0;
        }
        if (!part.break) {
            if (width === 0 && part.text?.trim() === "" && !part.style?.code) continue;
            line.push(part);
            width += part.width;
        }
    }
    lines.push(renderLine(line));
    return lines.length === 1
        ? lines[0]
        : `\\begin{array}{${alignment}}${lines.join("\\\\")}\\end{array}`;
}

export function hasTableMath(node: Table): boolean {
    const hasMath = (nodes: PhrasingContent[]): boolean => nodes.some(
        (child) => child.type === "inlineMath" ||
            ("children" in child && hasMath(child.children)),
    );
    return node.children.some((row) => row.children.some((cell) => hasMath(cell.children)));
}

export function tableToLatexChunks(node: Table): MathTableResult {
    // Render the whole table as one equation to avoid Zhihu's native-cell
    // restriction. Array workaround suggested by 于连:
    // https://www.zhihu.com/question/1914425114503680325/answer/1935357755381753435
    if (!hasTableMath(node) || !node.children.length) return { reason: "unsupported" };
    const columns = Math.max(...node.children.map((row) => row.children.length));
    const alignments = Array.from({ length: columns }, (_, col) => {
        const align = node.align?.[col];
        return align === "center" ? "c" : align === "right" ? "r" : "l";
    });
    const rows: string[] = [];
    for (const row of node.children) {
        const cells: string[] = [];
        for (let col = 0; col < columns; col++) {
            const parts = inlineParts(row.children[col]?.children || []);
            if (!parts) return { reason: "unsupported" };
            cells.push(renderCell(parts, alignments[col]));
        }
        rows.push(`${cells.join(" & ")} \\\\`);
    }
    const makeArray = (chunk: string[]) => [
        "\\small",
        `\\begin{array}{|${alignments.join("|")}|}`,
        "\\hline",
        chunk.join("\n\\hline\n"),
        "\\hline",
        "\\end{array}",
    ].join("\n");
    const fits = (chunk: string[]) => chunk.length <= MAX_CHUNK_ROWS &&
        zhihuEquationUrl(makeArray(chunk)).length <= MAX_TABLE_URL_LENGTH;
    const equations: string[] = [];
    const header = rows[0];
    let chunk = [header];
    if (!fits(chunk)) return { reason: "size" };
    for (const row of rows.slice(1)) {
        if (!fits([...chunk, row])) {
            // A header + a single data row cannot be divided without changing
            // cell meaning. Fall back for the whole table, never lose a row.
            if (chunk.length === 1 || !fits([header, row])) return { reason: "size" };
            equations.push(makeArray(chunk));
            chunk = [header];
        }
        chunk.push(row);
    }
    equations.push(makeArray(chunk));
    return { equations };
}

// Kept for callers that need the source of a single, unsplit table.
export function tableToLatex(node: Table): string | undefined {
    const result = tableToLatexChunks(node);
    return result.equations?.length === 1 ? result.equations[0] : undefined;
}

/** Validate the actual generated arrays, after Typst/image transforms. */
export async function prepareMathTables(
    tree: Root,
    validate: (url: string) => Promise<boolean>,
): Promise<Map<Table, MathTableResult>> {
    const tables: Table[] = [];
    visit(tree, "table", (node) => { if (hasTableMath(node)) tables.push(node); });
    const results = new Map<Table, MathTableResult>();
    const checked = new Map<string, boolean>();
    for (const table of tables) {
        const result = tableToLatexChunks(table);
        if (result.equations) {
            for (const tex of result.equations) {
                const url = zhihuEquationUrl(tex);
                if (!checked.has(url)) {
                    try { checked.set(url, await validate(url)); }
                    catch { checked.set(url, false); }
                }
                if (!checked.get(url)) {
                    results.set(table, { reason: "render" });
                    break;
                }
            }
        }
        if (!results.has(table)) results.set(table, result);
    }
    return results;
}

export function renderZhihuTable(
    state: any,
    node: Table,
    onUnsupported?: (reason: MathTableFallback) => void,
    prepared?: MathTableResult,
): Element | Element[] {
    if (hasTableMath(node)) {
        const result = prepared || tableToLatexChunks(node);
        if (result.equations) {
            const images = result.equations.map((tex) => zhihuEquation(tex, true));
            return images.length === 1 ? images[0] : images;
        }
        onUnsupported?.(result.reason);
    }
    // Keep the original native-table output for ordinary or unsupported tables.
    return {
        type: "element",
        tagName: "table",
        properties: {
            "data-draft-node": "block",
            "data-draft-type": "table",
            "data-size": "normal",
        },
        children: [{
            type: "element",
            tagName: "tbody",
            properties: {},
            children: state.all(node),
        }],
    };
}
