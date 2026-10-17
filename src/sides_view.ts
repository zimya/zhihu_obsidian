import { App, Vault, Notice, View, WorkspaceLeaf, setIcon } from "obsidian";
import {
    Recommendation,
    loadRecommendations,
    getRecommend,
} from "./recommend_service";
import { Follow, loadFollows, getFollows } from "./follow_service";
import { HotList, loadHotList } from "./hot_lists_service";
import { touchToRead } from "./read_service";
import { loadSettings } from "./settings";
import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;
export const SIDES_VIEW_TYPE = "zhihu-sides-view";
import { ZhihuOpener, asZhihuType, ZhihuOpenRequest } from "./open_service";

export async function activateSideView(app: App) {
    const { workspace } = app;
    const existingLeaf = workspace.getLeavesOfType(SIDES_VIEW_TYPE)[0];
    if (existingLeaf) {
        await workspace.revealLeaf(existingLeaf);
        return;
    }
    let leaf: WorkspaceLeaf | null = workspace.getLeftLeaf(false);

    if (!leaf) {
        leaf = workspace.getLeaf(true);
    }

    if (leaf) {
        await leaf.setViewState({
            type: SIDES_VIEW_TYPE,
            active: true,
        });
        await workspace.revealLeaf(leaf);
    } else {
        new Notice(`${locale.notice.openZhihuSideFailed}`);
        console.error(locale.error.noLeafAvailable);
    }
}

export class ZhihuSideView extends View {
    private recommendations: Recommendation[] = [];
    private follows: Follow[] = [];
    private hotLists: HotList[] = [];
    private recommendUrl = `https://www.zhihu.com/api/v3/feed/topstory/recommend?action=down&ad_interval=-10&desktop=true&page_number=7`;
    private followUrl = `https://www.zhihu.com/api/v3/moments?limit=10&desktop=true`;
    private nextRecommendUrl = "";
    private nextFollowUrl = "";
    private prevRecommendUrl = "";
    private prevFollowUrl = "";
    constructor(
        leaf: WorkspaceLeaf,
        private vault: Vault,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return SIDES_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Zhihu slides";
    }

    getIcon(): string {
        return "zhihu-icon";
    }

    async onOpen() {
        await this.render();
    }

