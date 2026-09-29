import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { el } from "./dom";
import { PdfViewer, PasswordRequiredError } from "./viewer";
import { EpubViewer } from "./epub";

type Engine = PdfViewer | EpubViewer;

function asPdf(e: Engine | null): PdfViewer | null {
  return e instanceof PdfViewer ? e : null;
}
import { currentSettings, ensureProviderConfigured, initSettings, saveSettings } from "./settings";
import type { Annotation, Bookmark, RecentFile } from "./types";
import { initSidebar, refreshAnnotations, switchTab, translateSelection } from "./sidebar";
import { initUpdater } from "./updater";
import { openUrl } from "@tauri-apps/plugin-opener";

interface ViewerTab {
  id: string;
  kind: "pdf" | "epub";
  engine: Engine;
  wrap: HTMLDivElement; // scroll container, one per tab
  inner: HTMLDivElement; // pages container
  title: string;
  path: string | null;
  pages: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
  annotations: Annotation[];
  bookmarks: Bookmark[];
  annoTimer: ReturnType<typeof setTimeout> | null;
  dataTimer: ReturnType<typeof setTimeout> | null;
  splitOn: boolean;
}

const tabs: ViewerTab[] = [];
let pendingSelection = "";
let activeTabId: string | null = null;
let tabSeq = 0;
let firstDocSeen = false;
let leftPanelTab: "thumbs" | "outline" = "thumbs";

const THEME_KEY = "pdfgist-theme";

/* ---------- bookmarks ---------- */

function renderBookmarks(pdf: PdfViewer | null): void {
  const list = el("bookmarks-list");
  list.innerHTML = "";
  if (!pdf || !pdf.isOpen) return;
  const items = pdf.getBookmarks();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.style.padding = "6px 8px";
    empty.textContent = "点工具栏书签图标收藏当前页";
    list.append(empty);
    return;
  }
  for (const b of items) {
    const item = document.createElement("div");
    item.className = "bookmark-item";
    const page = document.createElement("span");
    page.className = "page-no";
    page.textContent = `${b.page}`;
    const label = document.createElement("span");
    label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = b.label;
    const del = document.createElement("button");
    del.className = "card-btn";
    del.textContent = "删";
    del.title = "删除书签";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      pdf.removeBookmark(b.page);
      const tab = activeTab();
      if (tab) queueAnnotationSave(tab);
      renderBookmarks(pdf);
    });
    item.append(page, label, del);
    item.addEventListener("click", () => pdf.scrollToPage(b.page));
    list.append(item);
  }
}

function toggleBookmarkActive(): void {
  const tab = activeTab();
  const pdf = asPdf(activeViewer());
  if (!tab || !pdf?.isOpen) return;
  const result = pdf.toggleBookmark();
  tab.bookmarks = pdf.getBookmarks();
  el("btn-bookmark").classList.toggle("active", result === "added");
  queueAnnotationSave(tab);
  renderBookmarks(pdf);
}

/* ---------- split view ---------- */

function setSplit(on: boolean): void {
  const tab = activeTab();
  const pdf = asPdf(activeViewer());
  if (!tab || !pdf || !pdf.isOpen) return;
  tab.splitOn = on;
  el("btn-split").classList.toggle("active", on);
  const pane = el("split-pane");
  if (on) {
    pane.classList.remove("hidden");
    const inner = document.createElement("div");
    inner.className = "viewer-split";
    pane.innerHTML = "";
    pane.append(inner);
    pdf.attachSplit(pane, inner, () => {
      if (tab.splitOn) {
        const span = tab.wrap.scrollHeight - tab.wrap.clientHeight;
        const ratio = span > 0 ? Math.min(1, Math.max(0, tab.wrap.scrollTop / span)) : 0;
        pdf.scrollToSplitRatio(ratio);
      }
    });
    pdf.scrollToSplitRatio(
      tab.wrap.scrollTop / Math.max(tab.wrap.scrollHeight - tab.wrap.clientHeight, 1) || 0
    );
    el("doc-title").textContent = `SPLIT pane=${pane.clientWidth}x${pane.scrollHeight} kids=${pane.children.length} cls=${pane.className}`;
  } else {
    pdf.detachSplit();
    pane.classList.add("hidden");
    pane.innerHTML = "";
  }
}

/* ---------- password dialog ---------- */

