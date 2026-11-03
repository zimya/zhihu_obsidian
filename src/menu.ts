import { Plugin, Editor, Menu, Notice, TFile, TFolder } from "obsidian";
import * as publish from "./publish_service";
import * as answer from "./answer_service";
import * as login from "./login_service";

import i18n, { type Lang } from "../locales";
const locale: Lang = i18n.current;

export function registerMenuCommands(plugin: Plugin) {
    const loginNoticeStr = locale.notice.notLogin;
    // 监听右键菜单事件
    plugin.registerEvent(
        plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
            menu.addItem((item) => {
                item.setTitle(locale.ui.publishCurrentAnswer).onClick(
                    async () => {
                        if (await login.checkIsUserLogin(this.app.vault)) {
                            await answer.publishCurrentAnswer(this.app);
                        } else {
                            new Notice(loginNoticeStr);
                        }
                    },
                );
            });
            menu.addItem((item) => {
                item.setTitle(locale.ui.publishCurrentArticle).onClick(
                    async () => {
                        if (await login.checkIsUserLogin(this.app.vault)) {
                            await publish.publishCurrentArticle(this.app);
                        } else {
                            new Notice(loginNoticeStr);
                        }
                    },
                );
            });
        }),
    );
    plugin.registerEvent(
        plugin.app.workspace.on(
            "file-menu",
            (menu: Menu, file: TFile | TFolder) => {
                menu.addItem((item) => {
                    item.setTitle(locale.ui.publishCurrentAnswer).onClick(
                        async () => {
                            if (await login.checkIsUserLogin(this.app.vault)) {
                                await answer.publishCurrentAnswer(this.app);
                            } else {
                                new Notice(loginNoticeStr);
                            }
                        },
                    );
                });
                menu.addItem((item) => {
                    item.setTitle(locale.ui.publishCurrentArticle).onClick(
                        async () => {
                            if (await login.checkIsUserLogin(this.app.vault)) {
                                await publish.publishCurrentArticle(this.app);
                            } else {
                                new Notice(loginNoticeStr);
                            }
                        },
                    );
                });
            },
        ),
    );
}
