import "./style.css";
import { el } from "./dom";
import { PdfViewer } from "./viewer";
import { currentSettings, ensureProviderConfigured, initSettings } from "./settings";
import { initSidebar, switchTab, translateSelection } from "./sidebar";
import { initUpdater } from "./updater";

const viewerWrap = el("viewer-wrap");
const viewerEl = el("viewer");
const viewer = new PdfViewer(viewerWrap, viewerEl);

const THEME_KEY = "pdfgist-theme";
let leftPanelTab: "thumbs" | "outline" = "thumbs";

function setToolbarEnabled(enabled: boolean): void {
  for (const id of ["btn-panel", "btn-prev", "btn-next", "btn-zoom-in", "btn-zoom-out", "btn-zoom-reset", "btn-fit", "btn-find"]) {
    (el(id) as HTMLButtonElement).disabled = !enabled;
  }
  (el("page-input") as HTMLInputElement).disabled = !enabled;
}

function openPdfFile(file: File): void {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    alert("请选择 PDF 文件");
    return;
  }
  file
    .arrayBuffer()
    .then((buf) => viewer.open(buf, file.name))
    .catch((err) => alert(`打开失败：${err}`));
}

async function buildOutline(): Promise<void> {
  const tree = el("outline-tree");
  tree.innerHTML = "";
  const outline = await viewer.getOutline();
  const hasOutline = outline.length > 0;
  el("outline-empty").classList.toggle("hidden", hasOutline);

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

function showLeftPanel(tab: "thumbs" | "outline"): void {
  leftPanelTab = tab;
  el("left-panel").classList.remove("hidden");
  el("btn-panel").classList.add("active");
  el("panel-tab-thumbs").classList.toggle("active", tab === "thumbs");
  el("panel-tab-outline").classList.toggle("active", tab === "outline");
  el("panel-view-thumbs").classList.toggle("active", tab === "thumbs");
  el("panel-view-outline").classList.toggle("active", tab === "outline");
  if (tab === "thumbs") viewer.scrollToThumb();
}

function toggleLeftPanel(): void {
  if (el("left-panel").classList.contains("hidden")) {
    showLeftPanel(leftPanelTab);
  } else {
    el("left-panel").classList.add("hidden");
    el("btn-panel").classList.remove("active");
  }
}

viewer.events.onDocLoaded = ({ pages, title }) => {
  el("empty-state").classList.add("hidden");
  el("doc-title").textContent = title;
  el("page-total").textContent = String(pages);
  (el("page-input") as HTMLInputElement).value = "1";
  setToolbarEnabled(true);
  void buildOutline();
  viewer.buildThumbnails(el("thumbs-grid"));
  showLeftPanel("thumbs");
};
viewer.events.onPageChange = (page) => {
  (el("page-input") as HTMLInputElement).value = String(page);
  viewer.updateActiveThumb();
  if (el("left-panel").classList.contains("hidden")) return;
  viewer.scrollToThumb();
};
viewer.events.onZoom = (scale) => {
  (el("btn-zoom-reset") as HTMLButtonElement).textContent = `${Math.round(scale * 100)}%`;
};

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
  el("find-count").textContent = done
    ? `${viewer.getHitCount() > 0 ? viewer.getActiveHitIndex() + 1 : 0}/${found}`
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
  viewer.clearSearch();
  el("find-count").textContent = "";
}

function initFindbar(): void {
  const input = el("find-input") as HTMLInputElement;
  input.addEventListener("input", () => {
    if (findTimer) clearTimeout(findTimer);
    findTimer = setTimeout(() => {
      void viewer.runSearch(input.value, updateFindCount);
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) void viewer.prevHit().then(() => updateFindCount(viewer.getHitCount(), true));
      else void viewer.nextHit().then(() => updateFindCount(viewer.getHitCount(), true));
    } else if (e.key === "Escape") {
      closeFindbar();
    }
  });
  el("find-next").addEventListener("click", () =>
    void viewer.nextHit().then(() => updateFindCount(viewer.getHitCount(), true))
  );
  el("find-prev").addEventListener("click", () =>
    void viewer.prevHit().then(() => updateFindCount(viewer.getHitCount(), true))
  );
  el("find-close").addEventListener("click", closeFindbar);
  el("btn-find").addEventListener("click", openFindbar);
}

