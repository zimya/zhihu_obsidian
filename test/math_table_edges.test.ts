import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import type { Table } from 'mdast';
import { zhihuEquationUrl } from '../src/math';
import { MAX_TABLE_URL_LENGTH, prepareMathTables, tableToLatexChunks } from '../src/math_table';
import { isRenderedEquation, validateEquation } from '../src/math_table_validation';
import { parser, render, equations } from './helpers/markdown';

const table = (body: string) => `| 名称 | 公式 |\n| :--- | ---: |\n${body}`;
const parseTable = (md: string) => parser().parse(md).children[0] as Table;
const valid = { status: 200, headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }, text: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>' };
const errorSvg = readFileSync(new URL('./fixtures/zhihu-equation-error.svg', import.meta.url), 'utf8');

test('a trailing TeX comment cannot consume the generated cell/row delimiters', async () => {
    const formula = String.raw`x % a valid TeX comment`;
    const [tex] = equations((await render(table(`| 注释 | $${formula}$ |`))).html);
    assert.ok(tex.includes(`{${formula}\n}`));
    const percent = String.raw`x=100\%`;
    assert.ok(equations((await render(table(`| 百分比 | $${percent}$ |`))).html)[0].includes(`{${percent}\n}`));
});

test('nested matrices, cases, aligned equations, tags and escaped pipes keep their source', async () => {
    const formulas = [String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, String.raw`\begin{cases}x&x>0\\-x&x\le0\end{cases}`, String.raw`\begin{aligned}a&=b+c\\d&=e\end{aligned}`, String.raw`\|x\|`, String.raw`P(x\mid y)`, String.raw`\frac{\partial L}{\partial W}`, String.raw`x\tag{1}`];
    const [tex] = equations((await render(table(formulas.map((f, i) => `| 项${i} | $${f}$ |`).join('\n')))).html);
    for (const formula of formulas) assert.ok(tex.includes(`{${formula}\n}`), formula);
});

test('entities, literal dollar amounts, Unicode, combined styles and line breaks remain text', async () => {
    const { html } = await render(table('| ***中文ABC*** `a_b` &amp; &lt; &quot; &#124; &nbsp; 😀<BR />下一行 | $x$ |'));
    const [tex] = equations(html);
    assert.ok(tex.includes('中文ABC'));
    assert.ok(tex.includes(String.raw`\boldsymbol{\textit{中文ABC}}`));
    assert.ok(tex.includes(String.raw`{\&}`));
    assert.ok(tex.includes('😀'));
    assert.ok(tex.includes('下一行'));
    assert.ok(!tex.includes('&amp;'));
    assert.ok(!tex.includes('<BR'));
});

test('header-only tables, empty header/cells, missing cells, CRLF and no outer pipes convert', async () => {
    for (const md of ['| $x$ |\n|---|', '| | $x$ |\n|---|---|\n| | |\n| 单元格 |', 'a | b\r\n--- | ---\r\n文字 | $x$']) {
        const { html, skipped } = await render(md);
        assert.equal(skipped, 0);
        assert.equal(equations(html).length, 1, md);
        assert.ok(!html.includes('<table'));
    }
});

