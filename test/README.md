# Math table regression tests

Run `npm test` for 34 offline regression/integration tests, then `npm run build` for the TypeScript and production-bundle checks. `npm test` does not contact Zhihu or read/write a real vault.

Coverage:

- The original MoE table, ordinary tables, mixed documents, header math, inline `$` / `$$`, literal dollars, formula-looking code, and fenced code.
- Column alignment, empty/header-only/ragged tables, CRLF, missing outer pipes, tables in lists/quotes, explicit breaks, Chinese/English wrapping, text styles, HTML entities and TeX metacharacters.
- Fractions, nested matrices/cases/aligned environments, tags, escaped norm bars and conditional probability syntax. Formula source is preserved; a generated newline terminates a trailing TeX `%` comment.
- Combining accents, skin tones, ZWJ emoji and flag pairs at wrap boundaries, including hosts without `Intl.Segmenter`.
- 500 data rows, repeated headers, URL/row budgets, oversized headers/single rows, and unsupported content late in the table. No source-AST mutation or partial conversion.
- A deterministic 100-table mixed-text corpus inside one test (not 100 independent test cases).
- Links/images/footnotes/deletion/HTML fallbacks and real wiki-link parsing in the production pipeline.
- Real production Markdown-to-HTML pipeline, Typst-to-TeX ordering, encoded newlines surviving HTML cleanup, ordinary content compatibility and deduplicated notices/requests. The Obsidian host and transport are the only mocked boundaries.
- Actual captured HTTP-200 error SVG, non-200 responses, wrong media types, incomplete responses, transport errors, timeouts and failure in a later continuation chunk.

## Optional live verification

Run `npm run test:live` separately. It makes unauthenticated GET requests to `https://www.zhihu.com/equation`, with synthetic/public test content only. It never publishes or updates an article. Set `ZHIHU_TEST_REPORT_DIR` to an output directory to save each returned SVG, its TeX source and `live-results.json`.

On 2026-10-17, all 16 live tests passed (18 HTTP requests): 14 table cases produced successful renderings (the 65-row case produced three chunks); two negative cases reproduced the old trailing-comment bug and an undefined TeX command. Both returned HTTP 200 with an error SVG and were correctly rejected. The invalid-command case also verifies whole-table fallback. The captured metadata is in `fixtures/zhihu-live-results-2026-10-17.json` and a real error response is in `fixtures/zhihu-equation-error.svg`.

A separate boundary probe observed an 8,470-character URL returning HTTP 414; a 5,150-character URL succeeded. The 7,500-character conversion budget leaves headroom; the live split-table test also verified successful URLs of 7,288 and 7,308 characters. This is an observed service limit, not a contractual Zhihu API guarantee.

A temporary instrumented build was also exercised inside the running HWWORK Obsidian instance: a valid formula with a trailing comment converted successfully using the real Obsidian HTTP transport; an undefined command preserved the native table and text. The production build was then restored, reloaded and verified to expose all 13 Zhihu commands without the temporary hook. This did not publish an article or modify a note.

Screenshot and provenance: [`imgs/math-tables/README.md`](../imgs/math-tables/README.md).

## Limits of this verification

The live suite checks actual SVG responses and known MathJax error-image markers; HTTP 200 alone is insufficient. It is opt-in because it depends on the external service and its rate limits. The offline suite runs in CI.

These checks do not guarantee arbitrary TeX commands, exact font/emoji appearance, readable layout for any number of columns, or pixel-identical rendering across devices. The final article/answer publishing flow was not exercised. Source Markdown is preserved; unsupported/oversized/unrenderable tables fall back with a notice, so their math may still fail inside native Zhihu table cells. Validation adds a network request per distinct generated chunk and waits at most 10 seconds per request; it cannot cancel the underlying Obsidian HTTP request after timeout.
