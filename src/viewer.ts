import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ViewerEvents {
  onPageChange?: (page: number) => void;
  onDocLoaded?: (info: { pages: number; title: string }) => void;
  onZoom?: (scale: number) => void;
}

interface PageView {
  index: number;
  div: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayerDiv: HTMLDivElement;
  width: number; // css px at scale 1
  height: number;
  rendered: boolean;
  rendering: boolean;
  renderTask: pdfjs.RenderTask | null;
  text: string;
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

export class PdfViewer {
  private container: HTMLElement;
  private viewer: HTMLElement;
  private doc: PDFDocumentProxy | null = null;
  private loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
  private pages: PageView[] = [];
  private scale = 1;
  private fitWidth = true;
  private currentPage = 1;
  private renderScheduled = false;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  events: ViewerEvents = {};

  constructor(container: HTMLElement, viewer: HTMLElement) {
    this.container = container;
    this.viewer = viewer;
    container.addEventListener("scroll", () => this.scheduleRender());
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
    });
    this.loadingTask = task;
    const doc = await task.promise;
    if (this.loadingTask !== task) {
      void task.destroy(); // another file was opened meanwhile
      return;
    }
    this.doc = doc;

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
      div.append(canvas, textLayerDiv);
      this.viewer.append(div);
      return {
        index: i,
        div,
        canvas,
        textLayerDiv,
        width: vp.width,
        height: vp.height,
        rendered: false,
        rendering: false,
        renderTask: null,
        text: "",
      } satisfies PageView;
    });

    this.setScale(this.computeFitWidth(), true);
    this.container.scrollTop = 0;
    this.events.onDocLoaded?.({ pages: doc.numPages, title });
  }

  close(): void {
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
    return (this.container.clientWidth - 64) / this.pages[0].width;
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

  async goToDest(dest: string | readonly unknown[] | null): Promise<void> {
    if (!this.doc) return;
    let d = dest;
    if (typeof d === "string") d = await this.doc.getDestination(d);
    if (!Array.isArray(d) || d.length === 0) return;
    try {
      const index = await this.doc.getPageIndex(d[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
      this.scrollToPage(index + 1);
    } catch {
      // unresolvable destination (e.g. remote goto) — ignore
    }
  }

  async getPageText(n: number): Promise<string> {
    const pv = this.pages[n - 1];
    if (!pv) return "";
    if (!pv.rendered && this.doc) await this.ensureRendered(pv);
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

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderVisible();
      this.updateCurrentPage();
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
      const viewport = page.getViewport({ scale: this.scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pv.canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      pv.canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      pv.canvas.style.width = `${Math.floor(viewport.width)}px`;
      pv.canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = pv.canvas.getContext("2d");
      if (!ctx) return;
      const transform =
        dpr === 1 ? undefined : ([dpr, 0, 0, dpr, 0, 0] as [number, number, number, number, number, number]);
      const task = page.render({ canvasContext: ctx, viewport, transform });
      pv.renderTask = task;
      try {
        await task.promise;
      } catch (err) {
        if (!isCancel(err)) console.error("page render failed", err);
        return;
      } finally {
        pv.renderTask = null;
      }

      const textContent = await page.getTextContent();
      pv.text = textFromItems(textContent.items);
      await this.renderTextLayer(pv, textContent, viewport);
      pv.rendered = true;
    } catch (err) {
      if (!isCancel(err)) console.error("page load failed", err);
    } finally {
      pv.rendering = false;
    }
  }

  private async renderTextLayer(
    pv: PageView,
    textContent: Awaited<ReturnType<pdfjs.PDFPageProxy["getTextContent"]>>,
    viewport: pdfjs.PageViewport
  ): Promise<void> {
    pv.textLayerDiv.innerHTML = "";
    pv.div.style.setProperty("--scale-factor", String(viewport.scale));
    const layer = new pdfjs.TextLayer({
      textContentSource: textContent,
      container: pv.textLayerDiv,
      viewport,
    });
    await layer.render();
  }

  private unrender(pv: PageView): void {
    pv.rendered = false;
    pv.text = "";
    pv.canvas.width = 0;
    pv.canvas.height = 0;
    pv.textLayerDiv.innerHTML = "";
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
