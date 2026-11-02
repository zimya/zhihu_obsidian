import {
    App,
    PluginSettingTab,
    Setting,
    Notice,
    Vault,
    ToggleComponent,
    Platform,
} from "obsidian";
import type ZhihuObPlugin from "./main";
import { ConfirmationModal, loadSettings, saveSettings } from "./settings";
import * as login from "./login_service";
import { loadData, deleteData } from "./data";
import i18n, { type Lang } from "../locales";
import { EditorView } from "@codemirror/view";
import { createCookiesEditor } from "./cookies_editor/editor";
import { createTypstEditor, getTypstVersion } from "./typst";
import { FolderSuggestModal } from "./utilities";

const locale: Lang = i18n.current;

// Obsidian 1.13's declaration API is not present in the 1.11 typings.
export type SettingsTabContext = PluginSettingTab & {
    plugin: ZhihuObPlugin;
    isLoggedIn: boolean;
    userInfo: { avatar_url: string; name: string; headline?: string } | null;
    refresh(): void;
};

type SettingDefinition = {
    name: string;
    desc?: string;
    render: (setting: Setting) => void | (() => void);
};

function settingFor(container: HTMLElement | Setting): Setting {
    return container instanceof Setting ? container : new Setting(container);
}

export async function fetchUserStatus(vault: Vault) {
    const isLoggedIn = await login.checkIsUserLogin(vault);
    if (!isLoggedIn) return { isLoggedIn: false, userInfo: null };

    const data = await loadData(vault);
    return {
        isLoggedIn: true,
        userInfo: data?.userInfo
            ? {
                  avatar_url: data.userInfo.avatar_url,
                  name: data.userInfo.name,
                  headline: data.userInfo.headline,
              }
            : null,
    };
}

export function AccountSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
) {
    function renderUserInfo(
        setting: Setting,
        userInfo: { avatar_url: string; name: string; headline?: string },
    ) {
        const container = setting.nameEl.createDiv({ cls: "zhihu-user-info" });
        container.createEl("img", {
            cls: "zhihu-avatar",
            attr: { src: userInfo.avatar_url, width: "40", height: "40" },
        });

        const text = container.createDiv({ cls: "zhihu-text-container" });
        text.createDiv({ text: userInfo.name, cls: "zhihu-username" });
        if (userInfo.headline) {
            text.createDiv({
                text: userInfo.headline,
                cls: "zhihu-headline",
            });
        }
    }

    async function handleLogin() {
        await login.zhihuWebLogin(tab.app);
        const { isLoggedIn, userInfo } = await fetchUserStatus(tab.app.vault);
        tab.isLoggedIn = isLoggedIn;
        tab.userInfo = userInfo;
        tab.refresh();
    }

    async function handleLogout() {
        await deleteData(tab.app.vault, "userInfo");
        tab.isLoggedIn = false;
        tab.userInfo = null;
        tab.refresh();
    }

    async function handleRefresh() {
        await login.zhihuRefreshZseCookies(tab.app);
    }

    async function handleNewLogin() {
        await login.zhihuClearLoginInfo(tab.app);
        tab.isLoggedIn = false;
        tab.userInfo = null;
        new Notice(locale.settings.clearLoginSuccess);
        tab.refresh();
    }

    settingFor(containerEl)
        .setName(locale.settings.accountTitle)
        .setDesc(locale.settings.accountTitleDesc)
        .then((setting) => {
            setting.nameEl.addClass("zhihu-flex-container");

            if (tab.isLoggedIn && tab.userInfo) {
                renderUserInfo(setting, tab.userInfo);
                setting.addButton((btn) =>
                    btn
                        .setButtonText(locale.settings.logoutButtonText)
                        .setWarning()
                        .onClick(() => handleLogout()),
                );
                setting.addButton((btn) =>
                    btn
                        .setButtonText(locale.settings.refreshLoginButtonText)
                        .onClick(() => handleRefresh()),
                );
            } else {
                setting.addButton((btn) =>
                    btn
                        .setButtonText(locale.settings.loginButtonText)
                        .setCta()
                        .onClick(() => handleLogin()),
                );
                setting.addButton((btn) =>
                    btn
                        .setButtonText(locale.settings.clearLogin)
                        .onClick(() => handleNewLogin()),
                );
            }
        });
}