function showPasswordDialog(wrong: boolean, onCancel: () => void, onOk: (pwd: string) => void): void {
  const dialog = el("password-dialog");
  const msg = el("pwd-msg");
  const input = el("pwd-input") as HTMLInputElement;
  msg.textContent = wrong ? "密码错误，请重试" : "请输入打开密码";
  msg.classList.toggle("error", wrong);
  input.value = "";
  dialog.classList.remove("hidden");
  input.focus();
  const close = (): void => {
    dialog.classList.add("hidden");
    el("pwd-ok").removeEventListener("click", onOkHandler);
    el("pwd-cancel").removeEventListener("click", onCancelHandler);
    input.removeEventListener("keydown", onKey);
  };
  const submit = (): void => {
    const value = input.value;
    if (!value) return;
    close();
    onOk(value);
  };
  const onOkHandler = (): void => submit();
  const onCancelHandler = (): void => {
    close();
    onCancel();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") onCancelHandler();
  };
  el("pwd-ok").addEventListener("click", onOkHandler);
  el("pwd-cancel").addEventListener("click", onCancelHandler);
  input.addEventListener("keydown", onKey);
}

function activeTab(): ViewerTab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

function activeViewer(): Engine | null {
  return activeTab()?.engine ?? null;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/* ---------- tab lifecycle ---------- */

function setToolbarEnabled(enabled: boolean): void {
  for (const id of [
    "btn-panel",
    "btn-prev",
    "btn-next",
    "btn-zoom-in",
    "btn-zoom-out",
    "btn-zoom-reset",
    "btn-fit",
    "btn-find",
    "btn-print",
    "btn-double",
    "btn-bookmark",
    "btn-split",
  ]) {
    (el(id) as HTMLButtonElement).disabled = !enabled;
  }
  (el("page-input") as HTMLInputElement).disabled = !enabled;
}

function renderTabbar(): void {
  const bar = el("tabbar");
  bar.classList.toggle("hidden", tabs.length === 0);
  const wrap = el("tabs");
  wrap.innerHTML = "";
  for (const tab of tabs) {
    const chip = document.createElement("div");
    chip.className = `tab-chip${tab.id === activeTabId ? " active" : ""}`;
    const title = document.createElement("span");
    title.className = "tab-chip-title";
    title.textContent = tab.title;
    const close = document.createElement("button");
    close.className = "tab-chip-close";
    close.textContent = "×";
    close.title = "关闭标签页（Ctrl+W）";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    chip.append(title, close);
    chip.title = tab.path ?? tab.title;
    chip.addEventListener("click", () => activateTab(tab.id));
    chip.addEventListener("auxclick", (e) => {
      if (e.button === 1) closeTab(tab.id);
    });
    wrap.append(chip);
  }
}

function activateTab(id: string): void {
  if (!tabs.some((t) => t.id === id)) return;
  activeTabId = id;
  for (const t of tabs) t.wrap.classList.toggle("active", t.id === id);
  renderTabbar();
  refreshChrome();
  closeFindbar();
  hideSelectionBar();
}

function closeTab(id: string): void {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  if (tab.saveTimer) clearTimeout(tab.saveTimer);
  if (tab.annoTimer) clearTimeout(tab.annoTimer);
  void saveDocumentData(tab);
  tab.engine.close();
  tab.wrap.remove();
  if (tabs.length === 0) {
    activeTabId = null;
    refreshChrome();
    return;
  }
  if (activeTabId === id) {
    activateTab(tabs[Math.min(index, tabs.length - 1)].id);
  } else {
    renderTabbar();
  }
}

function refreshChrome(): void {
  const tab = activeTab();
  const has = !!tab && tab.engine.isOpen;
  setToolbarEnabled(Boolean(has));
  el("empty-state").classList.toggle("hidden", tabs.length > 0);
  renderRecents();
  if (!tab) {
    el("doc-title").textContent = "";
    el("page-total").textContent = "–";
    el("doc-pages-info").textContent = "";
    (el("page-input") as HTMLInputElement).value = "–";
    return;
  }
  el("doc-title").textContent = tab.title;
  el("page-total").textContent = String(tab.pages || "–");
  el("doc-pages-info").textContent = tab.kind === "epub" ? `EPUB · ${tab.pages} 章` : `PDF · ${tab.pages} 页`;
  (el("page-input") as HTMLInputElement).value = tab.engine.currentPageNumber().toString();
  (el("btn-zoom-reset") as HTMLButtonElement).textContent = `${Math.round(tab.engine.getScale() * 100)}%`;
  tab.engine.updateActiveThumb();
  (el("btn-double") as HTMLButtonElement).disabled = tab.kind === "epub";
  (el("btn-print") as HTMLButtonElement).disabled = tab.kind === "epub";
  const pdf = asPdf(tab.engine);
  const bookmarked = pdf?.isBookmarked(tab.engine.currentPageNumber()) ?? false;
  el("btn-bookmark").classList.toggle("active", bookmarked);
  renderBookmarks(pdf);
  if (tab.kind === "pdf") {
    void buildOutline(asPdf(tab.engine));
    asPdf(tab.engine)?.buildThumbnails(el("thumbs-grid"));
    setThumbsTabEnabled(true);
  } else {
    el("outline-tree").innerHTML = "";
    buildEpubOutline(tab.engine as EpubViewer);
    el("thumbs-grid").innerHTML = "";
    setThumbsTabEnabled(false);
    if (leftPanelTab === "thumbs") showLeftPanel("outline");
  }
}

function setThumbsTabEnabled(enabled: boolean): void {
  (el("panel-tab-thumbs") as HTMLButtonElement).disabled = !enabled;
}

function buildEpubOutline(engine: EpubViewer): void {
  const tree = el("outline-tree");
  tree.innerHTML = "";
  const toc = engine.getToc();
  el("outline-empty").classList.toggle("hidden", toc.length > 0);
  for (const item of toc) {
    const node = document.createElement("div");
    node.className = "outline-item";
    node.style.paddingLeft = `${8 + item.level * 14}px`;
    node.textContent = item.title;
    node.addEventListener("click", () => engine.scrollToPage(item.chapter));
    tree.append(node);
  }
}

async function openPdfWithPassword(
  buf: ArrayBuffer,
  title: string,
  path: string | null,
  resume: RecentFile | null,
  wrong = false
): Promise<void> {
  try {
    await createTab(buf, title, path, resume, "pdf");
  } catch (err) {
    if (err instanceof PasswordRequiredError) {
      showPasswordDialog(
        wrong || err.retry,
        () => {},
        (pwd) => {
          void (async () => {
            try {
              await createTab(buf, title, path, resume, "pdf", pwd);
            } catch (retryErr) {
              if (retryErr instanceof PasswordRequiredError) {
                await openPdfWithPassword(buf, title, path, resume, true);
              } else {
                alert(`打开失败：${retryErr}`);
              }
            }
          })();
        }
      );
      return;
    }
    throw err;
  }
}

async function createTab(
  buf: ArrayBuffer,
  title: string,
  path: string | null,
  resume: RecentFile | null,
  kind: "pdf" | "epub",
  password?: string
): Promise<void> {
  const id = `tab-${Date.now().toString(36)}-${tabSeq++}`;
  const wrap = document.createElement("div");
  wrap.className = "tab-view";
  const inner = document.createElement("div");
  inner.className = "viewer";
  wrap.append(inner);
  el("tab-views").append(wrap);
  const engine: Engine =
    kind === "epub" ? new EpubViewer(wrap, inner) : new PdfViewer(wrap, inner);
  if (engine instanceof PdfViewer) {
    engine.setViewMode(currentSettings().view_mode);
    if (password) engine.setPassword(password);
  }
  if (engine instanceof EpubViewer) {
    engine.setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }
  const tab: ViewerTab = {
    id,
    kind,
    engine,
    wrap,
    inner,
    title,
    path,
    pages: 0,
    saveTimer: null,
    annotations: [],
    bookmarks: [],
    annoTimer: null,
    dataTimer: null,
    splitOn: false,
  };
  if (path) {
    void invoke<{ annotations: Annotation[]; bookmarks: Bookmark[] }>("load_document", { path })
      .then((data) => {
        if (!tabs.includes(tab)) return;
        tab.annotations = data.annotations;
        tab.bookmarks = data.bookmarks;
        engine.setAnnotations(data.annotations);
        if (engine instanceof PdfViewer) engine.setBookmarks(data.bookmarks);
        if (activeTabId === id) refreshAnnotations();
      })
      .catch(() => {});
  }

  engine.events.onDocLoaded = (info) => {
    tab.pages = info.pages;
    if (tab.kind === "epub") (engine as EpubViewer).attachLinkHandler();
    if (!firstDocSeen) {
      firstDocSeen = true;
      showLeftPanel(leftPanelTab);
    }
    if (activeTabId === id) refreshChrome();
    void saveRecentProgress(tab);
    if (resume) restorePosition(tab, resume);
  };
  engine.events.onPageChange = (page) => {
    if (activeTabId === id) {
      (el("page-input") as HTMLInputElement).value = String(page);
      const pdf = asPdf(engine);
      el("btn-bookmark").classList.toggle("active", pdf?.isBookmarked(page) ?? false);
      if (tab.kind === "pdf" && el("left-panel").classList.contains("hidden") === false) {
        asPdf(engine)?.scrollToThumb();
      }
    }
    engine.updateActiveThumb();
    queueRecentSave(tab);
  };
  engine.events.onZoom = (scale) => {
    if (activeTabId === id) {
      (el("btn-zoom-reset") as HTMLButtonElement).textContent = `${Math.round(scale * 100)}%`;
    }
  };
  wrap.addEventListener("scroll", () => queueRecentSave(tab));
  engine.events.onLink = (url: string) => {
    void openUrl(url).catch((err) => alert(`无法打开链接：${err}`));
  };
  if (engine instanceof EpubViewer) {
    engine.events.onSelection = (sel) => {
      pendingSelection = sel.text;
      const bar = el("selection-bar");
      bar.style.left = `${Math.min(Math.max(sel.x - 52, 8), window.innerWidth - 130)}px`;
      bar.style.top = `${Math.max(sel.y - 44, 8)}px`;
      bar.classList.add("epub");
      bar.classList.remove("hidden");
    };
  }

  tabs.push(tab);
  activateTab(id);
  await engine.open(buf, title);
}

function restorePosition(tab: ViewerTab, resume: RecentFile): void {
  requestAnimationFrame(() => {
    const max = tab.wrap.scrollHeight - tab.wrap.clientHeight;
    tab.wrap.scrollTop = Math.max(0, resume.scroll_ratio * max);
  });
}

/* ---------- recents ---------- */

function queueRecentSave(tab: ViewerTab): void {
  if (!tab.path) return;
  if (tab.saveTimer) clearTimeout(tab.saveTimer);
  tab.saveTimer = setTimeout(() => void saveRecentProgress(tab), 1500);
}

async function saveRecentProgress(tab: ViewerTab): Promise<void> {
  if (!tab.path) return;
  if (tab.engine.isOpen) {
    const s = currentSettings();
    const span = tab.wrap.scrollHeight - tab.wrap.clientHeight;
    const ratio = span > 0 ? Math.min(1, Math.max(0, tab.wrap.scrollTop / span)) : 0;
    const entry: RecentFile = {
      path: tab.path,
      title: tab.title,
      page: tab.engine.currentPageNumber(),
      scroll_ratio: ratio,
      last_read: Math.floor(Date.now() / 1000),
    };
    s.recent_files = [entry, ...s.recent_files.filter((r) => r.path !== entry.path)].slice(0, 12);
    try {
      await saveSettings(s);
    } catch {
      // non-fatal: recents rebuild next session
    }
  }
  if (tabs.length === 0) renderRecents();
}

function renderRecents(): void {
  const box = el("recents");
  const list = el("recents-list");
  const recents = [...currentSettings().recent_files]
    .sort((a, b) => b.last_read - a.last_read)
    .slice(0, 8);
  box.classList.toggle("hidden", tabs.length > 0 || recents.length === 0);
  list.innerHTML = "";
  const sideList = el("recent-block-list");
  sideList.innerHTML = "";
  el("recent-block").classList.toggle("hidden", recents.length === 0);
  for (const r of recents) {
    const side = document.createElement("div");
    side.className = "bookmark-item";
    const sPage = document.createElement("span");
    sPage.className = "page-no";
    sPage.textContent = `${r.page}`;
    const sTitle = document.createElement("span");
    sTitle.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    sTitle.textContent = r.title;
    side.title = r.path;
    side.append(sPage, sTitle);
    side.addEventListener("click", () => void openPath(r.path, r));
    sideList.append(side);
    const item = document.createElement("div");
    item.className = "recent-item";
    const title = document.createElement("span");
    title.className = "recent-title";
    title.textContent = r.title;
    const meta = document.createElement("span");
    meta.className = "recent-meta";
    const d = new Date(r.last_read * 1000);
    meta.textContent = `第 ${r.page} 页 · ${d.getMonth() + 1}月${d.getDate()}日`;
    item.append(title, meta);
    item.title = r.path;
    item.addEventListener("click", () => void openPath(r.path, r));
    list.append(item);
  }
}

async function openPath(path: string, resume?: RecentFile): Promise<void> {
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    activateTab(existing.id);
    if (resume) restorePosition(existing, resume);
    return;
  }
  try {
    const buf = await invoke<ArrayBuffer>("read_pdf", { path });
    const kind: "pdf" | "epub" = /\.epub$/i.test(path) ? "epub" : "pdf";
    if (kind === "pdf") {
      await openPdfWithPassword(buf, basename(path), path, resume ?? null);
    } else {
      await createTab(buf, basename(path), path, resume ?? null, kind);
    }
  } catch (err) {
    alert(`打开失败：${err}`);
  }
}

