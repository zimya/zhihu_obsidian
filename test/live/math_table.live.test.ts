import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Table } from 'mdast';
import { parser } from '../helpers/markdown';
import { MAX_TABLE_URL_LENGTH, prepareMathTables, tableToLatexChunks } from '../../src/math_table';
import { zhihuEquationUrl } from '../../src/math';
import { isRenderedEquation } from '../../src/math_table_validation';

// Opt-in only: calls the actual public Zhihu equation renderer. No login,
// publishing, vault reads or article writes. Keep it out of ordinary CI.
const output = process.env.ZHIHU_TEST_REPORT_DIR;
if (output) mkdirSync(output, { recursive: true });
const report: object[] = [];
after(() => { if (output) writeFileSync(join(output, 'live-results.json'), JSON.stringify(report, null, 2)); });
const table = (rows: string) => `| 数据 | 公式 |\n|---|---|\n${rows}`;
async function request(name: string, tex: string, expected: boolean) {
    const url = zhihuEquationUrl(tex);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    const headers = Object.fromEntries(response.headers.entries());
    const rendered = isRenderedEquation({ status: response.status, headers, text });
    const result = { name, urlLength: url.length, status: response.status, type: headers['content-type'], rendered, expected, width: text.match(/\bwidth="([^"]+)/)?.[1], height: text.match(/\bheight="([^"]+)/)?.[1] };
    report.push(result);
    if (output) {
        writeFileSync(join(output, `${name}.svg`), text);
        writeFileSync(join(output, `${name}.tex`), tex);
    }
    assert.equal(rendered, expected, JSON.stringify(result));
    return rendered;
}
const cases: [string, string][] = [
    ['moe', readFileSync(new URL('../fixtures/moe-math-table.md', import.meta.url), 'utf8')],
    ['comment-fixed', table('| 注释 | $x % valid comment$ |')],
    ['escaped-percent', table(String.raw`| 百分比 | $x=100\%$ |`)],
    ['nested-matrix', table(String.raw`| 矩阵 | $\begin{pmatrix}a&b\\c&d\end{pmatrix}$ |`)],
    ['nested-cases', table(String.raw`| 分段 | $\begin{cases}x&x>0\\-x&x\le0\end{cases}$ |`)],
    ['nested-aligned', table(String.raw`| 对齐 | $\begin{aligned}a&=b+c\\d&=e\end{aligned}$ |`)],
    ['norm-and-fraction', table(String.raw`| 范数 | $\|x\|$ |`+'\n'+String.raw`| 导数 | $\displaystyle\frac{\partial L}{\partial W}$ |`)],
    ['text-symbols', table(String.raw`| A&B 50% # _ { } ^ ~ \\ \$ | $x+y=100\%$ |`)],
    ['styles-unicode', table('| ***中文ABC*** `a_b` 😀 👩‍💻 é<br>下一行 | $x$ |')],
    ['empty-crlf', '| | $x$ |\r\n|---|---|\r\n| | |\r\n| 数据 |'],
    ['header-only', '| $X_e$ |\n|---|'],
    ['long-text', table('| 保存，或用原始输入与路由重新分发，然后用于反向传播；这是更长的中英文 mixed text 用于验证自动换行。 | $x$ |')],
    ['large-split', table(Array.from({length: 65}, (_,i)=>`| 第${i}行保存用于反向传播的激活数据 | $x_{${i}}$ |`).join('\n'))],
    ['wide-eight-columns', '|'+Array.from({length:8},(_,i)=>'列'+i).join('|')+'|\n|'+Array(8).fill('---').join('|')+'|\n|'+Array(8).fill('$x$').join('|')+'|'],
];
for (const [name, md] of cases) {
    test(`live Zhihu rendering: ${name}`, async () => {
        const ast = parser().parse(md);
        const result = tableToLatexChunks(ast.children[0] as Table);
        assert.ok(result.equations);
        for (const [i, tex] of result.equations.entries()) {
            assert.ok(zhihuEquationUrl(tex).length <= MAX_TABLE_URL_LENGTH);
            await request(result.equations.length === 1 ? name : `${name}-${i+1}`, tex, true);
        }
    });
}

test('live Zhihu rendering: reproduce the old trailing-comment bug', async () => {
    const result = tableToLatexChunks(parser().parse(table('| 注释 | $x % valid comment$ |')).children[0] as Table);
    assert.ok(result.equations);
    await request('comment-before', result.equations[0].replace('comment\n}', 'comment}'), false);
});

test('live Zhihu rendering: invalid TeX falls back instead of replacing the entire table with an error SVG', async () => {
    const ast = parser().parse(table(String.raw`| 保留文字 | $\thisCommandDoesNotExist{x}$ |`));
    const results = await prepareMathTables(ast, async url => request('invalid-command', new URL(url).searchParams.get('tex')!, false));
    assert.equal([...results.values()][0].reason, 'render');
});
