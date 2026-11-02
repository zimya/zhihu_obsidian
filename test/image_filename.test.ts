import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

const bundle = buildSync({
    entryPoints: [resolve("src/utilities.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    alias: { obsidian: resolve("test/helpers/obsidian.ts") },
});
const bundledModule: {
    exports: { imageFileName?: (source: string) => string };
} = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(
    bundledModule,
    bundledModule.exports,
);
const imageFileName = bundledModule.exports.imageFileName!;

test("extracts filenames from vault paths and web URLs", () => {
    assert.equal(imageFileName("images/photo.png"), "photo.png");
    assert.equal(imageFileName("images/photo.png/"), "photo.png");
    assert.equal(imageFileName("图片.png"), "图片.png");
    assert.equal(
        imageFileName("https://example.com/images/photo.png?size=2#view"),
        "photo.png",
    );
    assert.equal(imageFileName(""), "");
});
