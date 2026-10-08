# PDFGist

A local-first PDF reader with AI translation and summarization built in — bring your own API key. Works with any OpenAI-compatible endpoint: OpenAI, DeepSeek, Kimi, SiliconFlow, Ollama (local), and more. Built with Tauri 2 + PDF.js.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey) ![built with](https://img.shields.io/badge/built%20with-Tauri%202-orange) [![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

**English** · [中文](README.zh-CN.md)

Most AI PDF apps lock you into their subscription. PDFGist takes the opposite approach: the app is a thin, fast reader, and the intelligence is whatever model *you* point it at. Your key, your model, your cost — stored locally, sent directly to the provider you choose. Nothing leaves your machine except the requests you make to your own provider.

## Features

- **PDF reading** — tabbed documents, continuous scroll, two-page book view, zoom / fit-width, thumbnails, outline, full-text search, dark mode, printing, keyboard navigation
- **Continue where you left off** — recent files keep your page and scroll position; files stay in your folders and sync drives, never copied into an app library
- **EPUB reading** — reflowable chapters with font-size control, table of contents, whole-book search, dark mode, and the same AI workflow (selection translation, chapter translation, summaries, chat)
- **Selection translation** — select any text, one click to translate, streaming result
- **Bilingual page reading** — paragraph-aligned translation of the current page: original and translation in pairs, streamed in parallel
- **Page & document summaries** — one-click structured summaries of the current page, a selection, or the whole document
- **Chat with the document** — ask questions grounded in the current page, your selection, or the first pages of the document
- **Bring your own model** — presets for Zhipu GLM (incl. the GLM Coding plan endpoint), DeepSeek, Moonshot Kimi, Alibaba Qwen, Doubao (Volcano Ark), SiliconFlow and Ollama, or any OpenAI-compatible base URL; model lists fetched on demand
- **Local-first** — settings and API keys live in your user config directory; no account, no telemetry
- **Auto-updates** — signed in-app updates via GitHub Releases, checked at startup and from Settings

## Building from source

Prerequisites: Node.js 22+, Rust, and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run tauri dev    # develop
npm run tauri build  # bundle installers
```

Regenerate the app icon after changing `scripts/make-icon.mjs`:

```bash
npm run icon
```

## Roadmap

- [ ] Annotation sidecar files (sync highlights via cloud drives)

## License

[AGPL-3.0](LICENSE)