async function pickAndOpen(): Promise<void> {
  const path = await openDialog({
    multiple: false,
    filters: [{ name: "PDF / EPUB", extensions: ["pdf", "epub"] }],
  });
  if (typeof path === "string") void openPath(path);
}

/* ---------- left panel (thumbnails / outline) ---------- */

function showLeftPanel(tab: "thumbs" | "outline"): void {
  leftPanelTab = tab;
  el("left-panel").classList.remove("hidden");
  el("btn-panel").classList.add("active");
  el("panel-tab-thumbs").classList.toggle("active", tab === "thumbs");
  el("panel-tab-outline").classList.toggle("active", tab === "outline");
  el("panel-view-thumbs").classList.toggle("active", tab === "thumbs");
  el("panel-view-outline").classList.toggle("active", tab === "outline");
  if (tab === "thumbs") activeViewer()?.scrollToThumb();
}

function toggleLeftPanel(): void {
  if (el("left-panel").classList.contains("hidden")) {
    showLeftPanel(leftPanelTab);
  } else {
    el("left-panel").classList.add("hidden");
    el("btn-panel").classList.remove("active");
  }
}

async function buildOutline(viewer: PdfViewer | null): Promise<void> {
  const tree = el("outline-tree");
  tree.innerHTML = "";
  if (!viewer) return;
  const outline = await viewer.getOutline();
  el("outline-empty").classList.toggle("hidden", outline.length > 0);

  const renderItems = (items: typeof outline, depth: number): void => {
    for (const item of items) {
      const node = document.createElement("div");
      node.className = "outline-item";
      node.style.paddingLeft = `${8 + depth * 14}px`;
      if (item.url) {
        node.textContent = `${item.title || "（未命名）"} ↗`;
        node.title = "外部链接，暂不支持跳转";
        node.classList.add("outline-item-ext");
      } else {
        node.textContent = item.title || "（未命名）";
        node.addEventListener("click", () => {
          void viewer.goToDest(item.dest).then((ok) => {
            if (!ok) showOutlineNotice("该条目无法跳转：文档目标缺失或指向外部");
          });
        });
      }
      tree.append(node);
      if (item.items?.length) renderItems(item.items, depth + 1);
    }
  };
  renderItems(outline, 0);
}

