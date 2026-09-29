import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { el } from "./dom";
import { PdfViewer } from "./viewer";
import { currentSettings, ensureProviderConfigured, initSettings, saveSettings } from "./settings";
import type { Annotation, RecentFile } from "./types";
import { initSidebar, refreshAnnotations, switchTab, translateSelection } from "./sidebar";
import { initUpdater } from "./updater";

interface ViewerTab {
  id: string;
  viewer: PdfViewer;
  wrap: HTMLDivElement; // scroll container, one per tab
  inner: HTMLDivElement; // pages container
  title: string;
  path: string | null;
  pages: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
  annotations: Annotation[];
  annoTimer: ReturnType<typeof setTimeout> | null;
}

const tabs: ViewerTab[] = [];
let activeTabId: string | null = null;
let tabSeq = 0;
let firstDocSeen = false;
let leftPanelTab: "thumbs" | "outline" = "thumbs";

const THEME_KEY = "pdfgist-theme";

function activeTab(): ViewerTab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

function activeViewer(): PdfViewer | null {
  return activeTab()?.viewer ?? null;
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
  void saveAnnotations(tab);
  tab.viewer.close();
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
  const has = !!tab && tab.viewer.isOpen;
  setToolbarEnabled(Boolean(has));
  el("empty-state").classList.toggle("hidden", tabs.length > 0);
  renderRecents();
  if (!tab) {
    el("doc-title").textContent = "";
    el("page-total").textContent = "–";
    (el("page-input") as HTMLInputElement).value = "–";
    return;
  }
  el("doc-title").textContent = tab.title;
  el("page-total").textContent = String(tab.pages || "–");
  (el("page-input") as HTMLInputElement).value = tab.viewer.currentPageNumber().toString();
  (el("btn-zoom-reset") as HTMLButtonElement).textContent = `${Math.round(tab.viewer.getScale() * 100)}%`;
  void buildOutline(tab.viewer);
  tab.viewer.buildThumbnails(el("thumbs-grid"));
  tab.viewer.updateActiveThumb();
}

