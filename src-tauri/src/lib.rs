mod commands;
mod database;
mod repositories;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::backup::create_backup,
            commands::backup::read_latest_backup,
            commands::backup::create_full_backup,
            commands::backup::read_latest_full_backup,
            commands::assets::asset_root,
            commands::assets::asset_write,
            commands::assets::asset_read,
            commands::assets::asset_delete,
            commands::database::database_info,
            commands::database::database_initialize,
            commands::database::database_reset,
            commands::repositories::repository_workspace_list,
            commands::repositories::repository_workspace_get,
            commands::repositories::repository_workspace_upsert,
            commands::repositories::repository_workspace_delete,
            commands::repositories::repository_note_list,
            commands::repositories::repository_note_get,
            commands::repositories::repository_note_upsert,
            commands::repositories::repository_note_delete,
            commands::repositories::repository_task_list,
            commands::repositories::repository_task_get,
            commands::repositories::repository_task_upsert,
            commands::repositories::repository_task_delete,
            commands::repositories::repository_calendar_list,
            commands::repositories::repository_calendar_get,
            commands::repositories::repository_calendar_upsert,
            commands::repositories::repository_calendar_delete,
            commands::repositories::repository_flashcard_list,
            commands::repositories::repository_flashcard_get,
            commands::repositories::repository_flashcard_upsert,
            commands::repositories::repository_flashcard_delete,
            commands::repositories::repository_flashcard_review,
            commands::repositories::repository_session_list,
            commands::repositories::repository_session_get,
            commands::repositories::repository_session_upsert,
            commands::repositories::repository_remaining_upsert,
            commands::repositories::repository_remaining_snapshot,
            commands::repositories::repository_remaining_initialized,
            commands::sync::repository_dual_write_state,
            commands::sync::repository_dual_write_counts,
            commands::sync::repository_snapshot,
            commands::migration::migration_status,
            commands::migration::migration_begin,
            commands::migration::migration_import_and_verify,
            commands::migration::migration_complete,
            commands::migration::migration_fail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running graphite application");
}