function showOutlineNotice(message: string): void {
  const notice = el("outline-empty");
  notice.textContent = message;
  notice.classList.remove("hidden");
  setTimeout(() => {
    notice.textContent = "本文档没有目录";
    notice.classList.add("hidden");
  }, 3000);
}

/* ---------- theme ---------- */

// theme: "system" follows the OS; the toolbar toggle picks an explicit
// theme while this select restores OS-following.
function resolvedTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(): void {
  const theme = resolvedTheme();
  document.documentElement.setAttribute("data-theme", theme);
  for (const t of tabs) {
    if (t.kind === "epub") (t.engine as EpubViewer).setTheme(theme);
  }
}

function initTheme(): void {
  applyTheme();
  const select = el("theme-mode") as HTMLSelectElement;
  select.value = localStorage.getItem(THEME_KEY) ?? "system";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if ((localStorage.getItem(THEME_KEY) ?? "system") === "system") applyTheme();
  });
  el("btn-theme").addEventListener("click", () => {
    localStorage.setItem(THEME_KEY, resolvedTheme() === "dark" ? "light" : "dark");
    applyTheme();
  });
  select.addEventListener("change", () => {
    localStorage.setItem(THEME_KEY, select.value);
    applyTheme();
  });
}

/* ---------- findbar ---------- */

