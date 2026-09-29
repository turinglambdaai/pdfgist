use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::CancelState;

#[derive(Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChatRequest {
    pub id: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta { text: String, reasoning: bool },
    Cancelled,
    Error { message: String },
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

// Accepts bare hosts, versioned bases (/v1, /v3, /v4, ...) and even full
// chat-completions URLs. A URL already ending in a version segment is kept
// as-is; /v1 is only appended when no version segment exists at all.
fn normalize_base_url(input: &str) -> String {
    let mut base = input.trim().trim_end_matches('/').to_string();
    if let Some(stripped) = base.strip_suffix("/chat/completions") {
        base = stripped.trim_end_matches('/').to_string();
    }
    let last = base.rsplit('/').next().unwrap_or("");
    let has_version = last
        .strip_prefix(['v', 'V'])
        .map(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or(false);
    if !has_version {
        base.push_str("/v1");
    }
    base
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

// Returns the delta text and whether it is chain-of-thought rather than
// answer content (reasoning models stream their thinking in a separate
// field). The frontend renders reasoning dimmed until real content arrives.
fn delta_text(value: &serde_json::Value) -> Option<(String, bool)> {
    let choice = value.get("choices")?.get(0)?;
    let delta = choice.get("delta")?;
    if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
        return Some((text.to_string(), false));
    }
    delta
        .get("reasoning_content")
        .and_then(|v| v.as_str())
        .map(|text| (text.to_string(), true))
}

#[tauri::command]
pub async fn llm_chat(
    state: State<'_, CancelState>,
    req: ChatRequest,
    on_delta: Channel<StreamEvent>,
) -> Result<(), String> {
    let token = CancellationToken::new();
    {
        let mut guards = state.0.lock().unwrap();
        guards.insert(req.id.clone(), token.clone());
    }
    let result = run_chat(&req, token, &on_delta).await;
    state.0.lock().unwrap().remove(&req.id);
    match result {
        Ok(true) => {
            let _ = on_delta.send(StreamEvent::Cancelled);
            Ok(())
        }
        Ok(false) => Ok(()),
        Err(message) => {
            let _ = on_delta.send(StreamEvent::Error {
                message: message.clone(),
            });
            Err(message)
        }
    }
}

#[tauri::command]
pub fn llm_stop(state: State<'_, CancelState>, id: String) {
    if let Some(token) = state.0.lock().unwrap().remove(&id) {
        token.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_base_url;

    #[test]
    fn keeps_provider_version_segments() {
        assert_eq!(
            normalize_base_url("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://open.bigmodel.cn/api/coding/paas/v4"),
            "https://open.bigmodel.cn/api/coding/paas/v4"
        );
        assert_eq!(
            normalize_base_url("https://open.bigmodel.cn/api/paas/v4/"),
            "https://open.bigmodel.cn/api/paas/v4"
        );
        assert_eq!(
            normalize_base_url("https://ark.cn-beijing.volces.com/api/v3"),
            "https://ark.cn-beijing.volces.com/api/v3"
        );
    }

    #[test]
    fn appends_v1_when_missing() {
        assert_eq!(
            normalize_base_url("https://api.example.com"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://api.example.com/gateway/"),
            "https://api.example.com/gateway/v1"
        );
    }

    #[test]
    fn strips_full_chat_completions_path() {
        assert_eq!(
            normalize_base_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1"
        );
    }
}

#[tauri::command]
pub async fn list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let client = http_client()?;
    let url = format!("{}/models", normalize_base_url(&base_url));
    let mut builder = client.get(&url).timeout(Duration::from_secs(20));
    if !api_key.is_empty() {
        builder = builder.bearer_auth(&api_key);
    }
    let response = builder.send().await.map_err(|e| format!("连接失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败：{e}"))?;
    let ids = value
        .get("data")
        .and_then(|d| d.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(ids)
}

async fn run_chat(
    req: &ChatRequest,
    token: CancellationToken,
    on_delta: &Channel<StreamEvent>,
) -> Result<bool, String> {
    let client = http_client()?;
    let url = format!("{}/chat/completions", normalize_base_url(&req.base_url));
    let body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "stream": true
    });
    let mut builder = client.post(&url).json(&body);
    if !req.api_key.is_empty() {
        builder = builder.bearer_auth(&req.api_key);
    }
    let response = builder.send().await.map_err(|e| format!("连接失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {status}：{}（POST {url}）",
            truncate_chars(text.trim(), 400)
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        tokio::select! {
            _ = token.cancelled() => return Ok(true),
            chunk = stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| format!("读取响应失败：{e}"))?;
                buffer.extend_from_slice(&chunk);
                while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = buffer.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&line).trim().to_string();
                    let Some(payload) = line.strip_prefix("data:") else { continue };
                    let payload = payload.trim();
                    if payload == "[DONE]" {
                        return Ok(false);
                    }
                    if payload.is_empty() {
                        continue;
                    }
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                        if let Some((text, reasoning)) = delta_text(&value) {
                            if !text.is_empty() {
                                let _ = on_delta.send(StreamEvent::Delta { text, reasoning });
                            }
                        }
                    }
                }
                if buffer.len() > 4 * 1024 * 1024 {
                    return Err("响应数据异常（单行过长）".into());
                }
            }
        }
    }
    Ok(false)
}
