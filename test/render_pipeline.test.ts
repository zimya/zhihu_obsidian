import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { equations } from './helpers/markdown';

// Exercise the real production pipeline (including wiki links, Typst, notices
// and newline cleanup). Only the Obsidian host/HTTP boundary is replaced.
const temporary = mkdtempSync(join(tmpdir(), 'zhihu-render-test-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
buildSync({
    stdin: { contents: 'export {remarkMdToHTML} from "./src/custom_render"; export * as host from "./test/helpers/obsidian";', resolveDir: process.cwd(), loader: 'ts' },
    outfile: join(temporary, 'pipeline.cjs'), bundle: true, platform: 'node', format: 'cjs',
    alias: { obsidian: resolve('test/helpers/obsidian.ts') }, logLevel: 'silent',
});
(globalThis as any).window = { localStorage: { getItem: () => 'en' } };
const { remarkMdToHTML, host } = createRequire(import.meta.url)(join(temporary, 'pipeline.cjs'));
const valid = { status: 200, headers: { 'content-type': 'image/svg+xml' }, text: '<svg><path d="M0 0"/></svg>' };
const mdTable = (row: string) => `| 数据 | 公式 |\n|---|---|\n${row}`;
function app(settings = {}) {
    return { vault: { configDir: '.obsidian', getMarkdownFiles: () => [], adapter: {
        exists: async () => true, read: async () => JSON.stringify({ settings }),
        write: async () => { throw Error('Must not write vault data'); },
    } } };
}
async function render(md: string, settings = {}) {
    // The production renderer logs HTML; suppress it to keep test/CI logs small.
    const log = console.log;
    console.log = () => {};
    try { return await remarkMdToHTML(app(settings), md); }
    finally { console.log = log; }
}

test('production pipeline validates the user MoE table and preserves decoded TeX/newlines', async () => {
    host.reset(async () => valid);
    const md = readFileSync(new URL('./fixtures/moe-math-table.md', import.meta.url), 'utf8');
    const html = await render(md);
    assert.equal(host.requests.length, 1);
    assert.deepEqual(equations(html), host.requests.map((url: string) => new URL(url).searchParams.get('tex')));
    assert.ok(equations(html)[0].includes('{X_e\n}'));
    assert.deepEqual(host.notices, []);
    assert.ok(!html.includes('<table'));
});

test('production pipeline leaves ordinary tables/paragraph formulas/code blocks unchanged without validation', async () => {
    host.reset(async () => { throw Error('No HTTP expected'); });
    const html = await render('| 数据 |\n|---|\n| 普通 |\n\n正文 $a+b$\n\n$$\nx+y\n$$\n\n```md\n| $fake$ |\n|---|\n```');
    assert.equal(host.requests.length, 0);
    assert.equal((html.match(/<table/g) || []).length, 1);
    assert.deepEqual(equations(html), ['a+b', 'x+y']);
    assert.match(html, /<pre lang="md">/);
});

test('production pipeline converts Typst before validating the table equation', async () => {
    host.reset(async () => valid);
    const html = await render(mdTable('| 导数 | $frac(a,b)$ |'), { typstMode: true });
    assert.equal(host.requests.length, 1);
    assert.ok(equations(html)[0].includes(String.raw`\frac{a}{b}`));
    assert.deepEqual(host.notices, []);
});

test('production pipeline keeps wiki links as unsupported instead of discarding them', async () => {
    host.reset(async () => { throw Error('No validation expected'); });
    const html = await render(mdTable('| [[笔记]] | $x$ |'));
    assert.equal(host.requests.length, 0);
    assert.match(html, /<table/);
    assert.ok(html.includes('笔记'));
    assert.equal(host.notices.length, 1);
});

test('production pipeline handles HTTP-200 error images, HTTP failures and rejected requests', async () => {
    const error = readFileSync(new URL('./fixtures/zhihu-equation-error.svg', import.meta.url), 'utf8');
    for (const reply of [async () => ({ ...valid, text: error }), async () => ({ ...valid, status: 414 }), async () => { throw Error('offline'); }]) {
        host.reset(reply);
        const html = await render(mdTable('| 保留文字 | $x$ |'));
        assert.match(html, /<table/);
        assert.ok(html.includes('保留文字'));
        assert.equal(host.notices.length, 1);
        assert.match(host.notices[0], /could not render/);
    }
});

test('production pipeline repeats headers when splitting, and reverts all chunks on later failure', async () => {
    const md = mdTable(Array.from({ length: 65 }, (_, i) => `| 数据${i} | $x_{${i}}$ |`).join('\n'));
    host.reset(async () => valid);
    const success = await render(md);
    assert.equal(equations(success).length, 3);
    assert.equal(host.requests.length, 3);
    assert.deepEqual(host.notices, []);
    let calls = 0;
    host.reset(async () => ++calls === 2 ? { ...valid, status: 500 } : valid);
    const failure = await render(md);
    assert.match(failure, /<table/);
    assert.equal((failure.match(/<tr>/g) || []).length, 66);
    assert.equal(equations(failure).filter(tex => tex.includes('begin{array}')).length, 0);
    assert.equal(host.notices.length, 1);
});

test('production pipeline distinguishes oversize/unsupported/render failures and only notifies once per reason', async () => {
    host.reset(async () => ({ ...valid, status: 500 }));
    const unsupported = mdTable('| [链接](https://example.com) | $x$ |');
    const huge = mdTable(`| ${'长'.repeat(2000)} | $x$ |`);
    const failing = mdTable('| 保留 | $x$ |');
    const html = await render([unsupported, unsupported, huge, huge, failing, failing].join('\n\n'));
    assert.equal((html.match(/<table/g) || []).length, 6);
    assert.equal(host.requests.length, 1);
    assert.equal(host.notices.length, 3);
    assert.ok(host.notices.some((s: string) => s.includes('too large')));
    assert.ok(host.notices.some((s: string) => s.includes('unsupported')));
    assert.ok(host.notices.some((s: string) => s.includes('could not render')));
});
