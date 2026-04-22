# Discourse2MD

[中文](./README.md) | [English](./README.en.md)

## 功能简介

Discourse2MD 是一个运行在 Discourse 主题页上的 userscript，用来把帖子内容导出为 Markdown，或直接写入 Obsidian。

项目面向泛 Discourse 站点，不绑定单一社区品牌。虽然默认根目录示例使用 `Linux.do`，但脚本并不是 Linux.do 专用工具。

当前仓库提供两个语言版本脚本：

- `discourse2MD-cn.user.js`
- `discourse2MD-en.user.js`

它们是同一个工具的不同界面语言版本，共用同一套 userscript 身份与配置。安装时请选择其中一个，不要同时启用两份。

脚本当前支持：

- 导出到浏览器下载的 Markdown 文件
- 通过 Obsidian Local REST API 直接写入笔记
- 图片存储：`file` / `local-plus` / `base64` / `none`
- 导出模板：`forum` / `clean`
- 多种筛选条件：楼层范围、只看楼主、图片筛选、指定用户、关键词、最少字数
- AI 过滤低信息量回复
- Obsidian Callout 格式和 YAML frontmatter
- 重复主题检测、目录概览和浏览器下载兜底链接

## 安装前提

### 1. 安装 userscript 管理器

推荐安装以下任一扩展：

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)
- [Greasemonkey](https://www.greasespot.net/)（Firefox）

### 2. 如需导出到 Obsidian，安装 Local REST API 插件

如果你只需要浏览器下载 Markdown，这一步可以跳过。

1. 安装并打开 [Obsidian](https://obsidian.md/) 桌面端。
2. 进入 `Settings -> Community plugins`。
3. 关闭安全模式后，搜索并安装 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)。
4. 启用插件。
5. 在插件设置中记录 API Key。

补充说明：

- 脚本默认连接地址为 `https://127.0.0.1:27124`。
- 如果本地 HTTPS 证书未被信任，脚本会自动尝试回退到本机 HTTP。

### 3. 如需使用 `local-plus` 存储模式，再安装 Local Images Plus

1. 在 Obsidian 社区插件中搜索并安装 [Local Images Plus](https://github.com/Sergei-Korneev/obsidian-local-images-plus)。
2. 按你的 Vault 习惯配置附件目录和本地化行为。
3. 使用统一脚本以 `local-plus` 模式导出后，在 Obsidian 中运行 Local Images Plus，把笔记中的远程图片转成本地附件。

## 安装步骤

1. 在 userscript 管理器中二选一安装脚本：
   - 中文界面：[`discourse2MD-cn.user.js`](https://raw.githubusercontent.com/chitiabao/discourse2MD/main/discourse2MD-cn.user.js)
   - 英文界面：[`discourse2MD-en.user.js`](https://raw.githubusercontent.com/chitiabao/discourse2MD/main/discourse2MD-en.user.js)
2. 也可以先打开仓库中的对应脚本文件，再点击 GitHub 页面上的 `Raw` 直接导入。
3. 保存并启用脚本。
4. 打开任意匹配的 Discourse 主题页。
5. 页面右下角会出现导出按钮，点击后可展开导出面板。

旧版本说明：

- 如果你之前安装的是 `local-images-plus/` 变体，需要手动切换到统一脚本，并重新选择存储模式。
- 本次合并不会迁移旧变体的 userscript 配置。

## 配置说明

访问任意 Discourse 主题页后，脚本面板中可看到两个主要区域：

- `Obsidian 连接设置`
- `导出风格`

### Obsidian 连接设置

| 配置项 | 说明 | 默认值 / 规则 |
| --- | --- | --- |
| API 地址 | Obsidian Local REST API 地址 | `https://127.0.0.1:27124` |
| API Key | 从 Obsidian 插件设置中复制 | 必填（仅 Obsidian 导出） |
| 根目录 | Vault 内的顶层导出路径，可多级 | 默认 `Linux.do` |
| 分类 | 当前根目录下的单层分类目录 | 默认 `未分类` |
| 存储模式 | `file` / `local-plus` / `base64` / `none` | 默认 `file` |
| 图片目录 | 图片保存目录，仅 `file` 模式生效 | 默认 `attachments` |

### 根目录、分类与图片目录规则

- `根目录` 用于区分不同社区或主存储位置，允许使用多级相对路径，例如 `Linux.do`、`Forum/Linux`。
- `分类` 固定为单层目录名，不允许包含 `/` 或 `\`。
- `图片目录` 必须是 Vault 内相对路径，且不能包含 `.` 或 `..`。
- 新配置下，图片目录会相对于当前根目录解析。
- 如果所选根目录或分类目录尚不存在，首次导出时会自动创建。

### 存储模式对比

| 模式 | 说明 | 优点 | 适合场景 |
| --- | --- | --- | --- |
| `file` | 将图片写入 Vault，并在笔记中用 `![[...]]` 引用 | 笔记体积更小，图片可复用 | 长期归档到 Obsidian |
| `local-plus` | 保留远程图片链接，后续由 Local Images Plus 本地化 | 不需要脚本直写图片文件，方便交给 Vault 侧统一处理 | 已在 Obsidian 中使用 Local Images Plus |
| `base64` | 直接把图片嵌入 Markdown | 单文件完整，迁移方便 | 想保留单文件笔记 |
| `none` | 不导出图片 | 文件最小 | 只关心文字内容 |

补充说明：

- `导出 Markdown` 时，脚本会默认使用 Base64 内嵌图片，不受 Obsidian 存储模式设置影响。
- `导出到 Obsidian` 时，存储模式才会按面板中的设置生效。
- 当存储模式为 `file` 时，实际图片路径类似：

```text
<根目录>/<图片目录>/<topicId>/
```

- 当存储模式为 `local-plus` 时，脚本会保留远程图片链接，不会直写图片文件。

### 目录概览与重复主题检测

脚本会根据当前根目录和分类显示目录概览，并在导出前扫描已有笔记的 `topic_id`：

- 当前分类下仅命中 1 篇同主题时，会提示是否覆盖导出。
- 同一根目录的其他分类下命中同主题时，会提示是否继续导出，并明确继续后会在当前分类新增一份副本。
- 如果当前分类和其他分类同时命中，脚本只会弹出 1 次确认，并同时展示覆盖目标与其他命中位置。
- 如果当前分类下命中多份相同 `topic_id`，脚本会阻止导出，并要求先清理重复文件。

## 使用方法

### 导出到 Markdown

1. 打开目标 Discourse 主题页。
2. 在 `导出风格` 中选择模板，并按需设置筛选条件。
3. 点击 `导出 Markdown`。
4. 脚本会生成浏览器下载。
5. 如果浏览器未自动保存，可点击面板中的兜底下载链接继续下载。

### 导出到 Obsidian

1. 打开目标 Discourse 主题页。
2. 在 `Obsidian 连接设置` 中填写 `API 地址` 和 `API Key`。
3. 点击 `测试连接` 确认配置可用。
4. 选择根目录、分类、存储模式，以及在 `file` 模式下使用的图片目录。
5. 在 `导出风格` 中选择模板，并按需设置筛选条件。
6. 点击 `导出到 Obsidian`。
7. 成功后，笔记会直接写入你指定的 Obsidian Vault 路径。

## 筛选与导出模板

### 导出模板

#### `forum`

- 导出 YAML frontmatter。
- 导出帖子信息摘要。
- 首帖正文与 `clean` 模式一致，尽量保留原始 Markdown 渲染结构。
- 后续回复按楼层生成 Callout，保留发言顺序、发言者和回复关系。
- 如果启用了筛选，摘要中会写入筛选条件。

#### `clean`

- 导出 YAML frontmatter。
- 导出帖子信息摘要。
- 仅保留首帖正文。
- 后续回复不会导出。
- 使用 `clean` 时，筛选项不会参与最终内容生成。

### 规则筛选

脚本会固定保留首帖，其余楼层可使用以下条件筛选：

| 条件 | 说明 |
| --- | --- |
| 楼层范围 | `全部楼层` 或 `指定范围` |
| 只看楼主 | 仅保留楼主发布的楼层 |
| 图片筛选 | 不筛选 / 仅含图楼层 / 仅无图楼层 |
| 指定用户 | 仅保留指定用户的楼层，多个用户名可用逗号、空格或分号分隔 |
| 包含关键词 | 命中任一关键词即可保留 |
| 排除关键词 | 命中任一关键词即过滤 |
| 最少字数 | 小于指定长度的楼层会被过滤 |

注意：

- 起始楼层不能大于结束楼层，否则导出会报错。
- 筛选摘要只会在 `forum` 模式中写入导出结果。

### AI 过滤

AI 过滤用于进一步剔除低信息量回复，例如纯感谢、纯附和、元评论、转载授权询问等。

启用前需要填写：

- `API URL`
- `API Key`
- `Model ID`

行为说明：

- 首帖固定保留，不会发送给 AI。
- AI 只会分析规则筛选之后剩余的非首帖楼层。
- AI 只返回应排除的候选楼层索引。
- 如果 AI 过滤失败，脚本会回退为内置规则继续导出，而不是直接中断整个导出流程。

## 导出结果示例

### 文件名

```text
<标题>-<topicId>.md
```

### YAML frontmatter

```yaml
---
title: "帖子标题"
topic_id: 12345
url: "https://example.com/t/topic/12345"
author: "楼主用户名"
category: "分类名"
tags:
  - "标签1"
  - "linuxdo"
export_time: "2024-01-01T12:00:00.000Z"
floors: 50
---
```

说明：

- `tags` 会包含主题原始标签，以及脚本追加的 `linuxdo` 标签。
- `floors` 为最终导出的楼层数，而不是原帖总楼层数。

### 帖子信息 Callout

```markdown
> [!info] 帖子信息
> - **原始链接**: [https://example.com/t/topic/12345](https://example.com/t/topic/12345)
> - **主题 ID**: 12345
> - **楼主**: @username
> - **分类**: 分类名
> - **标签**: 标签1, linuxdo
> - **导出时间**: 2024/1/1 12:00:00
> - **楼层数**: 50
> - **筛选条件**: 首帖=强制保留；范围=1-50
```

### 回复楼层 Callout

`forum` 模式中，首帖正文按 `clean` 导出；后续回复楼层使用 Callout。楼主回复使用 `[!success]`，其他用户回复使用 `[!note]`：

```markdown
> [!success]+ #2 用户名 (@username) 🏠 楼主 · 2024/1/1 12:00:00
> 帖子内容...
> ^floor-2
```

如果是回复其他楼层，导出内容中还会附带回复锚点：

```markdown
> > 回复 [[#^floor-12|#12楼]]
```

## 常见问题 / 故障排查

### 连接测试失败

可以依次检查：

1. Obsidian 是否已打开。
2. `Local REST API` 插件是否已启用。
3. API Key 是否填写正确。
4. 浏览器是否拦截了本地证书连接。

### 本地 HTTPS 证书未信任

脚本会优先连接 `https://127.0.0.1:27124`。如果本地证书未被信任，脚本会自动尝试回退到本机 HTTP。

如果你仍然连接失败，可手动访问：

```text
https://127.0.0.1:27124
```

并按浏览器提示信任证书后再重试。

### 图片无法显示或保存失败

- `base64` 模式下，问题通常来自原图下载失败或网络限制。
- `file` 模式下，请确认：
  - API Key 正确
  - 图片目录是合法相对路径
  - Obsidian Local REST API 可以写入对应 Vault

### 导出很慢

导出速度通常受以下因素影响：

- 主题楼层较多，需要分批拉取帖子数据
- 图片较多，需要下载或转换
- AI 过滤会额外发起接口请求

如果你只需要部分内容，建议先使用规则筛选缩小范围。

### 为什么会提示重复主题

脚本会扫描当前根目录下已有 Markdown 文件的 `topic_id`，避免同一主题被静默覆盖。

- 当前分类内命中 1 篇：提示是否覆盖
- 根目录其他分类命中：提示是否继续在当前分类导出一份副本
- 当前分类与其他分类同时命中：只提示 1 次，并展示两类命中位置
- 当前分类内命中多份：阻止导出，要求先清理重复文件

### 如何切换中英文脚本版本

请在 userscript 管理器中停用或替换当前脚本，再导入另一个语言版本。

不要同时启用 `discourse2MD-cn.user.js` 和 `discourse2MD-en.user.js`，否则会因为它们共享同一 userscript 身份与配置而产生冲突。

## 注意事项

- 仓库文档和脚本都面向泛 Discourse 主题页，不是 Linux.do 专用实现。
- README 中提到的 `Linux.do` 仅作为默认根目录示例。
- 当前仓库维护的是单文件 userscript，没有额外 CLI、安装器或构建流程。
- `API Key`、AI 配置、导出位置等都保存在 userscript 存储中，不会写入仓库文件。
- 版本号以脚本头部 metadata 的 `@version` 为准，README 不单独维护版本信息。

## 友情链接

- [Linux.do](https://linux.do/)
