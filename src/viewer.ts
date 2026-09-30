import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextContent, TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import type { Annotation, Bookmark } from "./types";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ViewerEvents {
  onPageChange?: (page: number) => void;
  onDocLoaded?: (info: { pages: number; title: string }) => void;
  onZoom?: (scale: number) => void;
  onLink?: (url: string) => void;
}

export class PasswordRequiredError extends Error {
  constructor(public readonly retry: boolean) {
    super(retry ? "密码错误" : "需要密码");
    this.name = "PasswordRequiredError";
  }
}

export interface SearchHit {
  page: number; // 1-based
  itemIndex: number;
  charStart: number;
  length: number;
}

interface PageView {
  index: number;
  div: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayerDiv: HTMLDivElement;
  highlightLayer: HTMLDivElement;
  width: number; // css px at scale 1
  height: number;
  rendered: boolean;
  rendering: boolean;
  renderTask: pdfjs.RenderTask | null;
  text: string;
  textContent: TextContent | null;
}

interface ThumbView {
  page: number;
  div: HTMLDivElement;
  canvas: HTMLCanvasElement;
  rendered: boolean;
}

function isCancel(err: unknown): boolean {
  return err instanceof Error && err.name === "RenderingCancelledException";
}

function textFromItems(items: readonly (TextItem | TextMarkedContent)[]): string {
  let out = "";
  for (const item of items) {
    if ("str" in item) {
      out += item.str;
      if (item.hasEOL) out += "\n";
    }
  }
  return out;
}

const RENDERED_CAP = 30; // keep at most this many decoded pages in memory
const MARGIN = 600; // render pages within this many px of the viewport
const THUMB_WIDTH = 116;

export class PdfViewer {
  private container: HTMLElement;
  private viewer: HTMLElement;
  private doc: PDFDocumentProxy | null = null;
  private loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
  private pages: PageView[] = [];
  private thumbs: ThumbView[] = [];
  private thumbObserver: IntersectionObserver | null = null;
  private scale = 1;
  private fitWidth = true;
  private viewMode: "single" | "double" = "single";
  private extraRotation = 0; // user-applied 90° steps on top of page.rotate
  private currentPage = 1;
  private renderScheduled = false;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private hits: SearchHit[] = [];
  private activeHit = -1;
  private searchToken = 0;
  private annotations: Annotation[] = [];
  private bookmarks: Bookmark[] = [];
  private password: string | null = null;
  private pendingPasswordCallback: ((password: string) => void) | null = null;
  private splitPane: HTMLElement | null = null;
  private splitSync: (() => void) | null = null;
  private splitViews = new Map<number, { div: HTMLDivElement; canvas: HTMLCanvasElement; rendered: boolean }>();
  events: ViewerEvents = {};