let findTimer: ReturnType<typeof setTimeout> | null = null;

function updateFindCount(found: number, done: boolean): void {
  const viewer = activeViewer();
  const total = viewer ? viewer.getHitCount() : 0;
  el("find-count").textContent = done
    ? `${total > 0 ? (viewer?.getActiveHitIndex() ?? -1) + 1 : 0}/${found}`
    : `${found}…`;
}

function openFindbar(): void {
  el("findbar").classList.remove("hidden");
  el("btn-find").classList.add("active");
  (el("find-input") as HTMLInputElement).focus();
  (el("find-input") as HTMLInputElement).select();
}

function closeFindbar(): void {
  el("findbar").classList.add("hidden");
  el("btn-find").classList.remove("active");
  activeViewer()?.clearSearch();
  el("find-count").textContent = "";
}

function initFindbar(): void {
  const input = el("find-input") as HTMLInputElement;
  input.addEventListener("input", () => {
    if (findTimer) clearTimeout(findTimer);
    findTimer = setTimeout(() => {
      const viewer = activeViewer();
      if (!viewer) return;
      void viewer.runSearch(input.value, updateFindCount);
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const viewer = activeViewer();
      if (!viewer) return;
      const step = e.shiftKey ? viewer.prevHit() : viewer.nextHit();
      void step.then(() => updateFindCount(viewer.getHitCount(), true));
    } else if (e.key === "Escape") {
      closeFindbar();
    }
  });
  el("find-next").addEventListener("click", () => {
    const viewer = activeViewer();
    if (!viewer) return;
    void viewer.nextHit().then(() => updateFindCount(viewer.getHitCount(), true));
  });
  el("find-prev").addEventListener("click", () => {
    const viewer = activeViewer();
    if (!viewer) return;
    void viewer.prevHit().then(() => updateFindCount(viewer.getHitCount(), true));
  });
  el("find-close").addEventListener("click", closeFindbar);
  el("btn-find").addEventListener("click", openFindbar);
}

/* ---------- print ---------- */

async function printActive(): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.kind !== "pdf" || !tab.engine.isOpen) return;
  if (tab.pages > 150 && !confirm(`共 ${tab.pages} 页，渲染全部页面可能需要一些时间，继续打印？`)) {
    return;
  }
  const btn = el("btn-print") as HTMLButtonElement;
  btn.disabled = true;
  const oldTitle = btn.title;
  btn.title = "正在渲染页面…";
  try {
    await asPdf(tab.engine)?.renderAll();
  } catch {
    // print whatever rendered
  }
  btn.disabled = false;
  btn.title = oldTitle;
  tab.wrap.classList.add("printing");
  window.print();
  tab.wrap.classList.remove("printing");
}

