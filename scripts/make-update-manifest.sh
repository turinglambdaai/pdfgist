#!/usr/bin/env bash
# Build the PDFGist update manifest (rivet format) over the final installer.
#
# Usage: scripts/make-update-manifest.sh <tag> <dist-dir> <key-der-path>
#   <tag>          release tag, e.g. v1.1.0 (must match rivet.rktd version)
#   <dist-dir>     directory containing the drag-install DMG named by the
#                  workflow:  PDFGist-<tag>-macos.dmg
#   <key-der-path> Ed25519 private key in DER (SubjectPublicKeyInfo/OneAsymmetricKey)
#                  form; the CI secret stores it base64-encoded.
#
# Overwrites <dist-dir>/update-stable.json — the signed stable-channel
# manifest whose artifact entry points at the released DMG. The manifest is
# regenerated here (rather than using the one `raco rivet release` wrote
# inside the job) because the released DMG is rebuilt with the drag-to-
# Applications layout after release produces its own plain DMG, and the
# manifest must carry the final artifact's URL, size, and SHA-256.
#
# Env overrides: RELEASE_ASSET_BASE_URL, RIVET_UPDATE_KEY_ID.

set -euo pipefail

TAG="${1:?usage: make-update-manifest.sh <tag> <dist-dir> <key-der-path>}"
DIST="${2:?usage: make-update-manifest.sh <tag> <dist-dir> <key-der-path>}"
KEY_PATH="${3:?usage: make-update-manifest.sh <tag> <dist-dir> <key-der-path>}"
VERSION="${TAG#v}"
KEY_ID="${RIVET_UPDATE_KEY_ID:-pdfgist-2026-10}"
BASE_URL="${RELEASE_ASSET_BASE_URL:-https://github.com/turinglambdaai/pdfgist/releases/download/$TAG}"

# ---- verify tag/version alignment -------------------------------------------
RKTD_VERSION="$(racket -e '(require racket/file) (displayln (hash-ref (file->value "rivet.rktd") (quote version)))' | tr -d '"')"
if [ "$VERSION" != "$RKTD_VERSION" ]; then
  echo "error: tag $VERSION != rivet.rktd version $RKTD_VERSION" >&2
  exit 1
fi

DMG="$DIST/PDFGist-$TAG-macos.dmg"
if [ ! -f "$DMG" ]; then
  echo "error: missing installer: $DMG" >&2
  exit 1
fi

# ---- build + sign the manifest with rivet's own signer -----------------------
MANIFEST="$DIST/update-stable.json"

SCRIPT="$(mktemp /tmp/pdfgist-manifest-XXXXXX.rkt)"
trap 'rm -f "$SCRIPT"' EXIT

cat > "$SCRIPT" <<RKT
#lang racket/base
(require rivet/distribution
         racket/file
         racket/format
         racket/string)
(define tag "$TAG")
(define version "$VERSION")
(define base-url "$BASE_URL")
(define key-id "$KEY_ID")
(define dist (path->string (path->complete-path "$DIST")))
(define key-path (path->complete-path "$KEY_PATH"))
(define build (hash-ref (file->value "rivet.rktd") 'build))

(define (artifact file installer)
  (define path (build-path dist file))
  (unless (file-exists? path)
    (error 'make-update-manifest "missing installer: ~a" path))
  (update-artifact 'macos 'arm64
                   (string-append base-url "/" file)
                   (sha256-file/hex path)
                   (file-size path)
                   installer
                   '()))

(define manifest
  (update-manifest "site.jrtx.pdfgist"
                   version
                   build
                   'stable
                   ;; published-at: RFC 3339, second precision
                   (let ([d (seconds->date (current-seconds) #f)])
                     (format "~a-~a-~aT~a:~a:~aZ"
                             (date-year d)
                             (~r (date-month d) #:min-width 2 #:pad-string "0")
                             (~r (date-day d) #:min-width 2 #:pad-string "0")
                             (~r (date-hour d) #:min-width 2 #:pad-string "0")
                             (~r (date-minute d) #:min-width 2 #:pad-string "0")
                             (~r (date-second d) #:min-width 2 #:pad-string "0")))
                   "0.0.0"
                   #f
                   #t
                   100
                   (list (artifact (format "PDFGist-~a-macos.dmg" tag) 'dmg))))

(call-with-output-file (build-path dist "update-stable.json")
  #:exists 'truncate/replace
  (lambda (out)
    (write-signed-manifest manifest
                           (read-ed25519-private-key key-path)
                           key-id
                           out)
    (newline out)))
(printf "manifest: ~a (~a artifact)\\n"
        (build-path dist "update-stable.json")
        (length (update-manifest-artifacts manifest)))
RKT

# rivet must be installed for the signer; the job links a checkout
racket "$SCRIPT"

echo "manifest: $MANIFEST (macos artifact: $(basename "$DMG"))"
