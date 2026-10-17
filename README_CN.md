<div align="center">
<picture>
<img alt="logo" src="./imgs/logo.svg" height="150">
</picture>
<h1>Zhihu on Obsidian</h1>

<p align="center">
<a href="https://github.com/zimya/zhihu_obsidian/actions">
<img src="https://img.shields.io/github/actions/workflow/status/zimya/zhihu_obsidian/ci.yml?&branch=master">
</a>
<a href="https://github.com/zimya/zhihu_obsidian/releases">
<img src="https://img.shields.io/github/v/release/zimya/zhihu_obsidian?&sort=semver">
</a>
<a href="https://github.com/zimya/zhihu_obsidian/releases">
<img src="https://img.shields.io/github/downloads/zimya/zhihu_obsidian/total">
</a>
<a href="https://github.com/zimya/zhihu_obsidian?tab=0BSD-1-ov-file#0BSD-1-ov-file">
<img src="https://img.shields.io/github/license/zimya/zhihu_obsidian">
</a>
<a href="https://t.me/zhihu_obsidian">
<img src="https://img.shields.io/badge/telegram-blue?logo=telegram&logoColor=white">
</a>
<a href="https://zhihu.melonhu.cn">
<img src="https://img.shields.io/badge/doc-cn-blue">
</a>
</p>