async function createTab(
  buf: ArrayBuffer,
  title: string,
  path: string | null,
  resume: RecentFile | null
): Promise<void> {
  const id = `tab-${Date.now().toString(36)}-${tabSeq++}`;
  const wrap = document.createElement("div");
  wrap.className = "tab-view";
  const inner = document.createElement("div");
  inner.className = "viewer";
  wrap.append(inner);
  el("tab-views").append(wrap);
  const viewer = new PdfViewer(wrap, inner);
  viewer.setViewMode(currentSettings().view_mode);
  const tab: ViewerTab = {
    id,
    viewer,
    wrap,
    inner,
    title,
    path,
    pages: 0,
    saveTimer: null,
    annotations: [],
    annoTimer: null,
  };
  if (path) {
    void invoke<Annotation[]>("load_annotations", { path })
      .then((list) => {
        if (!tabs.includes(tab) || list.length === 0) return;
        tab.annotations = list;
        viewer.setAnnotations(list);
        if (activeTabId === id) refreshAnnotations();
      })
      .catch(() => {});
  }

  viewer.events.onDocLoaded = (info) => {
    tab.pages = info.pages;
    if (!firstDocSeen) {
      firstDocSeen = true;
      showLeftPanel(leftPanelTab);
    }
    if (activeTabId === id) refreshChrome();
    void saveRecentProgress(tab);
    if (resume) restorePosition(tab, resume);
  };
  viewer.events.onPageChange = (page) => {
    if (activeTabId === id) {
      (el("page-input") as HTMLInputElement).value = String(page);
      if (el("left-panel").classList.contains("hidden") === false) viewer.scrollToThumb();
    }
    viewer.updateActiveThumb();
    queueRecentSave(tab);
  };
  viewer.events.onZoom = (scale) => {
    if (activeTabId === id) {
      (el("btn-zoom-reset") as HTMLButtonElement).textContent = `${Math.round(scale * 100)}%`;
    }
  };
  wrap.addEventListener("scroll", () => queueRecentSave(tab));

  tabs.push(tab);
  activateTab(id);
  await viewer.open(buf, title);
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
  if (tab.viewer.isOpen) {
    const s = currentSettings();
    const span = tab.wrap.scrollHeight - tab.wrap.clientHeight;
    const ratio = span > 0 ? Math.min(1, Math.max(0, tab.wrap.scrollTop / span)) : 0;
    const entry: RecentFile = {
      path: tab.path,
      title: tab.title,
      page: tab.viewer.currentPageNumber(),
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
  for (const r of recents) {
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
    await createTab(buf, basename(path), path, resume ?? null);
  } catch (err) {
    alert(`打开失败：${err}`);
  }
}

async function pickAndOpen(): Promise<void> {
  const path = await openDialog({
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
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

async function buildOutline(viewer: PdfViewer): Promise<void> {
  const tree = el("outline-tree");
  tree.innerHTML = "";
  const outline = await viewer.getOutline();
  el("outline-empty").classList.toggle("hidden", outline.length > 0);

  const renderItems = (items: typeof outline, depth: number): void => {
    for (const item of items) {
      const node = document.createElement("div");
      node.className = "outline-item";
      node.style.paddingLeft = `${8 + depth * 14}px`;
      node.textContent = item.title || "（未命名）";
      node.addEventListener("click", () => void viewer.goToDest(item.dest));
      tree.append(node);
      if (item.items?.length) renderItems(item.items, depth + 1);
    }
  };
  renderItems(outline, 0);
}

/* ---------- theme ---------- */

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function initTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(stored === "dark" || stored === "light" ? stored : media.matches ? "dark" : "light");
  media.addEventListener("change", (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      applyTheme(e.matches ? "dark" : "light");
    }
  });
  el("btn-theme").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
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
  if (!tab || !tab.viewer.isOpen) return;
  if (tab.pages > 150 && !confirm(`共 ${tab.pages} 页，渲染全部页面可能需要一些时间，继续打印？`)) {
    return;
  }
  const btn = el("btn-print") as HTMLButtonElement;
  btn.disabled = true;
  const oldTitle = btn.title;
  btn.title = "正在渲染页面…";
  try {
    await tab.viewer.renderAll();
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
  tab.annoTimer = setTimeout(() => void saveAnnotations(tab), 800);
}

async function saveAnnotations(tab: ViewerTab): Promise<void> {
  if (!tab.path) return;
  try {
    await invoke("save_annotations", { path: tab.path, annotations: tab.annotations });
  } catch (err) {
    console.error("annotations save failed", err);
  }
}

function updateAnnotation(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): void {
  const tab = activeTab();
  if (!tab) return;
  const a = tab.annotations.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, patch);
  if (patch.color) tab.viewer.setAnnotations(tab.annotations);
  queueAnnotationSave(tab);
  refreshAnnotations();
}

function removeAnnotation(id: string): void {
  const tab = activeTab();
  if (!tab) return;
  tab.annotations = tab.annotations.filter((x) => x.id !== id);
  tab.viewer.setAnnotations(tab.annotations);
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
    const text = window.getSelection()?.toString().trim() ?? "";
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
    if (text.length > 1 && inViewer) {
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      bar.style.left = `${Math.min(Math.max(rect.left + rect.width / 2 - 52, 8), window.innerWidth - 130)}px`;
      bar.style.top = `${Math.max(rect.top - 44, 8)}px`;
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
      if (tab) tab.viewer.setAnnotations(tab.annotations);
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
  el("btn-double").addEventListener("click", () => {
    const s = currentSettings();
    s.view_mode = s.view_mode === "double" ? "single" : "double";
    void saveSettings(s);
    el("btn-double").classList.toggle("active", s.view_mode === "double");
    for (const t of tabs) t.viewer.setViewMode(s.view_mode);
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
      if (path && /\.pdf$/i.test(path)) void openPath(path);
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
  initUpdater();
  setToolbarEnabled(false);
  el("btn-double").classList.toggle("active", currentSettings().view_mode === "double");
  refreshChrome();
}

void init();