    async render() {
        const container = this.containerEl;
        container.empty();
        container.addClass("zhihu-sides-view");

        // recommends
        const recom_details = container.createEl("details");
        recom_details.addClass("side-collapsible");
        const recom_summary = recom_details.createEl("summary", {
            text: locale.ui.recommendations,
        });
        recom_summary.addClass("side-summary");
        const recom_icon_container = recom_summary.createDiv();
        recom_icon_container.addClass("side-icons");
        const recom_prev_icon = recom_icon_container.createEl("span");
        recom_prev_icon.addClass("side-icon");
        recom_prev_icon.setAttr("aria-label", locale.ui.previousPage);
        setIcon(recom_prev_icon, "arrow-left");
        recom_prev_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() =>
                this.refreshRecommendations(this.prevRecommendUrl),
            );
        });
        const recom_refresh_icon = recom_icon_container.createEl("span");
        recom_refresh_icon.addClass("side-icon");
        recom_refresh_icon.setAttr("aria-label", locale.ui.refreshRecommend);
        setIcon(recom_refresh_icon, "refresh-cw");
        recom_refresh_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() =>
                this.refreshRecommendations(this.recommendUrl),
            );
        });
        const recom_next_icon = recom_icon_container.createEl("span");
        recom_next_icon.addClass("side-icon");
        recom_next_icon.setAttr("aria-label", locale.ui.nextPage);
        setIcon(recom_next_icon, "arrow-right");
        recom_next_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() =>
                this.refreshRecommendations(this.nextRecommendUrl),
            );
        });

        const recom_list_container = recom_details.createEl("div");
        recom_list_container.addClass("side-list-container");

        const recom_list = recom_list_container.createEl("ul");
        await this.refreshRecommendations(this.recommendUrl, recom_list); // 初始加载推荐

        // follows
        const follow_details = container.createEl("details");
        follow_details.addClass("side-collapsible");
        const follow_summary = follow_details.createEl("summary", {
            text: locale.ui.follows,
        });
        follow_summary.addClass("side-summary");

        const follow_icon_container = follow_summary.createDiv();
        follow_icon_container.addClass("side-icons");
        const follow_prev_icon = follow_icon_container.createEl("span");
        follow_prev_icon.addClass("side-icon");
        follow_prev_icon.setAttr("aria-label", locale.ui.previousPage);
        setIcon(follow_prev_icon, "arrow-left");
        follow_prev_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() => this.refreshFollows(this.prevFollowUrl));
        });
        const follow_refresh_icon = follow_icon_container.createEl("span");
        follow_refresh_icon.addClass("side-icon");
        follow_refresh_icon.setAttr("aria-label", locale.ui.refreshFollows);
        setIcon(follow_refresh_icon, "refresh-cw");
        follow_refresh_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() => this.refreshFollows(this.followUrl));
        });
        const follow_next_icon = follow_icon_container.createEl("span");
        follow_next_icon.addClass("side-icon");
        follow_next_icon.setAttr("aria-label", locale.ui.nextPage);
        setIcon(follow_next_icon, "arrow-right");
        follow_next_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() => this.refreshFollows(this.nextFollowUrl));
        });

        const follow_list_container = follow_details.createEl("div");
        follow_list_container.addClass("side-list-container");

        const follow_list = follow_list_container.createEl("ul");
        await this.refreshFollows(this.followUrl, follow_list); // 初始加载关注

        // hot lists
        const hotlist_details = container.createEl("details");
        hotlist_details.addClass("side-collapsible");
        const hotlist_summary = hotlist_details.createEl("summary", {
            text: locale.ui.hotlists,
        });
        hotlist_summary.addClass("side-summary");

        const hotlist_refresh_icon = hotlist_summary.createEl("span");
        hotlist_refresh_icon.addClass("side-icon");
        hotlist_refresh_icon.setAttr("aria-label", locale.ui.refreshHotlists);
        setIcon(hotlist_refresh_icon, "refresh-cw");
        hotlist_refresh_icon.onClickEvent((e) => {
            e.preventDefault();
            this.handleAction(() => this.refreshHotLists());
        });

        const hotlist_container = hotlist_details.createEl("div");
        hotlist_container.addClass("side-list-container");

        const hotlist = hotlist_container.createEl("ul");
        await this.refreshHotLists(hotlist); // 初始加载热榜
    }

    private async refreshRecommendations(
        url: string,
        recom_list?: HTMLElement,
    ) {
        const list =
            recom_list ||
            (this.containerEl.querySelector(
                ".zhihu-sides-view .side-list-container ul",
            ) as HTMLElement);
        const settings = await loadSettings(this.vault);
        list.empty();
        const response = await getRecommend(this.vault, url);
        this.recommendations = loadRecommendations(response);
        this.nextRecommendUrl = response.paging.next;
        this.prevRecommendUrl = response.paging.previous;
        new Notice(response.fresh_text);
        this.recommendations.forEach((recommendation) => {
            const item = list.createEl("li");
            item.addClass("side-item");
            item.setAttr(
                "aria-label",
                `${recommendation.title}\n${recommendation.author_name}`,
            );
            item.setAttr("data-tooltip-position", "right");
            const title = item.createEl("h4", { text: recommendation.title });
            title.addClass("side-title");

            const excerpt = item.createEl("p");
            excerpt.addClass("side-excerpt");
            excerpt.createEl("b", {
                text: recommendation.author_name,
            });
            excerpt.appendText(": " + recommendation.excerpt);

            item.onClickEvent(() => {
                this.handleAction(async () => {
                    if (settings.sendReadToZhihu !== false) {
                        await touchToRead(
                            this.vault,
                            recommendation.type,
                            recommendation.id,
                        );
                    }
                    const opener = new ZhihuOpener(this.app);
                    const zhType = asZhihuType(recommendation.type);
                    if (!zhType) return;
                    const req: ZhihuOpenRequest = {
                        url: recommendation.url,
                        type: zhType,
                        destFolder: settings.defaultSaveFolder,
                        offlineImages: settings.turnImgOffline,
                        overwrite: true,
                    };
                    await opener.open(req);
                });
            });
        });
    }

    private async refreshFollows(url: string, follow_list?: HTMLElement) {
        const list =
            follow_list ||
            (this.containerEl.querySelectorAll(
                ".zhihu-sides-view .side-list-container ul",
            )[1] as HTMLElement);
        const settings = await loadSettings(this.vault);
        list.empty();
        const response = await getFollows(this.vault, url);
        this.follows = loadFollows(response);
        this.nextFollowUrl = response.paging.next;
        this.prevFollowUrl = response.paging.previous;
        new Notice(response.fresh_test); // 逆天，知乎把text打成了test
        this.follows.forEach((follow) => {
            const item = list.createEl("li");
            item.addClass("side-item");
            item.setAttr(
                "aria-label",
                `${follow.title}\n${follow.action_text}`,
            );
            item.setAttr("data-tooltip-position", "right");
            const title = item.createEl("h4", { text: follow.title });
            title.addClass("side-title");

            const excerpt = item.createEl("p");
            excerpt.addClass("side-excerpt");
            excerpt.createEl("b", {
                text: follow.action_text,
            });
            excerpt.appendText(": " + follow.excerpt);

            item.onClickEvent(() => {
                this.handleAction(async () => {
                    if (settings.sendReadToZhihu !== false) {
                        await touchToRead(this.vault, follow.type, follow.id);
                    }
                    const opener = new ZhihuOpener(this.app);
                    const zhType = asZhihuType(follow.type);
                    if (!zhType) return;
                    const req: ZhihuOpenRequest = {
                        url: follow.url,
                        type: zhType,
                        destFolder: settings.defaultSaveFolder,
                        offlineImages: settings.turnImgOffline,
                        overwrite: true,
                    };
                    await opener.open(req);
                });
            });
        });
    }

    private handleAction(action: () => Promise<void>): void {
        void action().catch((error: unknown) => {
            new Notice(
                error instanceof Error
                    ? error.message
                    : locale.error.unknownError,
            );
        });
    }

    private async refreshHotLists(hotlist?: HTMLElement) {
        const list =
            hotlist ||
            (this.containerEl.querySelectorAll(
                ".zhihu-sides-view .side-list-container ul",
            )[2] as HTMLElement);
        const settings = await loadSettings(this.vault);
        list.empty();
        this.hotLists = await loadHotList(this.vault);
        this.hotLists.forEach((hot) => {
            const item = list.createEl("li");
            item.addClass("side-item");
            item.setAttr("aria-label", `${hot.title}\n${hot.detail_text}`);
            item.setAttr("data-tooltip-position", "right");
            const title = item.createEl("h4", { text: hot.title });
            title.addClass("side-title");

            const excerpt = item.createEl("p");
            excerpt.addClass("side-excerpt");
            excerpt.createEl("b", {
                text: `🔥${hot.detail_text}🔥`,
            });
            excerpt.appendText(": " + hot.excerpt);
            item.onClickEvent(() => {
                this.handleAction(async () => {
                    const opener = new ZhihuOpener(this.app);
                    const zhType = asZhihuType(hot.type);
                    if (!zhType) return;
                    const req: ZhihuOpenRequest = {
                        url: hot.link,
                        type: zhType,
                        destFolder: settings.defaultSaveFolder,
                        offlineImages: settings.turnImgOffline,
                        overwrite: true,
                    };
                    await opener.open(req);
                });
            });
        });
    }
}
