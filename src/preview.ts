import { App, MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import { publishCurrentArticle } from "./publish_service";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;

const WEBVIEWER_PLUGIN_ID = "webviewer";
const WEBVIEWER_VIEW_TYPE = "webviewer";
const ZHIHU_PREVIEW_LEAF_TAG = "__zhihuPreviewLeaf";

interface WebviewerPlugin {
    enabled?: boolean;
    instance?: {
        openUrl(url: string, newWindow: boolean, focus: boolean): void;
    };
}

function getWebviewerInstance(app: App) {
    const internalPlugins = (
        app as unknown as {
            internalPlugins?: {
                getPluginById?(id: string): WebviewerPlugin | undefined;
            };
        }
    ).internalPlugins;
    const plugin = internalPlugins?.getPluginById?.(WEBVIEWER_PLUGIN_ID);
    if (!plugin?.enabled || !plugin?.instance) {
        return null;
    }
    return plugin.instance;
}

// 知乎文章的“电脑预览”
export async function zhihuDesktopPreview(app: App) {
    const markdownLeaf = app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
    const id = await publishCurrentArticle(app, true); // 先把当前内容放在草稿中
    if (id === undefined) return;
    await createPreview(app, id, markdownLeaf);
}

async function createPreview(
    app: App,
    articleId: string,
    sourceLeaf?: WorkspaceLeaf,
) {
    // 加入 timestamp 是为了确保每次 preview 都会刷新
    const previewURL = `https://zhuanlan.zhihu.com/p/${articleId}/preview?comment=0&catalog=0&_ts=${Date.now()}`;
    const webviewer = getWebviewerInstance(app);
    if (!webviewer) {
        new Notice(locale.notice.enableWebviewerFirst);
        return;
    }

    const markdownLeaf =
        sourceLeaf ??
        app.workspace.getActiveViewOfType(MarkdownView)?.leaf ??
        app.workspace.getMostRecentLeaf();
    if (!markdownLeaf) {
        new Notice("No active markdown leaf found");
        return;
    }

    const webviewerLeaf = getOrCreatePreviewLeaf(app, markdownLeaf);
    app.workspace.setActiveLeaf(webviewerLeaf, { focus: false });

    await webviewerLeaf.setViewState({
        type: WEBVIEWER_VIEW_TYPE,
        active: true,
    });

    Reflect.set(webviewerLeaf, ZHIHU_PREVIEW_LEAF_TAG, true);
    webviewer.openUrl(previewURL, false, true);
    app.workspace.revealLeaf(webviewerLeaf);
}

function getOrCreatePreviewLeaf(
    app: App,
    markdownLeaf: WorkspaceLeaf,
): WorkspaceLeaf {
    const webviewerLeaves = app.workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE);

    const taggedLeaf = webviewerLeaves.find((leaf) =>
        Boolean(Reflect.get(leaf, ZHIHU_PREVIEW_LEAF_TAG)),
    );
    if (taggedLeaf) {
        return taggedLeaf;
    }

    if (webviewerLeaves.length > 0) {
        return webviewerLeaves[webviewerLeaves.length - 1];
    }

    app.workspace.setActiveLeaf(markdownLeaf, { focus: false });
    return app.workspace.getLeaf("split", "vertical");
}
