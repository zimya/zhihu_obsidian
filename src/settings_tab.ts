import {
    App,
    PluginSettingTab,
    Setting,
    Notice,
    ButtonComponent,
    Modal,
    MarkdownRenderer,
    Component,
    Vault,
    ToggleComponent,
} from "obsidian";
import ZhihuObPlugin from "./main";
import { loadSettings, saveSettings } from "./settings";
import * as login from "./login_service";
import { loadData, deleteData } from "./data";
import i18n, { type Lang } from "../locales";
import { EditorView } from "@codemirror/view";
import { createCookiesEditor } from "./cookies_editor/editor";
import { createTypstEditor, getTypstVersion } from "./typst";
import { FolderSuggestModal } from "./utilities";

const locale: Lang = i18n.current;

async function fetchUserStatus(vault: Vault) {
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

function AccountSetting(containerEl: HTMLElement, tab: ZhihuSettingTab) {
    function renderUserInfo(setting: Setting, userInfo: any) {
        const container = setting.nameEl.createDiv({ cls: "zhihu-user-info" });
        container.createEl("img", {
            cls: "zhihu-avatar",
            attr: { src: userInfo.avatar_url, width: "40", height: "40" },
        });

        const text = container.createDiv({ cls: "zhihu-text-container" });
        text.createEl("div", { text: userInfo.name, cls: "zhihu-username" });
        if (userInfo.headline) {
            text.createEl("div", {
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
        tab.display();
    }

    async function handleLogout() {
        await deleteData(tab.app.vault, "userInfo");
        tab.isLoggedIn = false;
        tab.userInfo = null;
        tab.display();
    }

    async function handleRefresh() {
        await login.zhihuRefreshZseCookies(tab.app);
    }

    async function handleNewLogin() {
        await login.zhihuWebLogin(tab.app, true);
        const { isLoggedIn, userInfo } = await fetchUserStatus(tab.app.vault);
        tab.isLoggedIn = isLoggedIn;
        tab.userInfo = userInfo;
        tab.display();
    }

    new Setting(containerEl)
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
                        .setButtonText(locale.settings.newLoginButtonText)
                        .onClick(() => handleNewLogin()),
                );
            }
        });
}

function UserAgentSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    userAgent: string,
) {
    new Setting(containerEl)
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

function DefaultSaveFolderSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    folder: string,
) {
    const setting = new Setting(containerEl)
        .setName(locale.settings.defaultSaveDir)
        .setDesc(locale.settings.defaultSaveDirDesc);
    setting.nameEl.createEl("code", { text: ` ${folder}` });
    setting.addButton((btn) =>
        btn.setButtonText(locale.ui.choose).onClick(() => {
            new FolderSuggestModal(tab.app, async (selectedFolder) => {
                try {
                    await saveSettings(tab.app.vault, {
                        defaultSaveFolder: selectedFolder.path,
                    });
                    tab.display();
                } catch (e) {
                    console.error("Failed to set default folder", e);
                }
            }).open();
        }),
    );
}

function RestrictToZhihuSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    restrict: boolean,
) {
    // Restrict @知友 to notes with zhihu tag
    new Setting(containerEl)
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

function ClearImgCacheSetting(containerEl: HTMLElement, tab: ZhihuSettingTab) {
    // Clear Image Cahce in `data.cache`
    new Setting(containerEl)
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

function SendReadToZhihuSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    sendReadToZhihu: boolean,
) {
    // If send read to Zhihu
    new Setting(containerEl)
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

function ZhihuHeadingsSettings(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    useZhihuHeading: boolean,
) {
    // Setting to enable Zhihu level headings
    new Setting(containerEl)
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

function UseImgNameDefaultSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    useImgNameDefault: boolean,
) {
    // setting to control if set default img name as img base name
    // if img caption is not provided
    new Setting(containerEl)
        .setName(locale.settings.useImgNameDefault)
        .setDesc(locale.settings.useImgNameDefaultDesc)
        .addToggle((toggle) =>
            toggle.setValue(useImgNameDefault).onChange(async (value) => {
                try {
                    await saveSettings(this.app.vault, {
                        useImgNameDefault: value,
                    });
                } catch (e) {
                    console.error(locale.error.saveUseImgNameFailed, e);
                }
            }),
        );
}

function AutoOpenZhihuLinkSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    autoOpenZhihuLink: boolean,
) {
    // auto open zhihulink
    new Setting(containerEl)
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

function TurnImgOfflineSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    turnImgOffline: boolean,
) {
    // auto open zhihulink
    new Setting(containerEl)
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

function MermaidScaleSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
    scale: number,
) {
    // mermaid scale option
    new Setting(containerEl)
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
                    await saveSettings(this.app.vault, {
                        mermaidScale: parseInt(value),
                    });
                });
        });
}

