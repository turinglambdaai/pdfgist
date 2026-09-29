mod annotations;
mod library;
mod llm;
mod settings;

use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

// Active LLM streams keyed by request id, so the frontend can cancel one.
pub struct CancelState(pub Mutex<HashMap<String, CancellationToken>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CancelState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            library::read_pdf,
            library::save_text,
            annotations::load_annotations,
            annotations::save_annotations,
            llm::llm_chat,
            llm::llm_stop,
            llm::list_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
