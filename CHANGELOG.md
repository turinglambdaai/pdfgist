# Changelog

All notable changes to PDFGist are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver.
The v1 (Tauri) line's history lives in git tags and GitHub Releases on `main`.

## [Unreleased]

### Changed

- Full rebuild on Rivet: one Racket domain core (`racket/`, `app/backend.rkt`)
  driving first-party native hosts over typed RPC (RVT1). The Tauri 2 + PDF.js
  stack has been removed from this branch; v1 remains on `main` for reference.
  Parity carried over: AI streaming (translate/summarize/chat), annotations &
  bookmarks, recents, settings, AcroForm filling, printing, TTS, split view,
  and page-level editing (delete / rotate / insert blank / extract / merge /
  watermark & text-box bake) backed by a self-contained Racket PDF reader &
  writer. EPUB is the one v1 feature not yet ported.
