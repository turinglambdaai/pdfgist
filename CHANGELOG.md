# Changelog

All notable changes to PDFGist are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver.
The v1 (Tauri) line's history lives in git tags and GitHub Releases on `main`.

## [Unreleased]

## [1.2.0] - 2026-10-09

Family packaging standard (the taskly v1.3.0 benchmark) applied to PDFGist.

### Added

- **Intel Mac support.** macOS now ships both architectures —
  `pdfgist-<version>-macos-arm64.dmg` / `.zip` (Apple silicon) and
  `pdfgist-<version>-macos-x64.dmg` / `.zip` (Intel, built on Intel
  runners). The signed update feed carries both portable zips, and each
  client picks its own architecture at check time (rivet/distribution
  selects by platform *and* architecture).
- **Portable zips.** Both macOS architectures ship a
  `pdfgist-<version>-macos-<arch>.zip` alongside the drag-to-install
  DMG; the in-app update feed now serves the zip.

### Changed

- **Release artifact naming** follows the family convention: lowercase
  with an explicit architecture — `pdfgist-<version>-macos-<arch>.dmg`
  replaces `PDFGist-v<version>-macos.dmg`.
- The in-app updater downloads the portable zip and the native installer
  unpacks it with `ditto` (DMG artifacts in a manifest remain supported).
- **Upstream Rivet alignment.** Rivet main now scopes generated Swift
  records and enums under `RivetTypes`; the macOS host's call sites were
  migrated accordingly (`RecentEntry` → `RivetTypes.RecentEntry` and so
  on). Cold builds of the host fail against the new codegen without this.
- Release metadata is gated by `scripts/check-release-version.sh`
  (VERSION == rivet.rktd == updater constants == tag) in CI and in every
  release job.

### Note for 1.1.0 installations

The 1.1.0 updater can verify and download this release but its installer
only mounts DMGs, so it cannot install the new zip feed — update once
manually: download `pdfgist-1.2.0-macos-arm64.dmg` from this release and
drag it to Applications. From 1.2.0 on, in-app updates work again.

## [1.1.0] - 2026-10-09

Online updates. The app can now check for new releases and update itself.

### Added

- Signature-verified online updates on macOS (File → 检查更新… / Check for
  Updates, ⌘U): the backend fetches the release channel manifest
  (`update-stable.json`), verifies its Ed25519 signature and key id
  (`pdfgist-2026-10`) before parsing, applies channel/version/rollout
  policy, then downloads the DMG on a background thread with progress
  reporting and SHA-256 verification against the signed manifest. The host
  owns installation: mount, replace `/Applications/PDFGist.app` (keeping
  the previous bundle beside it as a rollback copy), relaunch. A silent
  launch-time check runs at most once a day; nothing is installed without
  the user clicking through.
- Release pipeline now runs `raco rivet release --development` on macOS and
  publishes the signed channel manifest `update-stable.json` alongside the
  DMG (SHA256SUMS and build-provenance attestation unchanged).

## [1.0.0] - 2026-10-08

First release of the Rivet line. macOS (Apple silicon, macOS 14+);
the Windows and Linux hosts are under construction.

### Added

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
- Drag-to-Applications DMG installer with SHA256SUMS and build-provenance
  attestation.