/* ---------- selection action ---------- */

function hideSelectionAction(): void {
  el("selection-action").classList.add("hidden");
}

function initSelectionAction(): void {
  const btn = el("selection-action");
  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const inViewer = !!sel && sel.rangeCount > 0 && viewerEl.contains(sel.anchorNode);
    if (text.length > 1 && inViewer) {
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      btn.style.left = `${Math.min(Math.max(rect.left + rect.width / 2 - 28, 8), window.innerWidth - 70)}px`;
      btn.style.top = `${Math.max(rect.top - 42, 8)}px`;
      btn.classList.remove("hidden");
    } else {
      hideSelectionAction();
    }
  });
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    const text = window.getSelection()?.toString().trim() ?? "";
    hideSelectionAction();
    if (text) translateSelection(text);
  });
  viewerWrap.addEventListener("scroll", hideSelectionAction);
}

/* ---------- wiring ---------- */

function initToolbar(): void {
  const fileInput = el("file-input") as HTMLInputElement;
  el("btn-open").addEventListener("click", () => fileInput.click());
  el("btn-open-empty").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) openPdfFile(file);
    fileInput.value = "";
  });
  el("btn-prev").addEventListener("click", () => viewer.prevPage());
  el("btn-next").addEventListener("click", () => viewer.nextPage());
  el("btn-zoom-in").addEventListener("click", () => viewer.zoomIn());
  el("btn-zoom-out").addEventListener("click", () => viewer.zoomOut());
  el("btn-zoom-reset").addEventListener("click", () => viewer.zoomReset());
  el("btn-fit").addEventListener("click", () => viewer.fitToWidth());
  el("btn-panel").addEventListener("click", toggleLeftPanel);
  el("panel-tab-thumbs").addEventListener("click", () => showLeftPanel("thumbs"));
  el("panel-tab-outline").addEventListener("click", () => showLeftPanel("outline"));
  el("btn-sidebar").addEventListener("click", () => {
    const sidebar = el("sidebar");
    const hidden = sidebar.classList.toggle("hidden");
    el("btn-sidebar").classList.toggle("active", !hidden);
  });
  (el("page-input") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
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
      (el("file-input") as HTMLInputElement).click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (viewer.isOpen) openFindbar();
      return;
    }
    if (typing) return;
    if (e.key === "+" || e.key === "=") viewer.zoomIn();
    else if (e.key === "-") viewer.zoomOut();
    else if (e.key === "Escape") {
      if (!el("findbar").classList.contains("hidden")) closeFindbar();
      hideSelectionAction();
    }
  });
}

function initWheelZoom(): void {
  viewerWrap.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) viewer.zoomIn();
      else viewer.zoomOut();
    },
    { passive: false }
  );
}

function initDragDrop(): void {
  let depth = 0;
  viewerWrap.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth += 1;
    el("drop-overlay").classList.remove("hidden");
  });
  viewerWrap.addEventListener("dragover", (e) => e.preventDefault());
  viewerWrap.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) el("drop-overlay").classList.add("hidden");
  });
  viewerWrap.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    el("drop-overlay").classList.add("hidden");
    const file = e.dataTransfer?.files?.[0];
    if (file) openPdfFile(file);
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
        if (!viewer.isOpen) return null;
        const n = viewer.currentPageNumber();
        const text = (await viewer.getPageText(n)).trim();
        return text ? { page: n, text } : null;
      },
      selection: () => {
        const text = window.getSelection()?.toString().trim() ?? "";
        return text.length > 1 ? text : null;
      },
      doc: async () => {
        if (!viewer.isOpen) return null;
        return viewer.getDocText(12, 24000);
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
}

void init();