/* ---------- annotations ---------- */

function queueAnnotationSave(tab: ViewerTab): void {
  if (!tab.path) return;
  if (tab.annoTimer) clearTimeout(tab.annoTimer);
  tab.annoTimer = setTimeout(() => void saveDocumentData(tab), 800);
}

async function saveDocumentData(tab: ViewerTab): Promise<void> {
  if (!tab.path) return;
  try {
    await invoke("save_document", {
      path: tab.path,
      data: { annotations: tab.annotations, bookmarks: tab.bookmarks },
    });
  } catch (err) {
    console.error("document data save failed", err);
  }
}

function updateAnnotation(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): void {
  const tab = activeTab();
  if (!tab) return;
  const a = tab.annotations.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, patch);
  if (patch.color) tab.engine.setAnnotations(tab.annotations);
  queueAnnotationSave(tab);
  refreshAnnotations();
}

function removeAnnotation(id: string): void {
  const tab = activeTab();
  if (!tab) return;
  tab.annotations = tab.annotations.filter((x) => x.id !== id);
  tab.engine.setAnnotations(tab.annotations);
  queueAnnotationSave(tab);
  refreshAnnotations();
}

/* ---------- selection bar & annotation popover ---------- */

function hideSelectionBar(): void {
  el("selection-bar").classList.add("hidden");
}

function createAnnotationFromSelection(color: "yellow" | "green" | "blue"): void {
  const tab = activeTab();
  const viewer = activeViewer();
  if (!tab || !viewer) return;
  const selInfo = viewer.selectionAnnotation();
  const text = window.getSelection()?.toString().trim() ?? "";
  hideSelectionBar();
  if (!selInfo || !text) return;
  const a: Annotation = {
    id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    page: selInfo.page,
    rects: selInfo.rects,
    excerpt: text.slice(0, 800),
    color,
    note: "",
    created: Math.floor(Date.now() / 1000),
  };
  tab.annotations.push(a);
  viewer.setAnnotations(tab.annotations);
  queueAnnotationSave(tab);
  refreshAnnotations();
}

let popoverAnnotation: Annotation | null = null;
let noteSaveTimer: ReturnType<typeof setTimeout> | null = null;

function markPopoverColor(color: string): void {
  document
    .querySelectorAll("#annotation-popover .sel-color")
    .forEach((d) => d.classList.toggle("active", (d as HTMLElement).dataset.color === color));
}

function openAnnotationPopover(a: Annotation, x: number, y: number): void {
  popoverAnnotation = a;
  const pop = el("annotation-popover");
  el("anno-excerpt").textContent =
    a.excerpt.length > 160 ? `${a.excerpt.slice(0, 160)}…` : a.excerpt;
  (el("anno-note") as HTMLTextAreaElement).value = a.note;
  markPopoverColor(a.color);
  pop.classList.remove("hidden");
  const left = Math.min(Math.max(x - 140, 8), window.innerWidth - 296);
  const top = Math.min(Math.max(y + 12, 8), window.innerHeight - 240);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  (el("anno-note") as HTMLTextAreaElement).focus();
}

function closeAnnotationPopover(): void {
  popoverAnnotation = null;
  el("annotation-popover").classList.add("hidden");
}

