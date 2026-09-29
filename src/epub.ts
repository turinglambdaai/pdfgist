import { unzipSync } from "fflate";
import type { Annotation } from "./types";

export interface EpubTocItem {
  title: string;
  chapter: number; // 1-based spine index
  level: number;
}

export interface EpubHit {
  chapter: number;
  ordinal: number;
  excerpt: string;
}

export interface EpubEvents {
  onDocLoaded?: (info: { pages: number; title: string }) => void;
  onPageChange?: (chapter: number) => void;
  onZoom?: (scale: number) => void;
}

const READING_CSS = `
  :root[data-theme="light"] { --fg: #292524; }
  :root[data-theme="dark"] { --fg: #D6D3D1; }
  html { background: transparent; }
  body {
    margin: 0;
    padding: 0;
    color: var(--fg, #292524);
    font-family: "Georgia", "Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif;
    font-size: calc(16px * var(--fs, 1));
    line-height: 1.9;
  }
  p { margin: 0 0 1em; text-align: justify; }
  h1, h2, h3, h4 { line-height: 1.35; margin: 1.4em 0 0.6em; }
  img, svg { max-width: 100%; height: auto; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #8884; }
  a { color: inherit; pointer-events: none; }
  mark.search-hit { background: rgba(255, 196, 0, 0.55); color: inherit; }
`;

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function joinZip(baseDir: string, href: string): string {
  const parts = (baseDir ? `${baseDir}/` : "").split("/").filter(Boolean);
  for (const seg of decodeURIComponent(href).split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// Walks text nodes and wraps the nth occurrence of `query` in a mark.
function markOccurrence(root: ParentNode, query: string, ordinal: number): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const lower = query.toLowerCase();
  let count = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    const lowerText = text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lowerText.indexOf(lower, from);
      if (at === -1) break;
      if (count === ordinal) {
        const mark = document.createElement("mark");
        mark.className = "search-hit";
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + query.length);
        range.surroundContents(mark);
        mark.scrollIntoView({ block: "center" });
        return true;
      }
      count += 1;
      from = at + query.length;
    }
    node = walker.nextNode();
  }
  return false;
}

function clearMarks(root: ParentNode): void {
  root.querySelectorAll("mark.search-hit").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
}

/**
 * Minimal EPUB engine: unzips the container, renders each spine document in
 * a sandboxed same-origin iframe (book scripts stripped, typography ours),
 * and exposes the same surface the app expects from a reader engine —
 * outline (TOC), whole-book search with in-place marks, font-size zoom,
 * theme, chapter text for AI features.
 */
export class EpubViewer {
  private container: HTMLElement;
  private viewer: HTMLElement;
  private zip: Record<string, Uint8Array> | null = null;
  private opfDir = "";
  private spine: string[] = [];
  private docs: Document[] = [];
  private frames: HTMLIFrameElement[] = [];
  private loaded: Promise<void>[] = [];
  private toc: EpubTocItem[] = [];
  private bookTitle = "";
  private fontScale = 1;
  private currentChapter = 1;
  private theme: "light" | "dark" = "light";
  private hits: EpubHit[] = [];
  private activeHit = -1;
  private lastQuery = "";
  private blobUrls: string[] = [];
  events: EpubEvents = {};

  constructor(container: HTMLElement, viewer: HTMLElement) {
    this.container = container;
    this.viewer = viewer;
    container.addEventListener("scroll", () => this.updateCurrentChapter());
  }

  get isOpen(): boolean {
    return this.zip !== null;
  }

  getDocPages(): number {
    return this.spine.length;
  }

  currentPageNumber(): number {
    return this.currentChapter;
  }

  getScale(): number {
    return this.fontScale;
  }

