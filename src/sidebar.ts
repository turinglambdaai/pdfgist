import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { chatStream } from "./ai";
import { el } from "./dom";
import { renderMarkdown } from "./markdown";
import type { Annotation, ChatMessage, ProviderConfig } from "./types";

export interface TextSource {
  page: () => Promise<{ page: number; text: string } | null>;
  selection: () => string | null;
  doc: () => Promise<{ pages: number; text: string } | null>;
  pages: () => number;
  pageText: (n: number) => Promise<string>;
}

export interface AnnotationDeps {
  list: () => Annotation[];
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Pick<Annotation, "note" | "color">>) => void;
  jump: (a: Annotation) => void;
  translate: (text: string) => void;
  meta: () => { title: string; path: string | null } | null;
}

export interface SidebarDeps {
  getProvider: () => ProviderConfig | null;
  getTargetLang: () => string;
  text: TextSource;
  annotations: AnnotationDeps;
}

// Accumulates reasoning and answer separately. While streaming, reasoning
// is only a compact "thinking" indicator — raw chain-of-thought is noise
// for a reader. `html(true)` (stream ended) falls back to the dimmed
// reasoning, covering providers that put the whole answer into the
// reasoning field.
class StreamBuffer {
  private reasoning = "";
  private content = "";
  private gotContent = false;

  push(text: string, isReasoning: boolean): void {
    if (isReasoning) {
      if (!this.gotContent) this.reasoning += text;
    } else {
      this.gotContent = true;
      this.content += text;
    }
  }

  html(final = false): string {
    if (this.content) return renderMarkdown(this.content);
    if (final) {
      return this.reasoning ? `<div class="reasoning">${renderMarkdown(this.reasoning)}</div>` : "";
    }
    return this.reasoning
      ? `<div class="thinking">思考中<span class="dots"><i>·</i><i>·</i><i>·</i></span></div>`
      : "";
  }

  text(): string {
    return this.content;
  }

  isEmpty(): boolean {
    return !this.content && !this.reasoning;
  }
}

const PAGE_TRUNCATE = 8000;
let deps: SidebarDeps;
let chatHistory: ChatMessage[] = [];
let chatBusy = false;
let chatHandle: { cancel: () => void } | null = null;

function translateList(): HTMLElement {
  return el("translate-list");
}

function summarizeList(): HTMLElement {
  return el("summarize-list");
}

export function switchTab(id: string): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === id);
  }
  for (const panel of document.querySelectorAll<HTMLElement>(".tab-panel")) {
    panel.classList.toggle("active", panel.id === `tab-${id}`);
  }
  window.dispatchEvent(new CustomEvent("pdfgist-tab-activated", { detail: id }));
}

