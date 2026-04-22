import { Vault, PluginSettingTab, Setting } from "obsidian";
import { basicSetup } from "./ui/cookies_editor/extensions";
import { EditorState } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { loadSettings, saveSettings } from "./settings";
import { execFileSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { getZhihuImg } from "./image_service";
import { writeFile, mkdtemp, rm } from "fs/promises";

export async function createTypstEditor(
    st: PluginSettingTab,
    setting: Setting,
    style: string,
) {
    const customCSSWrapper = setting.controlEl.createDiv(
        "typst-editor-wrapper",
    );
    const extensions = basicSetup;

    const change = EditorView.updateListener.of(async (v: ViewUpdate) => {
        if (v.docChanged) {
            await saveSettings(st.app.vault, {
                typstPresetStyle: v.state.doc.toString(),
            });
        }
    });

    extensions.push(change);

    this.typstEditor = new EditorView({
        state: EditorState.create({
            doc: style,
            extensions: extensions,
        }),
    });
    customCSSWrapper.appendChild(this.typstEditor.dom);
}

export function getTypstVersion(path: string): string | null {
    if (!path) return null;
    try {
        const version = execFileSync(path, ["--version"]).toString();
        return version.replace("typst ", "");
    } catch (error) {
        console.error(error);
        return null;
    }
}

export async function typstCode2Img(
    code: string,
    vault: Vault,
): Promise<string> {
    const settings = await loadSettings(vault);
    const typstPath = settings.typstCliPath.trim();
    const typstImgPPI = settings.typstImgPPI.toString();

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "typst-"));
    const pngFile = path.join(tmpDir, "formula.png");
    const typFile = path.join(tmpDir, "formula.typ");
    await writeFile(typFile, code, "utf8");
    // 使用命令行转换成png图片
    execFileSync(typstPath, [
        "compile",
        "--ppi",
        typstImgPPI,
        typFile,
        pngFile,
    ]);
    const imgData = fs.readFileSync(pngFile);
    const imgArrayBuffer = imgData.buffer.slice(
        imgData.byteOffset,
        imgData.byteOffset + imgData.byteLength,
    ) as ArrayBuffer;
    const imgRes = await getZhihuImg(vault, imgArrayBuffer);
    const imgLink = imgRes.original_src;
    await rm(tmpDir, { recursive: true, force: true }); // 清理临时文件夹
    return imgLink;
}
