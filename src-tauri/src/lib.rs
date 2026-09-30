mod annotations;
mod library;
mod llm;
mod settings;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

// Active LLM streams keyed by request id, so the frontend can cancel one.
pub struct CancelState(pub Mutex<HashMap<String, CancellationToken>>);

pub fn run() {
    // Single instance: a second launch (e.g. double-clicking a PDF) forwards
    // the file path to the running app instead of spawning a new process.
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.iter().nth(1) {
                let _ = app.emit("open-file", path.clone());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CancelState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            library::read_pdf,
            library::save_text,
            library::save_file_b64,
            annotations::load_document,
            annotations::save_document,
            llm::llm_chat,
            llm::llm_stop,
            llm::list_models
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let argv: Vec<String> = std::env::args().collect();
            if argv.len() > 1 {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let _ = handle.emit("open-file", argv[1].clone());
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
