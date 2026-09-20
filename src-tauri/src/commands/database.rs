use crate::database;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct DatabaseInfo {
    pub path: String,
    pub exists: bool,
    pub schema_version: i32,
}

#[tauri::command]
pub fn database_info(app: AppHandle) -> Result<DatabaseInfo, String> {
    let (conn, path) = database::open(&app)?;
    let version = database::schema_version(&conn).map_err(|e| format!("Could not read SQLite schema version: {e}"))?;
    Ok(DatabaseInfo {
        path: path.display().to_string(),
        exists: database::db_exists(&path),
        schema_version: version,
    })
}

#[tauri::command]
pub fn database_initialize(app: AppHandle) -> Result<DatabaseInfo, String> {
    database_info(app)
}


#[tauri::command]
pub fn database_reset(app: AppHandle) -> Result<bool, String> {
    let path = database::db_path(&app)?;
    for suffix in ["", "-wal", "-shm"] {
        let target = if suffix.is_empty() { path.clone() } else { std::path::PathBuf::from(format!("{}{}", path.display(), suffix)) };
        if target.exists() {
            std::fs::remove_file(&target).map_err(|e| format!("Could not delete SQLite database file {}: {e}", target.display()))?;
        }
    }
    Ok(true)
}
