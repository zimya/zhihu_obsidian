import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeRaw from "rehype-raw";
import { mathPlugin, zhihuEquation } from "../../src/math";
import { renderZhihuTable } from "../../src/math_table";

export function parser() {
    return unified().use(remarkParse).use(remarkGfm).use(mathPlugin);
}

export async function render(markdown: string) {
    let skipped = 0;
    const output = await parser()
        .use(remarkRehype, {
            allowDangerousHtml: true,
            handlers: {
                inlineMath: (_state, node) => zhihuEquation(node.value, false),
                math: (_state, node) => zhihuEquation(node.value, true),
                table: (state, node) => renderZhihuTable(state, node, () => skipped++),
            },
        })
        .use(rehypeRaw)
        .use(rehypeStringify)
        .process(markdown);
    return { html: String(output), skipped };
}

export function equations(html: string): string[] {
    return Array.from(html.matchAll(/src="(\/\/www\.zhihu\.com\/equation\?tex=[^"]+)"/g),
        (match) => new URL(`https:${match[1]}`).searchParams.get("tex")!);
}

