import { Vault, PluginSettingTab, Setting, FileSystemAdapter } from "obsidian";
import { basicSetup, editorRoot } from "./cookies_editor/extensions";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { loadSettings, saveSettings } from "./settings";
import { execFileSync } from "child_process";

export async function createTypstEditor(
    st: PluginSettingTab,
    setting: Setting,
    style: string,
) {
    const customCSSWrapper = setting.controlEl.createDiv(
        "typst-editor-wrapper",
    );
    const change = EditorView.updateListener.of(async (v: ViewUpdate) => {
        if (v.docChanged) {
            await saveSettings(st.app.vault, {
                typstPresetStyle: v.state.doc.toString(),
            });
        }
    });

    // basicSetup is shared by all editors, so never mutate it
    const extensions: Extension[] = [...basicSetup, change];

    this.typstEditor = new EditorView({
        state: EditorState.create({
            doc: style,
            extensions: extensions,
        }),
        root: editorRoot(customCSSWrapper),
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
): Promise<ArrayBuffer> {
    const settings = await loadSettings(vault);
    const typstPath = settings.typstCliPath.trim();
    const typstImgPPI = settings.typstImgPPI.toString();

    // 临时文件通过 Obsidian 的 vault.adapter 读写，仅在插件配置目录内
    const adapter = vault.adapter;
    const basePath = (adapter as FileSystemAdapter).getBasePath();
    const tmpDir = `${vault.configDir}/plugins/zhihu/typst-tmp`;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const typFile = `${tmpDir}/formula-${id}.typ`;
    const pngFile = `${tmpDir}/formula-${id}.png`;
    if (!(await adapter.exists(tmpDir))) {
        await adapter.mkdir(tmpDir);
    }
    try {
        await adapter.write(typFile, code);
        // 使用命令行转换成png图片
        execFileSync(typstPath, [
            "compile",
            "--ppi",
            typstImgPPI,
            `${basePath}/${typFile}`,
            `${basePath}/${pngFile}`,
        ]);
        // 必须 await，否则 finally 会在读取完成前删除文件
        return await adapter.readBinary(pngFile);
    } finally {
        // 清理临时文件
        for (const file of [typFile, pngFile]) {
            if (await adapter.exists(file)) {
                await adapter.remove(file);
            }
        }
    }
}
