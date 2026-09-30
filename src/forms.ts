// Sidebar: FORM tab (AcroForm fields) + export of the filled PDF via pdf-lib.
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { el } from "./dom";
import type { FormField } from "./types";

interface FormDeps {
  collect: () => Promise<FormField[]>;
  setValue: (name: string, value: string | boolean) => void;
  meta: () => { title: string; path: string | null } | null;
  isPdf: () => boolean;
}

let deps: FormDeps;
let fieldsLoaded = false;
let fields: FormField[] = [];
const values = new Map<string, string | boolean>();
let exportBusy = false;

function setFormStatus(text: string, isError = false): void {
  const status = el("forms-status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function renderFormFields(): void {
  const list = el("forms-list");
  list.innerHTML = "";
  if (fields.length === 0) {
    const card = document.createElement("div");
    card.className = "card";
    const body = document.createElement("div");
    body.className = "card-body";
    const span = document.createElement("span");
    span.className = "card-empty";
    span.textContent = "本文档没有可填写的表单字段";
    body.append(span);
    card.append(body);
    list.append(card);
    return;
  }
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "form-field-row";
    const name = document.createElement("div");
    name.className = "form-field-name";
    const typeLabel = { Tx: "文本", Btn: "勾选", Ch: "选择" }[f.type] ?? f.type;
    name.innerHTML = `<span class="field-type">${typeLabel}</span>`;
    name.append(document.createTextNode(f.name));
    row.append(name);

    if (f.type === "Btn") {
      const wrap = document.createElement("label");
      wrap.className = "form-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = values.get(f.name) === true;
      cb.addEventListener("change", () => {
        values.set(f.name, cb.checked);
        deps.setValue(f.name, cb.checked);
      });
      wrap.append(cb, document.createTextNode("勾选"));
      row.append(wrap);
    } else if (f.type === "Ch") {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "选项值（需与表单选项完全一致）";
      input.value = typeof values.get(f.name) === "string" ? String(values.get(f.name)) : "";
      input.addEventListener("input", () => {
        values.set(f.name, input.value);
        deps.setValue(f.name, input.value);
      });
      row.append(input);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.value = typeof values.get(f.name) === "string" ? String(values.get(f.name)) : "";
      input.addEventListener("input", () => {
        values.set(f.name, input.value);
        deps.setValue(f.name, input.value);
      });
      row.append(input);
    }
    list.append(row);
  }
}

async function loadFields(force = false): Promise<void> {
  if (fieldsLoaded && !force) return;
  setFormStatus("正在读取表单字段…");
  try {
    fields = await deps.collect();
    fieldsLoaded = true;
    setFormStatus(fields.length > 0 ? `共 ${fields.length} 个字段` : "");
    renderFormFields();
  } catch (e) {
    setFormStatus(String(e), true);
  }
}

function onTabOrDocChanged(): void {
  fieldsLoaded = false;
  fields = [];
  values.clear();
  if (deps.isPdf() && el("tab-forms").classList.contains("active")) {
    void loadFields();
  } else {
    renderFormFields();
  }
}

async function exportFilledPdf(): Promise<void> {
  if (exportBusy) return;
  const meta = deps.meta();
  if (!meta?.path) {
    setFormStatus("仅支持从磁盘打开的 PDF 导出", true);
    return;
  }
  if (fields.length === 0) {
    setFormStatus("本文档没有表单字段", true);
    return;
  }
  exportBusy = true;
  setFormStatus("正在生成…");
  try {
    const { PDFDocument } = await import("pdf-lib");
    const buf = await invoke<ArrayBuffer>("read_pdf", { path: meta.path });
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const form = doc.getForm();
    let filled = 0;
    const skipped: string[] = [];
    for (const f of fields) {
      if (!values.has(f.name)) continue;
      const raw = values.get(f.name) ?? "";
      const v = typeof raw === "boolean" ? "" : raw;
      try {
        if (f.type === "Btn") {
          if (raw === true) form.getCheckBox(f.name).check();
          else form.getCheckBox(f.name).uncheck();
        } else if (f.type === "Ch") {
          try {
            form.getDropdown(f.name).select(v);
          } catch {
            form.getOptionList(f.name).select(v);
          }
        } else {
          form.getTextField(f.name).setText(v);
        }
        filled += 1;
      } catch {
        skipped.push(f.name);
      }
    }
    form.updateFieldAppearances();
    const bytes = await doc.save();
    const b64 = bytesToB64(bytes);
    const path = await saveDialog({
      defaultPath: `${(meta.title ?? "form").replace(/\.pdf$/i, "")}-已填写.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof path === "string") {
      await invoke("save_file_b64", { path, bytesB64: b64 });
      setFormStatus(
        skipped.length > 0
          ? `✓ 已导出（填写 ${filled} 个，跳过 ${skipped.length} 个：${skipped.join("、")}）`
          : `✓ 已导出 ${filled} 个字段`
      );
    } else {
      setFormStatus("已取消导出");
    }
  } catch (e) {
    setFormStatus(`导出失败：${e}`, true);
  } finally {
    exportBusy = false;
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function initFormTab(d: FormDeps): void {
  deps = d;
  el("btn-export-filled").addEventListener("click", () => void exportFilledPdf());
  document
    .querySelector('.tab-btn[data-tab="forms"]')
    ?.addEventListener("click", () => {
      void loadFields(true);
    });
}

// Called when the active document changes: drops cached fields so the next
// activation reads the new document.
export function resetFormCache(): void {
  fieldsLoaded = false;
  fields = [];
  values.clear();
}

export function onFormContextChanged(): void {
  onTabOrDocChanged();
}

export function reloadFormFields(): Promise<void> {
  return loadFields();
}

// Loads fields when the FORM tab becomes active (click or programmatic).
export function activateFormTab(): void {
  fieldsLoaded = false;
  void loadFields(true);
}
