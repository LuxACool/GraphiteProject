use super::super::repositories;
use tauri::AppHandle;

#[tauri::command]
pub fn repository_workspace_list(app: AppHandle, include_archived: Option<bool>) -> Result<Vec<repositories::Workspace>, String> { repositories::workspace_list(&app, include_archived.unwrap_or(false)) }
#[tauri::command]
pub fn repository_workspace_get(app: AppHandle, id: String) -> Result<Option<repositories::Workspace>, String> { repositories::workspace_get(&app, &id) }
#[tauri::command]
pub fn repository_workspace_upsert(app: AppHandle, input: repositories::WorkspaceInput) -> Result<repositories::Workspace, String> { repositories::workspace_upsert(&app, input) }
#[tauri::command]
pub fn repository_workspace_delete(app: AppHandle, id: String) -> Result<bool, String> { repositories::workspace_delete(&app, &id) }

#[tauri::command]
pub fn repository_note_list(app: AppHandle, workspace_id: String, include_deleted: Option<bool>) -> Result<Vec<repositories::Note>, String> { repositories::note_list(&app, &workspace_id, include_deleted.unwrap_or(false)) }
#[tauri::command]
pub fn repository_note_get(app: AppHandle, id: String) -> Result<Option<repositories::Note>, String> { repositories::note_get(&app, &id) }
#[tauri::command]
pub fn repository_note_upsert(app: AppHandle, input: repositories::NoteInput) -> Result<repositories::Note, String> { repositories::note_upsert(&app, input) }
#[tauri::command]
pub fn repository_note_delete(app: AppHandle, id: String, hard: Option<bool>) -> Result<bool, String> { repositories::note_delete(&app, &id, hard.unwrap_or(false)) }

#[tauri::command]
pub fn repository_task_list(app: AppHandle, workspace_id: String, include_deleted: Option<bool>) -> Result<Vec<repositories::Task>, String> { repositories::task_list(&app, &workspace_id, include_deleted.unwrap_or(false)) }
#[tauri::command]
pub fn repository_task_get(app: AppHandle, id: String) -> Result<Option<repositories::Task>, String> { repositories::task_get(&app, &id) }
#[tauri::command]
pub fn repository_task_upsert(app: AppHandle, input: repositories::TaskInput) -> Result<repositories::Task, String> { repositories::task_upsert(&app, input) }
#[tauri::command]
pub fn repository_task_delete(app: AppHandle, id: String, hard: Option<bool>) -> Result<bool, String> { repositories::task_delete(&app, &id, hard.unwrap_or(false)) }

#[tauri::command]
pub fn repository_calendar_list(app: AppHandle, workspace_id: String, from_at: Option<i64>, to_at: Option<i64>, include_deleted: Option<bool>) -> Result<Vec<repositories::CalendarEvent>, String> { repositories::event_list(&app, &workspace_id, from_at, to_at, include_deleted.unwrap_or(false)) }
#[tauri::command]
pub fn repository_calendar_get(app: AppHandle, id: String) -> Result<Option<repositories::CalendarEvent>, String> { repositories::event_get(&app, &id) }
#[tauri::command]
pub fn repository_calendar_upsert(app: AppHandle, input: repositories::CalendarEventInput) -> Result<repositories::CalendarEvent, String> { repositories::event_upsert(&app, input) }
#[tauri::command]
pub fn repository_calendar_delete(app: AppHandle, id: String, hard: Option<bool>) -> Result<bool, String> { repositories::event_delete(&app, &id, hard.unwrap_or(false)) }

#[tauri::command]
pub fn repository_flashcard_list(app: AppHandle, workspace_id: String, due_before: Option<i64>, include_deleted: Option<bool>) -> Result<Vec<repositories::Flashcard>, String> { repositories::card_list(&app, &workspace_id, due_before, include_deleted.unwrap_or(false)) }
#[tauri::command]
pub fn repository_flashcard_get(app: AppHandle, id: String) -> Result<Option<repositories::Flashcard>, String> { repositories::card_get(&app, &id) }
#[tauri::command]
pub fn repository_flashcard_upsert(app: AppHandle, input: repositories::FlashcardInput) -> Result<repositories::Flashcard, String> { repositories::card_upsert(&app, input) }
#[tauri::command]
pub fn repository_flashcard_delete(app: AppHandle, id: String, hard: Option<bool>) -> Result<bool, String> { repositories::card_delete(&app, &id, hard.unwrap_or(false)) }
#[tauri::command]
pub fn repository_flashcard_review(app: AppHandle, input: repositories::FlashcardReviewInput) -> Result<repositories::FlashcardReview, String> { repositories::card_review(&app, input) }

#[tauri::command]
pub fn repository_session_list(app: AppHandle, workspace_id: String, from_at: Option<i64>, to_at: Option<i64>) -> Result<Vec<repositories::FocusSession>, String> { repositories::session_list(&app, &workspace_id, from_at, to_at) }
#[tauri::command]
pub fn repository_session_get(app: AppHandle, id: String) -> Result<Option<repositories::FocusSession>, String> { repositories::session_get(&app, &id) }
#[tauri::command]
pub fn repository_session_upsert(app: AppHandle, input: repositories::FocusSessionInput) -> Result<repositories::FocusSession, String> { repositories::session_upsert(&app, input) }

#[tauri::command]
pub fn repository_remaining_upsert(app: AppHandle, state: repositories::remaining::RemainingState) -> Result<(), String> {
    let workspace_ids = repositories::workspace_list(&app, true)?.into_iter().map(|w| w.id).collect::<std::collections::BTreeSet<_>>();
    repositories::remaining::upsert_state(&app, &workspace_ids, &state)
}

#[tauri::command]
pub fn repository_remaining_snapshot(app: AppHandle, workspace_id: Option<String>) -> Result<repositories::remaining::RemainingState, String> {
    repositories::remaining::snapshot(&app, workspace_id.as_deref())
}


#[tauri::command]
pub fn repository_remaining_initialized(app: AppHandle) -> Result<bool, String> {
    repositories::remaining::initialized(&app)
}