export function UserAgentSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    userAgent: string,
) {
    settingFor(containerEl)
        .setName(locale.settings.userAgent)
        .setDesc(locale.settings.userAgentDesc)
        .addText((text) =>
            text
                .setPlaceholder(locale.settings.userAgentPlaceholder)
                .setValue(userAgent)
                .onChange(async (value) => {
                    try {
                        await saveSettings(tab.app.vault, {
                            user_agent: value,
                        });
                    } catch (e) {
                        console.error(locale.error.saveUserAgentFailed, e);
                    }
                }),
        );
}

export function DefaultSaveFolderSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    folder: string,
) {
    const setting = settingFor(containerEl)
        .setName(locale.settings.defaultSaveDir)
        .setDesc(locale.settings.defaultSaveDirDesc);
    setting.nameEl.createEl("code", { text: ` ${folder}` });
    setting.addButton((btn) =>
        btn.setButtonText(locale.ui.choose).onClick(() => {
            new FolderSuggestModal(tab.app, (selectedFolder) => {
                void saveSettings(tab.app.vault, {
                    defaultSaveFolder: selectedFolder.path,
                })
                    .then(() => tab.refresh())
                    .catch((error: unknown) => {
                        console.error("Failed to set default folder", error);
                    });
            }).open();
        }),
    );
}

export function RestrictToZhihuSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    restrict: boolean,
) {
    // Restrict @知友 to notes with zhihu tag
    settingFor(containerEl)
        .setName(locale.settings.restrictAt)
        .setDesc(locale.settings.restrictAtDesc)
        .addToggle((toggle) =>
            toggle.setValue(restrict).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        restrictToZhihuFM: value,
                    });
                } catch (e) {
                    console.error(locale.error.saveRestrictAtFailed, e);
                }
            }),
        );
}

export function ClearImgCacheSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
) {
    // Clear Image Cahce in `data.cache`
    settingFor(containerEl)
        .setName(locale.settings.clearImageCache)
        .setDesc(locale.settings.clearImageCacheDesc)
        .then((setting) => {
            setting.addButton((button) =>
                button
                    .setButtonText(locale.settings.clearImageCacheButtonText)
                    .onClick(async () => {
                        try {
                            await deleteData(tab.app.vault, "cache");
                            new Notice(locale.notice.imageCacheCleared);
                        } catch (e) {
                            console.error(
                                locale.error.clearImageCacheFailed,
                                e,
                            );
                        }
                    }),
            );
        });
}

export function SendReadToZhihuSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    sendReadToZhihu: boolean,
) {
    // If send read to Zhihu
    settingFor(containerEl)
        .setName(locale.settings.sendRead)
        .setDesc(locale.settings.sendReadDesc)
        .addToggle((toggle) =>
            toggle.setValue(sendReadToZhihu).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        sendReadToZhihu: value,
                    });
                } catch (e) {
                    console.error(locale.error.saveSendZhihuFailed, e);
                }
            }),
        );
}

export function ZhihuHeadingsSettings(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    useZhihuHeading: boolean,
) {
    // Setting to enable Zhihu level headings
    settingFor(containerEl)
        .setName(locale.settings.zhihuHeading)
        .setDesc(locale.settings.zhihuHeadingDesc)
        .addToggle((toggle) =>
            toggle.setValue(useZhihuHeading).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        useZhihuHeadings: value,
                    });
                } catch (e) {
                    console.error(locale.error.saveUseZhihuHeadingFailed, e);
                }
            }),
        );
}

export function UseImgNameDefaultSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    useImgNameDefault: boolean,
) {
    // setting to control if set default img name as img base name
    // if img caption is not provided
    settingFor(containerEl)
        .setName(locale.settings.useImgNameDefault)
        .setDesc(locale.settings.useImgNameDefaultDesc)
        .addToggle((toggle) =>
            toggle.setValue(useImgNameDefault).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        useImgNameDefault: value,
                    });
                } catch (e) {
                    console.error(locale.error.saveUseImgNameFailed, e);
                }
            }),
        );
}