function initSelectionAction(): void {
  const bar = el("selection-bar");
  bar.addEventListener("mousedown", (e) => e.preventDefault());
  el("sel-translate").addEventListener("click", () => {
    const text = pendingSelection || (window.getSelection()?.toString().trim() ?? "");
    hideSelectionBar();
    if (text) translateSelection(text);
  });
  for (const dot of bar.querySelectorAll<HTMLButtonElement>(".sel-color")) {
    dot.addEventListener("click", () => {
      createAnnotationFromSelection((dot.dataset.color as "yellow" | "green" | "blue") ?? "yellow");
    });
  }

  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const wrap = activeTab()?.wrap;
    const inViewer = !!sel && sel.rangeCount > 0 && !!wrap && wrap.contains(sel.anchorNode);
    if (text.length > 1) pendingSelection = text;
    if (text.length > 1 && inViewer) {
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      bar.style.left = `${Math.min(Math.max(rect.left + rect.width / 2 - 52, 8), window.innerWidth - 130)}px`;
      bar.style.top = `${Math.max(rect.top - 44, 8)}px`;
      bar.classList.toggle("epub", activeTab()?.kind === "epub");
      bar.classList.remove("hidden");
    } else {
      hideSelectionBar();
    }
  });

  el("viewer-wrap").addEventListener("click", (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const viewer = activeViewer();
    if (!viewer) return;
    const hit = viewer.annotationAt(e.clientX, e.clientY);
    if (hit) openAnnotationPopover(hit, e.clientX, e.clientY);
    else closeAnnotationPopover();
  });
  el("viewer-wrap").addEventListener(
    "scroll",
    () => {
      hideSelectionBar();
      closeAnnotationPopover();
    },
    true
  );

  for (const dot of document.querySelectorAll<HTMLButtonElement>("#annotation-popover .sel-color")) {
    dot.addEventListener("click", () => {
      if (!popoverAnnotation) return;
      popoverAnnotation.color = (dot.dataset.color as "yellow" | "green" | "blue") ?? "yellow";
      markPopoverColor(popoverAnnotation.color);
      const tab = activeTab();
      if (tab) tab.engine.setAnnotations(tab.annotations);
      queueAnnotationSave(tab!);
    });
  }
  (el("anno-note") as HTMLTextAreaElement).addEventListener("input", (e) => {
    if (!popoverAnnotation) return;
    popoverAnnotation.note = (e.target as HTMLTextAreaElement).value;
    if (noteSaveTimer) clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(() => {
      const tab = activeTab();
      if (tab) queueAnnotationSave(tab);
    }, 400);
  });
  el("anno-delete").addEventListener("click", () => {
    if (popoverAnnotation) removeAnnotation(popoverAnnotation.id);
    closeAnnotationPopover();
  });
  el("anno-close").addEventListener("click", closeAnnotationPopover);
}

/* ---------- wiring ---------- */

function initToolbar(): void {
  el("btn-open").addEventListener("click", () => void pickAndOpen());
  el("btn-open-empty").addEventListener("click", () => void pickAndOpen());
  el("btn-tab-new").addEventListener("click", () => void pickAndOpen());
  el("btn-prev").addEventListener("click", () => activeViewer()?.prevPage());
  el("btn-next").addEventListener("click", () => activeViewer()?.nextPage());
  el("btn-zoom-in").addEventListener("click", () => activeViewer()?.zoomIn());
  el("btn-zoom-out").addEventListener("click", () => activeViewer()?.zoomOut());
  el("btn-zoom-reset").addEventListener("click", () => activeViewer()?.zoomReset());
  el("btn-fit").addEventListener("click", () => activeViewer()?.fitToWidth());
  el("btn-panel").addEventListener("click", toggleLeftPanel);
  el("panel-tab-thumbs").addEventListener("click", () => showLeftPanel("thumbs"));
  el("panel-tab-outline").addEventListener("click", () => showLeftPanel("outline"));
  el("btn-sidebar").addEventListener("click", () => {
    const sidebar = el("sidebar");
    const hidden = sidebar.classList.toggle("hidden");
    el("btn-sidebar").classList.toggle("active", !hidden);
  });
  el("btn-print").addEventListener("click", () => void printActive());
  el("btn-bookmark").addEventListener("click", toggleBookmarkActive);
  el("btn-bookmark-add").addEventListener("click", toggleBookmarkActive);
  el("btn-split").addEventListener("click", () => {
    const tab = activeTab();
    if (tab) setSplit(!tab.splitOn);
  });
  el("btn-double").addEventListener("click", () => {
    const s = currentSettings();
    s.view_mode = s.view_mode === "double" ? "single" : "double";
    void saveSettings(s);
    el("btn-double").classList.toggle("active", s.view_mode === "double");
    for (const t of tabs) if (t.kind === "pdf") asPdf(t.engine)?.setViewMode(s.view_mode);
  });
  (el("page-input") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const viewer = activeViewer();
    if (!viewer) return;
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(value) && value >= 1 && value <= viewer.getDocPages()) {
      viewer.scrollToPage(value);
    }
    (e.target as HTMLInputElement).blur();
  });
}

