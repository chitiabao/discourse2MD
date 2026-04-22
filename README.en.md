# Discourse2MD

[中文](./README.md) | [English](./README.en.md)

## Overview

Discourse2MD is a userscript for Discourse topic pages. It can export a topic as Markdown or write it directly into Obsidian.

This repository currently maintains two language variants of the same script:

- `discourse2MD-cn.js`
- `discourse2MD-en.js`

These are alternative language builds of the same tool. They share the same userscript identity and stored settings, so install only one of them at a time.

The project is maintained as single-file userscripts. There is no build step and no npm dependency setup.

## Features

### 1. Generic Discourse topic support

- Works with standard Discourse topic pages rather than a single branded community.
- Current match rules cover `https://*/t/*` and `https://*/t/topic/*`.
- Suitable for turning forum discussions into Markdown notes or an Obsidian knowledge base.

### 2. Two export templates

- `forum`
  - Exports YAML frontmatter.
  - Includes a topic summary block.
  - Outputs posts as callouts, preserving author info, post order, and reply relations.
  - Works with rule-based filters and AI filtering.

- `clean`
  - Exports YAML frontmatter.
  - Includes a topic summary block.
  - Keeps only the first post body and omits all replies.
  - Useful when you want a compact note from the original topic post.

### 3. Rule-based filtering and AI filtering

The first post is always kept. Replies can be filtered with built-in rules:

- post range: all posts or a custom range
- OP only
- image filter: with images / without images / no filter
- specific users
- include keywords
- exclude keywords
- minimum length

The script also supports AI filtering for low-value replies:

- AI only reviews non-first posts that remain after the rule-based filters.
- The goal is to remove pure thanks, pure agreement, meta-comments, repost/source permission questions, and similar low-information replies.
- The API must be OpenAI-compatible `chat/completions`.
- Required settings:
  - `API URL`
  - `API Key`
  - `Model ID`

### 4. Obsidian export

- Writes notes directly through the Obsidian Local REST API.
- Supports three image modes:
  - `file`: save images inside the vault and reference them with `![[...]]`
  - `base64`: embed images directly in Markdown
  - `none`: export text only
- Supports configurable roots, categories, and image directories.
- Scans existing notes by `topic_id` before export, so duplicate exports are confirmed instead of silently overwriting.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Import one script from this repository:
   - Chinese UI: `discourse2MD-cn.js`
   - English UI: `discourse2MD-en.js`
3. Save and enable the script.
4. Open any Discourse topic page and wait for the export panel to appear.

## Markdown Export

### Steps

1. Open the target Discourse topic page.
2. Choose an export template in the script panel.
3. Configure rule-based filters or AI filtering if needed.
4. Click `Export Markdown`.

### Result

- The output filename format is `<title>-<topicId>.md`.
- The note includes frontmatter, a topic summary, and the exported body content.
- Browser-downloaded Markdown embeds Base64 images by default, so you can get a single-file export without Obsidian.

## Obsidian Export

### Dependencies

Obsidian export depends on the Obsidian desktop app and the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin.

1. Install and open [Obsidian](https://obsidian.md/).
2. Go to `Settings -> Community plugins`.
3. Disable safe mode, then search for and install `Local REST API`.
4. Enable the plugin and copy the API key from its settings page.

Additional notes:

- The default API URL is `https://127.0.0.1:27124`.
- If the local HTTPS certificate is not trusted, the script will automatically fall back to local HTTP.
- If you only need browser Markdown download, Obsidian and the plugin are optional.

### Configuration

Configure everything under `Obsidian Settings` in the script panel.

#### Connection

- `API URL`
  - Default: `https://127.0.0.1:27124`
- `API Key`
  - Copy it from the Local REST API plugin settings in Obsidian.
- `Test Connection`
  - Verifies that the API URL and API key are usable.

#### Export location

- `Root` and `Category` together determine the final note path:

```text
<root>/<category>/<title-topicId>.md
```

- The script scans existing Markdown notes under the selected root by `topic_id`.
- If the same topic already exists:
  - in the current category, the script asks whether to overwrite it
  - in another category under the same root, the script asks whether to continue exporting

#### Image export

When image mode is `file`:

- the `Image Directory` setting is used
- images are stored under that directory with an automatic `topicId` subdirectory

For example, if the image directory is `attachments`, the actual path will look like:

```text
<root>/attachments/<topicId>/
```

## Notes

- The API key, AI settings, and export location settings are stored in the userscript storage, not in repository files.
- This repository only provides script sources and documentation. It does not include a CLI, installer, or build pipeline.
- If you want to switch the UI language, replace the installed script in your userscript manager instead of enabling both language variants together.
