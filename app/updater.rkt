#lang racket/base

;; Online update support for PDFGist, built on rivet/distribution. The
;; backend verifies and downloads signed update artifacts; the native host
;; owns installation (rivet docs/release-and-updates.md). A check downloads
;; and verifies the Ed25519-signed channel manifest; the actual DMG download
;; runs on a background thread with progress published to a state box that
;; the UI polls through the `update-state` RPC (RVT1 events are thread-local,
;; so a background thread cannot emit them directly).
;;
;; Updater bookkeeping (lastUpdateCheckAt, rolloutBucket) does NOT ride the
;; settings.json document: that file must stay byte-compatible with v1
;; installs (AGENTS.md data contract). It lives in a small sibling file,
;; <config-dir>/updater.json, owned entirely by this module.

(require crypto
         crypto/all
         json
         net/base64
         net/url
         rivet/distribution
         racket/file
         racket/format
         racket/port
         racket/string
         "../racket/pdfgist/settings.rkt"
         "version.rkt")

(provide platform-symbol
         architecture-symbol
         installer-extension
         manifest-url
         fetch-manifest-bytes
         destination-path
         copy-with-progress!
         update-state-snapshot
         reset-update-state!
         perform-check!
         start-download!
         rollout-bucket
         last-update-check-at)

