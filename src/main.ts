import "./style.css";
import { el } from "./dom";
import { PdfViewer } from "./viewer";
import { currentSettings, ensureProviderConfigured, initSettings } from "./settings";
import { initSidebar, switchTab, translateSelection } from "./sidebar";
import { initUpdater } from "./updater";

const viewerWrap = el("viewer-wrap");
const viewerEl = el("viewer");
const viewer = new PdfViewer(viewerWrap, viewerEl);

function hideSelectionAction(): void {
  el("selection-action").classList.add("hidden");
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
  el("btn-outline").classList.toggle("disabled", !hasOutline);
  el("outline-panel").classList.toggle("hidden", !hasOutline);

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

viewer.events.onDocLoaded = ({ pages, title }) => {
  el("empty-state").classList.add("hidden");
  el("doc-title").textContent = title;
  el("page-indicator").textContent = `1 / ${pages}`;
  void buildOutline();
};
viewer.events.onPageChange = (page) => {
  el("page-indicator").textContent = `${page} / ${viewer.getDocPages()}`;
};
viewer.events.onZoom = (scale) => {
  (el("btn-zoom-reset") as HTMLButtonElement).textContent = `${Math.round(scale * 100)}%`;
};

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
  el("btn-outline").addEventListener("click", () =>
    el("outline-panel").classList.toggle("hidden")
  );
  el("btn-sidebar").addEventListener("click", () => {
    const sidebar = el("sidebar");
    const hidden = sidebar.classList.toggle("hidden");
    el("btn-sidebar").classList.toggle("active", !hidden);
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
    if (typing) return;
    if (e.key === "+" || e.key === "=") viewer.zoomIn();
    else if (e.key === "-") viewer.zoomOut();
    else if (e.key === "Escape") hideSelectionAction();
  });
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

function initSelectionAction(): void {
  const btn = el("selection-action");
  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const inViewer =
      !!sel && sel.rangeCount > 0 && viewerEl.contains(sel.anchorNode);
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

async function init(): Promise<void> {
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
  initDragDrop();
  initSelectionAction();
  initUpdater();
}

void init();