  async open(data: ArrayBuffer, title: string): Promise<void> {
    this.close();
    this.zip = unzipSync(new Uint8Array(data));
    const parser = new DOMParser();
    const decode = (path: string): string => {
      const bytes = this.findByPath(path);
      return new TextDecoder().decode(bytes);
    };

    const containerDoc = parser.parseFromString(decode("META-INF/container.xml"), "application/xml");
    const opfPath =
      [...containerDoc.getElementsByTagName("*")].find((n) => n.localName === "rootfile")?.getAttribute("full-path") ??
      "content.opf";
    this.opfDir = dirOf(opfPath);
    const opfDoc = parser.parseFromString(decode(opfPath), "application/xml");

    const metadata = [...opfDoc.getElementsByTagName("*")].find((n) => n.localName === "title");
    this.bookTitle = metadata?.textContent?.trim() || title;

    const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
    const spineOrder: string[] = [];
    for (const n of opfDoc.getElementsByTagName("*")) {
      if (n.localName === "item") {
        manifest.set(n.getAttribute("id") ?? "", {
          href: n.getAttribute("href") ?? "",
          mediaType: n.getAttribute("media-type") ?? "",
          properties: n.getAttribute("properties") ?? "",
        });
      } else if (n.localName === "itemref") {
        spineOrder.push(n.getAttribute("idref") ?? "");
      }
    }
    for (const id of spineOrder) {
      const item = manifest.get(id);
      if (item && (item.mediaType === "application/xhtml+xml" || item.mediaType === "text/html")) {
        this.spine.push(joinZip(this.opfDir, item.href));
      }
    }

    const navItem = [...manifest.values()].find((i) => i.properties.includes("nav"));
    if (navItem) this.parseNav(joinZip(this.opfDir, navItem.href));
    if (this.toc.length === 0) {
      const ncxItem = [...manifest.values()].find((i) => i.mediaType === "application/x-dtbncx+xml");
      if (ncxItem) this.parseNcx(joinZip(this.opfDir, ncxItem.href));
    }

    this.viewer.innerHTML = "";
    this.frames = [];
    this.docs = [];
    const banner = document.createElement("div");
    banner.className = "epub-title";
    banner.append(Object.assign(document.createElement("div"), { className: "epub-book-title", textContent: this.bookTitle }));
    this.viewer.append(banner);
    for (const path of this.spine) this.buildChapter(path, parser);
    this.applyThemeToChapters();
    this.container.scrollTop = 0;
    this.events.onDocLoaded?.({ pages: this.spine.length, title });
  }

  close(): void {
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    this.zip = null;
    this.spine = [];
    this.docs = [];
    this.frames = [];
    this.loaded = [];
    this.toc = [];
    this.hits = [];
    this.activeHit = -1;
    this.currentChapter = 1;
    this.viewer.innerHTML = "";
  }

  private findByPath(path: string): Uint8Array {
    const direct = this.zip?.[path];
    if (direct) return direct;
    // some epubs ship unencoded hrefs; fall back to a suffix match
    const suffix = path.split("/").pop() ?? path;
    for (const key of Object.keys(this.zip ?? {})) {
      if (key.endsWith(suffix)) return this.zip![key];
    }
    throw new Error(`EPUB 缺少文件：${path}`);
  }

  private parseNav(path: string): void {
    const doc = new DOMParser().parseFromString(this.decode2(path), "application/xml");
    let level = 0;
    const walk = (parent: Element): void => {
      level += 1;
      for (const li of [...parent.children].filter((c) => c.localName === "li")) {
        const a = [...li.children].find((c) => c.localName === "a");
        const nested = [...li.children].find((c) => c.localName === "ol");
        if (a) {
          const href = a.getAttribute("href") ?? "";
          const chapter = this.spine.findIndex((s) => s.endsWith(dirOf2(joinZip(this.opfDir, href))));
          if (chapter !== -1) this.toc.push({ title: a.textContent?.trim() ?? "", chapter: chapter + 1, level });
        }
        if (nested) walk(nested);
      }
      level -= 1;
    };
    const nav = [...doc.getElementsByTagName("*")].find((n) => n.localName === "nav");
    const ol = nav ? [...nav.children].find((c) => c.localName === "ol") : null;
    if (ol) walk(ol);
  }

