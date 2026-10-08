# Changelog

All notable changes to PDFGist are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver.
The v1 (Tauri) line's history lives in git tags and GitHub Releases on `main`.

## [Unreleased]

### Changed

- Full rebuild on Rivet: one Racket domain core (`racket/`, `app/backend.rkt`)
  driving first-party native hosts over typed RPC (RVT1). The Tauri 2 + PDF.js
  stack has been removed; v1 remains in git history and v1.x tags for reference.
  Parity carried over: AI streaming (translate/summarize/chat), annotations &
  bookmarks, recents, settings, AcroForm filling, printing, TTS, split view,
  and page-level editing (delete / rotate / insert blank / extract / merge /
  watermark & text-box bake) backed by a self-contained Racket PDF reader &
  writer. EPUB reading is ported too: a domain-core EPUB reader
  (container/OPF/spine/TOC, sanitized chapter HTML with inlined images,
  plain-text extraction) rendered by WKWebView in the host with the v1
  reading typography, TOC navigation, whole-book search, font-size
  control and the chapter-scoped AI workflow.
