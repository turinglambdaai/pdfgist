import { invoke } from "@tauri-apps/api/core";
import { el } from "./dom";
import { listModels } from "./ai";
import { LANGUAGES, PRESETS, type ProviderConfig, type Settings } from "./types";

interface PresetState {
  base_url: string;
  api_key: string;
  model: string;
}

let current: Settings;
const perPreset = new Map<string, PresetState>();
let needConfigHint: () => void = () => {};

function defaultSettings(): Settings {
  const preset = PRESETS.find((p) => p.id === "deepseek") ?? PRESETS[0];
  return {
    provider: {
      name: preset.id,
      base_url: preset.base_url,
      api_key: "",
      model: preset.models[0] ?? "",
    },
    target_language: "中文",
    recent_files: [],
    view_mode: "single",
  };
}

export function currentSettings(): Settings {
  return current;
}

export function providerConfig(): ProviderConfig {
  return current.provider;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await invoke("save_settings", { settings });
}

function setStatus(text: string, isError = false): void {
  const status = el("settings-status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function fillForm(): void {
  const p = current.provider;
  (el("preset-select") as HTMLSelectElement).value = p.name;
  (el("base-url") as HTMLInputElement).value = p.base_url;
  (el("api-key") as HTMLInputElement).value = p.api_key;
  (el("model-input") as HTMLInputElement).value = p.model;
  for (const id of ["target-lang", "target-lang-settings"]) {
    (el(id) as HTMLSelectElement).value = current.target_language;
  }
}

function applyPresetDefaults(id: string): void {
  const preset = PRESETS.find((p) => p.id === id);
  const p = current.provider;
  p.name = id;
  p.base_url = preset?.base_url ?? "";
  p.model = preset?.models[0] ?? "";
  p.api_key = "";
  const saved = perPreset.get(id);
  if (saved) {
    p.base_url = saved.base_url;
    p.api_key = saved.api_key;
    p.model = saved.model;
  }
}

function stashForm(): void {
  const p = current.provider;
  perPreset.set(p.name, { base_url: p.base_url, api_key: p.api_key, model: p.model });
}

export async function initSettings(onNeedConfig: () => void): Promise<void> {
  needConfigHint = onNeedConfig;
  const fallback = defaultSettings();
  try {
    const stored = await invoke<Partial<Settings>>("get_settings");
    // an empty provider means no real settings exist yet (fresh install or
    // hand-cleared file) — don't let empty strings override the defaults
    current = {
      provider: stored.provider?.name
        ? { ...fallback.provider, ...stored.provider }
        : fallback.provider,
      target_language: stored.target_language || fallback.target_language,
      recent_files: Array.isArray(stored.recent_files) ? stored.recent_files : [],
      view_mode: stored.view_mode === "double" ? "double" : "single",
    };
  } catch {
    current = fallback;
  }

  const presetSelect = el("preset-select") as HTMLSelectElement;
  for (const preset of PRESETS) {
    const opt = document.createElement("option");
    opt.value = preset.id;
    opt.textContent = preset.name;
    presetSelect.append(opt);
  }
  for (const id of ["target-lang", "target-lang-settings"]) {
    const select = el(id) as HTMLSelectElement;
    for (const lang of LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = lang;
      opt.textContent = lang;
      select.append(opt);
    }
  }

  presetSelect.addEventListener("change", () => {
    stashForm();
    applyPresetDefaults(presetSelect.value);
    fillForm();
  });
  (el("base-url") as HTMLInputElement).addEventListener("input", (e) => {
    current.provider.base_url = (e.target as HTMLInputElement).value.trim();
  });
  (el("api-key") as HTMLInputElement).addEventListener("input", (e) => {
    current.provider.api_key = (e.target as HTMLInputElement).value.trim();
  });
  (el("model-input") as HTMLInputElement).addEventListener("input", (e) => {
    current.provider.model = (e.target as HTMLInputElement).value.trim();
  });
  for (const id of ["target-lang", "target-lang-settings"]) {
    (el(id) as HTMLSelectElement).addEventListener("change", (e) => {
      current.target_language = (e.target as HTMLSelectElement).value;
      void saveSettings(current).catch(() => {});
      fillForm();
    });
  }

  el("btn-save-settings").addEventListener("click", () => {
    saveSettings(current)
      .then(() => setStatus("✓ 已保存"))
      .catch((e) => setStatus(`保存失败：${e}`, true));
  });

  const fetchModels = async () => {
    setStatus("正在拉取模型列表…");
    try {
      const models = await listModels(current.provider);
      const datalist = el("model-list");
      datalist.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        datalist.append(opt);
      }
      setStatus(
        models.length > 0
          ? `✓ 连接正常，共 ${models.length} 个模型`
          : "✓ 连接正常（服务商未返回模型列表，可直接手填模型名）"
      );
    } catch (e) {
      setStatus(String(e), true);
    }
  };
  el("btn-fetch-models").addEventListener("click", () => void fetchModels());
  el("btn-test").addEventListener("click", () => void fetchModels());

  fillForm();
}

export function ensureProviderConfigured(): ProviderConfig | null {
  const p = current.provider;
  const missingKey = p.api_key.length === 0 && p.name !== "ollama";
  if (!p.base_url || !p.model || missingKey) {
    needConfigHint();
    setStatus("请先完成服务商配置并保存", true);
    return null;
  }
  return p;
}