export function setTocDefaultSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    setTocDefault: boolean,
) {
    // if to set toc = true when creating a new article/answer
    settingFor(containerEl)
        .setName(locale.settings.setTocDefault)
        .setDesc(locale.settings.setTocDefaultDesc)
        .addToggle((toggle) =>
            toggle.setValue(setTocDefault).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        setTocDefault: value,
                    });
                } catch (e) {
                    console.error(locale.error.saveUseImgNameFailed, e);
                }
            }),
        );
}
export function AutoOpenZhihuLinkSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    autoOpenZhihuLink: boolean,
) {
    // auto open zhihulink
    settingFor(containerEl)
        .setName(locale.settings.autoOpenZhihuLink)
        .setDesc(locale.settings.autoOpenZhihuLinkDesc)
        .addToggle((toggle) =>
            toggle.setValue(autoOpenZhihuLink).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        autoOpenZhihuLink: value,
                    });
                } catch (e) {
                    console.error("save settings failed:", e);
                }
            }),
        );
}

export function TurnImgOfflineSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    turnImgOffline: boolean,
) {
    // auto open zhihulink
    settingFor(containerEl)
        .setName(locale.settings.turnImgOffline)
        .setDesc(locale.settings.turnImgOfflineDesc)
        .addToggle((toggle) =>
            toggle.setValue(turnImgOffline).onChange(async (value) => {
                try {
                    await saveSettings(tab.app.vault, {
                        turnImgOffline: value,
                    });
                } catch (e) {
                    console.error("save settings failed:", e);
                }
            }),
        );
}

export function MermaidScaleSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    scale: number,
) {
    // mermaid scale option
    settingFor(containerEl)
        .setName(locale.settings.mermaidScale)
        .setDesc(locale.settings.mermaidScaleDesc)
        .addDropdown((dropdown) => {
            dropdown
                .addOption("4", locale.settings.UltraHD)
                .addOption("3", locale.settings.HD)
                .addOption("2", locale.settings.LR)
                .setValue(scale.toString())
                .onChange(async (value) => {
                    scale = parseFloat(value);
                    await saveSettings(tab.app.vault, {
                        mermaidScale: parseInt(value),
                    });
                });
        });
}

export function AddPopularStrSetting(
    containerEl: HTMLElement | Setting,
    tab: SettingsTabContext,
    popularize: boolean,
) {
    async function handleToggle(value: boolean, toggle: ToggleComponent) {
        if (value) {
            popularize = true;
            await saveSettings(tab.app.vault, { popularize: value });
            return;
        }
        // 如果是关闭开关，则显示确认弹窗
        // 用于跟踪用户是否点击了确认按钮
        let confirmed = false;

        const modal = new ConfirmationModal(
            tab.app,
            locale.settings.closePopularStrWarning,
            (button) => {
                button
                    .setButtonText(
                        locale.settings.closePopularStrWarningButtonText,
                    )
                    .setWarning();
            },
            async () => {
                confirmed = true; // 标记为已确认
                popularize = false;
                await saveSettings(tab.app.vault, {
                    popularize: value,
                });
            },
        );
        modal.onClose = () => {
            if (!confirmed) {
                toggle.setValue(true);
            }
        };

        modal.open();
    }
    // Add popularize string option
    settingFor(containerEl)
        .setName(locale.settings.addPopularStr)
        .setDesc(locale.settings.addPopularStrDesc)
        .addToggle((toggle) =>
            toggle
                .setValue(popularize)
                .onChange(async (value) => handleToggle(value, toggle)),
        );
}

