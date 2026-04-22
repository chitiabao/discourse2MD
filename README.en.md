# Discourse2MD

[中文](./README.md) | [English](./README.en.md)

## Overview

Discourse2MD is a userscript for Discourse topic pages. It exports topics as Markdown or writes them directly into Obsidian.

The project targets generic Discourse sites rather than a single branded forum. The default root example uses `Linux.do`, but the script itself is not Linux.do-specific.

This repository currently provides two language variants:

- `discourse2MD-cn.js`
- `discourse2MD-en.js`

They are two UI languages for the same tool and share the same userscript identity and stored settings. Install only one of them at a time.

Current capabilities:

- export to a browser-downloaded Markdown file
- export directly to Obsidian through Local REST API
- image handling: `file` / `base64` / `none`
- export templates: `forum` / `clean`
- rule-based filters: post range, OP only, image filter, users, keywords, minimum length
- AI filtering for low-value replies
- YAML frontmatter and Obsidian callout formatting
- duplicate topic detection, directory overview, and fallback browser download link

## Prerequisites

### 1. Install a userscript manager

Use any of the following:

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)
- [Greasemonkey](https://www.greasespot.net/) (Firefox)

### 2. If you want Obsidian export, install Local REST API

You can skip this section if you only want browser Markdown download.

1. Install and open [Obsidian](https://obsidian.md/).
2. Go to `Settings -> Community plugins`.
3. Disable safe mode, then install [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api).
4. Enable the plugin.
5. Copy the API key from the plugin settings.

Additional notes:

- The default API URL is `https://127.0.0.1:27124`.
- If the local HTTPS certificate is not trusted, the script will automatically fall back to local HTTP.

## Installation

1. Import the script into your userscript manager.
2. Choose one version:
   - Chinese UI: `discourse2MD-cn.js`
   - English UI: `discourse2MD-en.js`
3. Save and enable it.
4. Open any supported Discourse topic page.
5. An export button will appear in the lower-right corner. Click it to open the export panel.

## Configuration

Once you open a Discourse topic page, the script panel contains two main areas:

- `Obsidian Settings`
- `Export Style`

### Obsidian Settings

| Field | Description | Default / Rule |
| --- | --- | --- |
| API URL | Obsidian Local REST API endpoint | `https://127.0.0.1:27124` |
| API Key | Copied from the Obsidian plugin settings | Required for Obsidian export |
| Root | Top-level export path inside the vault, can be nested | Default `Linux.do` |
| Category | Single-level category folder under the current root | Default `Uncategorized` |
| Image Mode | `file` / `base64` / `none` | Default `file` |
| Image Directory | Image save directory, only used in `file` mode | Default `attachments` |

### Rules for root, category, and image directory

- `Root` is used to separate communities or top-level storage locations. Multi-level relative paths such as `Linux.do` or `Forum/Linux` are allowed.
- `Category` is always a single-level directory name and cannot contain `/` or `\`.
- `Image Directory` must be a relative path inside the vault and cannot contain `.` or `..`.
- In the current configuration model, the image directory is resolved relative to the selected root.
- If the selected root or category does not exist yet, it will be created on first export.

### Image mode comparison

| Mode | Description | Advantage | Best for |
| --- | --- | --- | --- |
| `file` | Saves images into the vault and references them with `![[...]]` | Smaller notes, reusable assets | Long-term Obsidian storage |
| `base64` | Embeds images directly into Markdown | Self-contained single file | Portable one-file exports |
| `none` | Skips image export entirely | Smallest output | Text-only archives |

Additional notes:

- `Export Markdown` always embeds images as Base64 and does not use the Obsidian image mode setting.
- The image mode setting only applies to `Export to Obsidian`.
- In `file` mode, the effective image path looks like:

```text
<root>/<image-directory>/<topicId>/
```

### Directory overview and duplicate topic detection

The script shows a directory overview for the selected root and category, then scans existing notes by `topic_id` before export:

- if the same topic already exists in the current category, the script asks whether to overwrite it
- if the same topic exists in another category under the same root, the script asks whether to continue exporting

## Usage

### Export to Markdown

1. Open the target Discourse topic page.
2. Choose a template under `Export Style` and configure filters if needed.
3. Click `Export Markdown`.
4. The script will trigger a browser download.
5. If the browser does not save automatically, use the fallback download link shown in the panel.

### Export to Obsidian

1. Open the target Discourse topic page.
2. Fill in `API URL` and `API Key` under `Obsidian Settings`.
3. Click `Test Connection`.
4. Choose the root, category, image mode, and image directory.
5. Under `Export Style`, choose a template and configure filters if needed.
6. Click `Export to Obsidian`.
7. On success, the note is written directly into the selected vault path.

## Filters and Export Templates

### Export templates

#### `forum`

- Exports YAML frontmatter.
- Includes a topic summary block.
- Outputs posts as callouts, preserving order, author information, and reply relations.
- If filtering is enabled, the filter summary is written into the exported note.

#### `clean`

- Exports YAML frontmatter.
- Includes a topic summary block.
- Keeps only the first post body.
- Omits all follow-up replies.
- In `clean` mode, the filter settings do not affect the final content.

### Rule-based filters

The first post is always kept. Other posts can be filtered with the following options:

| Filter | Description |
| --- | --- |
| Post Range | `All posts` or `Custom range` |
| OP Only | Keeps only posts from the original poster |
| Image Filter | No filter / posts with images only / posts without images only |
| Users | Keeps only posts from specified users; multiple values can be separated by commas, spaces, or semicolons |
| Include Keywords | Keeps posts that match any listed keyword |
| Exclude Keywords | Removes posts that match any listed keyword |
| Minimum Length | Removes posts shorter than the configured length |

Notes:

- The start post number cannot be greater than the end post number.
- The filter summary is only written into exported notes in `forum` mode.

### AI filtering

AI filtering is used to remove low-value replies such as pure thanks, pure agreement, meta-comments, or repost/source permission questions.

Required fields:

- `API URL`
- `API Key`
- `Model ID`

Behavior:

- The first post is always kept and is never sent to AI.
- AI only analyzes non-first posts that remain after the rule-based filters.
- AI returns only the candidate indexes that should be excluded.
- If AI filtering fails, the script falls back to its built-in rules and continues exporting instead of aborting the whole export.

## Output Examples

### Filename

```text
<title>-<topicId>.md
```

### YAML frontmatter

```yaml
---
title: "Topic Title"
topic_id: 12345
url: "https://example.com/t/topic/12345"
author: "op_username"
category: "Category Name"
tags:
  - "tag1"
  - "linuxdo"
export_time: "2024-01-01T12:00:00.000Z"
floors: 50
---
```

Notes:

- `tags` include the original topic tags plus the extra `linuxdo` tag added by the script.
- `floors` is the final exported post count, not the total raw post count from the source topic.

### Topic info callout

```markdown
> [!info] Topic Info
> - **Source URL**: [https://example.com/t/topic/12345](https://example.com/t/topic/12345)
> - **Topic ID**: 12345
> - **OP**: @username
> - **Category**: Category Name
> - **Tags**: tag1, linuxdo
> - **Exported At**: 1/1/2024, 12:00:00 PM
> - **Posts**: 50
> - **Filters**: First post=always kept; Range=1-50
```

### Post callout

OP posts use `[!success]`, while other users use `[!note]`:

```markdown
> [!success]+ #1 Username (@username) 🏠 OP · 1/1/2024, 12:00:00 PM
> Post content...
> ^floor-1
```

When a post replies to another floor, the export also includes a reply anchor:

```markdown
> > Reply to [[#^floor-12|post #12]]
```

## FAQ / Troubleshooting

### Test Connection fails

Check the following:

1. Obsidian is running.
2. The `Local REST API` plugin is enabled.
3. The API key was copied correctly.
4. Your browser is not blocking the local certificate connection.

### Local HTTPS certificate is not trusted

The script first tries `https://127.0.0.1:27124`. If the local certificate is not trusted, it automatically attempts a fallback to local HTTP.

If the connection still fails, manually visit:

```text
https://127.0.0.1:27124
```

and trust the certificate in your browser before retrying.

### Images do not display or fail to save

- In `base64` mode, failures are usually caused by source image download problems or network restrictions.
- In `file` mode, check that:
  - the API key is valid
  - the image directory is a valid relative path
  - Obsidian Local REST API can write to the target vault

### Export is slow

Common reasons:

- large topics require batched post fetching
- many images need downloading or conversion
- AI filtering adds extra API requests

If you only need part of the topic, narrow the export first with rule-based filters.

### Why am I seeing a duplicate topic warning

The script scans existing Markdown files under the selected root by `topic_id` so it does not overwrite the same topic silently.

- match inside the current category: asks whether to overwrite
- match in another category under the same root: asks whether to continue

### How do I switch between Chinese and English

Disable or replace the currently installed script in your userscript manager, then import the other language variant.

Do not enable `discourse2MD-cn.js` and `discourse2MD-en.js` at the same time, because they share the same userscript identity and stored settings.

## Notes

- The repository and scripts target generic Discourse topic pages, not only Linux.do.
- Any mention of `Linux.do` in the README is only an example default root.
- The project is maintained as single-file userscripts and does not include a separate CLI, installer, or build pipeline.
- API keys, AI settings, and export locations are stored in userscript storage rather than repository files.
- The source of truth for the version is the `@version` field in the userscript metadata, not the README.

## Related Link

- [Linux.do](https://linux.do/)
