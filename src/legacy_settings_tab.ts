import { App, PluginSettingTab } from "obsidian";
import type ZhihuObPlugin from "./main";
import { EditorView } from "@codemirror/view";
import { loadSettings } from "./settings";
import { loadData } from "./data";
import { createCookiesEditor } from "./cookies_editor/editor";
import { createTypstEditor } from "./typst";
import {
    fetchUserStatus,
    AccountSetting,
    UserAgentSetting,
    DefaultSaveFolderSetting,
    RestrictToZhihuSetting,
    ClearImgCacheSetting,
    SendReadToZhihuSetting,
    ZhihuHeadingsSettings,
    UseImgNameDefaultSetting,
    setTocDefaultSetting,
    AutoOpenZhihuLinkSetting,
    TurnImgOfflineSetting,
    MermaidScaleSetting,
    AddPopularStrSetting,
    ManualCookieToggle,
    CookiesEditorPanel,
    TypstModeToggle,
    TypstPathSetting,
    TypstDisplaySetting,
    TypstPPISetting,
    TypstRenderSetting,
    TypstEditor,
} from "./settings_tab";

export class LegacyZhihuSettingTab extends PluginSettingTab {
    isLoggedIn = false;
    userInfo: { avatar_url: string; name: string; headline?: string } | null = null;
    cookiesEditor: EditorView | undefined;
    typstEditor: EditorView | undefined;
    private renderGeneration = 0;
    private visible = false;

    constructor(app: App, public plugin: ZhihuObPlugin) {
        super(app, plugin);
    }

    private destroyEditors(): void {
        this.cookiesEditor?.destroy();
        this.typstEditor?.destroy();
        this.cookiesEditor = undefined;
        this.typstEditor = undefined;
    }

    refresh(): void {
        if (this.visible) this.display();
    }

    hide(): void {
        this.visible = false;
        this.renderGeneration++;
        this.destroyEditors();
    }

    display(): void {
        this.visible = true;
        const generation = ++this.renderGeneration;
        this.destroyEditors();
        this.containerEl.empty();
        void this.renderLegacy(generation).catch((error: unknown) => {
            console.error("Failed to render Zhihu settings", error);
        });
    }

    private async renderLegacy(generation: number): Promise<void> {
        const { containerEl } = this;
        const { isLoggedIn, userInfo } = await fetchUserStatus(this.app.vault);
        if (generation !== this.renderGeneration) return;
        this.isLoggedIn = isLoggedIn;
        this.userInfo = userInfo;
        const sts = await loadSettings(this.app.vault); // 用户的设置数据（settings -> sts）
        const data = await loadData(this.app.vault); // 用户的所有数据（包括cookies）
        if (generation !== this.renderGeneration) return;
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
        // 是否给新创建的文章或回答默认带上目录
        setTocDefaultSetting(containerEl, this, sts.setTocDefault);
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
        await createCookiesEditor.call(this, this, cookiesEditor, data);
        if (generation !== this.renderGeneration) return;
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
        await createTypstEditor.call(
            this,
            this,
            typstEditor,
            sts.typstPresetStyle,
        );
    }
}
