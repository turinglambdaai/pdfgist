import { chatStream } from "./ai";
import { el } from "./dom";
import { renderMarkdown } from "./markdown";
import type { ChatMessage, ProviderConfig } from "./types";

export interface TextSource {
  page: () => Promise<{ page: number; text: string } | null>;
  selection: () => string | null;
  doc: () => Promise<{ pages: number; text: string } | null>;
}

export interface SidebarDeps {
  getProvider: () => ProviderConfig | null;
  getTargetLang: () => string;
  text: TextSource;
}

interface StreamEntry {
  raw: string;
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
}

interface Card {
  body: HTMLElement;
  stopBtn: HTMLButtonElement;
}

function makeCard(list: HTMLElement, title: string, meta: string): Card {
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
  const closeBtn = document.createElement("button");
  closeBtn.className = "card-btn";
  closeBtn.textContent = "×";
  actions.append(stopBtn, closeBtn);
  header.append(titleEl, metaEl, actions);
  const body = document.createElement("div");
  body.className = "card-body md";
  card.append(header, body);
  list.prepend(card);
  closeBtn.addEventListener("click", () => card.remove());
  return { body, stopBtn };
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
  const { body, stopBtn } = makeCard(list, title, meta);
  if (sourceText) {
    const source = document.createElement("div");
    source.className = "card-source";
    source.textContent = sourceText;
    body.before(source);
  }
  const entry: StreamEntry = { raw: "" };
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    body.innerHTML = renderMarkdown(entry.raw);
  };
  const handle = chatStream(provider, messages, (delta) => {
    entry.raw += delta;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  });
  body.classList.add("streaming");
  stopBtn.addEventListener("click", () => handle.cancel());
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
      if (!entry.raw.trim()) {
        body.innerHTML = `<div class="card-empty">（无返回内容）</div>`;
      } else {
        flush();
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
  let assistantText = "";
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    bubble.innerHTML = renderMarkdown(assistantText);
    el("chat-messages").scrollTop = el("chat-messages").scrollHeight;
  };
  const handle = chatStream(provider, history, (delta) => {
    assistantText += delta;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  });
  chatHandle = handle;
  handle.done
    .catch((err: unknown) => {
      bubble.textContent = `⚠ ${errorMessage(err)}`;
    })
    .finally(() => {
      chatBusy = false;
      bubble.classList.remove("streaming");
      chatHandle = null;
      el("btn-chat-send").classList.remove("hidden");
      el("btn-chat-stop").classList.add("hidden");
      if (assistantText.trim()) {
        chatHistory.push(userMsg, { role: "assistant", content: assistantText });
        flush();
      } else {
        bubble.remove();
      }
    });
}

export function initSidebar(d: SidebarDeps): void {
  deps = d;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab ?? "translate"));
  }
  el("btn-translate-page").addEventListener("click", () => void translatePage());
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