;; rivet release tooling emits these exact symbols into update manifests
(define (platform-symbol)
  (case (system-type 'os)
    [(macosx) 'macos]
    [(windows) 'windows]
    [else 'linux]))

(define (architecture-symbol)
  (case (system-type 'arch)
    [(aarch64 arm64) 'arm64]
    [else 'x64]))

(define (installer-extension)
  (case (system-type 'os)
    [(macosx) ".dmg"]
    [(windows) ".msi"]
    [else ".tar.gz"]))

(define maximum-download-bytes (* 800 1024 1024))

;; ---------- public key ----------

;; crypto/all sets the full factory set at module load; the embedded DER is
;; the public half of the update key whose private half never ships.
(define (embedded-public-key)
  (datum->pk-key (base64-string->bytes update-public-key-b64)
                 'SubjectPublicKeyInfo))

;; ---------- shared update state (UI-visible) ----------

;; phase: idle | checking | downloading | downloaded | error
(define update-state
  (box (hasheq 'phase "idle"
               'percent 0
               'message 'null
               'downloadedPath 'null
               'availableVersion 'null)))

(define candidate-box (box #f))
(define worker-thread-box (box #f))

(define (state-set! key value)
  (set-box! update-state (hash-set (unbox update-state) key value)))

(define (update-state-snapshot)
  (unbox update-state))

(define (reset-update-state!)
  (set-box! candidate-box #f)
  (set-box! update-state
            (hasheq 'phase "idle"
                    'percent 0
                    'message 'null
                    'downloadedPath 'null
                    'availableVersion 'null)))

;; ---------- updater bookkeeping (updater.json; v1 settings stay untouched) --

(define (updater-state-path)
  (build-path (config-dir-path) "updater.json"))

;; missing/corrupt file -> empty prefs (the updater never blocks on its own
;; bookkeeping; a fresh install simply has neither key)
(define (load-updater-prefs)
  (define path (updater-state-path))
  (if (not (file-exists? path))
      (hasheq)
      (with-handlers
          ([exn:fail?
            (lambda (e) (hasheq))])
        (define value (read-json (open-input-string (file->string path))))
        (if (hash? value) value (hasheq)))))

(define (save-updater-prefs! prefs)
  (make-directory* (config-dir-path))
  (with-output-to-file (updater-state-path)
    (lambda () (write-json prefs))
    #:exists 'replace))

(define (pref-with prefs key value)
  (hash-set prefs key value))

(define (last-update-check-at)
  (hash-ref (load-updater-prefs) 'lastUpdateCheckAt 'null))

;; ---------- manifest URL ----------

(define (manifest-url)
  (string-append (string-trim default-update-base-url "/" #:right? #t)
                 "/update-"
                 (symbol->string app-channel)
                 ".json"))

;; ---------- check ----------

;; GitHub release assets answer with a 302 to the CDN, so every fetch must
;; follow redirects (rivet's fetch-update-manifest uses a bare get-pure-port
;; and comes back empty on github.com; verify-signed-manifest below still
;; owns the trust model). Manifests are capped at 1 MiB like rivet's own
;; fetch.
(define (fetch-manifest-bytes url)
  (define in (get-pure-port (string->url url)
                            '("User-Agent: PDFGist-Updater/1")
                            #:redirections 10))
  (dynamic-wind
    void
    (lambda ()
      (define out (open-output-bytes))
      (define buffer (make-bytes 65536))
      (define limit (* 1024 1024))
      (let loop ([total 0])
        (define count (read-bytes-avail! buffer in))
        (unless (eof-object? count)
          (write-bytes buffer out 0 count)
          (define next (+ total count))
          (when (> next limit)
            (error 'fetch-manifest "manifest exceeds 1 MiB"))
          (loop next)))
      (get-output-bytes out))
    (lambda () (close-input-port in))))

;; Returns a wire jsexpr describing the outcome; also refreshes
;; lastUpdateCheckAt (epoch seconds) in updater.json on every completed check.
(define (perform-check!)
  (state-set! 'phase "checking")
  (with-handlers
      ([exn:fail?
        (lambda (e)
          (state-set! 'phase "error")
          (state-set! 'message (exn-message e))
          (hasheq 'status "error" 'message (exn-message e)))])
    (define manifest
      (verify-signed-manifest (open-input-bytes (fetch-manifest-bytes (manifest-url)))
                              (embedded-public-key)
                              #:key-id update-key-id))
    (define config
      (updater-config app-identifier
                      app-version
                      app-channel
                      (platform-symbol)
                      (architecture-symbol)
                      (embedded-public-key)
                      update-key-id
                      (rollout-bucket)
                      maximum-download-bytes))
    (define candidate (select-update config manifest))
    (save-updater-prefs!
     (pref-with (load-updater-prefs)
                'lastUpdateCheckAt (current-seconds)))
    (cond
      [candidate
       (set-box! candidate-box candidate)
       (define artifact (update-candidate-artifact candidate))
       (state-set! 'phase "idle")
       (state-set! 'availableVersion
                   (update-manifest-version (update-candidate-manifest candidate)))
       (hasheq 'status "available"
               'currentVersion app-version
               'availableVersion
               (update-manifest-version (update-candidate-manifest candidate))
               'build (update-manifest-build (update-candidate-manifest candidate))
               'publishedAt
               (update-manifest-published-at (update-candidate-manifest candidate))
               'installer (symbol->string (update-artifact-installer artifact))
               'sizeBytes (update-artifact-size artifact))]
      [else
       (state-set! 'phase "idle")
       (state-set! 'availableVersion 'null)
       (hasheq 'status "up-to-date" 'currentVersion app-version)])))

;; rollout bucket: stable random 0..99 assigned on first check so staged
;; rollouts are sticky per installation
(define (rollout-bucket)
  (define prefs (load-updater-prefs))
  (define existing (hash-ref prefs 'rolloutBucket 'null))
  (cond
    [(and (exact-integer? existing) (<= 0 existing 99)) existing]
    [else
     (define bucket (random 100))
     (save-updater-prefs! (pref-with prefs 'rolloutBucket bucket))
     bucket]))

;; ---------- download ----------

;; Container file extension for a manifest installer symbol. The family
;; feed serves portable zips; DMG (and later MSI/targz) manifests stay
;; supported. Unknown symbols fall back to the platform default so a
;; future installer kind cannot crash the download path.
(define (installer-extension/symbol sym)
  (case sym
    [(zip) ".zip"]
    [(dmg) ".dmg"]
    [(msi) ".msi"]
    [(targz) ".tar.gz"]
    [else (installer-extension)]))

(define (destination-path candidate)
  (define artifact (update-candidate-artifact candidate))
  (define version
    (update-manifest-version (update-candidate-manifest candidate)))
  (build-path (config-dir-path)
              "updates"
              (string-append app-display-name "-" version
                             (installer-extension/symbol
                              (update-artifact-installer artifact)))))

;; copy with progress; same limits as rivet's download-update but publishes
;; integer percent changes to the state box while streaming
(define (copy-with-progress! in out total)
  (define buffer (make-bytes 65536))
  (let loop ([done 0] [last-percent -1])
    (define count (read-bytes-avail! buffer in))
    (cond
      [(eof-object? count) done]
      [else
       (write-bytes buffer out 0 count)
       (define next (+ done count))
       (define percent
         (if (> total 0)
             (min 100 (quotient (* next 100) total))
             0))
       (when (> percent last-percent)
         (state-set! 'percent percent))
       (loop next percent)])))

(define (download-with-progress! config candidate destination)
  (define artifact (update-candidate-artifact candidate))
  (define total (update-artifact-size artifact))
  (when (> total (updater-config-maximum-download-bytes config))
    (error 'download-update "signed artifact size exceeds the download limit"))
  (make-parent-directory* destination)
  (define temporary (path-add-extension destination #".partial"))
  (when (file-exists? temporary) (delete-file temporary))
  (define in
    (get-pure-port (string->url (update-artifact-url artifact))
                   '("User-Agent: PDFGist-Updater/1")
                   #:redirections 10))
  (dynamic-wind
    void
    (lambda ()
      (call-with-output-file temporary
        #:exists 'truncate/replace
        #:mode 'binary
        (lambda (out) (copy-with-progress! in out total))))
    (lambda () (close-input-port in)))
  ;; size + SHA-256 against the signed manifest before the file is trusted
  (verify-update-artifact! candidate temporary)
  (rename-file-or-directory temporary destination #t)
  destination)

(define (start-download!)
  (define worker (unbox worker-thread-box))
  (when (and worker (thread-running? worker))
    (error 'start-download! "an update download is already running"))
  (define candidate (unbox candidate-box))
  (unless candidate
    (error 'start-download! "no update is available; run a check first"))
  (state-set! 'phase "downloading")
  (state-set! 'percent 0)
  (state-set! 'message 'null)
  (define config
    (updater-config app-identifier
                    app-version
                    app-channel
                    (platform-symbol)
                    (architecture-symbol)
                    (embedded-public-key)
                    update-key-id
                    (rollout-bucket)
                    maximum-download-bytes))
  (define destination (destination-path candidate))
  (set-box! worker-thread-box
            (thread
             (lambda ()
               (with-handlers
                   ([exn:fail?
                     (lambda (e)
                       (state-set! 'phase "error")
                       (state-set! 'message (exn-message e)))])
                 (define path
                   (download-with-progress! config candidate destination))
                 (state-set! 'phase "downloaded")
                 (state-set! 'percent 100)
                 (state-set! 'downloadedPath (path->string path)))))))