  private parseNcx(path: string): void {
    const doc = new DOMParser().parseFromString(this.decode2(path), "application/xml");
    const walk = (parent: Element, level: number): void => {
      for (const point of [...parent.children].filter((c) => c.localName === "navPoint")) {
        const label = [...point.children].find((c) => c.localName === "navLabel")?.textContent?.trim() ?? "";
        const content = [...point.children].find((c) => c.localName === "content");
        const src = content?.getAttribute("src") ?? "";
        const chapter = this.spine.findIndex((s) => s.endsWith(dirOf2(joinZip(this.opfDir, src))));
        if (label && chapter !== -1) this.toc.push({ title: label, chapter: chapter + 1, level });
        walk(point, level + 1);
      }
    };
    const navMap = [...doc.getElementsByTagName("*")].find((n) => n.localName === "navMap");
    if (navMap) walk(navMap, 0);
  }

  private decode2(path: string): string {
    return new TextDecoder().decode(this.findByPath(path));
  }

  private parseChapter(path: string): Document {
    const doc = new DOMParser().parseFromString(this.decode2(path), "text/html");
    doc.querySelectorAll("script, link[rel='stylesheet'], style").forEach((n) => n.remove());
    const chapterDir = dirOf(path);
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (!src || /^(https?:|data:|blob:)/.test(src)) continue;
      try {
        const bytes = this.findByPath(joinZip(chapterDir, src));
        const url = URL.createObjectURL(new Blob([bytes.slice() as BlobPart]));
        this.blobUrls.push(url);
        img.setAttribute("src", url);
      } catch {
        img.remove();
      }
    }
    return doc;
  }

  private buildChapter(path: string, parser: DOMParser): void {
    const index = this.frames.length;
    const doc = this.parseChapter(path);
    this.docs.push(doc);
    const chapterTitle =
      [...doc.body.querySelectorAll("h1,h2,h3")][0]?.textContent?.trim() ?? `第 ${index + 1} 章`;

    const iframe = document.createElement("iframe");
    iframe.className = "epub-chapter";
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.title = chapterTitle;
    this.viewer.append(iframe);
    this.frames.push(iframe);

    const head = `<meta charset="utf-8"><style>${READING_CSS}</style>`;
    const srcdoc = `<!doctype html><html data-theme="${this.theme}" style="--fs: ${this.fontScale}"><head>${head}</head><body>${doc.body.innerHTML}</body></html>`;
    const loaded = new Promise<void>((resolve) => {
      iframe.addEventListener(
        "load",
        () => {
          this.fitFrame(iframe);
          resolve();
        },
        { once: true }
      );
    });
    this.loaded.push(loaded);
    iframe.srcdoc = srcdoc;
    void parser;
  }

  private fitFrame(iframe: HTMLIFrameElement): void {
    const doc = iframe.contentDocument;
    if (!doc) return;
    iframe.style.height = `${Math.max(doc.documentElement.scrollHeight, 80)}px`;
  }

  private refitAll(): void {
    for (const iframe of this.frames) this.fitFrame(iframe);
    this.updateCurrentChapter();
  }

  private applyThemeToChapters(): void {
    for (const iframe of this.frames) {
      iframe.contentDocument?.documentElement.setAttribute("data-theme", this.theme);
    }
  }

  setTheme(theme: "light" | "dark"): void {
    this.theme = theme;
    this.applyThemeToChapters();
  }

  zoomIn(): void {
    this.setFontScale(Math.min(2, this.fontScale * 1.1));
  }

  zoomOut(): void {
    this.setFontScale(Math.max(0.7, this.fontScale / 1.1));
  }

  zoomReset(): void {
    this.setFontScale(1);
  }

  private setFontScale(scale: number): void {
    this.fontScale = scale;
    for (const iframe of this.frames) {
      iframe.contentDocument?.documentElement.style.setProperty("--fs", String(scale));
    }
    requestAnimationFrame(() => this.refitAll());
    this.events.onZoom?.(scale);
  }

  fitToWidth(): void {
    /* reflowable text — nothing to fit */
  }

  setViewMode(_mode: "single" | "double"): void {
    /* EPUB is always single-column */
  }

  scrollToPage(chapter: number): void {
    const frame = this.frames[chapter - 1];
    if (frame) this.container.scrollTop = frame.offsetTop - 12;
  }

  nextPage(): void {
    this.scrollToPage(this.currentChapter + 1);
  }

  prevPage(): void {
    this.scrollToPage(this.currentChapter - 1);
  }

  scrollToAnnotation(_a: Annotation): void {
    /* EPUB highlights are not supported yet */
  }

  notifyContainerResized(): void {
    requestAnimationFrame(() => this.refitAll());
  }

  getToc(): EpubTocItem[] {
    return this.toc;
  }

  getPageText(chapter: number): string {
    const doc = this.docs[chapter - 1];
    if (!doc) return "";
    return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").trim();
  }

  async getDocText(maxChapters: number, capChars: number): Promise<{ pages: number; text: string }> {
    const n = Math.min(this.spine.length, maxChapters);
    const parts: string[] = [];
    let used = 0;
    for (let i = 1; i <= n; i++) {
      const text = this.getPageText(i);
      if (!text) continue;
      const slice = text.length > 3000 ? `${text.slice(0, 3000)}…` : text;
      parts.push(`--- 第 ${i} 章 ---\n${slice}`);
      used += slice.length;
      if (used >= capChars) break;
    }
    return { pages: n, text: parts.join("\n\n") };
  }

  /* ---------- search ---------- */

  async runSearch(query: string, onCount: (found: number, done: boolean) => void): Promise<void> {
    this.clearSearch();
    const needle = query.trim().toLowerCase();
    if (!needle || !this.zip) {
      onCount(0, true);
      return;
    }
    this.lastQuery = query.trim();
    for (let i = 0; i < this.docs.length; i++) {
      const text = (this.docs[i].body.textContent ?? "").toLowerCase();
      let from = 0;
      let ordinal = 0;
      for (;;) {
        const at = text.indexOf(needle, from);
        if (at === -1) break;
        const excerpt = (this.docs[i].body.textContent ?? "").slice(Math.max(0, at - 32), at + needle.length + 48);
        this.hits.push({ chapter: i + 1, ordinal, excerpt });
        ordinal += 1;
        from = at + needle.length;
      }
      if (ordinal > 0) onCount(this.hits.length, false);
    }
    if (this.hits.length > 0) await this.gotoHit(0);
    onCount(this.hits.length, true);
  }

  getHitCount(): number {
    return this.hits.length;
  }

  getActiveHitIndex(): number {
    return this.activeHit;
  }

  async nextHit(): Promise<void> {
    if (this.hits.length === 0) return;
    this.activeHit = (this.activeHit + 1) % this.hits.length;
    await this.gotoHit(this.activeHit);
  }

  async prevHit(): Promise<void> {
    if (this.hits.length === 0) return;
    this.activeHit = (this.activeHit - 1 + this.hits.length) % this.hits.length;
    await this.gotoHit(this.activeHit);
  }

  private async gotoHit(index: number): Promise<void> {
    const hit = this.hits[index];
    if (!hit) return;
    this.activeHit = index;
    await this.loaded[hit.chapter - 1];
    const frame = this.frames[hit.chapter - 1];
    const doc = frame?.contentDocument;
    if (!doc) return;
    for (const chapterDoc of this.frames.map((f) => f.contentDocument)) {
      if (chapterDoc) clearMarks(chapterDoc.body);
    }
    markOccurrence(doc.body, this.lastQuery, hit.ordinal);
  }

  clearSearch(): void {
    this.hits = [];
    this.activeHit = -1;
    for (const frame of this.frames) {
      const doc = frame.contentDocument;
      if (doc) clearMarks(doc.body);
    }
  }

  /* ---------- compatibility no-ops (PDF-only features) ---------- */

  updateActiveThumb(): void {}

  scrollToThumb(): void {}

  setAnnotations(_list: Annotation[]): void {}

  selectionAnnotation(): null {
    return null;
  }

  annotationAt(_x: number, _y: number): null {
    return null;
  }

  /* ---------- internal ---------- */

  private updateCurrentChapter(): void {
    const line = this.container.scrollTop + this.container.clientHeight * 0.35;
    let current = Math.min(1, this.frames.length);
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].offsetTop <= line) {
        current = i + 1;
        break;
      }
    }
    if (current !== this.currentChapter) {
      this.currentChapter = current;
      this.events.onPageChange?.(current);
    }
  }
}

function dirOf2(path: string): string {
  // chapter paths end with the file name; TOC hrefs may include anchors
  return path.split("#")[0];
}