interface Card {
  body: HTMLElement;
  metaEl: HTMLElement;
  stopBtn: HTMLButtonElement;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function makeCard(list: HTMLElement, title: string, meta: string, getCopyText?: () => string): Card {
  const card = document.createElement("div");
  card.className = "card";
  const header = document.createElement("div");
  header.className = "card-header";
  const titleEl = document.createElement("span");
  titleEl.className = "card-title";
  titleEl.textContent = title;
  const metaEl = document.createElement("span");
  metaEl.className = "card-meta";
  metaEl.textContent = meta;
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const stopBtn = document.createElement("button");
  stopBtn.className = "card-btn";
  stopBtn.textContent = "停止";
  const copyBtn = document.createElement("button");
  copyBtn.className = "card-btn";
  copyBtn.textContent = "复制";
  copyBtn.addEventListener("click", () => {
    const text = getCopyText?.() ?? "";
    if (!text.trim()) return;
    void copyToClipboard(text).then(() => {
      copyBtn.textContent = "已复制";
      copyBtn.classList.add("done");
      setTimeout(() => {
        copyBtn.textContent = "复制";
        copyBtn.classList.remove("done");
      }, 1200);
    });
  });
  const closeBtn = document.createElement("button");
  closeBtn.className = "card-btn";
  closeBtn.textContent = "×";
  actions.append(stopBtn, copyBtn, closeBtn);
  header.append(titleEl, metaEl, actions);
  const body = document.createElement("div");
  body.className = "card-body md";
  card.append(header, body);
  list.prepend(card);
  closeBtn.addEventListener("click", () => card.remove());
  return { body, metaEl, stopBtn };
}

function addNotice(list: HTMLElement, message: string): void {
  const card = document.createElement("div");
  card.className = "card";
  const body = document.createElement("div");
  body.className = "card-body";
  const span = document.createElement("span");
  span.className = "card-empty";
  span.textContent = message;
  body.append(span);
  card.append(body);
  list.prepend(card);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function streamInto(
  list: HTMLElement,
  title: string,
  meta: string,
  messages: ChatMessage[],
  sourceText?: string
): void {
  const provider = deps.getProvider();
  if (!provider) return;
  const entry = new StreamBuffer();
  const { body, stopBtn } = makeCard(list, title, meta, () => entry.text());
  if (sourceText) {
    const source = document.createElement("div");
    source.className = "card-source";
    source.textContent = sourceText;
    body.before(source);
  }
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    body.innerHTML = entry.html();
  };
  const handle = chatStream(provider, messages, (delta, reasoning) => {
    entry.push(delta, reasoning);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  });
  body.classList.add("streaming");
  let stopped = false;
  stopBtn.addEventListener("click", () => {
    stopped = true;
    handle.cancel();
  });
  handle.done
    .catch((err: unknown) => {
      const box = document.createElement("div");
      box.className = "card-error";
      box.textContent = errorMessage(err);
      body.innerHTML = "";
      body.append(box);
    })
    .finally(() => {
      body.classList.remove("streaming");
      stopBtn.remove();
      if (entry.isEmpty()) {
        body.innerHTML = `<div class="card-empty">${stopped ? "（已停止）" : "（无返回内容）"}</div>`;
      } else {
        body.innerHTML = entry.html(true);
      }
    });
}

function translatePrompt(text: string, lang: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        `你是专业的翻译引擎。将用户提交的内容翻译成${lang}：术语准确，保持段落结构，` +
        "代码、数学公式与引用标记原样保留。只输出译文，不要任何解释。",
    },
    { role: "user", content: text },
  ];
}

export function translateSelection(text: string): void {
  switchTab("translate");
  const lang = deps.getTargetLang();
  streamInto(translateList(), "划词翻译", `→ ${lang}`, translatePrompt(text, lang), text);
}

async function translatePage(): Promise<void> {
  const src = await deps.text.page();
  if (!src) {
    addNotice(translateList(), "先打开一个 PDF");
    return;
  }
  let text = src.text;
  if (text.length > PAGE_TRUNCATE) text = `${text.slice(0, PAGE_TRUNCATE)}…（内容过长，已截断）`;
  const lang = deps.getTargetLang();
  streamInto(
    translateList(),
    `第 ${src.page} 页翻译`,
    `→ ${lang}`,
    translatePrompt(`以下是 PDF 第 ${src.page} 页提取的文本：\n\n${text}`, lang),
    text
  );
}