export function ManualCookieToggle(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    manualCookieEdit: boolean,
    getSettingEl: () => Setting | undefined,
) {
    async function handleToggle(value: boolean) {
        try {
            await saveSettings(tab.app.vault, {
                manualCookieEdit: value,
            });
            const settingEl = getSettingEl();
            settingEl?.settingEl.toggleClass("cookies-setting-area", value);
            settingEl?.settingEl.toggleClass("hidden", !value);
        } catch (e) {
            console.error("save settings failed:", e);
        }
    }

    settingFor(containerEl)
        .setName(locale.settings.editCookies)
        .setDesc(locale.settings.editCookiesDesc)
        .addToggle((toggle) =>
            toggle.setValue(manualCookieEdit).onChange(async (value) => {
                await handleToggle(value);
            }),
        );
}

export function CookiesEditorPanel(
    containerEl: HTMLElement | Setting,
    manualCookieEdit: boolean,
): Setting {
    return settingFor(containerEl)
        .setName("Cookies")
        .setDesc(locale.settings.editorDesc)
        .setClass(manualCookieEdit ? "cookies-setting-area" : "hidden");
}

export function TypstModeToggle(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    typstMode: boolean,
    getSettings: () => Setting[],
) {
    settingFor(containerEl)
        .setName(locale.settings.typstMode)
        .setDesc(locale.settings.typstModeDesc)
        .addToggle((toggle) =>
            toggle.setValue(typstMode).onChange(async (value) => {
                if (!value) {
                    typstMode = false;
                    await saveSettings(tab.app.vault, {
                        typstMode: value,
                    });
                    for (const s of getSettings()) {
                        s.settingEl.toggleClass("hidden", true);
                    }
                    return;
                }
                // 如果是关闭开关，则显示确认弹窗
                // 用于跟踪用户是否点击了确认按钮
                let confirmed = false;

                const modal = new ConfirmationModal(
                    tab.app,
                    locale.settings.typstModeWarning,
                    (button) => {
                        button
                            .setButtonText(locale.ui.confirmOpen)
                            .setWarning();
                    },
                    async () => {
                        confirmed = true; // 标记为已确认
                        await saveSettings(tab.app.vault, {
                            typstMode: value,
                        });
                        for (const s of getSettings()) {
                            s.settingEl.toggleClass(
                                "typst-setting-area",
                                value,
                            );
                        }
                        for (const s of getSettings()) {
                            s.settingEl.toggleClass("hidden", !value);
                        }
                    },
                );

                modal.onClose = () => {
                    if (!confirmed) {
                        toggle.setValue(false);
                    }
                };

                modal.open();
            }),
        );
}

export function TypstPathSetting(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    typstMode: boolean,
    typstCliPath: string,
): Setting {
    // Typst path setting
    if (!Platform.isDesktop) {
        return settingFor(containerEl)
            .setName(locale.settings.typstVersion)
            .setDesc(locale.settings.typstDesktopOnly)
            .setClass(typstMode ? "typst-setting-area" : "hidden");
    }
    let versionName = getTypstVersion(typstCliPath);
    if (!versionName && typstMode) {
        new Notice(locale.notice.typstNotFound);
        versionName = locale.ui.notFound;
    }
    const typstPathSetting = settingFor(containerEl)
        .setName(`${locale.settings.typstVersion}${versionName}`)
        .setDesc(locale.settings.typstPathDesc)
        .addText((text) => {
            text.setValue(typstCliPath).onChange(async (value) => {
                try {
                    typstCliPath = value;
                    await saveSettings(tab.app.vault, {
                        typstCliPath: value,
                    });
                } catch (e) {
                    console.error(e);
                }
            });
        })
        .addButton((button) => {
            button
                .setIcon("rotate-ccw")
                .setTooltip(locale.settings.typstPathToolTip)
                .onClick(async () => {
                    const path = typstCliPath.trim();
                    if (!path) {
                        new Notice(locale.notice.typstPathEmpty);
                        return;
                    }
                    try {
                        versionName = getTypstVersion(path);
                        if (!versionName) {
                            new Notice(locale.notice.typstNotFound);
                            versionName = locale.ui.notFound;
                        }
                        new Notice(
                            `${locale.notice.typstVersion}:${versionName}`,
                        );
                        typstPathSetting.setName(
                            `${locale.settings.typstVersion} ${versionName}`,
                        );
                    } catch (e) {
                        console.error(e);
                    }
                });
        })
        .setClass(typstMode ? "typst-setting-area" : "hidden");
    return typstPathSetting;
}