  constructor(container: HTMLElement, viewer: HTMLElement) {
    this.container = container;
    this.viewer = viewer;
    container.addEventListener("scroll", () => this.scheduleRender());
    container.addEventListener("click", (e) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // selection wins over links
      this.linkLayerHit(e.clientX, e.clientY);
    });
    window.addEventListener("resize", () => {
      if (!this.doc || !this.fitWidth) return;
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.setScale(this.computeFitWidth(), true);
      }, 150);
    });
  }

  get isOpen(): boolean {
    return this.doc !== null;
  }

  getDocPages(): number {
    return this.doc?.numPages ?? 0;
  }

  getScale(): number {
    return this.scale;
  }

  getViewMode(): "single" | "double" {
    return this.viewMode;
  }

  setViewMode(mode: "single" | "double"): void {
    this.viewMode = mode;
    this.viewer.classList.toggle("double", mode === "double");
    if (this.doc) {
      if (this.fitWidth) this.setScale(this.computeFitWidth(), true);
      else this.setScale(this.scale);
    }
  }

  // Renders every page of the document sequentially — used before printing,
  // where unrendered pages would come out blank.
  async renderAll(): Promise<void> {
    for (const pv of this.pages) {
      if (!pv.rendered && this.doc) await this.ensureRendered(pv);
    }
  }

  currentPageNumber(): number {
    return this.currentPage;
  }

  async open(data: ArrayBuffer, title: string): Promise<void> {
    this.close();
    const cMapUrl = import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/cmaps/"
      : "cmaps/";
    const standardFontDataUrl = import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/standard_fonts/"
      : "standard_fonts/";
    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      password: this.password ?? undefined,
      onPassword: (callback: (password: string) => void, reason: number) => {
        if (this.password && reason !== pdfjs.PasswordResponses.INCORRECT_PASSWORD) {
          callback(this.password);
          return;
        }
        this.password = null;
        this.pendingPasswordCallback = callback;
        throw new PasswordRequiredError(
          reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
        );
      },
    } as Parameters<typeof pdfjs.getDocument>[0]);
    this.loadingTask = task;
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (err) {
      if (err instanceof PasswordRequiredError) throw err;
      void task.destroy();
      throw err;
    }
    if (this.loadingTask !== task) {
      void task.destroy(); // another file was opened meanwhile
      return;
    }
    this.doc = doc;
    this.password = null;

    this.viewer.classList.toggle("double", this.viewMode === "double");
    const metas = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
    );
    this.viewer.innerHTML = "";
    this.pages = metas.map((page, i) => {
      const vp = page.getViewport({ scale: 1 });
      const div = document.createElement("div");
      div.className = "page-view";
      const canvas = document.createElement("canvas");
      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "textLayer";
      const highlightLayer = document.createElement("div");
      highlightLayer.className = "highlight-layer";
      div.append(canvas, textLayerDiv, highlightLayer);
      this.viewer.append(div);
      return {
        index: i,
        div,
        canvas,
        textLayerDiv,
        highlightLayer,
        width: vp.width,
        height: vp.height,
        rendered: false,
        rendering: false,
        renderTask: null,
        text: "",
        textContent: null,
      } satisfies PageView;
    });

    this.setScale(this.computeFitWidth(), true);
    this.container.scrollTop = 0;
    this.events.onDocLoaded?.({ pages: doc.numPages, title });
  }

  close(): void {
    this.searchToken++;
    this.hits = [];
    this.activeHit = -1;
    this.detachSplit();
    this.teardownThumbs();
    if (this.loadingTask) {
      void this.loadingTask.destroy();
      this.loadingTask = null;
    }
    this.doc = null;
    this.pages = [];
    this.currentPage = 1;
    this.viewer.innerHTML = "";
  }

  private computeFitWidth(): number {
    if (this.pages.length === 0) return 1;
    const columns = this.viewMode === "double" ? 2 : 1;
    const padding = columns === 2 ? 80 : 64;
    return (this.container.clientWidth - padding) / (this.pages[0].width * columns);
  }

  setScale(next: number, fit = false): void {
    this.fitWidth = fit;
    this.scale = Math.min(4, Math.max(0.4, next));
    const anchor = this.currentPage;
    const prevOffset = anchor > 1 ? this.pages[anchor - 1].div.offsetTop - this.container.scrollTop : 0;
    for (const pv of this.pages) {
      pv.renderTask?.cancel();
      pv.renderTask = null;
      pv.rendering = false;
      this.unrender(pv);
      pv.div.style.width = `${Math.floor(pv.width * this.scale)}px`;
      pv.div.style.height = `${Math.floor(pv.height * this.scale)}px`;
    }
    if (anchor > 1 && this.pages[anchor - 1]) {
      this.container.scrollTop = this.pages[anchor - 1].div.offsetTop - prevOffset;
    }
    this.events.onZoom?.(this.scale);
    this.scheduleRender();
    this.redrawOverlay();
  }

  zoomIn(): void {
    this.setScale(this.scale * 1.2);
  }

  zoomOut(): void {
    this.setScale(this.scale / 1.2);
  }

  zoomReset(): void {
    this.setScale(1);
  }

  fitToWidth(): void {
    this.setScale(this.computeFitWidth(), true);
  }

  // Effective viewport honoring per-page base rotation + user rotation.
  private viewportFor(page: PDFPageProxy, scale: number): pdfjs.PageViewport {
    return page.getViewport({ scale, rotation: (page.rotate + this.extraRotation) % 360 });
  }

  rotatePage(): void {
    if (!this.doc || this.pages.length === 0) return;
    this.extraRotation = (this.extraRotation + 90) % 360;
    void (async () => {
      for (const pv of this.pages) {
        if (!this.doc) return;
        pv.renderTask?.cancel();
        pv.renderTask = null;
        pv.rendering = false;
        this.unrender(pv);
        const page = await this.doc.getPage(pv.index + 1);
        const viewport = this.viewportFor(page, 1);
        pv.width = viewport.width;
        pv.height = viewport.height;
        pv.div.style.width = `${Math.floor(pv.width * this.scale)}px`;
        pv.div.style.height = `${Math.floor(pv.height * this.scale)}px`;
      }
      if (this.fitWidth) this.setScale(this.computeFitWidth(), true);
      else this.setScale(this.scale);
    })();
  }

  // Container width changes via the panel splitters, not window resize.
  notifyContainerResized(): void {
    if (!this.doc) return;
    if (this.fitWidth) this.setScale(this.computeFitWidth(), true);
    else this.scheduleRender();
  }

  scrollToPage(n: number): void {
    const pv = this.pages[n - 1];
    if (!pv) return;
    this.container.scrollTop = pv.div.offsetTop - 16;
    this.scheduleRender();
  }

  nextPage(): void {
    this.scrollToPage(this.currentPage + 1);
  }

  prevPage(): void {
    this.scrollToPage(this.currentPage - 1);
  }

  async getOutline(): Promise<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>> {
    if (!this.doc) return [];
    try {
      return (await this.doc.getOutline()) ?? [];
    } catch {
      return [];
    }
  }

  // Returns false when the destination cannot be resolved (missing named
  // target, external link) so the UI can tell the document issue from ours.
  async goToDest(dest: string | readonly unknown[] | null): Promise<boolean> {
    if (!this.doc) return false;
    let d = dest;
    if (typeof d === "string") {
      try {
        d = await this.doc.getDestination(d);
      } catch (err) {
        console.error("outline dest resolution failed", err);
        return false;
      }
    }
    if (!Array.isArray(d) || d.length === 0) return false;
    if (typeof d[0] === "number") {
      // some producers write a 0-based page number instead of a page reference
      this.scrollToPage(Math.max(1, d[0] + 1));
      return true;
    }
    try {
      const index = await this.doc.getPageIndex(d[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
      this.scrollToPage(index + 1);
      return true;
    } catch (err) {
      console.error("outline jump failed", err);
      return false;
    }
  }

  async getPageText(n: number): Promise<string> {
    const pv = this.pages[n - 1];
    if (!pv) return "";
    if (!pv.rendered && this.doc) {
      await this.ensureTextItems(pv);
      if (!pv.rendered) await this.ensureRendered(pv);
    }
    return pv.text;
  }

  // Collected text of the first `maxPages` pages, per-page capped, joined
  // with page markers — the context payload for whole-document AI actions.
  async getDocText(maxPages: number, capChars: number): Promise<{ pages: number; text: string }> {
    if (!this.doc) return { pages: 0, text: "" };
    const n = Math.min(this.doc.numPages, maxPages);
    const parts: string[] = [];
    let used = 0;
    for (let i = 1; i <= n; i++) {
      const text = (await this.getPageText(i)).trim();
      if (!text) continue;
      const slice = text.length > 3000 ? `${text.slice(0, 3000)}…` : text;
      parts.push(`--- 第 ${i} 页 ---\n${slice}`);
      used += slice.length;
      if (used >= capChars) break;
    }
    return { pages: n, text: parts.join("\n\n") };
  }

  /* ---------- split view ---------- */

  // The split pane mirrors the main scroll with its own scroll container.
  attachSplit(pane: HTMLElement, inner: HTMLElement, syncScroll: () => void): void {
    this.splitPane = pane;
    void inner;
    this.splitSync = syncScroll;
    // caller owns pane contents (the inner container is already attached)
    this.splitViews.clear();
    for (const pv of this.pages) {
      const div = document.createElement("div");
      div.className = "page-view";
      const canvas = document.createElement("canvas");
      div.append(canvas);
      inner.append(div);
      this.splitViews.set(pv.index + 1, { div, canvas, rendered: false });
    }
    this.renderSplitVisible();
  }

  detachSplit(): void {
    if (this.splitPane) this.splitPane.innerHTML = "";
    this.splitPane = null;
    this.splitSync = null;
    this.splitViews.clear();
  }

  hasSplit(): boolean {
    return this.splitPane !== null;
  }

  scrollToSplitRatio(ratio: number): void {
    if (!this.splitPane) return;
    const span = this.splitPane.scrollHeight - this.splitPane.clientHeight;
    this.splitPane.scrollTop = Math.max(0, ratio * span);
  }

  private renderSplitVisible(): void {
    if (!this.splitPane || !this.doc) return;
    const top = this.splitPane.scrollTop;
    const bottom = top + this.splitPane.clientHeight;
    const width = this.splitPane.clientWidth - 64;
    for (const pv of this.pages) {
      const view = this.splitViews.get(pv.index + 1);
      if (!view) continue;
      const scale = width / pv.width;
      view.div.style.width = `${Math.floor(pv.width * scale)}px`;
      view.div.style.height = `${Math.floor(pv.height * scale)}px`;
      const pTop = view.div.offsetTop;
      const pBottom = pTop + view.div.offsetHeight;
      const inRange = pBottom >= top - 800 && pTop <= bottom + 800;
      if (inRange && !view.rendered) {
        view.rendered = true;
        void this.doc.getPage(pv.index + 1).then((page) => {
          const viewport = page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          view.canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
          view.canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
          view.canvas.style.width = `${Math.floor(viewport.width)}px`;
          view.canvas.style.height = `${Math.floor(viewport.height)}px`;
          const ctx = view.canvas.getContext("2d");
          if (!ctx) return;
          const transform = dpr === 1 ? undefined : ([dpr, 0, 0, dpr, 0, 0] as [number, number, number, number, number, number]);
          return page.render({ canvasContext: ctx, viewport, transform }).promise;
        }).catch(() => {
          view.rendered = false;
        });
      }
    }
  }

  /* ---------- user bookmarks ---------- */

  getBookmarks(): Bookmark[] {
    return [...this.bookmarks].sort((a, b) => a.page - b.page || a.created - b.created);
  }

  toggleBookmark(): "added" | "removed" {
    const page = this.currentPage;
    const existing = this.bookmarks.find((b) => b.page === page);
    if (existing) {
      this.bookmarks = this.bookmarks.filter((b) => b !== existing);
      return "removed";
    }
    this.bookmarks.push({ page, label: `第 ${page} 页`, created: Math.floor(Date.now() / 1000) });
    return "added";
  }

  removeBookmark(page: number): void {
    this.bookmarks = this.bookmarks.filter((b) => b.page !== page);
  }

  isBookmarked(page: number): boolean {
    return this.bookmarks.some((b) => b.page === page);
  }

  /* ---------- form fields (AcroForm) ---------- */

  // Values live in pdf.js annotation storage; re-rendering affected pages
  // draws them onto the canvas.
  setFormValue(name: string, value: string | boolean): void {
    if (!this.doc) return;
    this.doc.annotationStorage.setValue(name, value);
    void this.rerenderFormPages(name);
  }

  private async rerenderFormPages(name: string): Promise<void> {
    if (!this.doc) return;
    for (const pv of this.pages) {
      const page = await this.doc.getPage(pv.index + 1);
      const annots = await page.getAnnotations({ intent: "display" });
      if (annots.some((a) => (a as { fieldName?: string }).fieldName === name)) {
        pv.renderTask?.cancel();
        pv.rendered = false;
        pv.rendering = false;
        this.unrender(pv);
        void this.ensureRendered(pv);
      }
    }
  }

  async collectFormFields(): Promise<Array<{ name: string; type: string; page: number }>> {
    if (!this.doc) return [];
    const out: Array<{ name: string; type: string; page: number }> = [];
    const seen = new Set<string>();
    for (const pv of this.pages.slice(0, 100)) {
      const page = await this.doc.getPage(pv.index + 1);
      const annots = await page.getAnnotations({ intent: "display" });
      for (const a of annots) {
        const w = a as { subtype?: string; fieldName?: string; fieldType?: string };
        if (w.subtype !== "Widget" || !w.fieldName || seen.has(w.fieldName)) continue;
        seen.add(w.fieldName);
        out.push({ name: w.fieldName, type: w.fieldType ?? "", page: pv.index + 1 });
      }
    }
    return out;
  }

  /* ---------- password ---------- */

  hasPendingPassword(): boolean {
    return this.pendingPasswordCallback !== null;
  }

  submitPassword(password: string): boolean {
    const callback = this.pendingPasswordCallback;
    if (!callback) return false;
    this.pendingPasswordCallback = null;
    this.password = password;
    callback(password);
    return true;
  }

  // Prime the password used by the next open() call (retry path).
  setPassword(password: string): void {
    this.password = password;
  }

  /* ---------- link layer ---------- */

  // Click-through for in-document GoTo links and external URLs. Rects live
  // on top of the text layer, so text selection still wins.
  private linkLayerHit(clientX: number, clientY: number): void {
    for (const pv of this.pages) {
      const rect = pv.div.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const x = (clientX - rect.left) / this.scale;
      const y = (clientY - rect.top) / this.scale;
      void this.doc?.getPage(pv.index + 1).then((page) => {
        const annotations = page.getAnnotations({ intent: "display" });
        return annotations.then((items) => {
          for (const item of items) {
            if (!item.rect || item.rect.length < 4) continue;
            const [x1, y1] = pdfjs.Util.applyTransform(
              [item.rect[0], item.rect[1]],
              page.getViewport({ scale: this.scale })
            );
            const [x2, y2] = pdfjs.Util.applyTransform(
              [item.rect[2], item.rect[3]],
              page.getViewport({ scale: this.scale })
            );
            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            const top = Math.min(y1, y2);
            const bottom = Math.max(y1, y2);
            if (x < left || x > right || y < top || y > bottom) continue;
            if (item.url) {
              this.events.onLink?.(item.url);
              return;
            }
            if (item.dest) {
              void this.goToDest(item.dest);
              return;
            }
          }
        });
      });
    }
  }

  /* ---------- annotations ---------- */

  setAnnotations(list: Annotation[]): void {
    this.annotations = list;
    this.redrawOverlay();
  }

  setBookmarks(list: Bookmark[]): void {
    this.bookmarks = list;
  }

  hasAnnotations(page: number): boolean {
    return this.annotations.some((a) => a.page === page);
  }

  // Converts the current text-layer selection into page-space rectangles.
  selectionAnnotation(): { page: number; rects: Array<{ x: number; y: number; width: number; height: number }> } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    let pageDiv: HTMLElement | null = null;
    while (node) {
      if (node instanceof HTMLElement && node.classList.contains("page-view")) {
        pageDiv = node;
        break;
      }
      node = node.parentNode;
    }
    if (!pageDiv) return null;
    const pv = this.pages.find((p) => p.div === pageDiv);
    if (!pv) return null;
    const pageRect = pageDiv.getBoundingClientRect();
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 2) continue;
      rects.push({
        x: (r.left - pageRect.left) / this.scale,
        y: (r.top - pageRect.top) / this.scale,
        width: r.width / this.scale,
        height: r.height / this.scale,
      });
    }
    if (rects.length === 0) return null;
    return { page: pv.index + 1, rects };
  }

  // Hit-tests a viewport point against annotation rects; returns the
  // annotation object identity passed to setAnnotations.
  annotationAt(clientX: number, clientY: number): Annotation | null {
    for (const pv of this.pages) {
      const rect = pv.div.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const px = (clientX - rect.left) / this.scale;
      const py = (clientY - rect.top) / this.scale;
      for (const a of this.annotations) {
        if (a.page !== pv.index + 1) continue;
        for (const r of a.rects) {
          if (px >= r.x - 1 && px <= r.x + r.width + 1 && py >= r.y - 1 && py <= r.y + r.height + 1) {
            return a;
          }
        }
      }
    }
    return null;
  }

  async scrollToAnnotation(a: Annotation): Promise<void> {
    const pv = this.pages[a.page - 1];
    if (!pv) return;
    const r = a.rects[0];
    if (!r) {
      this.scrollToPage(a.page);
      return;
    }
    if (!pv.rendered && this.doc) await this.ensureRendered(pv);
    this.container.scrollTop = pv.div.offsetTop + r.y * this.scale - this.container.clientHeight / 3;
    this.scheduleRender();
  }

  /* ---------- search ---------- */

  // Progressive whole-document search, starting from the current page.
  // Reports the running hit count; draws overlays on rendered pages.
  async runSearch(query: string, onCount: (found: number, done: boolean) => void): Promise<void> {
    const token = ++this.searchToken;
    this.clearSearch();
    const needle = query.trim().toLowerCase();
    if (!needle || !this.doc) {
      onCount(0, true);
      return;
    }
    const total = this.doc.numPages;
    const order: number[] = [];
    for (let offset = 0; offset < total; offset++) {
      order.push((((this.currentPage - 1 + offset) % total) + total) % total);
    }
    let first = true;
    for (const pageIndex of order) {
      if (this.searchToken !== token) return; // superseded
      const pv = this.pages[pageIndex];
      if (!pv) continue;
      const items = (await this.ensureTextItems(pv)).items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!("str" in item)) continue;
        const haystack = item.str.toLowerCase();
        let start = haystack.indexOf(needle);
        while (start !== -1) {
          this.hits.push({ page: pageIndex + 1, itemIndex: i, charStart: start, length: needle.length });
          start = haystack.indexOf(needle, start + needle.length);
        }
      }
      if (pv.rendered && (this.hasPageHits(pv.index + 1) || this.hasAnnotations(pv.index + 1))) this.drawOverlay(pv);
      onCount(this.hits.length, false);
      if (first && this.hits.length > 0) {
        first = false;
        this.setActiveHit(0);
      }
    }
    if (this.searchToken !== token) return;
    onCount(this.hits.length, true);
  }

  hasPageHits(page: number): boolean {
    return this.hits.some((h) => h.page === page);
  }

  getHitCount(): number {
    return this.hits.length;
  }

  getActiveHitIndex(): number {
    return this.activeHit;
  }

  async nextHit(): Promise<void> {
    if (this.hits.length === 0) return;
    await this.setActiveHit((this.activeHit + 1) % this.hits.length);
  }

  async prevHit(): Promise<void> {
    if (this.hits.length === 0) return;
    await this.setActiveHit((this.activeHit - 1 + this.hits.length) % this.hits.length);
  }

  async setActiveHit(index: number): Promise<void> {
    this.activeHit = index;
    const hit = this.hits[index];
    if (!hit) return;
    const pv = this.pages[hit.page - 1];
    if (!pv) return;
    if (!pv.rendered) {
      this.scrollToPage(hit.page);
      await this.ensureRendered(pv);
    }
    const rect = await this.hitRect(pv, hit);
    if (rect) {
      const target = pv.div.offsetTop + rect.top - this.container.clientHeight / 3;
      this.container.scrollTop = Math.max(0, target);
    }
    await this.drawOverlay(pv);
  }

  clearSearch(): void {
    this.hits = [];
    this.activeHit = -1;
    for (const pv of this.pages) this.clearHighlights(pv);
  }

  private clearHighlights(pv: PageView): void {
    pv.highlightLayer.innerHTML = "";
  }

  redrawOverlay(): void {
    for (const pv of this.pages) {
      if (pv.rendered && (this.hasPageHits(pv.index + 1) || this.hasAnnotations(pv.index + 1))) {
        void this.drawOverlay(pv);
      }
    }
  }

  // Screenspace rect of a hit at the current scale. Sub-item position is
  // estimated with uniform character width — good enough for highlights.
  private async hitRect(pv: PageView, hit: SearchHit): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const item = pv.textContent?.items[hit.itemIndex];
    if (!item || !("str" in item) || !this.doc) return null;
    const page = await this.doc.getPage(pv.index + 1);
    const viewport = this.viewportFor(page, this.scale);
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const charW = (item.width * viewport.scale) / Math.max(item.str.length, 1);
    return {
      left: tx[4] + charW * hit.charStart,
      top: tx[5] - fontHeight,
      width: charW * hit.length,
      height: fontHeight * 1.15,
    };
  }

  private async drawOverlay(pv: PageView): Promise<void> {
    this.clearHighlights(pv);
    // annotations first (bottom), search hits on top
    for (const a of this.annotations) {
      if (a.page !== pv.index + 1) continue;
      for (const r of a.rects) {
        const div = document.createElement("div");
        div.className = `anno anno-${a.color}`;
        if (a.kind === "underline") {
          div.style.left = `${r.x * this.scale}px`;
          div.style.top = `${(r.y + r.height) * this.scale - 2}px`;
          div.style.width = `${r.width * this.scale}px`;
          div.style.height = "2.5px";
          div.style.background = "currentColor";
          div.style.color = "rgb(47, 111, 237)";
        } else if (a.kind === "strike") {
          div.style.left = `${r.x * this.scale}px`;
          div.style.top = `${(r.y + r.height / 2) * this.scale - 1.5}px`;
          div.style.width = `${r.width * this.scale}px`;
          div.style.height = "2.5px";
          div.style.background = "rgb(214, 69, 105)";
        } else {
          div.style.left = `${r.x * this.scale}px`;
          div.style.top = `${r.y * this.scale}px`;
          div.style.width = `${r.width * this.scale}px`;
          div.style.height = `${r.height * this.scale}px`;
        }
        pv.highlightLayer.append(div);
      }
    }
    for (let i = 0; i < this.hits.length; i++) {
      const hit = this.hits[i];
      if (hit.page !== pv.index + 1) continue;
      const rect = await this.hitRect(pv, hit);
      if (!rect) continue;
      const div = document.createElement("div");
      div.className = i === this.activeHit ? "hit hit-active" : "hit";
      div.style.left = `${rect.left}px`;
      div.style.top = `${rect.top}px`;
      div.style.width = `${rect.width}px`;
      div.style.height = `${rect.height}px`;
      pv.highlightLayer.append(div);
    }
  }

  private async ensureTextItems(pv: PageView): Promise<TextContent> {
    if (pv.textContent) return pv.textContent;
    if (!this.doc) return { items: [], styles: {}, lang: null };
    const page = await this.doc.getPage(pv.index + 1);
    const content = await page.getTextContent();
    pv.textContent = content;
    pv.text = textFromItems(content.items);
    return content;
  }

  /* ---------- thumbnails ---------- */

  buildThumbnails(container: HTMLElement): void {
    this.teardownThumbs();
    if (!this.doc) return;
    container.innerHTML = "";
    this.thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const view = this.thumbs.find((t) => t.div === entry.target);
          if (view && !view.rendered) void this.renderThumb(view);
        }
      },
      { root: container, rootMargin: "200px" }
    );
    for (const pv of this.pages) {
      const div = document.createElement("div");
      div.className = "thumb";
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = Math.max(1, Math.floor((THUMB_WIDTH * pv.height) / pv.width));
      const label = document.createElement("span");
      label.className = "thumb-label";
      label.textContent = String(pv.index + 1);
      div.append(canvas, label);
      div.addEventListener("click", () => this.scrollToPage(pv.index + 1));
      container.append(div);
      const view: ThumbView = { page: pv.index + 1, div, canvas, rendered: false };
      this.thumbs.push(view);
      this.thumbObserver.observe(div);
    }
    this.updateActiveThumb();
  }

  private async renderThumb(view: ThumbView): Promise<void> {
    if (!this.doc) return;
    view.rendered = true; // mark early so the observer doesn't re-fire
    try {
      const page = await this.doc.getPage(view.page);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (THUMB_WIDTH / view.canvas.width) * dpr });
      const ctx = view.canvas.getContext("2d");
      if (!ctx) return;
      view.canvas.width = Math.floor(viewport.width);
      view.canvas.height = Math.floor(viewport.height);
      // the backing store is dpr-scaled; pin the CSS size to the panel width
      view.canvas.style.width = `${THUMB_WIDTH}px`;
      const transform = dpr === 1 ? undefined : ([dpr, 0, 0, dpr, 0, 0] as [number, number, number, number, number, number]);
      await page.render({ canvasContext: ctx, viewport, transform }).promise;
    } catch (err) {
      if (!isCancel(err)) console.error("thumb render failed", err);
    }
  }

  updateActiveThumb(): void {
    for (const view of this.thumbs) {
      view.div.classList.toggle("active", view.page === this.currentPage);
    }
  }

  scrollToThumb(): void {
    const view = this.thumbs[this.currentPage - 1];
    view?.div.scrollIntoView({ block: "nearest" });
  }

  private teardownThumbs(): void {
    this.thumbObserver?.disconnect();
    this.thumbObserver = null;
    this.thumbs = [];
  }

  /* ---------- rendering ---------- */

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderVisible();
      this.updateCurrentPage();
      this.renderSplitVisible();
      this.splitSync?.();
    });
  }

  private renderVisible(): void {
    if (this.pages.length === 0) return;
    const top = this.container.scrollTop;
    const bottom = top + this.container.clientHeight;
    for (const pv of this.pages) {
      const pTop = pv.div.offsetTop;
      const pBottom = pTop + pv.div.offsetHeight;
      if (pBottom >= top - MARGIN && pTop <= bottom + MARGIN) {
        void this.ensureRendered(pv);
      }
    }
    this.enforceMemoryCap(top, bottom);
  }

  private updateCurrentPage(): void {
    const line = this.container.scrollTop + this.container.clientHeight * 0.35;
    let current = Math.min(1, this.pages.length);
    for (let i = this.pages.length - 1; i >= 0; i--) {
      if (this.pages[i].div.offsetTop <= line) {
        current = i + 1;
        break;
      }
    }
    // in two-page view both pages of a row share offsetTop; report the row's
    // left page so the indicator doesn't jump to the right-hand page
    if (
      this.viewMode === "double" &&
      current > 1 &&
      this.pages[current - 2] &&
      this.pages[current - 2].div.offsetTop === this.pages[current - 1].div.offsetTop
    ) {
      current -= 1;
    }
    if (current !== this.currentPage) {
      this.currentPage = current;
      this.events.onPageChange?.(current);
    }
  }

  private async ensureRendered(pv: PageView): Promise<void> {
    if (pv.rendered || pv.rendering || !this.doc) return;
    pv.rendering = true;
    try {
      const page = await this.doc.getPage(pv.index + 1);
      const viewport = this.viewportFor(page, this.scale);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pv.canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      pv.canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      pv.canvas.style.width = `${Math.floor(viewport.width)}px`;
      pv.canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = pv.canvas.getContext("2d");
      if (!ctx) return;
      const transform =
        dpr === 1 ? undefined : ([dpr, 0, 0, dpr, 0, 0] as [number, number, number, number, number, number]);
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform,
        annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
      });
      pv.renderTask = task;
      try {
        await task.promise;
      } catch (err) {
        if (!isCancel(err)) console.error("page render failed", err);
        return;
      } finally {
        pv.renderTask = null;
      }

      await this.ensureTextItems(pv);
      await this.renderTextLayer(pv, viewport);
      if (this.hasPageHits(pv.index + 1) || this.hasAnnotations(pv.index + 1)) await this.drawOverlay(pv);
      pv.rendered = true;
    } catch (err) {
      if (!isCancel(err)) console.error("page load failed", err);
    } finally {
      pv.rendering = false;
    }
  }

  private async renderTextLayer(
    pv: PageView,
    viewport: pdfjs.PageViewport
  ): Promise<void> {
    pv.textLayerDiv.innerHTML = "";
    if (!pv.textContent) return;
    pv.div.style.setProperty("--scale-factor", String(viewport.scale));
    const layer = new pdfjs.TextLayer({
      textContentSource: pv.textContent,
      container: pv.textLayerDiv,
      viewport,
    });
    await layer.render();
  }

  private unrender(pv: PageView): void {
    pv.rendered = false;
    pv.canvas.width = 0;
    pv.canvas.height = 0;
    pv.textLayerDiv.innerHTML = "";
    this.clearHighlights(pv);
  }

  private enforceMemoryCap(top: number, bottom: number): void {
    const rendered = this.pages.filter((p) => p.rendered);
    if (rendered.length <= RENDERED_CAP) return;
    const center = (top + bottom) / 2;
    const farthest = rendered
      .map((p) => ({ p, dist: Math.abs(p.div.offsetTop + p.div.offsetHeight / 2 - center) }))
      .sort((a, b) => b.dist - a.dist);
    for (const { p } of farthest.slice(0, rendered.length - RENDERED_CAP)) {
      this.unrender(p);
    }
  }
}

