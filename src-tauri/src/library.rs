use tauri::ipc::Response;

/// Reads a PDF from disk so the frontend can reopen recent files by path.
/// The result ships as raw IPC bytes; the frontend feeds them to PDF.js.
#[tauri::command]
pub fn read_pdf(path: String) -> Result<Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取文件：{e}"))?;
    Ok(Response::new(bytes))
}