export function TypstDisplaySetting(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    typstMode: boolean,
    typstDisplayToTeX: boolean,
): Setting {
    // 对于行间公式的处理：是否转成LaTeX
    return settingFor(containerEl)
        .setName(locale.settings.displayMathSetting)
        .setDesc(locale.settings.displayMathSettingDesc)
        .addDropdown((dropdown) => {
            dropdown
                .addOption("false", locale.settings.displayMathTransPic)
                .addOption("true", locale.settings.displayMathTransTex)
                .setValue(typstDisplayToTeX.toString())
                .onChange(async (value) => {
                    typstDisplayToTeX = value === "true";
                    await saveSettings(tab.app.vault, {
                        typstDisplayToTeX: typstDisplayToTeX,
                    });
                });
        })
        .setClass(typstMode ? "typst-setting-area" : "hidden");
}

export function TypstPPISetting(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    typstMode: boolean,
    typstImgPPI: number,
): Setting {
    // Typst PPI setting
    return settingFor(containerEl)
        .setName(locale.settings.typstPicPPI)
        .setDesc(locale.settings.typstPicPPIDesc)
        .addDropdown((dropdown) => {
            dropdown
                .addOption("500", "500")
                .addOption("400", "400")
                .addOption("300", "300")
                .addOption("200", "200")
                .setValue(typstImgPPI.toString())
                .onChange(async (value) => {
                    typstImgPPI = parseFloat(value);
                    await saveSettings(tab.app.vault, {
                        typstImgPPI: parseInt(value),
                    });
                });
        })
        .setClass(typstMode ? "typst-setting-area" : "hidden");
}

export function TypstRenderSetting(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    typstMode: boolean,
    typstRenderLang: string,
): Setting {
    // Typst code identifier
    return settingFor(containerEl)
        .setName(locale.settings.typstRenderSetting)
        .setDesc(locale.settings.typstRenderSettingDesc)
        .addText((text) => {
            text.setValue(typstRenderLang).onChange(async (value) => {
                try {
                    typstRenderLang = value;
                    await saveSettings(tab.app.vault, {
                        typstRenderLang: value,
                    });
                } catch (e) {
                    console.error(e);
                }
            });
        })
        .setClass(typstMode ? "typst-setting-area" : "hidden");
}

export function TypstEditor(
    tab: SettingsTabContext,
    containerEl: HTMLElement | Setting,
    typstMode: boolean,
): Setting {
    // typst 内容编辑器
    return settingFor(containerEl)
        .setName(locale.settings.typstPresetStyle)
        .setDesc(locale.settings.typstPresetStyleDesc)
        .setClass(typstMode ? "typst-setting-area" : "hidden")
        .setClass("preset-style-area");
}

export class ZhihuSettingTab extends PluginSettingTab {
    plugin: ZhihuObPlugin;
    isLoggedIn = false;
    cookiesEditor: EditorView | undefined;
    typstEditor: EditorView | undefined;
    private visible = false;
    private declarativeRows = new Map<string, () => void>();
    private declarativeCleanups = new Map<string, () => void>();
    private declarativeSettings = new Map<string, Setting>();
    private snapshot:
        | Promise<{
              status: Awaited<ReturnType<typeof fetchUserStatus>>;
              settings: Awaited<ReturnType<typeof loadSettings>>;
              data: Awaited<ReturnType<typeof loadData>>;
          }>
        | undefined;

    private loadSnapshot() {
        if (!this.snapshot) {
            this.snapshot = Promise.all([
                fetchUserStatus(this.app.vault),
                loadSettings(this.app.vault),
                loadData(this.app.vault),
            ]).then(([status, settings, data]) => ({ status, settings, data }));
        }
        return this.snapshot;
    }

