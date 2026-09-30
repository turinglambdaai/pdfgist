use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct ProviderConfig {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            name: "deepseek".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            api_key: String::new(),
            model: "deepseek-chat".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct RecentFile {
    pub path: String,
    pub title: String,
    pub page: u32,
    pub scroll_ratio: f64,
    pub last_read: i64,
}

impl Default for RecentFile {
    fn default() -> Self {
        Self {
            path: String::new(),
            title: String::new(),
            page: 1,
            scroll_ratio: 0.0,
            last_read: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    pub provider: ProviderConfig,
    pub target_language: String,
    pub recent_files: Vec<RecentFile>,
    pub view_mode: String,
    pub annotation_sidecar: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: ProviderConfig::default(),
            target_language: "中文".into(),
            recent_files: Vec::new(),
            view_mode: "single".into(),
            annotation_sidecar: false,
        }
    }
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取设置失败：{e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("设置文件解析失败：{e}"))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = config_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("写入设置失败：{e}"))
}
