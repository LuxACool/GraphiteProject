use super::super::repositories::sync::{self, DualWritePayload, SyncReport};
use tauri::AppHandle;

#[tauri::command]
pub fn repository_dual_write_state(app: AppHandle, payload: DualWritePayload) -> Result<SyncReport, String> {
    sync::dual_write_state(&app, payload)
}

#[tauri::command]
pub fn repository_dual_write_counts(app: AppHandle) -> Result<SyncReport, String> {
    use crate::database;
    let (conn, _) = database::open(&app)?;
    let count = |table: &str| -> Result<usize, String> {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get::<_, i64>(0))
            .map(|v| v.max(0) as usize)
            .map_err(|e| format!("Could not count {table}: {e}"))
    };
    Ok(SyncReport {
        workspaces: count("workspaces")?,
        notes: count("notes")?,
        tasks: count("tasks")?,
        calendar_events: count("calendar_events")?,
        flashcards: count("flashcards")?,
        sessions: count("focus_sessions")?,
    })
}

#[tauri::command]
pub fn repository_snapshot(app: AppHandle) -> Result<DualWritePayload, String> {
    sync::authoritative_snapshot(&app)
}