    getSettingDefinitions(): SettingDefinition[] {
        const entries: [string, string, string?][] = [
            [
                "account",
                locale.settings.accountTitle,
                locale.settings.accountTitleDesc,
            ],
            [
                "userAgent",
                locale.settings.userAgent,
                locale.settings.userAgentDesc,
            ],
            [
                "folder",
                locale.settings.defaultSaveDir,
                locale.settings.defaultSaveDirDesc,
            ],
            [
                "restrict",
                locale.settings.restrictAt,
                locale.settings.restrictAtDesc,
            ],
            [
                "cache",
                locale.settings.clearImageCache,
                locale.settings.clearImageCacheDesc,
            ],
            [
                "sendRead",
                locale.settings.sendRead,
                locale.settings.sendReadDesc,
            ],
            [
                "headings",
                locale.settings.zhihuHeading,
                locale.settings.zhihuHeadingDesc,
            ],
            [
                "imageName",
                locale.settings.useImgNameDefault,
                locale.settings.useImgNameDefaultDesc,
            ],
            [
                "toc",
                locale.settings.setTocDefault,
                locale.settings.setTocDefaultDesc,
            ],
            [
                "openLink",
                locale.settings.autoOpenZhihuLink,
                locale.settings.autoOpenZhihuLinkDesc,
            ],
            [
                "offline",
                locale.settings.turnImgOffline,
                locale.settings.turnImgOfflineDesc,
            ],
            [
                "mermaid",
                locale.settings.mermaidScale,
                locale.settings.mermaidScaleDesc,
            ],
            [
                "popular",
                locale.settings.addPopularStr,
                locale.settings.addPopularStrDesc,
            ],
            [
                "manualCookies",
                locale.settings.editCookies,
                locale.settings.editCookiesDesc,
            ],
            ["cookies", "Cookies", locale.settings.editorDesc],
            [
                "typstMode",
                locale.settings.typstMode,
                locale.settings.typstModeDesc,
            ],
            [
                "typstPath",
                locale.settings.typstVersion,
                locale.settings.typstPathDesc,
            ],
            [
                "typstPPI",
                locale.settings.typstPicPPI,
                locale.settings.typstPicPPIDesc,
            ],
            [
                "typstDisplay",
                locale.settings.displayMathSetting,
                locale.settings.displayMathSettingDesc,
            ],
            [
                "typstRender",
                locale.settings.typstRenderSetting,
                locale.settings.typstRenderSettingDesc,
            ],
            [
                "typstEditor",
                locale.settings.typstPresetStyle,
                locale.settings.typstPresetStyleDesc,
            ],
        ];
        return entries.map(([id, name, desc]) => ({
            name,
            desc,
            render: (setting) => this.mountDeclarativeRow(id, setting),
        }));
    }