// Group extracted page lines into paragraph-sized chunks so each can be
// translated as an independent streaming request (aligned pairs).
function splitParagraphs(text: string, targetChars = 400): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const paragraphs: string[] = [];
  let current = "";
  for (const line of lines) {
    const joiner = /[A-Za-z0-9.,;:!?)]$/.test(current) && /^[A-Za-z0-9(`"']/.test(line) ? " " : "";
    current += joiner + line;
    if (current.length >= targetChars) {
      paragraphs.push(current);
      current = "";
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

const BILINGUAL_MAX_PARAS = 12;
const BILINGUAL_CONCURRENCY = 2;

async function translatePageBilingual(): Promise<void> {
  const src = await deps.text.page();
  if (!src) {
    addNotice(translateList(), "先打开一个 PDF");
    return;
  }
  const provider = deps.getProvider();
  if (!provider) return;
  const paragraphs = splitParagraphs(src.text).slice(0, BILINGUAL_MAX_PARAS);
  if (paragraphs.length === 0) {
    addNotice(translateList(), `第 ${src.page} 页没有可提取的文本（可能是扫描件）`);
    return;
  }
  const lang = deps.getTargetLang();
  const handles: Array<{ cancel: () => void }> = [];
  let bilingualStopped = false;

  const { body, metaEl, stopBtn } = makeCard(
    translateList(),
    `第 ${src.page} 页对照`,
    `0/${paragraphs.length} 段`,
    () => slots.map((s) => s.buffer.text()).join("\n\n")
  );
  if (paragraphs.length >= BILINGUAL_MAX_PARAS) {
    metaEl.textContent = `0/${paragraphs.length} 段（取前 ${BILINGUAL_MAX_PARAS} 段）`;
  }

  // slots are created upfront in reading order; translations fill them in place
  interface Slot {
    textDiv: HTMLElement;
    buffer: StreamBuffer;
    scheduled: boolean;
    flush: () => void;
  }
  const slots: Slot[] = [];
  for (const paragraph of paragraphs) {
    const pair = document.createElement("div");
    pair.className = "pair";
    const srcDiv = document.createElement("div");
    srcDiv.className = "pair-src";
    const srcTag = document.createElement("span");
    srcTag.className = "pair-tag";
    srcTag.textContent = "原文";
    srcDiv.append(srcTag, document.createTextNode(paragraph));
    const dstTag = document.createElement("span");
    dstTag.className = "pair-tag";
    dstTag.textContent = `译文 → ${lang}`;
    const textDiv = document.createElement("div");
    textDiv.className = "md";
    pair.append(srcDiv, dstTag, textDiv);
    body.append(pair);
    const slot: Slot = {
      textDiv,
      buffer: new StreamBuffer(),
      scheduled: false,
      flush: () => {
        slot.scheduled = false;
        textDiv.innerHTML = slot.buffer.html();
      },
    };
    slots.push(slot);
  }

  let completed = 0;
  const updateMeta = (): void => {
    metaEl.textContent = `${completed}/${paragraphs.length} 段`;
  };

  const startOne = (index: number): Promise<void> => {
    const slot = slots[index];
    slot.textDiv.classList.add("streaming");
    const handle = chatStream(provider, translatePrompt(paragraphs[index], lang), (delta, reasoning) => {
      slot.buffer.push(delta, reasoning);
      if (!slot.scheduled) {
        slot.scheduled = true;
        requestAnimationFrame(slot.flush);
      }
    });
    handles.push(handle);
    return handle.done
      .catch((err: unknown) => {
        slot.buffer = new StreamBuffer();
        slot.textDiv.innerHTML = "";
        const box = document.createElement("div");
        box.className = "card-error";
        box.textContent = errorMessage(err);
        slot.textDiv.append(box);
      })
      .finally(() => {
        slot.textDiv.classList.remove("streaming");
        if (!slot.buffer.isEmpty()) {
          slot.textDiv.innerHTML = slot.buffer.html(true);
        } else {
          slot.textDiv.innerHTML = `<div class="card-empty">${
            bilingualStopped ? "（已停止）" : "（无返回内容）"
          }</div>`;
        }
        completed += 1;
        updateMeta();
      });
  };

  stopBtn.addEventListener("click", () => {
    bilingualStopped = true;
    for (const handle of handles) handle.cancel();
  });

  // two workers pull from a shared cursor; order is preserved by the slots
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < paragraphs.length) {
      const index = cursor++;
      await startOne(index);
    }
  };
  await Promise.all(Array.from({ length: BILINGUAL_CONCURRENCY }, () => worker()));
  stopBtn.remove();
}

async function summarizePage(): Promise<void> {
  const src = await deps.text.page();
  if (!src) {
    addNotice(summarizeList(), "先打开一个 PDF");
    return;
  }
  let text = src.text;
  if (text.length > PAGE_TRUNCATE) text = `${text.slice(0, PAGE_TRUNCATE)}…（内容过长，已截断）`;
  const lang = deps.getTargetLang();
  streamInto(
    summarizeList(),
    `第 ${src.page} 页总结`,
    lang,
    [
      {
        role: "system",
        content:
          `你是文档阅读助手。用${lang}总结用户提交的 PDF 页面：先用一段话概括核心内容，` +
          "再用要点列出关键信息。使用 Markdown 输出。",
      },
      { role: "user", content: text },
    ],
    text
  );
}

function summarizeSelection(): void {
  const text = deps.text.selection();
  if (!text) {
    switchTab("summarize");
    addNotice(summarizeList(), "先在 PDF 中选择一段文本");
    return;
  }
  const lang = deps.getTargetLang();
  streamInto(summarizeList(), "选区总结", lang, [
    {
      role: "system",
      content:
        `你是文档阅读助手。用${lang}总结用户提交的文本：先用一句话概括，再列出要点。` +
        "使用 Markdown 输出。",
    },
    { role: "user", content: text },
  ]);
}

async function summarizeDoc(): Promise<void> {
  const src = await deps.text.doc();
  if (!src || !src.text.trim()) {
    addNotice(summarizeList(), "先打开一个 PDF");
    return;
  }
  const lang = deps.getTargetLang();
  streamInto(summarizeList(), `全文总结`, `前 ${src.pages} 页`, [
    {
      role: "system",
      content:
        `你是文档阅读助手。用${lang}总结用户提交的整份 PDF：主题与背景、核心观点或结论、` +
        "结构与各部分要点、值得注意的数据或方法。使用 Markdown 输出。",
    },
    {
      role: "user",
      content: `以下是整份 PDF（前 ${src.pages} 页）的分页文本：\n\n${src.text}`,
    },
  ]);
}

function appendBubble(role: "user" | "assistant", text: string): HTMLElement {
  const bubble = document.createElement("div");
  bubble.className = `msg ${role} md`;
  bubble.textContent = text;
  el("chat-messages").append(bubble);
  el("chat-messages").scrollTop = el("chat-messages").scrollHeight;
  return bubble;
}

async function buildContext(scope: string): Promise<{ context: string; label: string } | null> {
  if (scope === "selection") {
    const text = deps.text.selection();
    if (!text) {
      appendBubble("assistant", "（先在 PDF 中选择一段文本，再切换到「选区」范围）");
      return null;
    }
    return { context: text, label: "选区" };
  }
  if (scope === "doc") {
    const src = await deps.text.doc();
    if (!src || !src.text.trim()) {
      appendBubble("assistant", "（先打开一个 PDF）");
      return null;
    }
    return { context: src.text, label: `全文前 ${src.pages} 页` };
  }
  const page = await deps.text.page();
  if (!page) {
    appendBubble("assistant", "（先打开一个 PDF）");
    return null;
  }
  return { context: `第 ${page.page} 页：\n${page.text}`, label: `第 ${page.page} 页` };
}

async function sendChat(): Promise<void> {
  const input = el("chat-input") as HTMLTextAreaElement;
  const question = input.value.trim();
  if (!question || chatBusy) return;
  const provider = deps.getProvider();
  if (!provider) return;

  const scope = (el("chat-scope") as HTMLSelectElement).value;
  const ctx = await buildContext(scope);
  if (!ctx) return;

  const lang = deps.getTargetLang();
  const system: ChatMessage = {
    role: "system",
    content:
      `你是 PDF 阅读助手，用${lang}回答。仅依据提供的文档内容回答，` +
      "内容不足以回答时明确说明。输出使用 Markdown。\n\n" +
      `=== 文档内容（${ctx.label}）===\n${ctx.context}`,
  };
  const userMsg: ChatMessage = { role: "user", content: question };
  appendBubble("user", question);
  input.value = "";
  const bubble = appendBubble("assistant", "…");

  const history = [system, ...chatHistory.slice(-12), userMsg];
  chatBusy = true;
  bubble.classList.add("streaming");
  el("btn-chat-send").classList.add("hidden");
  el("btn-chat-stop").classList.remove("hidden");
  const assistant = new StreamBuffer();
  let chatStopped = false;
  let scheduled = false;
  const flush = (final = false) => {
    scheduled = false;
    bubble.innerHTML = assistant.html(final);
    el("chat-messages").scrollTop = el("chat-messages").scrollHeight;
  };
  const handle = chatStream(provider, history, (delta, reasoning) => {
    assistant.push(delta, reasoning);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => flush(false));
    }
  });
  chatHandle = handle;
  const stopBtnChat = el("btn-chat-stop");
  const onStop = () => {
    chatStopped = true;
  };
  stopBtnChat.addEventListener("click", onStop);
  handle.done
    .catch((err: unknown) => {
      bubble.textContent = `⚠ ${errorMessage(err)}`;
    })
    .finally(() => {
      chatBusy = false;
      bubble.classList.remove("streaming");
      chatHandle = null;
      stopBtnChat.removeEventListener("click", onStop);
      el("btn-chat-send").classList.remove("hidden");
      el("btn-chat-stop").classList.add("hidden");
      if (assistant.text().trim()) {
        chatHistory.push(userMsg, { role: "assistant", content: assistant.text() });
        flush(true);
      } else if (!assistant.isEmpty()) {
        flush(true); // reasoning-only stream (stopped before the answer)
      } else {
        bubble.textContent = chatStopped ? "（已停止）" : "（无返回内容）";
        bubble.style.color = "var(--text-faint)";
        bubble.style.fontStyle = "italic";
      }
    });
}

export function initSidebar(d: SidebarDeps): void {
  deps = d;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab ?? "translate"));
  }
  el("btn-translate-page").addEventListener("click", () => void translatePage());
  el("btn-translate-bilingual").addEventListener("click", () => void translatePageBilingual());
  el("btn-export-bilingual").addEventListener("click", () => startBilingualExport());
  el("btn-export-annotations").addEventListener("click", () => void exportAnnotationsMarkdown());
  el("btn-copy-annotations").addEventListener("click", () => {
    const md = buildAnnotationsMarkdown(deps.annotations.list(), deps.annotations.meta());
    void copyToClipboard(md).then(() => setNotesStatus("已复制到剪贴板"));
  });
  renderNotes();
  el("btn-sum-page").addEventListener("click", () => void summarizePage());
  el("btn-sum-selection").addEventListener("click", () => summarizeSelection());
  el("btn-sum-doc").addEventListener("click", () => void summarizeDoc());

  el("btn-chat-send").addEventListener("click", () => void sendChat());
  el("btn-chat-stop").addEventListener("click", () => chatHandle?.cancel());
  (el("chat-input") as HTMLTextAreaElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  });
}

/* ---------- notes (annotations) tab ---------- */

function setNotesStatus(text: string, isError = false): void {
  const status = el("notes-status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

export function refreshAnnotations(): void {
  renderNotes();
}

function renderNotes(): void {
  const list = el("notes-list");
  list.innerHTML = "";
  const items = deps.annotations.list();
  if (items.length === 0) {
    const card = document.createElement("div");
    card.className = "card";
    const body = document.createElement("div");
    body.className = "card-body";
    const span = document.createElement("span");
    span.className = "card-empty";
    span.textContent = "在正文中划选文本即可高亮并写笔记；高亮支持三色，点击高亮可补笔记";
    body.append(span);
    card.append(body);
    list.append(card);
    return;
  }
  const sorted = [...items].sort((a, b) => a.page - b.page || a.created - b.created);
  for (const a of sorted) {
    const card = document.createElement("div");
    card.className = "card";
    const body = document.createElement("div");
    body.className = "card-body";

    const row = document.createElement("div");
    row.className = "note-row";
    const dot = document.createElement("span");
    dot.className = `note-dot ${a.color}`;
    const page = document.createElement("span");
    page.className = "note-page";
    page.textContent = `第 ${a.page} 页`;
    const translateBtn = document.createElement("button");
    translateBtn.className = "card-btn";
    translateBtn.textContent = "译";
    translateBtn.title = "翻译这条批注";
    translateBtn.addEventListener("click", () => deps.annotations.translate(a.excerpt));
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "card-btn";
    deleteBtn.textContent = "删";
    deleteBtn.title = "删除这条批注";
    deleteBtn.addEventListener("click", () => deps.annotations.remove(a.id));
    row.append(dot, page, translateBtn, deleteBtn);

    const excerpt = document.createElement("div");
    excerpt.className = "note-excerpt";
    excerpt.textContent = a.excerpt;
    excerpt.addEventListener("click", () => deps.annotations.jump(a));

    card.append(row, excerpt);
    if (a.note.trim()) {
      const note = document.createElement("div");
      note.className = "note-text";
      note.textContent = a.note;
      note.addEventListener("click", () => deps.annotations.jump(a));
      card.append(note);
    }
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("card-btn")) return;
      deps.annotations.jump(a);
    });
    list.append(card);
  }
}

function buildAnnotationsMarkdown(
  items: Annotation[],
  meta: { title: string; path: string | null } | null
): string {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.created - b.created);
  const lines: string[] = [];
  lines.push(`# 批注 — ${meta?.title ?? "文档"}`);
  lines.push("");
  if (meta?.path) lines.push(`> 来源：${meta.path}`);
  lines.push(`> 导出时间：${new Date().toLocaleString()} · 共 ${sorted.length} 条`);
  lines.push("");
  let lastPage = 0;
  for (const a of sorted) {
    if (a.page !== lastPage) {
      lines.push(`## 第 ${a.page} 页`);
      lines.push("");
      lastPage = a.page;
    }
    lines.push(`> ${a.excerpt.replace(/\n/g, "\n> ")}`);
    lines.push("");
    if (a.note.trim()) {
      lines.push(a.note.trim());
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function exportAnnotationsMarkdown(): Promise<void> {
  const items = deps.annotations.list();
  if (items.length === 0) {
    setNotesStatus("还没有批注", true);
    return;
  }
  const meta = deps.annotations.meta();
  const md = buildAnnotationsMarkdown(items, meta);
  try {
    const path = await saveDialog({
      defaultPath: `${(meta?.title ?? "批注").replace(/\.pdf$/i, "")}-批注.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof path === "string") {
      await invoke("save_text", { path, content: md });
      setNotesStatus(`✓ 已导出 ${items.length} 条批注`);
    } else {
      await copyToClipboard(md);
      setNotesStatus("已取消保存，Markdown 已复制到剪贴板");
    }
  } catch (e) {
    setNotesStatus(String(e), true);
  }
}

/* ---------- batch bilingual export ---------- */

let exportBusy = false;

function startBilingualExport(): void {
  if (exportBusy) return;
  const provider = deps.getProvider();
  if (!provider) return;
  const docPages = deps.text.pages();
  if (docPages === 0) {
    addNotice(translateList(), "先打开一个 PDF");
    return;
  }
  const btn = el("btn-export-bilingual") as HTMLButtonElement;
  btn.classList.add("hidden");
  const row = btn.parentElement!;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "30";
  input.value = "3";
  input.className = "inline-input";
  input.title = "导出前几页（1-30）";
  const go = document.createElement("button");
  go.className = "accent-btn";
  go.textContent = "翻译并导出";
  const cancel = document.createElement("button");
  cancel.className = "ghost-btn";
  cancel.textContent = "取消";
  row.insertBefore(input, btn);
  row.insertBefore(go, btn);
  row.insertBefore(cancel, btn);
  input.focus();
  const cleanup = (): void => {
    input.remove();
    go.remove();
    cancel.remove();
    btn.classList.remove("hidden");
  };
  cancel.addEventListener("click", cleanup);
  go.addEventListener("click", () => {
    const n = Math.max(1, Math.min(30, parseInt(input.value, 10) || 3));
    cleanup();
    void runBilingualExport(n, provider);
  });
}

interface ExportTask {
  index: number;
  page: number;
  paragraph: string;
  translation: string;
}

async function runBilingualExport(pages: number, provider: ProviderConfig): Promise<void> {
  exportBusy = true;
  const lang = deps.getTargetLang();
  const n = Math.min(pages, deps.text.pages());
  const { body, metaEl, stopBtn } = makeCard(translateList(), "导出对照翻译", "准备中…");

  const tasks: ExportTask[] = [];
  for (let p = 1; p <= n; p++) {
    const text = (await deps.text.pageText(p)).trim();
    if (!text) continue;
    for (const paragraph of splitParagraphs(text)) {
      tasks.push({ index: 0, page: p, paragraph, translation: "" });
    }
  }
  tasks.forEach((t, i) => (t.index = i));
  const total = tasks.length;
  let completed = 0;
  let stopped = false;
  const updateProgress = (page: number): void => {
    metaEl.textContent = `${completed}/${total} 段 · 第 ${page} 页`;
    body.innerHTML = `<div class="card-empty">正在翻译，完成后可选择保存为 Markdown…</div>`;
  };

  const handles: Array<{ cancel: () => void }> = [];
  stopBtn.addEventListener("click", () => {
    stopped = true;
    for (const h of handles) h.cancel();
  });

  const startOne = async (task: ExportTask): Promise<void> => {
    const handle = chatStream(provider, translatePrompt(task.paragraph, lang), (delta) => {
      task.translation += delta;
    });
    handles.push(handle);
    await handle.done.catch((err: unknown) => {
      task.translation = `⚠ ${errorMessage(err)}`;
    });
    completed += 1;
    updateProgress(task.page);
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < total) {
      if (stopped) return;
      await startOne(tasks[cursor++]);
    }
  };
  updateProgress(1);
  await Promise.all(Array.from({ length: BILINGUAL_CONCURRENCY }, () => worker()));
  stopBtn.remove();

  const sorted = [...tasks].sort((a, b) => a.index - b.index);
  const meta = deps.annotations.meta();
  const lines: string[] = [];
  lines.push(`# ${meta?.title ?? "文档"} — 对照翻译（前 ${n} 页）`);
  lines.push("");
  lines.push(`> 译入：${lang} · 导出时间：${new Date().toLocaleString()}`);
  lines.push("");
  let lastPage = 0;
  for (const t of sorted) {
    if (t.page !== lastPage) {
      lines.push(`## 第 ${t.page} 页`);
      lines.push("");
      lastPage = t.page;
    }
    lines.push("**原文**");
    lines.push("");
    lines.push(`> ${t.paragraph.replace(/\n/g, "\n> ")}`);
    lines.push("");
    lines.push(`**译文（${lang}）**`);
    lines.push("");
    lines.push(`> ${t.translation.replace(/\n/g, "\n> ")}`);
    lines.push("");
  }
  const md = lines.join("\n");
  exportBusy = false;

  try {
    const path = await saveDialog({
      defaultPath: `${(meta?.title ?? "document").replace(/\.pdf$/i, "")}-对照翻译.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof path === "string") {
      await invoke("save_text", { path, content: md });
      body.innerHTML = `<div class="card-empty">✓ 已导出 ${total} 段到 ${path}</div>`;
    } else {
      await copyToClipboard(md);
      body.innerHTML = `<div class="card-empty">已取消保存，${total} 段对照内容已复制到剪贴板</div>`;
    }
  } catch (err) {
    body.innerHTML = "";
    const box = document.createElement("div");
    box.className = "card-error";
    box.textContent = `导出失败：${errorMessage(err)}（内容已复制到剪贴板）`;
    body.append(box);
    await copyToClipboard(md);
  }
}
