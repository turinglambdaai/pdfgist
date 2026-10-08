# PDFGist

<<<<<<< HEAD
> A local-first AI PDF reader — bring your own model. Built on [Rivet](https://github.com/turinglambdaai/rivet): one Racket domain core driving first-party native hosts over typed RPC.
=======
A local-first PDF reader with AI translation and summarization built in — bring your own API key. Works with any OpenAI-compatible endpoint: OpenAI, DeepSeek, Kimi, SiliconFlow, Ollama (local), and more. Built with Tauri 2 + PDF.js.

>>>>>>> 9cf3ec1 (Unify README head with family template)

**English** · [中文](README.zh-CN.md)

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey) ![built with](https://img.shields.io/badge/built%20with-Rivet-blue) [![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

Most AI PDF apps lock you into their subscription. PDFGist takes the opposite approach: the app is a thin, fast reader, and the intelligence is whatever model *you* point it at. Your key, your model, your cost — stored locally, sent directly to the provider you choose. Nothing leaves your machine except the requests you make to your own provider.

## Features

- **PDF reading** — tabbed documents, continuous scroll, two-page book view, zoom / fit-width, thumbnails, outline, full-text search, dark mode, printing, split view, text-to-speech, keyboard navigation
- **EPUB reading** — reflowable serif typography, chapter table of contents, whole-book search, font-size control, dark mode, and the same AI workflow on chapters
- **Page editing** — delete, rotate, insert blank pages, extract a selection into a new file, merge documents, bake watermarks and text boxes (in-memory; your source files are never modified)
- **Continue where you left off** — recent files keep your page and scroll position; files stay in your folders and sync drives, never copied into an app library
- **Selection translation** — select any text, one click to translate, streaming result
- **Bilingual page reading** — paragraph-aligned translation of the current page: original and translation in pairs, streamed in parallel
- **Page & document summaries** — one-click structured summaries of the current page, a selection, or the whole document
- **Chat with the document** — ask questions grounded in the current page, your selection, or the first pages of the document
- **AcroForm filling** — fill text / checkbox / choice fields and export the filled PDF
- **Annotations & bookmarks** — highlights (three colors), notes, bookmarks stored in a sidecar JSON next to your PDF, ready for cloud-drive sync
- **Bring your own model** — presets for Zhipu GLM (incl. the GLM Coding plan endpoint), DeepSeek, Moonshot Kimi, Alibaba Qwen, Doubao (Volcano Ark), SiliconFlow and Ollama, or any OpenAI-compatible base URL; model lists fetched on demand
- **Local-first** — settings and API keys live in your user config directory; no account, no telemetry

## Architecture

One Racket domain core (`racket/` + `app/backend.rkt`) owns all business logic — AI streaming, PDF page surgery, annotation storage, settings — and exposes it over Rivet's typed RPC (RVT1). First-party hosts render and interact only:

| Host | Stack | Directory |
|---|---|---|
| macOS | SwiftUI + generated client | `macos-host/` |
| Windows | C++/WinRT + generated client | `windows/` |
| Linux | GTK4 + generated client | `linux/` |

PDF page-level operations run on the domain core's own minimal PDF reader/writer (`racket/pdfgist/pdfdoc.rkt`) — no external PDF libraries.

## Building from source

Prerequisites: [Racket](https://racket-lang.org) CS 9.x with [Rivet](https://github.com/turinglambdaai/rivet) linked, plus the Swift / WinRT / GTK toolchain for your platform.

```bash
raco rivet doctor --json   # toolchain check
raco rivet build           # generate clients, build backend + host
raco rivet dev             # develop (rebuild on change)
raco test racket/          # domain-core tests
```

## Roadmap

- [ ] Windows & Linux host builds

## License

[AGPL-3.0](LICENSE)
