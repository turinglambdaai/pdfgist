use std::fs;

use base64::Engine as _;
use tauri::ipc::Response;

/// Saves base64-encoded binary content (e.g. a form-filled PDF exported by
/// pdf-lib in the frontend) to a user-chosen path.
#[tauri::command]
pub fn save_file_b64(path: String, bytes_b64: String) -> Result<(), String> {
    use base64::engine::general_purpose::STANDARD as B64;
    let bytes = B64.decode(bytes_b64.trim()).map_err(|e| format!("解码失败：{e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("保存文件失败：{e}"))
}

/// Reads a PDF from disk so the frontend can reopen recent files by path.
/// The result ships as raw IPC bytes; the frontend feeds them to PDF.js.
#[tauri::command]
pub fn read_pdf(path: String) -> Result<Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取文件：{e}"))?;
    Ok(Response::new(bytes))
}

/// Writes frontend-generated text (annotation/batch-translation exports)
/// to a user-chosen path.
#[tauri::command]
pub fn save_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("保存文件失败：{e}"))
}
