use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AnnotationRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Default for AnnotationRect {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Annotation {
    pub id: String,
    pub page: u32,
    pub rects: Vec<AnnotationRect>,
    pub excerpt: String,
    pub color: String,
    pub note: String,
    pub created: i64,
}

impl Default for Annotation {
    fn default() -> Self {
        Self {
            id: String::new(),
            page: 1,
            rects: Vec::new(),
            excerpt: String::new(),
            color: "yellow".into(),
            note: String::new(),
            created: 0,
        }
    }
}

// FNV-1a 64-bit — stable across processes, unlike std's DefaultHasher.
fn fnv1a64(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn storage_path(app: &AppHandle, source: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("annotations");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{:016x}.json", fnv1a64(source))))
}

#[tauri::command]
pub fn load_annotations(app: AppHandle, path: String) -> Result<Vec<Annotation>, String> {
    let file = storage_path(&app, &path)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&file).map_err(|e| format!("读取批注失败：{e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("批注文件解析失败：{e}"))
}

#[tauri::command]
pub fn save_annotations(app: AppHandle, path: String, annotations: Vec<Annotation>) -> Result<(), String> {
    let file = storage_path(&app, &path)?;
    let json = serde_json::to_string_pretty(&annotations).map_err(|e| e.to_string())?;
    fs::write(&file, json).map_err(|e| format!("保存批注失败：{e}"))
}