    private renderDeclarativeContent(
        id: string,
        setting: Setting,
        owner: ZhihuSettingTab,
        s: Awaited<ReturnType<typeof loadSettings>>,
        data: Awaited<ReturnType<typeof loadData>>,
    ): void {
        const get = (key: string) => this.declarativeSettings.get(key);
        switch (id) {
            case "account":
                AccountSetting(setting, this);
                break;
            case "userAgent":
                UserAgentSetting(setting, this, s.user_agent);
                break;
            case "folder":
                DefaultSaveFolderSetting(setting, this, s.defaultSaveFolder);
                break;
            case "restrict":
                RestrictToZhihuSetting(setting, this, s.restrictToZhihuFM);
                break;
            case "cache":
                ClearImgCacheSetting(setting, this);
                break;
            case "sendRead":
                SendReadToZhihuSetting(setting, this, s.sendReadToZhihu);
                break;
            case "headings":
                ZhihuHeadingsSettings(setting, this, s.useZhihuHeadings);
                break;
            case "imageName":
                UseImgNameDefaultSetting(setting, this, s.useImgNameDefault);
                break;
            case "toc":
                setTocDefaultSetting(setting, this, s.setTocDefault);
                break;
            case "openLink":
                AutoOpenZhihuLinkSetting(setting, this, s.autoOpenZhihuLink);
                break;
            case "offline":
                TurnImgOfflineSetting(setting, this, s.turnImgOffline);
                break;
            case "mermaid":
                MermaidScaleSetting(setting, this, s.mermaidScale);
                break;
            case "popular":
                AddPopularStrSetting(setting, this, s.popularize);
                break;
            case "manualCookies":
                ManualCookieToggle(this, setting, s.manualCookieEdit, () =>
                    get("cookies"),
                );
                break;
            case "cookies":
                CookiesEditorPanel(setting, s.manualCookieEdit);
                void createCookiesEditor
                    .call(owner, this, setting, data)
                    .catch(console.error);
                break;
            case "typstMode":
                TypstModeToggle(this, setting, s.typstMode, () =>
                    [
                        "typstPath",
                        "typstPPI",
                        "typstDisplay",
                        "typstRender",
                        "typstEditor",
                    ]
                        .map(get)
                        .filter((row): row is Setting => !!row),
                );
                break;
            case "typstPath":
                TypstPathSetting(this, setting, s.typstMode, s.typstCliPath);
                break;
            case "typstPPI":
                TypstPPISetting(this, setting, s.typstMode, s.typstImgPPI);
                break;
            case "typstDisplay":
                TypstDisplaySetting(
                    this,
                    setting,
                    s.typstMode,
                    s.typstDisplayToTeX,
                );
                break;
            case "typstRender":
                TypstRenderSetting(
                    this,
                    setting,
                    s.typstMode,
                    s.typstRenderLang,
                );
                break;
            case "typstEditor":
                TypstEditor(this, setting, s.typstMode);
                void createTypstEditor
                    .call(owner, this, setting, s.typstPresetStyle)
                    .catch(console.error);
                break;
        }
    }

    private mountDeclarativeRow(id: string, setting: Setting): () => void {
        this.visible = true;
        this.declarativeCleanups.get(id)?.();
        let active = true;
        let version = 0;
        // Editor factories use `this` for their instance, including reset callbacks.
        const owner = Object.create(this) as ZhihuSettingTab;
        const destroyEditor = () => {
            if (id === "cookies") {
                owner.cookiesEditor?.destroy();
                owner.cookiesEditor = undefined;
            } else if (id === "typstEditor") {
                owner.typstEditor?.destroy();
                owner.typstEditor = undefined;
            }
        };
        const render = () => {
            const current = ++version;
            destroyEditor();
            setting.clear();
            setting.settingEl.removeClass(
                "hidden",
                "cookies-setting-area",
                "typst-setting-area",
                "preset-style-area",
            );
            setting.nameEl.empty();
            setting.descEl.empty();
            void this.loadSnapshot()
                .then(({ status, settings: s, data }) => {
                    if (!active || current !== version) return;
                    this.isLoggedIn = status.isLoggedIn;
                    this.userInfo = status.userInfo;
                    this.renderDeclarativeContent(id, setting, owner, s, data);
                })
                .catch((error: unknown) =>
                    console.error("Failed to render Zhihu setting", error),
                );
        };
        this.declarativeSettings.set(id, setting);
        this.declarativeRows.set(id, render);
        render();
        const cleanup = () => {
            active = false;
            version++;
            destroyEditor();
            if (this.declarativeRows.get(id) === render) {
                this.declarativeRows.delete(id);
                this.declarativeSettings.delete(id);
                this.declarativeCleanups.delete(id);
            }
        };
        this.declarativeCleanups.set(id, cleanup);
        return cleanup;
    }

    refresh(): void {
        if (!this.visible) return;
        if (this.declarativeRows.size) {
            this.snapshot = undefined;
            for (const render of this.declarativeRows.values()) render();
        }
    }

    private destroyEditors() {
        this.cookiesEditor?.destroy();
        this.typstEditor?.destroy();
        this.cookiesEditor = undefined;
        this.typstEditor = undefined;
    }

    hide() {
        this.visible = false;
        this.snapshot = undefined;
        for (const cleanup of this.declarativeCleanups.values()) cleanup();
        this.destroyEditors();
    }

    userInfo: { avatar_url: string; name: string; headline?: string } | null =
        null;

    constructor(app: App, plugin: ZhihuObPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        this.refresh();
    }
}
