# Linux host (GTK4) — scaffold, under construction

The Linux host is **not part of any release yet**. The plan is a GTK4 window
over one embedded Racket CS backend, speaking RVT1 through the shared
`runtime/` codec via rivet's Linux runtime bridge (`rivet::linux_runtime` —
the same embedding contract as `rivet::windows`, with a connected
`socketpair` standing in for the Win32 named pipe pair).

What is here today is the **rivet template scaffold**, not a PDF reader:

- `src/main.cpp` — a GTK4 counter demo over the generated client: boot the
  runtime off the UI thread, render one State value, one button. No document
  view, no tabs, no AI workflow — the reader UI lives only in `macos-host/`.
- `GeneratedBackend.hpp` — the generated client for the full PDFGist schema
  (chat / summarize / translate / epub / edit / settings / updates). The
  scaffold UI does not call any of it yet.
- `CMakeLists.txt` — builds the scaffold against `$RIVET_ROOT` (rivet's
  `platform/linux/runtime` + `runtime/include`) and an embeddable Racket CS.

Known staleness: `main.cpp` still calls the template-era counter API
(`get_counter_async` / `set_counter_async`), which the PDFGist backend schema
no longer exposes. The scaffold does not compile against the checked-in
generated client and needs rework onto the real API before reader-UI work
resumes. `windows/` is in the same state; pdfgist's CI does not compile
either host yet. Progress is tracked in the top-level README roadmap
("Windows & Linux host builds").

## Building by hand

Requirements: an embeddable Racket CS build, CMake ≥ 3.24, pkg-config, GTK 4,
zlib, LZ4, curses, and a graphical session (or Xvfb) to run. The standard
prebuilt Linux Racket installer does not ship `libracketcs` or the three boot
files; build and install Racket CS from a source distribution as described by
Racket's embedding guide.

```bash
export RIVET_ROOT=/path/to/rivet
export RIVET_RACKET_INCLUDE=/path/to/racket/include
export RIVET_RACKET_LIBRARY=/path/to/racket/lib/libracketcs.a
cmake -S linux -B /tmp/pdfgist-linux-build
cmake --build /tmp/pdfgist-linux-build
```

The executable must sit beside a staged runtime to start: `runtime/*.boot`
and `res/core.zo` (the same artifacts every platform host consumes;
`raco rivet build`, `dev`, and `package` create this layout automatically).