test('wrapping never splits combining accents, skin tones, ZWJ emoji or flags', async () => {
    const bundle = buildSync({ entryPoints: [resolve('src/math_table.ts')], write: false, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const legacy = { module: { exports: {} as typeof import('../src/math_table') }, Intl: {} };
    runInNewContext(bundle.outputFiles[0].text, legacy);
    for (const cluster of ['é', '👍🏽', '👩‍💻', '🇨🇳']) {
        const md = table(`| ${'汉'.repeat(13)}${cluster}后续 | $x$ |`);
        const [tex] = equations((await render(md)).html);
        assert.ok(tex.includes(cluster), cluster);
        const result = legacy.module.exports.tableToLatexChunks(parseTable(md));
        assert.ok(result.equations?.[0].includes(cluster), `legacy host: ${cluster}`);
    }
});

test('tables inside quotes and lists do not introduce nested paragraphs', async () => {
    for (const md of ['> '+table('| 值 | $x$ |').replace(/\n/g, '\n> '), '- 项目\n\n  '+table('| 值 | $x$ |').replace(/\n/g, '\n  ')]) {
        const { html } = await render(md);
        assert.equal(equations(html).length, 1);
        assert.doesNotMatch(html, /<p>\s*<p>/);
    }
});

test('large tables split under the URL/height budgets with repeated headers and no missing rows', async () => {
    const md = table(Array.from({ length: 500 }, (_, i) => `| 第${i}行保存用于反向传播的激活数据 | $x_{${i}}$ |`).join('\n'));
    const ast = parseTable(md);
    const before = JSON.stringify(ast);
    const result = tableToLatexChunks(ast);
    assert.ok(result.equations && result.equations.length > 1);
    assert.equal(JSON.stringify(ast), before);
    for (const tex of result.equations) {
        assert.ok(zhihuEquationUrl(tex).length <= MAX_TABLE_URL_LENGTH);
        assert.ok(tex.includes(String.raw`\text{名称} & \text{公式}`));
        assert.ok((tex.match(/\\hline/g) || []).length <= 31);
    }
    const combined = result.equations.join('\n');
    for (let i = 0; i < 500; i++) assert.equal(combined.split(`{x_{${i}}\n}`).length - 1, 1, String(i));
    const { html } = await render(md);
    assert.equal(equations(html).length, result.equations.length);
    assert.doesNotMatch(html, /<table|<div>|<p>\s*<p>/);
});

test('oversized individual rows and headers fall back for the whole table', async () => {
    for (const md of [table(`| 内容${'长'.repeat(2000)} | $x$ |`), `| ${'长'.repeat(2000)} | $x$ |\n|---|---|\n| 内容 | $y$ |`]) {
        assert.equal(tableToLatexChunks(parseTable(md)).reason, 'size');
        const { html, skipped } = await render(md);
        assert.match(html, /<table/);
        assert.equal(skipped, 1);
        assert.ok(html.includes('长'.repeat(100)));
    }
});

test('unsupported content after many valid rows does not partially convert or lose content', async () => {
    const md = table(Array.from({ length: 60 }, () => '| 值 | $x$ |').join('\n')+'\n| [必须保留](https://example.com) | $y$ |');
    const { html, skipped } = await render(md);
    assert.equal(skipped, 1);
    assert.match(html, /<table/);
    assert.ok(html.includes('必须保留'));
    assert.equal(equations(html).filter(tex => tex.includes('begin{array}')).length, 0);
});

test('validation checks real 200 error SVGs, HTTP status, media type, and incomplete responses', () => {
    assert.equal(isRenderedEquation(valid), true);
    for (const response of [{ ...valid, text: errorSvg }, { ...valid, status: 414 }, { ...valid, status: 403 }, { ...valid, headers: { 'content-type': 'text/html' } }, { ...valid, text: '<html>captcha</html>' }, { ...valid, text: '<svg>' }, { ...valid, text: '<svg><merror>bad</merror></svg>' }]) {
        assert.equal(isRenderedEquation(response), false);
    }
    assert.equal(isRenderedEquation({ ...valid, text: '<svg><text>error is ordinary user text</text></svg>' }), true);
});

test('validation handles transport failure, timeout, synchronous throws and valid SVGs', async () => {
    assert.equal(await validateEquation(async () => valid), true);
    assert.equal(await validateEquation(async () => { throw Error('offline'); }), false);
    assert.equal(await validateEquation(() => { throw Error('sync failure'); }), false);
    assert.equal(await validateEquation(() => new Promise(() => {}), 5), false);
});

test('preparation caches identical requests, skips ordinary/unsupported tables, and retains the AST', async () => {
    const md = [table('| 值 | $x$ |'), table('| 值 | $x$ |'), '| a |\n|---|\n| b |', table('| [链接](https://example.com) | $x$ |')].join('\n\n');
    const ast = parser().parse(md);
    const before = JSON.stringify(ast);
    const requests: string[] = [];
    const results = await prepareMathTables(ast, async url => { requests.push(url); return true; });
    assert.equal(requests.length, 1);
    assert.equal(results.size, 3);
    assert.equal([...results.values()].filter(r => r.reason === 'unsupported').length, 1);
    assert.equal(JSON.stringify(ast), before);
});

test('a failure in a continuation reverts the entire table, and thrown errors are contained', async () => {
    const ast = parser().parse(table(Array.from({ length: 60 }, (_, i) => `| 项${i} | $x_{${i}}$ |`).join('\n')));
    let calls = 0;
    const results = await prepareMathTables(ast, async () => ++calls !== 2);
    assert.equal(calls, 2);
    assert.equal([...results.values()][0].reason, 'render');
    const failed = await prepareMathTables(ast, async () => { throw Error('network'); });
    assert.equal([...failed.values()][0].reason, 'render');
});

test('deterministic mixed-text corpus keeps every formula and stays within request budgets', async () => {
    let seed = 42;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    const words = ['中文', 'English', 'A&B', '50%', '#tag', 'a_b', '{文字}', '😀', 'é', '<br>', '**粗体**', '*斜体*', '`a_b`'];
    for (let sample = 0; sample < 100; sample++) {
        const count = 1 + next() % 12;
        const rows = Array.from({ length: count }, (_, i) => `| ${Array.from({ length: 1 + next() % 12 }, () => words[next() % words.length]).join(' ')} | $x_{${sample},${i}}$ |`);
        const result = tableToLatexChunks(parseTable(table(rows.join('\n'))));
        assert.ok(result.equations, `sample ${sample}`);
        for (const tex of result.equations) assert.ok(zhihuEquationUrl(tex).length <= MAX_TABLE_URL_LENGTH);
        for (let i = 0; i < count; i++) assert.ok(result.equations.join('\n').includes(`{x_{${sample},${i}}\n}`));
    }
});