function AddPopularStrSetting(
    containerEl: HTMLElement,
    tab: ZhihuSettingTab,
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
    new Setting(containerEl)
        .setName(locale.settings.addPopularStr)
        .setDesc(locale.settings.addPopularStrDesc)
        .addToggle((toggle) =>
            toggle
                .setValue(popularize)
                .onChange(async (value) => handleToggle(value, toggle)),
        );
}

function ManualCookieToggle(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    manualCookieEdit: boolean,
    getSettingEl: () => Setting,
) {
    async function handleToggle(value: boolean) {
        try {
            await saveSettings(tab.app.vault, {
                manualCookieEdit: value,
            });
            const settingEl = getSettingEl();
            settingEl.settingEl.toggleClass("cookies-setting-area", value);
            settingEl.settingEl.toggleClass("hidden", !value);
        } catch (e) {
            console.error("save settings failed:", e);
        }
    }

    new Setting(containerEl)
        .setName(locale.settings.editCookies)
        .setDesc(locale.settings.editCookiesDesc)
        .addToggle((toggle) =>
            toggle.setValue(manualCookieEdit).onChange(async (value) => {
                handleToggle(value);
            }),
        );
}

function CookiesEditorPanel(
    containerEl: HTMLElement,
    manualCookieEdit: boolean,
): Setting {
    return new Setting(containerEl)
        .setName("Cookies")
        .setDesc(locale.settings.editorDesc)
        .setClass(manualCookieEdit ? "cookies-setting-area" : "hidden");
}

