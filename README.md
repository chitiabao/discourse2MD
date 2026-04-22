# Discourse2MD

[中文](./README.md) | [English](./README.en.md)

## 项目简介

Discourse2MD 是一个运行在 Discourse 主题页上的 userscript，用来把帖子内容导出为 Markdown，或直接写入 Obsidian。

仓库当前维护两个语言版本脚本：

- `discourse2MD-cn.js`
- `discourse2MD-en.js`

这两个脚本是同一个工具的中英文版本，共用同一套 userscript 身份与配置。安装时请选择其中一个，不要同时安装两份。

项目以单文件 userscript 形式维护，没有构建步骤，也不依赖 npm。导入脚本后即可使用。

## 功能特性

### 1. 泛 Discourse 主题页适配

- 面向标准 Discourse 主题页，不绑定单一社区品牌。
- 当前匹配规则覆盖 `https://*/t/*` 与 `https://*/t/topic/*`。
- 适合把论坛讨论沉淀为 Markdown 笔记或 Obsidian 知识库。

### 2. 两种导出模板

- `forum`
  - 导出 YAML frontmatter。
  - 导出帖子摘要信息。
  - 按楼层生成内容，并用 Callout 保留发言顺序、作者和回复关系。
  - 支持配合规则筛选和 AI 过滤，只导出需要的回复。

- `clean`
  - 导出 YAML frontmatter。
  - 导出帖子摘要信息。
  - 仅保留首帖正文，不导出后续回复。
  - 适合把主题首帖整理成简洁笔记。

### 3. 规则筛选与 AI 过滤

除首帖固定保留外，脚本支持对回复楼层做规则筛选：

- 楼层范围：全部或指定范围
- 只看楼主
- 图片筛选：仅含图 / 仅无图 / 不筛选
- 指定用户
- 包含关键词
- 排除关键词
- 最少字数

此外还支持 AI 过滤无效回复：

- AI 只处理规则筛选之后的非首帖楼层。
- 目标是剔除纯感谢、纯附和、元评论、转载授权询问等低信息量回复。
- 接口要求为 OpenAI-compatible `chat/completions`。
- 需要配置：
  - `API URL`
  - `API Key`
  - `Model ID`

### 4. Obsidian 导出

- 支持通过 Obsidian Local REST API 直接写入笔记。
- 支持图片三种模式：
  - `file`：保存到库内并用 `![[...]]` 引用
  - `base64`：内嵌到 Markdown
  - `none`：只导出文字
- 支持根目录、分类、图片目录配置。
- 会扫描同一 `topic_id` 是否已经导出，避免重复覆盖时无提示。

## 安装

1. 安装 userscript 管理器，推荐 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 从仓库中二选一导入脚本：
   - 中文版：`discourse2MD-cn.js`
   - 英文版：`discourse2MD-en.js`
3. 保存并启用脚本。
4. 打开任意 Discourse 主题页，等待页面加载完成后使用导出面板。

## Markdown 导出

### 使用步骤

1. 打开目标 Discourse 主题页。
2. 在脚本面板中选择导出模板。
3. 按需设置规则筛选或 AI 过滤。
4. 点击 `导出 Markdown`。

### 导出结果

- 文件名格式为 `<标题>-<topicId>.md`。
- 笔记包含 frontmatter、帖子摘要和正文内容。
- 浏览器下载的 Markdown 默认会内嵌 Base64 图片，因此不依赖 Obsidian 也能得到单文件版本。

## Obsidian 导出

### 依赖

Obsidian 导出依赖 Obsidian 桌面端和 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 插件。

1. 安装并打开 [Obsidian](https://obsidian.md/) 桌面端。
2. 进入 `Settings -> Community plugins`。
3. 关闭安全模式后，搜索并安装 `Local REST API`。
4. 启用插件并在设置页获取 API Key。

补充说明：

- 默认 API 地址为 `https://127.0.0.1:27124`。
- 如果本地 HTTPS 证书未被信任，脚本会自动尝试回退到本机 HTTP。
- 如果你只需要浏览器下载 Markdown，可以不安装 Obsidian 和该插件。

### 配置项

在脚本面板的 `Obsidian 连接设置` 中完成配置。

#### 连接信息

- `API 地址`
  - 默认值为 `https://127.0.0.1:27124`。
- `API Key`
  - 从 Obsidian 的 Local REST API 插件设置中复制。
- `测试连接`
  - 用于验证 API 地址和 API Key 是否可用。

#### 导出位置

- `根目录` 与 `分类` 共同决定笔记保存位置：

```text
<根目录>/<分类>/<标题-topicId>.md
```

- 脚本会扫描所选根目录下已有 Markdown 的 `topic_id`。
- 如果发现同主题：
  - 当前分类下已有同主题时，会提示是否覆盖。
  - 其他分类下已有同主题时，会提示是否继续导出。

#### 图片导出

图片模式为 `file` 时：

- `图片目录` 配置会生效。
- 图片会保存到图片目录下，并按 `topicId` 自动创建子目录。

例如图片目录为 `attachments` 时，实际路径类似：

```text
<根目录>/attachments/<topicId>/
```

## 注意事项

- `API Key`、AI 配置和导出位置配置都保存在 userscript 存储中，不写入仓库文件。
- 当前仓库只提供脚本源码与文档，不包含额外 CLI、安装器或构建流程。
- 如果你要切换中英文界面，请在 userscript 管理器中替换脚本版本，而不是同时启用两份脚本。
