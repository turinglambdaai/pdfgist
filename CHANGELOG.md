# Changelog

All notable changes to PDFGist are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver.

## [Unreleased]

## [0.6.1] — 2026-09-29

### Changed

- Paper-plane mark moves further right: the glyph is now centered on its area centroid (a further 3.5% right), which reads balanced at a glance.

## [0.6.0] — 2026-09-29

Annotations and exports.

### Added

- Light annotations: select text and highlight in three colors, click a highlight to attach a note, change its color or delete it. Annotations are stored per file in the app config directory and survive sessions
- Notes tab in the sidebar: all annotations of the active document with one-click jump, re-translate and delete, plus Markdown export (and copy) in an Obsidian-friendly format
- Batch bilingual export: translate the first N pages paragraph-by-paragraph with two concurrent streams and save the original/translation pairs as Markdown
- Two-page view now reports the row's left page in the page indicator

## [0.5.0] — 2026-09-29

The daily-driver release.

### Added

- Tabbed reading: open multiple PDFs at once, each tab keeps its own render cache; Ctrl+W or middle-click closes a tab
- Continue-reading shelf: the start screen lists recently read files with page and scroll position, and reopening resumes exactly there. Files are referenced in place — never copied into an app library, so folder layouts and sync drives stay untouched
- Two-page book view, persisted across sessions
- Printing: renders all pages of the active document first, then opens the system print dialog
- Window size and position are restored between sessions

### Changed

- The open dialog and drag-drop now hand real file paths to the app; drag-drop previously never fired inside the Tauri webview

## [0.4.3] — 2026-09-29

### Changed

- Reasoning models no longer stream their chain-of-thought into translation and summary cards: the thinking phase shows a compact animated "思考中" indicator, replaced by the streamed answer as soon as it starts. The dimmed reasoning text only appears as a fallback when a stream ends without any answer content. Stopped streams now say "（已停止）" instead of "（无返回内容）".

## [0.4.2] — 2026-09-29

### Changed

- Optical centering of the paper-plane mark: the glyph is left-heavy (wide tail, pointed nose), so it now sits ~5% right of the bounding-box center in the app icon, favicon and the in-app empty state.

## [0.4.1] — 2026-09-29

### Changed

- Redrew the brand mark: the app icon (window, taskbar, installers, site favicon) now uses the terracotta gradient with the white paper plane, matching the in-app mark and the TuringLambdaAI family style.

## [0.4.0] — 2026-09-28

Brand refresh.

### Added

- Warm visual identity across the app (light and dark), aligned with the TuringLambdaAI product family: terracotta accent, paper-tone surfaces, segmented toolbar groups and tabs, redesigned empty state with the paper-plane mark

### Fixed

- Reasoning models no longer dump chain-of-thought into translation and summary output: thinking streams dimmed in place and the visible result keeps only the answer; copy and chat history carry the answer only

## [0.3.1] — 2026-09-28

### Fixed

- GLM and Doubao presets failed with HTTP 404: the backend appended `/v1` to base URLs that already carried a provider version segment (`…/paas/v4`, `…/api/v3`), producing invalid paths like `…/v4/v1/chat/completions`. Version segments are now detected and preserved; `/v1` is only added when the URL has none. Regression-tested with unit tests, and CI now runs `cargo test`.
- HTTP error messages now include the request URL, so misconfigured base URLs are immediately visible.

## [0.3.0] — 2026-09-28

Bilingual reading.

### Added

- Paragraph-aligned page translation (段落对照): the current page is split into paragraph chunks, translated with two concurrent streaming requests, and shown as original/translation pairs in reading order; stop cancels the remaining paragraphs
- Copy button on AI result cards (translations, summaries and bilingual pairs)
- Smarter line joining when regrouping extracted page text (CJK-safe)

## [0.2.0] — 2026-09-28

Interface overhaul and reading features.

### Added

- In-document search (Ctrl+F): progressive whole-document search with highlight overlays, active-match navigation (Enter / Shift+Enter) and a floating find bar
- Page thumbnails panel with lazy rendering, current-page tracking and click-to-jump, paired with the document outline in a tabbed left panel
- Dark mode following the system theme with a manual toggle (persisted)
- Ctrl+mouse-wheel zoom and an editable page-number box for direct navigation
- Provider presets: Kimi Code plan (api.kimi.com/coding/v1) and Doubao Coding plan (ark api/coding/v3) alongside the existing GLM Coding / Qwen / DeepSeek presets

### Changed

- Full visual redesign: icon toolbar, refined color system with light/dark design tokens, redesigned empty state with keyboard hints, grouped settings sections, streaming cursor during AI output

## [0.1.0] — 2026-09-28

First release.

### Added

- PDF reading: continuous scroll, zoom / fit-width, document outline, keyboard navigation, drag-and-drop open
- Selection translation with streaming output and a floating translate button
- One-click summaries: current page, selection, whole document (first 12 pages with page markers)
- Chat with the document, grounded in the current page / selection / document start, with history and stop
- Bring-your-own-model settings: presets for Zhipu GLM (both the standard API and the GLM Coding plan endpoint), DeepSeek, Moonshot Kimi, Alibaba Qwen, Doubao (Volcano Ark), SiliconFlow and Ollama, any custom OpenAI-compatible base URL, on-demand model list fetching, connection test
- In-app auto-updates: startup and manual update checks against GitHub Releases, minisign-signed updater artifacts, download progress and relaunch
- Local-first persistence: provider config and target language stored in the user config directory
- Cancellable LLM streams (per-request cancellation tokens in the Rust backend)
- CJK-ready text extraction (PDF.js cmaps and standard fonts bundled)

[Unreleased]: https://github.com/turinglambdaai/pdfgist/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.6.1
[0.6.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.6.0
[0.5.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.5.0
[0.4.3]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.4.3
[0.4.2]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.4.2
[0.4.1]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.4.1
[0.4.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.4.0
[0.3.1]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.3.1
[0.3.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.3.0
[0.2.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.2.0
[0.2.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.2.0
[0.1.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.1.0