function TypstModeToggle(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    typstMode: boolean,
    getSettings: () => Setting[],
) {
    new Setting(containerEl)
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

function TypstPathSetting(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    typstMode: boolean,
    typstCliPath: string,
): Setting {
    // Typst path setting
    let versionName = getTypstVersion(typstCliPath);
    if (!versionName && typstMode) {
        new Notice(locale.notice.typstNotFound);
        versionName = locale.ui.notFound;
    }
    const typstPathSetting = new Setting(containerEl)
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

function TypstDisplaySetting(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    typstMode: boolean,
    typstDisplayToTeX: boolean,
): Setting {
    // 对于行间公式的处理：是否转成LaTeX
    return new Setting(containerEl)
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

function TypstPPISetting(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    typstMode: boolean,
    typstImgPPI: number,
): Setting {
    // Typst PPI setting
    return new Setting(containerEl)
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

function TypstRenderSetting(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    typstMode: boolean,
    typstRenderLang: string,
): Setting {
    // Typst code identifier
    return new Setting(containerEl)
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

function TypstEditor(
    tab: ZhihuSettingTab,
    containerEl: HTMLElement,
    typstMode: boolean,
): Setting {
    // typst 内容编辑器
    return new Setting(containerEl)
        .setName(locale.settings.typstPresetStyle)
        .setDesc(locale.settings.typstPresetStyleDesc)
        .setClass(typstMode ? "typst-setting-area" : "hidden")
        .setClass("preset-style-area");
}

export class ZhihuSettingTab extends PluginSettingTab {
    plugin: ZhihuObPlugin;
    isLoggedIn = false;
    cookiesEditor: EditorView;
    typstEditor: EditorView;

    hide() {
        this.cookiesEditor?.destroy();
        this.typstEditor?.destroy();
    }

    userInfo: { avatar_url: string; name: string; headline?: string } | null =
        null;

    constructor(app: App, plugin: ZhihuObPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        const { isLoggedIn, userInfo } = await fetchUserStatus(this.app.vault);
        this.isLoggedIn = isLoggedIn;
        this.userInfo = userInfo;
        const sts = await loadSettings(this.app.vault); // 用户的设置数据（settings -> sts）
        const data = await loadData(this.app.vault); // 用户的所有数据（包括cookies）
        // 账户设置：显示用户头像、用户名和签名，并且在最右边有登录登出按钮
        AccountSetting(containerEl, this);
        // User Agent设置
        UserAgentSetting(containerEl, this, sts.user_agent);
        // 默认知乎文章或图片保存位置
        DefaultSaveFolderSetting(containerEl, this, sts.defaultSaveFolder);
        // 艾特知友功能是否限制在仅在知乎笔记中出发
        RestrictToZhihuSetting(containerEl, this, sts.restrictToZhihuFM);
        // 清除图片缓存设置
        ClearImgCacheSetting(containerEl, this);
        // 是否向知乎发送浏览记录
        SendReadToZhihuSetting(containerEl, this, sts.sendReadToZhihu);
        // 是否使用知乎特色的标题
        ZhihuHeadingsSettings(containerEl, this, sts.useZhihuHeadings);
        // 是否使用图片名称作为图片备注
        UseImgNameDefaultSetting(containerEl, this, sts.useImgNameDefault);
        // 自动在 Obsidian 打开知乎链接
        AutoOpenZhihuLinkSetting(containerEl, this, sts.autoOpenZhihuLink);
        // 打开知乎链接时是否离线加载图片
        TurnImgOfflineSetting(containerEl, this, sts.turnImgOffline);
        // mermaid 图片的清晰程度
        MermaidScaleSetting(containerEl, this, sts.mermaidScale);
        // 是否添加推广语句
        AddPopularStrSetting(containerEl, this, sts.popularize);
        // 手动编辑 cookie 的按钮
        ManualCookieToggle(
            this,
            containerEl,
            sts.manualCookieEdit,
            () => cookiesEditor,
        );
        // cookie 编辑器
        const cookiesEditor = CookiesEditorPanel(
            containerEl,
            sts.manualCookieEdit,
        );
        createCookiesEditor(this, cookiesEditor, data);
        // 打开或关闭 Typst 模式的按钮
        TypstModeToggle(this, containerEl, sts.typstMode, () => [
            typstPPISetting,
            typstEditor,
            typstDisplaySetting,
            typstPathSetting,
            typstRenderSetting,
        ]);
        // Typst 的路径设置
        const typstPathSetting = TypstPathSetting(
            this,
            containerEl,
            sts.typstMode,
            sts.typstCliPath,
        );
        // Typst 图片导出的分辨率设置
        const typstPPISetting = TypstPPISetting(
            this,
            containerEl,
            sts.typstMode,
            sts.typstImgPPI,
        );
        // Typst 的行间公式如何处理：转成LaTeX或转成图片
        const typstDisplaySetting = TypstDisplaySetting(
            this,
            containerEl,
            sts.typstMode,
            sts.typstDisplayToTeX,
        );
        // Typst 的代码块的语言：默认为 `Typrender`
        const typstRenderSetting = TypstRenderSetting(
            this,
            containerEl,
            sts.typstMode,
            sts.typstRenderLang,
        );
        // Typst 的公式样式设置，包含一个 Typst 编辑器
        const typstEditor = TypstEditor(this, containerEl, sts.typstMode);
        createTypstEditor(this, typstEditor, sts.typstPresetStyle);
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
        const component = new (class extends Component {})();

        MarkdownRenderer.render(
            this.app,
            bodyMarkdown,
            contentDiv,
            "", // sourcePath 通常留空
            component, // 将 modal 实例自身作为 Component 传入
        );

        new Setting(this.contentEl)
            .addButton((button) => {
                buttonCallback(button);
                button.onClick(async () => {
                    await clickCallback();
                    this.close();
                });
            })
            .addButton((button) =>
                button
                    .setButtonText(locale.ui.cancel)
                    .onClick(() => this.close()),
            );
    }
}