function initKeyboard(): void {
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void pickAndOpen();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (activeViewer()?.isOpen) openFindbar();
      return;
    }
    if (!typing && e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey) {
      toggleBookmarkActive();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
      return;
    }
    if (typing) return;
    if (e.key === "+" || e.key === "=") activeViewer()?.zoomIn();
    else if (e.key === "-") activeViewer()?.zoomOut();
    else if (e.key === "Escape") {
      if (!el("findbar").classList.contains("hidden")) closeFindbar();
      hideSelectionBar();
    }
  });
}

function initSplitters(): void {
  const clampV = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const apply = (): void => {
    const l = clampV(parseInt(localStorage.getItem("pdfgist-left-w") ?? "232", 10) || 232, 160, 440);
    const r = clampV(parseInt(localStorage.getItem("pdfgist-sidebar-w") ?? "400", 10) || 400, 280, 680);
    document.documentElement.style.setProperty("--left-w", `${l}px`);
    document.documentElement.style.setProperty("--sidebar-w", `${r}px`);
  };
  apply();

  const notifyAll = (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const t of tabs) t.engine.notifyContainerResized();
      }, 120);
    };
  })();

  const setup = (handleId: string, varName: string, key: string, min: number, max: number, invert: boolean): void => {
    const handle = el(handleId);
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handle.classList.add("dragging");
      document.body.classList.add("panel-resizing");
      const startX = e.clientX;
      const startW =
        parseInt(getComputedStyle(document.documentElement).getPropertyValue(varName), 10) ||
        (varName === "--left-w" ? 232 : 400);
      let last = startW;
      const onMove = (ev: MouseEvent): void => {
        const delta = ev.clientX - startX;
        last = Math.min(max, Math.max(min, startW + (invert ? -delta : delta)));
        document.documentElement.style.setProperty(varName, `${last}px`);
        notifyAll();
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        handle.classList.remove("dragging");
        document.body.classList.remove("panel-resizing");
        localStorage.setItem(key, String(last));
        for (const t of tabs) t.engine.notifyContainerResized();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    handle.addEventListener("dblclick", () => {
      localStorage.removeItem(key);
      const def = varName === "--left-w" ? "232px" : "400px";
      document.documentElement.style.setProperty(varName, def);
      for (const t of tabs) t.engine.notifyContainerResized();
    });
  };
  setup("left-resize", "--left-w", "pdfgist-left-w", 160, 440, false);
  setup("sidebar-resize", "--sidebar-w", "pdfgist-sidebar-w", 280, 680, true);
}

function initWheelZoom(): void {
  el("viewer-wrap").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) activeViewer()?.zoomIn();
      else activeViewer()?.zoomOut();
    },
    { passive: false }
  );
}

function initDragDrop(): void {
  const overlay = el("drop-overlay");
  let depth = 0;
  getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter") {
      depth += 1;
      overlay.classList.remove("hidden");
    } else if (event.payload.type === "drop") {
      depth = 0;
      overlay.classList.add("hidden");
      const path = event.payload.paths[0];
      if (path && /\.(pdf|epub)$/i.test(path)) void openPath(path);
    } else if (event.payload.type === "leave") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.classList.add("hidden");
    }
  });
}

async function init(): Promise<void> {
  initTheme();
  await initSettings(() => switchTab("settings"));
  initSidebar({
    getProvider: () => ensureProviderConfigured(),
    getTargetLang: () => currentSettings().target_language,
    text: {
      page: async () => {
        const viewer = activeViewer();
        if (!viewer?.isOpen) return null;
        const n = viewer.currentPageNumber();
        const text = (await viewer.getPageText(n)).trim();
        return text ? { page: n, text } : null;
      },
      selection: () => {
        const text = window.getSelection()?.toString().trim() ?? "";
        return text.length > 1 ? text : null;
      },
      doc: async () => {
        const viewer = activeViewer();
        if (!viewer?.isOpen) return null;
        return viewer.getDocText(12, 24000);
      },
      pages: () => activeViewer()?.getDocPages() ?? 0,
      pageText: async (n) => {
        const viewer = activeViewer();
        if (!viewer?.isOpen) return "";
        return viewer.getPageText(n);
      },
    },
    annotations: {
      list: () => activeTab()?.annotations ?? [],
      remove: removeAnnotation,
      update: updateAnnotation,
      jump: (a) => void activeViewer()?.scrollToAnnotation(a),
      translate: (text) => translateSelection(text),
      meta: () => {
        const t = activeTab();
        return t ? { title: t.title, path: t.path } : null;
      },
    },
  });
  initToolbar();
  initKeyboard();
  initWheelZoom();
  initDragDrop();
  initSelectionAction();
  initFindbar();
  initSplitters();
  initUpdater();
  setToolbarEnabled(false);
  el("btn-double").classList.toggle("active", currentSettings().view_mode === "double");
  refreshChrome();
}

void init();
