import {
    App,
    ButtonComponent,
    Component,
    MarkdownRenderer,
    Modal,
    Setting,
    Vault,
} from "obsidian";
import { loadData, updateData } from "./data";
import i18n, { type Lang } from "../locales";

const locale: Lang = i18n.current;

// Define the structure of the settings
export interface ZhihuSettings {
    partition: string;
    user_agent: string;
    defaultSaveFolder: string;
    restrictToZhihuFM: boolean;
    sendReadToZhihu: boolean;
    recommendCount: number;
    useZhihuHeadings: boolean;
    useImgNameDefault: boolean;
    manualCookieEdit: boolean;
    autoOpenZhihuLink: boolean;
    mermaidScale: number;
    popularize: boolean;
    typstMode: boolean;
    typstCliPath: string;
    typstImgPPI: number;
    typstRenderLang: string;
    typstPresetStyle: string;
    typstFallbackToTeX: boolean;
    typstDisplayToTeX: boolean;
    turnImgOffline: boolean;
}

// Default settings in case none exist in zhihu-data.json
const DEFAULT_SETTINGS: ZhihuSettings = {
    partition: "zhihu-login",
    user_agent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    defaultSaveFolder: "zhihu",
    restrictToZhihuFM: false,
    sendReadToZhihu: true,
    recommendCount: 7,
    useZhihuHeadings: true,
    useImgNameDefault: false,
    manualCookieEdit: false,
    autoOpenZhihuLink: true,
    mermaidScale: 3,
    popularize: true,
    typstMode: false,
    typstCliPath: "",
    typstImgPPI: 300,
    typstRenderLang: "typrender",
    typstPresetStyle:
        "#set page(width: auto, height: auto, margin:(x: 40pt, y: 10pt))",
    typstFallbackToTeX: true,
    typstDisplayToTeX: false,
    turnImgOffline: true,
};

/**
 * Load settings from zhihu-data.json
 * @param vault Obsidian Vault instance
 * @returns Promise resolving to ZhihuSettings
 */
export async function loadSettings(vault: Vault): Promise<ZhihuSettings> {
    try {
        const data = await loadData(vault);
        const settings = data?.settings || {};
        return { ...DEFAULT_SETTINGS, ...settings };
    } catch (e) {
        console.error("Error loading settings:", e);
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Save settings to zhihu-data.json
 * @param vault Obsidian Vault instance
 * @param settings Partial settings to update
 */
export async function saveSettings(
    vault: Vault,
    settings: Partial<ZhihuSettings>,
): Promise<void> {
    try {
        await updateData(vault, { settings });
    } catch (e) {
        console.error("Error saving settings:", e);
        throw e;
    }
}

export class ConfirmationModal extends Modal {
    constructor(
        app: App,
        bodyMarkdown: string,
        buttonCallback: (button: ButtonComponent) => void,
        clickCallback: () => Promise<void>,
    ) {
        super(app);
        this.contentEl.addClass("zhihu-obsidian-confirmation-modal");
        const contentDiv = this.contentEl.createDiv();
        const component = new (class extends Component { })();

        MarkdownRenderer.render(this.app, bodyMarkdown, contentDiv, "", component);

        new Setting(this.contentEl)
            .addButton((button: ButtonComponent) => {
                buttonCallback(button);
                button.onClick(async () => {
                    await clickCallback();
                    this.close();
                });
            })
            .addButton((button: ButtonComponent) =>
                button
                    .setButtonText(locale.ui.cancel)
                    .onClick(() => this.close()),
            );
    }
}
