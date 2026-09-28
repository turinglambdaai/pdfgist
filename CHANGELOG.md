# Changelog

All notable changes to PDFGist are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver.

## [Unreleased]

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

[Unreleased]: https://github.com/turinglambdaai/pdfgist/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.2.0
[0.1.0]: https://github.com/turinglambdaai/pdfgist/releases/tag/v0.1.0
