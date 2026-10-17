import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Table } from "mdast";
import { tableToLatex } from "../src/math_table";
import { parser, render, equations } from "./helpers/markdown";

const moe = readFileSync(new URL("./fixtures/moe-math-table.md", import.meta.url), "utf8");

test("the original MoE table becomes one display equation with all formulas preserved", async () => {
    const { html, skipped } = await render(moe);
    assert.equal(skipped, 0);
    assert.doesNotMatch(html, /<table|eeimg="1"/);
    assert.match(html, /^<p><img eeimg="2"/);
    const [tex] = equations(html);
    assert.equal(equations(html).length, 1);
    assert.match(tex, /\\begin\{array\}\{\|l\|l\|l\|\}/);
    assert.match(tex, /\\hline/);
    for (const math of ["X_e", "G_e,U_e", "H_e", "p", "V_{t,e}", String.raw`dp=\langle dY,V\rangle`]) {
        assert.ok(tex.includes(`{${math}\n}`), math);
    }
    assert.ok(html.includes("%26"));
    assert.equal(new URL(`https:${html.match(/src="([^"]+)"/)![1]}`).searchParams.size, 1);
});

test("ordinary tables keep their original native Zhihu HTML", async () => {
    const { html, skipped } = await render("| 水果 | 英文 |\n| --- | --- |\n| 苹果 | apple |");
    assert.equal(skipped, 0);
    assert.equal(html.replace(/>\n</g, "><"), '<table data-draft-node="block" data-draft-type="table" data-size="normal"><tbody><tr><th>水果</th><th>英文</th></tr><tr><td>苹果</td><td>apple</td></tr></tbody></table>');
});

test("escaped dollars and formula-looking code do not trigger conversion", async () => {
    const { html } = await render("| 金额 | 示例 |\n| --- | --- |\n| \\$5 | `$x$` |");
    assert.match(html, /<table/);
    assert.deepEqual(equations(html), []);
});

test("only math tables convert, including math in headers and inline double dollars", async () => {
    const { html } = await render("正文 $a+b$\n\n| 普通 |\n| --- |\n| 文本 |\n\n| $$X_e$$ |\n| --- |\n| 数值 |");
    assert.equal((html.match(/<table/g) || []).length, 1);
    assert.equal(equations(html).length, 2);
    assert.equal(equations(html)[0], "a+b");
    assert.ok(equations(html)[1].includes("{X_e\n}"));
});

test("text metacharacters are escaped while formula source stays intact", async () => {
    const input = String.raw`| 字符 | 公式 |
| --- | --- |
| A&B 50% # _ { } ^ ~ \\ \$ | $x+y=100\%$ |`;
    const [tex] = equations((await render(input)).html);
    for (const escape of [String.raw`\&`, String.raw`\%`, String.raw`\#`, String.raw`\_`, String.raw`\{`, String.raw`\}`, String.raw`\backslash`, String.raw`\$`]) {
        assert.ok(tex.includes(escape), escape);
    }
    assert.ok(tex.includes("{x+y=100\\%\n}"));
    assert.doesNotMatch(tex, /\\text(?:backslash|asciicircum|asciitilde)/);
    assert.ok(tex.includes("^"));
    assert.ok(tex.includes("~"));
});

test("long Chinese text wraps, alignment is kept, and source AST is not mutated", () => {
    const input = "| 数据 | 处理方式 |\n| :--- | ---: |\n| $V_{t,e}$ | 保存，或用原始输入与路由重新分发，然后用于反向传播 |";
    const table = parser().parse(input).children[0] as Table;
    const before = JSON.stringify(table);
    const tex = tableToLatex(table)!;
    assert.equal(JSON.stringify(table), before);
    assert.ok(tex.includes(String.raw`\begin{array}{|l|r|}`));
    assert.ok(tex.includes(String.raw`\begin{array}{r}`));
    assert.ok(tex.includes("{V_{t,e}\n}"));
});

test("formatting, empty cells, Unicode, and HTML line breaks survive conversion", async () => {
    const { html } = await render("| 公式 | 文本 | 空 |\n| --- | :---: | --- |\n| **$x$** | **粗体** *斜体* `a_b` 😀<br>换行 | |");
    const [tex] = equations(html);
    assert.ok(tex.includes("{x\n}"));
    assert.ok(tex.includes(String.raw`\textbf{`));
    assert.ok(tex.includes(String.raw`\textit{`));
    assert.ok(tex.includes(String.raw`\texttt{a}{\_}\texttt{b}`));
    assert.doesNotMatch(tex, /\\text\{\\text(?:bf|it|tt)/);
    assert.ok(tex.includes("😀"));
    assert.ok(tex.includes(String.raw`\begin{array}{c}`));
    assert.ok(tex.includes(String.raw`\text{ }`));
});

for (const content of [
    "[链接](https://example.com)",
    "![图片](https://example.com/image.png)",
    "<em>HTML</em>",
    "~~删除线~~",
    "引用[^note]",
]) {
    test(`unsupported content stays native and is reported: ${content}`, async () => {
        const { html, skipped } = await render(`| 公式 | 内容 |\n| --- | --- |\n| $x$ | ${content} |\n\n[^note]: 注释`);
        assert.match(html, /<table/);
        assert.equal(skipped, 1);
        assert.doesNotMatch(equations(html)[0], /\\begin\{array\}/);
        if (content.startsWith("[链接]")) assert.ok(html.includes('href="https://example.com"'));
        if (content.startsWith("![图片]")) assert.ok(html.includes('src="https://example.com/image.png"'));
    });
}

test("standalone equations keep modes and round-trip reserved URL characters", async () => {
    const eq = String.raw`\begin{aligned}x&=a+b\\y&=\#\end{aligned}`;
    const { html } = await render(`$a+b$\n\n$$\n${eq}\n$$`);
    assert.match(html, /eeimg="1"/);
    assert.match(html, /eeimg="2"/);
    assert.deepEqual(equations(html), ["a+b", eq]);
});
