use serde::Serialize;
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct BackupResult {
    pub path: String,
    pub bytes: usize,
}

fn backup_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn create_backup(app: AppHandle, payload: String) -> Result<BackupResult, String> {
    let dir = backup_dir(&app)?;
    let timestamp = chrono_like_timestamp();
    let path = dir.join(format!("graphite-backup-{timestamp}.json"));
    fs::write(&path, payload.as_bytes()).map_err(|e| e.to_string())?;
    Ok(BackupResult { path: path.display().to_string(), bytes: payload.len() })
}

#[tauri::command]
pub fn read_latest_backup(app: AppHandle) -> Result<Option<String>, String> {
    let dir = backup_dir(&app)?;
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|v| v.to_str()) == Some("json"))
        .collect();
    entries.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let Some(entry) = entries.pop() else { return Ok(None); };
    fs::read_to_string(entry.path()).map(Some).map_err(|e| e.to_string())
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullBackupResult {
    pub path: String,
    pub database: String,
    pub assets_path: String,
    pub manifest: String,
    pub created_at: String,
}

fn full_backup_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = backup_dir(app)?.join("snapshots");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    if !src.exists() { return Ok(()); }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() { copy_dir_recursive(&path, &target)?; }
        else { fs::copy(&path, &target).map_err(|e| format!("Could not copy backup asset {}: {e}", path.display()))?; }
    }
    Ok(())
}

#[tauri::command]
pub fn create_full_backup(app: AppHandle, payload: String) -> Result<FullBackupResult, String> {
    let base = full_backup_dir(&app)?;
    let timestamp = chrono_like_timestamp();
    let dir = base.join(format!("graphite-{timestamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Checkpoint WAL so the copied database is self-contained. SQLite can
    // reopen the snapshot even if the live app continues running afterward.
    let (conn, db_path) = crate::database::open(&app)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(|e| format!("Could not checkpoint SQLite before backup: {e}"))?;
    let db_target = dir.join("graphite.db");
    fs::copy(&db_path, &db_target).map_err(|e| format!("Could not copy SQLite database: {e}"))?;

    let assets_source = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assets");
    let assets_target = dir.join("assets");
    copy_dir_recursive(&assets_source, &assets_target)?;

    let manifest = serde_json::json!({
        "format": 1,
        "createdAt": timestamp,
        "database": "graphite.db",
        "assets": "assets",
        "stateSnapshot": serde_json::from_str::<serde_json::Value>(&payload).unwrap_or(serde_json::Value::Null),
    });
    let manifest_path = dir.join("manifest.json");
    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;

    Ok(FullBackupResult {
        path: dir.display().to_string(),
        database: db_target.display().to_string(),
        assets_path: assets_target.display().to_string(),
        manifest: manifest_path.display().to_string(),
        created_at: timestamp,
    })
}

#[tauri::command]
pub fn read_latest_full_backup(app: AppHandle) -> Result<Option<String>, String> {
    let dir = full_backup_dir(&app)?;
    let mut entries: Vec<_> = fs::read_dir(&dir).map_err(|e| e.to_string())?
        .filter_map(Result::ok).filter(|e| e.path().is_dir()).collect();
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    let Some(entry) = entries.pop() else { return Ok(None); };
    let manifest = entry.path().join("manifest.json");
    if !manifest.exists() { return Ok(None); }
    fs::read_to_string(manifest).map(Some).map_err(|e| e.to_string())
}
