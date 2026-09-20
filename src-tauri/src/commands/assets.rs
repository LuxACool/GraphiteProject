use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub id: String,
    pub category: String,
    pub relative_path: String,
    pub path: String,
    pub bytes: u64,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("Could not resolve app data directory: {e}"))?.join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create asset directory: {e}"))?;
    for category in ["images", "attachments", "canvas", "imports"] {
        fs::create_dir_all(dir.join(category)).map_err(|e| format!("Could not create asset category: {e}"))?;
    }
    Ok(dir)
}

fn safe_component(value: &str) -> Result<String, String> {
    let p = Path::new(value);
    if value.is_empty() || p.is_absolute() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Invalid asset path".into());
    }
    Ok(value.replace('\\', "/"))
}

fn category_dir(app: &AppHandle, category: &str) -> Result<PathBuf, String> {
    if !matches!(category, "images" | "attachments" | "canvas" | "imports") {
        return Err(format!("Unsupported asset category: {category}"));
    }
    let dir = root(app)?.join(category);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn asset_root(app: AppHandle) -> Result<String, String> {
    Ok(root(&app)?.display().to_string())
}

#[tauri::command]
pub fn asset_write(app: AppHandle, category: String, relative_path: String, bytes: Vec<u8>) -> Result<AssetInfo, String> {
    let relative_path = safe_component(&relative_path)?;
    let base = category_dir(&app, &category)?;
    let path = base.join(&relative_path);
    if !path.starts_with(&base) { return Err("Asset path escapes its category".into()); }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    fs::write(&path, &bytes).map_err(|e| format!("Could not write asset: {e}"))?;
    let id = format!("{category}/{relative_path}");
    Ok(AssetInfo { id, category, relative_path, path: path.display().to_string(), bytes: bytes.len() as u64 })
}

#[tauri::command]
pub fn asset_read(app: AppHandle, category: String, relative_path: String) -> Result<Vec<u8>, String> {
    let relative_path = safe_component(&relative_path)?;
    let base = category_dir(&app, &category)?;
    let path = base.join(&relative_path);
    if !path.starts_with(&base) { return Err("Asset path escapes its category".into()); }
    fs::read(path).map_err(|e| format!("Could not read asset: {e}"))
}

#[tauri::command]
pub fn asset_delete(app: AppHandle, category: String, relative_path: String) -> Result<bool, String> {
    let relative_path = safe_component(&relative_path)?;
    let base = category_dir(&app, &category)?;
    let path = base.join(&relative_path);
    if !path.starts_with(&base) { return Err("Asset path escapes its category".into()); }
    if !path.exists() { return Ok(false); }
    fs::remove_file(path).map_err(|e| format!("Could not delete asset: {e}"))?;
    Ok(true)
}
