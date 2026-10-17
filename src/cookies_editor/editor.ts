import {
    PluginSettingTab,
    ExtraButtonComponent,
    Setting,
    ButtonComponent,
    Notice,
    Vault,
} from "obsidian";
import { basicSetup, editorRoot } from "./extensions";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { loadData, saveData, type ZhihuData } from "src/data";
import { ConfirmationModal } from "src/settings";
import i18n, { type Lang } from "locales";
import { getUserInfo } from "src/login_service";

const locale = i18n.current;

// Only touch the cookies field: `data` is a snapshot taken when the settings tab was displayed,
// saving it whole would overwrite newer settings (e.g. typstPresetStyle).
async function saveCookies(vault: Vault, cookies: ZhihuData["cookies"]) {
    const latest = await loadData(vault);
    latest.cookies = cookies;
    await saveData(vault, latest);
}

export async function createCookiesEditor(
    st: PluginSettingTab,
    cookiesSetting: Setting,
    data: ZhihuData,
) {
    const backupData = JSON.parse(JSON.stringify(data)); // create a deep copy of data
    const customCSSWrapper = cookiesSetting.controlEl.createDiv(
        "cookies-editor-wrapper",
    );
    const cookiesFooter = cookiesSetting.controlEl.createDiv("cookies-footer");
    const validity = cookiesFooter.createDiv("cookies-editor-validity");
    const validityIndicator = new ExtraButtonComponent(validity);
    validityIndicator
        .setIcon("checkmark")
        .extraSettingsEl.addClass("cookies-editor-validity-indicator");

    const validityText = validity.createDiv("cookies-editor-validity-text");
    validityText.addClass("setting-item-description");

    function updateValidityIndicator(success: boolean) {
        validityIndicator.setIcon(success ? "checkmark" : "cross");
        validityIndicator.extraSettingsEl.removeClass(
            success ? "invalid" : "valid",
        );
        validityIndicator.extraSettingsEl.addClass(
            success ? "valid" : "invalid",
        );
        validityText.setText(
            success
                ? locale.settings.editorSyntaxSaved
                : locale.settings.editorSyntaxInvalid,
        );
    }

    const change = EditorView.updateListener.of((v: ViewUpdate) => {
        if (v.docChanged) {
            const cookies = v.state.doc.toString();

            let success = true;
            let parsedCookies;
            try {
                parsedCookies = JSON.parse(cookies);
            } catch (e) {
                success = false;
            }

            updateValidityIndicator(success);

            if (!success) return;
            void saveCookies(st.app.vault, parsedCookies).catch(
                (error: unknown) => {
                    console.error("Failed to save cookies", error);
                },
            );
        }
    });

    // basicSetup is shared by all editors, so never mutate it
    const extensions: Extension[] = [...basicSetup, change];

    this.cookiesEditor = new EditorView({
        state: EditorState.create({
            doc: JSON.stringify(data.cookies, null, 2),
            extensions,
        }),
        root: editorRoot(customCSSWrapper),
    });

    customCSSWrapper.appendChild(this.cookiesEditor.dom);
    const buttonsDiv = cookiesFooter.createDiv("cookies-editor-buttons");
    const reset = new ButtonComponent(buttonsDiv);
    reset
        .setIcon("arrow-left-right")
        .setTooltip(locale.settings.editorResetTooltip)
        .onClick(() => {
            new ConfirmationModal(
                st.app,
                locale.settings.editorResetWarning,
                (button) =>
                    button
                        .setButtonText(
                            locale.settings.editorResetWarningButtonText,
                        )
                        .setWarning(),
                async () => {
                    this.cookiesEditor.setState(
                        EditorState.create({
                            doc: JSON.stringify(backupData.cookies, null, 2),
                            extensions: extensions,
                        }),
                    );
                    updateValidityIndicator(true);
                    await saveCookies(st.app.vault, backupData.cookies);
                },
            ).open();
        });
    const refresh = new ButtonComponent(buttonsDiv);
    refresh
        .setIcon("rotate-ccw")
        .setTooltip(locale.settings.editorRefreshTooltip)
        .onClick(async () => {
            try {
                await getUserInfo(st.app.vault);
                st.display();
            } catch (error) {
                new Notice(locale.settings.editorRefreshFailedNotice);
            }
        });
}
