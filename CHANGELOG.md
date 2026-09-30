# Changelog

All notable changes to PDFGist are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver.

## [Unreleased]

## [1.2.2] — 2026-10-01

### Added

- Focus mode: toolbar button (or Ctrl+Shift+F) slides both panels away for distraction-free reading; moving the mouse to a window edge briefly peeks the hidden panel; state is remembered across sessions

### Fixed

- The double-click word-selection box now clears on any single click or scroll, instead of lingering until the next double-click

## [1.2.1] — 2026-09-30

### Fixed

- Double-click word selection now computes word boundaries directly from PDF text item geometry instead of relying on the transparent text layer — the font-metric drift between the two (sans-serif overlay vs embedded serif glyphs) no longer clips leading letters like the "c" in "configuration". Selection is shown as precise overlay boxes and feeds the floating translate bar exactly

## [1.2.0] — 2026-09-30

Page management and light editing.

### Added

- Page management via the thumbnails panel: multi-select pages, then 删除 / 旋转(+90°, persisted) / 提取为 PDF / 插入空白页 / 合并其他 PDF 到文末 — every operation applies instantly through a pdf-lib pipeline and reloads the viewer in place
- Text boxes: 点击页面放置文本, session preview overlays, baked into the export
- Watermark: diagonal text watermark (CJK-capable via system SimHei, falls back to Helvetica) baked on export
- 导出编辑版 button bakes text boxes + watermark into a saved copy

## [1.1.0] — 2026-09-30

Forms and richer annotations.

### Added

- AcroForm form filling: the new 表单 tab lists all form fields of the document (text fields, checkboxes, choices), filled values render onto the pages via pdf.js annotation storage, and 导出填写后的 PDF saves the completed document through pdf-lib
- Annotation kinds: 下划线 and 删除线 join the selection bar next to the three highlight colors; kind is persisted per annotation and included in Markdown export

## [1.0.0] — 2026-09-30

The 1.0: a complete local-first AI reader, feature-full and battle-tested.

### Added

- File association: double-clicking a PDF (or "Open with") now offers PDFGist; a second launch forwards the file to the running window instead of starting a second instance
- Read aloud (TTS): speaks the current page text via the system speech engine
- Page rotation: 90° steps for landscape scans
- Annotation sidecar option: store highlights/notes/bookmarks as `<file>.pdfgist.json` next to the PDF so cloud drives sync them
- Performance verified on a 500-page document: open + layout is instant, lazy rendering keeps scroll smooth

### Deferred (by design)

- Interactive form filling (needs a PDF-rewrite layer) and full UI i18n — planned post-1.0

## [0.9.0] — 2026-09-29

### Fixed

- EPUB text selection now reaches the floating toolbar: select inside a book and translate it (previously the selection never left the sandboxed chapter frame)
- User bookmarks are persisted per file again (0.8.0 shipped them session-only despite the notes): bookmarks live alongside annotations in the per-document data file, with automatic migration of 0.8.x annotation-only files

### Changed

- Product homepage refreshed to the current UI (bottom status bar, new brand mark) with updated feature story

## [0.8.3] — 2026-09-29

### Changed

- New brand mark: a white document with a folded corner and a highlighted "gist" line on the terracotta gradient — naturally symmetric (no more optical nudging of the wedge-shaped plane). Applied across app icons, taskbar, installers, favicon and the in-app empty state.

## [0.8.2] — 2026-09-29

### Changed

- Layout follows the reader-industry convention: page navigation and zoom moved from the top toolbar to a slim bottom status bar (page box on the left, zoom on the right, document info in between). The top toolbar now carries only document-level actions — 8 buttons instead of 13

## [0.8.1] — 2026-09-29

### Added

- "最近打开" now lives in the left panel too (below bookmarks), so recent files are reachable while documents are open — not only on the start screen

### Removed

- Dark-mode page inversion (它确实多此一举): dark mode keeps page content untouched, full stop

## [0.8.0] — 2026-09-29

Adobe-grade reading details.

### Added

- In-document links: internal GoTo links jump to their target, external URLs open in the default browser
- User bookmarks: flag the current page from the toolbar (Ctrl+B), listed under the outline with jump/delete; persisted per file with annotations
- Encrypted PDFs: a password prompt opens protected documents, with retry on wrong passwords
- Split view: the same document in two synchronized panes for side-by-side reading (toolbar toggle), with lazy rendering in both panes

## [0.7.3] — 2026-09-29

### Added

- Optional night reading: a "深色模式下反转页面颜色" toggle in Settings → 通用 inverts PDF page content (pages become dark with light text, thumbnails follow) while dark mode is active. Off by default — dark mode still only darkens the chrome unless enabled, and EPUB keeps its native dark colors.

## [0.7.2] — 2026-09-29

### Fixed

- Outline jumps are more robust: destinations written as a 0-based page number (some producers) now jump correctly, and unresolvable entries no longer fail silently — the outline panel shows "该条目无法跳转" instead

## [0.7.1] — 2026-09-29

A guided installer and a system-following theme.

### Added

- Windows installer now guides you: Simplified Chinese / English language selection, per-user vs all-users install mode choice, the AGPL license page, and branded sidebar/header art
- Appearance setting (跟随系统 / 浅色 / 深色) in Settings → 通用: the toolbar toggle picks an explicit theme, and 跟随系统 restores OS-following (previously a manual toggle permanently disabled system-following)

## [0.7.0] — 2026-09-29

EPUB and a more comfortable workspace.

### Added

- EPUB support: open .epub files from the dialog, drag-drop or the continue-reading shelf. Chapters render as reflowable sandboxed sections with serif reading typography; the table of contents lands in the left panel, font-size zoom replaces page zoom, dark mode applies inside the book, and the whole AI workflow works on chapter text (selection translation, chapter translation, summaries, chat)
- Whole-book search for EPUB with in-place marks and hit navigation
- Resizable panels: drag the inner edges of the outline/thumbnails panel and the AI sidebar to resize (double-click resets); the reader reflows on release. Widths persist per install

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

[Unreleased]: https://github.com/turinglambdaai/pdfgist/compare/v0.8.3...HEAD
[0.8.3]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.8.3
[0.8.2]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.8.2
[0.8.1]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.8.1
[0.8.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.8.0
[0.7.3]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.7.3
[0.7.2]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.7.2
[0.7.1]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.7.1
[0.7.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.7.0
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
