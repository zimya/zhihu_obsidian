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
    exports: {
        getAvailableMarkdownPath?: (
            vault: { getAllLoadedFiles: () => Array<{ path: string }> },
            baseName?: string,
        ) => string;
    };
} = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(
    bundledModule,
    bundledModule.exports,
);
const getAvailableMarkdownPath =
    bundledModule.exports.getAvailableMarkdownPath!;

function mockVault(paths: string[]) {
    return {
        getAllLoadedFiles: () => paths.map((path) => ({ path })),
    };
}

test("returns baseName.md when vault has no conflicting path", () => {
    assert.equal(getAvailableMarkdownPath(mockVault([])), "untitled.md");
    assert.equal(
        getAvailableMarkdownPath(mockVault(["notes/Untitled.md"])),
        "untitled.md",
    );
});

test("skips existing paths case-insensitively and increments counter", () => {
    const vault = mockVault([
        "Untitled.md",
        "Untitled 1.md",
        "untitled 2.md",
        "Untitled 3.md",
        "Untitled 4.md",
    ]);
    assert.equal(getAvailableMarkdownPath(vault), "untitled 5.md");
});