[EN README](./README.md) | [电报交流群](https://t.me/zhihu_obsidian) | [官网/文档](https://zhihu.melonhu.cn)

</div>

## 核心功能

Zhihu on Obsidian允许你在Obsidian内将markdown内容直接发布到知乎（中文问答平台）。该插件包含以下几点核心功能：

- 创建并发布知乎文章
- 创建并发布知乎回答
- 将知乎文章投稿至问题
- 浏览首页推荐、关注、热榜，并直接在Obsidian内查看。

## 使用方法

### 安装插件

在 Obsidian 的插件市场中搜索 `Zhihu`，选择第一个插件并安装即可。

### 登录知乎

登录知乎功能需要 Obsidian 核心插件：[网页浏览器](https://obsidian.md/help/plugins/web-viewer)，它是默认关闭的。你需要先在`设置`-`核心插件`中启用它，才能登录知乎。

运行 `Zhihu: Web login` 命令，可以看到弹出了一个知乎网页端登录页面。打开知乎app扫码登录，插件会自动获取所有需要的cookie和用户信息。(**插件永远不会上传您的用户信息**)

![image-20250503144240817](./imgs/zhihu-weblogin.jpg)

打开`设置->Zhihu Obsidian`, 如果看到你的头像和账号可以正常显示，说明登录成功。

![settings](./imgs/settings.jpg)

### 发布文章

登录后你就可以发布文章了。

打开命令面板，键入 `Zhihu: Create new article` ，插件就会自动创建一个知乎文章草稿，并创建一个markdown文件。

![new_draft](./imgs/new_draft.jpg)

创建的markdown文件有三个属性（frontmatter）

- 标题(`zhihu-title`): 默认为`untitled`, 你可以后续进行修改
- 话题(`zhihu-topics`): 默认为空，添加话题是**强制**的
- 链接(`zhihu-link`): 你的文章的URL

在写完文章准备发表的时候，运行命令 `Zhihu: Publish current article` 即可。插件会将markdown转换为知乎HTML。在真正看到知乎上的文章之前，你可能需要等上几秒（或几分钟）。

### 发布回答

打开命令面板，键入 `Zhihu: Create new answer` ，插件会要求你输入问题的链接。比如你想要回答问题：`https://www.zhihu.com/question/1900539734356390396`，直接将链接放在弹窗中，按回车，插件就会为你创建回答草稿。

![new_answer_draft](./imgs/new_answer_draft.jpg)

回答草稿中不需要填写任何属性，直接写完回答后运行命令 `Zhihu: Publish current answer`。然后回答链接就会出现在 `zhihu-link` 属性中。用同样的命令也可以更新回答。

但需要注意，你**不能在同一个问题下创建两次回答**（包括回答草稿）。如果你已经回答过了这个问题，你应该**手动编辑属性：添加 `zhihu-question`, `zhihu-link`**。再运行发布命令就可以成功更新回答了。

### 浏览

你也可以通过插件浏览知乎的推荐、关注和热榜。点击左侧知乎图标，就可以浏览推荐、关注和热榜了。点击回答或者文章会直接在Obsidian中打开，markdown文件会保存在`vault/zhihu/`下面。

![recommend](./imgs/recommend.jpg)

LaTeX公式也可以正常显示

![follow](./imgs/follow.jpg)

## 语法

### 艾特知乎用户

只要键入`@`即可，选择你想要艾特的知友，enter键选中。点击`@`链接会进入知友的知乎主页。

![at_members](./imgs/at_members.jpg)

链接的语法是 `[@name](https://www.zhihu.com/member_id "member_mention + hash")`

### 卡片链接

将链接变成卡片也非常简单。比如将GitHub官网变成带有GitHub标题的卡片，可以这么写

```
[Github](https://github.com/ "card")
```

效果

![github_card](./imgs/github_card.png)

### 图片

你只需要使用markdown语法插入图片，插件就会帮你完成剩下的工作。对于本地图片，请使用Obsidian推荐的语法：`![[image|caption]]`。而对于网络图片，请使用`![caption](https://img.link)`语法，插件会自动下载网络图片并上传到知乎。

注意，请**不要**使用`![caption](...)`语法上传本地图片，否则图片可能无法完成上传。

### 表格内的数学公式

含 `$...$`（或行内 `$$...$$`）公式的 Markdown 表格，在发布文章、回答或保存知乎草稿时会自动转换为 LaTeX `array` 行间公式，避免知乎原生表格无法显示内嵌公式的问题。Obsidian 中的笔记仍然保留原来的 Markdown 表格，无需手动改写。

```markdown
| 数据 | 反向用途 |
| --- | --- |
| 专家输入 $X_e$ | 计算 Gate/Up WGrad |
| 专家输出 $V_{t,e}$ | 计算 $dp=\langle dY,V\rangle$ |
```

不含公式的表格保持原样。转换保留列对齐、中文、加粗、斜体和行内代码；较长的文字会自动换行，也支持用 `<br>` 手动换行。公式本身不会被自动拆开，特别宽的公式仍需自行精简或换行。

若同一张公式表格中含有链接、图片、脚注、删除线或其他 HTML，则保留原生表格并提示，避免转换丢失这些内容或功能；其中公式仍可能无法在知乎显示。可将这些内容移到表格外，再重新发布。公式表格在知乎中作为整体公式编辑，不再是逐格编辑的原生表格。

大表格会按 URL 长度和行数拆成多个带重复表头的公式块。插件会请求知乎公式服务检查各块（同一次转换中重复请求只检查一次，每次最多等待 10 秒）；语法错误、请求失败或超时会保留整张原生表格并提示。单个表头或数据行过长、无法拆分时也会保留原生表格。详见[数学公式文档](./website/docs/语法/数学公式.md)和[测试覆盖说明](./test/README.md)。

`array` 变通方法参考[于连关于知乎表格内 LaTeX 的回答](https://www.zhihu.com/question/1914425114503680325/answer/1935357755381753435)。

### 文章封面

插件也可以让你一键上传你最爱的封面图片。只要在属性(property)中添加`zhihu-cover`条目，然后键入`[[img]]`选择图片。就像这样

![cover_example](./imgs/cover_example.jpg)

### 目录

在属性中添加 `zhihu-toc` 条目，确保它不为空，那么发布回答或文章时就会生成目录。

比如`zhihu-toc`可以是：`True` 或者 `1`。

如果你不添加 `zhihu-toc`, 那么就不会生成目录。

## 贡献

欢迎任何PR

你可以fork这个仓库到 `vault/.obsidian/plugins` 下面，并确保NodeJS版本至少 v16

- 运行`npm i` 或者 `yarn` 安装依赖
- `npm run dev` 开启编译监视模式
- `npm run build` 可以发布一个release版本

## TODO

- [x] 添加：mermaid 支持
- [ ] 添加：desmos-graph 支持
- [x] 添加：参考文献支持
- [ ] 添加：状态栏显示点赞数、收藏数
- [ ] 添加：评论查看
- [x] 添加：图片不来自本地或知乎图床也可发布
- [ ] 添加：文章发表到自己的专栏

## 支持我的开发

点个星星⭐来支持我！

<a href="https://github.com/zimya/zhihu_obsidian/stargazers">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=zimya/zhihu_obsidian&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=zimya/zhihu_obsidian&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=zimya/zhihu_obsidian&type=Date" />
 </picture>
</a>
