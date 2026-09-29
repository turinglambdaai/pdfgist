import { invoke, Channel } from "@tauri-apps/api/core";
import type { ChatMessage, ChatRequest, ProviderConfig, StreamEvent } from "./types";

export interface StreamHandle {
  done: Promise<void>;
  cancel: () => void;
}

let seq = 0;

// Streams one OpenAI-compatible chat completion through the Rust backend.
// Deltas arrive via the channel (`reasoning` marks chain-of-thought text
// from reasoning models); the promise settles when the stream ends
// (rejecting with the provider error message on failure).
export function chatStream(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  onDelta: (text: string, reasoning: boolean) => void
): StreamHandle {
  const id = `req-${Date.now().toString(36)}-${seq++}`;
  let error: Error | null = null;
  let resolveDone!: () => void;
  let rejectDone!: (err: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const channel = new Channel<StreamEvent>();
  channel.onmessage = (event) => {
    if (event.type === "delta") {
      onDelta(event.text, event.reasoning);
    } else if (event.type === "error") {
      error = new Error(event.message);
    }
    // "cancelled" needs no handling: the invoke promise resolves right after.
  };

  const req: ChatRequest = {
    id,
    base_url: cfg.base_url,
    api_key: cfg.api_key,
    model: cfg.model,
    messages,
  };
  invoke("llm_chat", { req, onDelta: channel })
    .then(() => {
      if (error) rejectDone(error);
      else resolveDone();
    })
    .catch((e) => rejectDone(error ?? new Error(String(e))));

  return {
    done,
    cancel: () => {
      invoke("llm_stop", { id }).catch(() => {});
    },
  };
}

export async function listModels(cfg: ProviderConfig): Promise<string[]> {
  return invoke<string[]>("list_models", { baseUrl: cfg.base_url, apiKey: cfg.api_key });
}
