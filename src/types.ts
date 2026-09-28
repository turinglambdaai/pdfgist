export interface ProviderPreset {
  id: string;
  name: string;
  base_url: string;
  models: string[];
}

// Field names mirror the Rust structs (snake_case) on purpose.
export interface ProviderConfig {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

export interface Settings {
  provider: ProviderConfig;
  target_language: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  id: string;
  base_url: string;
  api_key: string;
  model: string;
  messages: ChatMessage[];
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export const LANGUAGES = [
  "中文",
  "繁體中文",
  "English",
  "日本語",
  "한국어",
  "Français",
  "Deutsch",
  "Español",
] as const;

export const PRESETS: ProviderPreset[] = [
  {
    id: "glm-coding",
    name: "GLM Coding 套餐（智谱）",
    base_url: "https://open.bigmodel.cn/api/coding/paas/v4",
    models: ["glm-5", "glm-4.6", "glm-4.5-air", "glm-4.5-flash"],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5", "glm-4.6", "glm-4.5-flash"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "qwen",
    name: "通义千问 Qwen",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3-max", "qwen-plus", "qwen-flash"],
  },
  {
    id: "doubao",
    name: "豆包（火山方舟）",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seed-2-1-pro", "doubao-seed-2-0-lite"],
  },
  {
    id: "moonshot",
    name: "Moonshot Kimi",
    base_url: "https://api.moonshot.cn/v1",
    models: ["kimi-k2-0905-preview", "kimi-latest", "moonshot-v1-8k"],
  },
  {
    id: "siliconflow",
    name: "SiliconFlow 硅基流动",
    base_url: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen3-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
  },
  {
    id: "openai",
    name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    base_url: "http://localhost:11434/v1",
    models: ["qwen3", "llama3.1"],
  },
  {
    id: "custom",
    name: "自定义",
    base_url: "",
    models: [],
  },
];
