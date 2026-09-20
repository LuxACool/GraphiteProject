//! Typed domain repositories for Graphite's SQLite store.
//!
//! Feature code must not execute SQL directly. Tauri commands call these
//! repositories, while the frontend talks to Graphite.repositories.

pub mod migration;
pub mod sync;
pub mod remaining;


use crate::database;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

fn conn(app: &AppHandle) -> Result<Connection, String> {
    database::open(app).map(|(c, _)| c)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn require(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() { Err(format!("{field} must not be empty")) } else { Ok(()) }
}

fn bool_i64(v: bool) -> i64 { if v { 1 } else { 0 } }
fn i64_bool(v: i64) -> bool { v != 0 }

fn sql_err(context: &str, e: rusqlite::Error) -> String { format!("{context}: {e}") }

// -------------------- Workspaces --------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub last_app: Option<String>,
    pub focus_minutes: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInput {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub last_app: Option<String>,
    pub focus_minutes: Option<i64>,
}

fn workspace_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, last_app: row.get(3)?, focus_minutes: row.get(4)?, created_at: row.get(5)?, updated_at: row.get(6)?, archived_at: row.get(7)? })
}

pub fn workspace_list(app: &AppHandle, include_archived: bool) -> Result<Vec<Workspace>, String> {
    let c = conn(app)?;
    let sql = if include_archived { "SELECT id,name,color,last_app,focus_minutes,created_at,updated_at,archived_at FROM workspaces ORDER BY created_at" } else { "SELECT id,name,color,last_app,focus_minutes,created_at,updated_at,archived_at FROM workspaces WHERE archived_at IS NULL ORDER BY created_at" };
    let mut stmt = c.prepare(sql).map_err(|e| sql_err("Could not prepare workspace list", e))?;
    let x = stmt.query_map([], workspace_row).map_err(|e| sql_err("Could not list workspaces", e))?.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read workspaces", e)); x
}

pub fn workspace_get(app: &AppHandle, id: &str) -> Result<Option<Workspace>, String> {
    require(id, "workspace id")?;
    let c = conn(app)?;
    c.query_row("SELECT id,name,color,last_app,focus_minutes,created_at,updated_at,archived_at FROM workspaces WHERE id=?1", [id], workspace_row).optional().map_err(|e| sql_err("Could not get workspace", e))
}

pub fn workspace_upsert(app: &AppHandle, input: WorkspaceInput) -> Result<Workspace, String> {
    require(&input.id, "workspace id")?; require(&input.name, "workspace name")?;
    let c = conn(app)?; let now = now_ms();
    c.execute("INSERT INTO workspaces(id,name,color,last_app,focus_minutes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,last_app=excluded.last_app,focus_minutes=excluded.focus_minutes,updated_at=excluded.updated_at", params![input.id, input.name, input.color, input.last_app, input.focus_minutes.unwrap_or(0), now]).map_err(|e| sql_err("Could not save workspace", e))?;
    workspace_get(app, &input.id)?.ok_or_else(|| "Workspace disappeared after save".into())
}

pub fn workspace_delete(app: &AppHandle, id: &str) -> Result<bool, String> {
    require(id, "workspace id")?;
    let c = conn(app)?;
    let changed = c.execute("DELETE FROM workspaces WHERE id=?1", [id]).map_err(|e| sql_err("Could not delete workspace", e))?;
    Ok(changed > 0)
}

// -------------------- Notes --------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note { pub id: String, pub workspace_id: String, pub title: String, pub body: String, pub tags: String, pub created_at: i64, pub updated_at: i64, pub deleted_at: Option<i64> }
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput { pub id: String, pub workspace_id: String, pub title: String, pub body: String, pub tags: String, pub metadata_json: Option<String> }
fn note_row(r: &Row<'_>) -> rusqlite::Result<Note> { Ok(Note { id:r.get(0)?, workspace_id:r.get(1)?, title:r.get(2)?, body:r.get(3)?, tags:r.get(4)?, created_at:r.get(5)?, updated_at:r.get(6)?, deleted_at:r.get(7)? }) }
pub fn note_list(app:&AppHandle, workspace_id:&str, include_deleted:bool)->Result<Vec<Note>,String>{ require(workspace_id,"workspace id")?; let c=conn(app)?; let sql=if include_deleted {"SELECT id,workspace_id,title,body,tags,created_at,updated_at,deleted_at FROM notes WHERE workspace_id=?1 ORDER BY updated_at DESC"} else {"SELECT id,workspace_id,title,body,tags,created_at,updated_at,deleted_at FROM notes WHERE workspace_id=?1 AND deleted_at IS NULL ORDER BY updated_at DESC"}; let mut s=c.prepare(sql).map_err(|e|sql_err("Could not prepare note list",e))?; let x = s.query_map([workspace_id],note_row).map_err(|e|sql_err("Could not list notes",e))?.collect::<Result<Vec<_>,_>>().map_err(|e|sql_err("Could not read notes",e)); x
}

pub fn note_get(app:&AppHandle,id:&str)->Result<Option<Note>,String>{require(id,"note id")?;let c=conn(app)?;c.query_row("SELECT id,workspace_id,title,body,tags,created_at,updated_at,deleted_at FROM notes WHERE id=?1",[id],note_row).optional().map_err(|e|sql_err("Could not get note",e))}
pub fn note_upsert(app:&AppHandle,input:NoteInput)->Result<Note,String>{require(&input.id,"note id")?;require(&input.workspace_id,"workspace id")?;let c=conn(app)?;let now=now_ms();c.execute("INSERT INTO notes(id,workspace_id,title,body,tags,created_at,updated_at,deleted_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?6,NULL,?7) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,body=excluded.body,tags=excluded.tags,updated_at=excluded.updated_at,deleted_at=NULL,metadata_json=excluded.metadata_json",params![input.id,input.workspace_id,input.title,input.body,input.tags,now,input.metadata_json.clone().unwrap_or_else(||"{}".into())]).map_err(|e|sql_err("Could not save note",e))?;note_get(app,&input.id)?.ok_or_else(||"Note disappeared after save".into())}
pub fn note_delete(app:&AppHandle,id:&str,hard:bool)->Result<bool,String>{require(id,"note id")?;let c=conn(app)?;let changed=if hard{c.execute("DELETE FROM notes WHERE id=?1",[id])}else{c.execute("UPDATE notes SET deleted_at=?1,updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",params![now_ms(),id])}.map_err(|e|sql_err("Could not delete note",e))?;Ok(changed>0)}

// -------------------- Tasks --------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct Task { pub id:String,pub workspace_id:String,pub column_id:String,pub title:String,pub description:String,pub priority:String,pub due_at:Option<i64>,pub position:f64,pub created_at:i64,pub updated_at:i64,pub completed_at:Option<i64>,pub deleted_at:Option<i64> }
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct TaskInput { pub id:String,pub workspace_id:String,pub column_id:String,pub title:String,pub description:Option<String>,pub priority:Option<String>,pub due_at:Option<i64>,pub position:Option<f64>,pub metadata_json:Option<String> }
fn task_row(r:&Row<'_>)->rusqlite::Result<Task>{Ok(Task{id:r.get(0)?,workspace_id:r.get(1)?,column_id:r.get(2)?,title:r.get(3)?,description:r.get(4)?,priority:r.get(5)?,due_at:r.get(6)?,position:r.get(7)?,created_at:r.get(8)?,updated_at:r.get(9)?,completed_at:r.get(10)?,deleted_at:r.get(11)?})}
pub fn task_list(app:&AppHandle,workspace_id:&str,include_deleted:bool)->Result<Vec<Task>,String>{require(workspace_id,"workspace id")?;let c=conn(app)?;let sql=if include_deleted{"SELECT id,workspace_id,column_id,title,description,priority,due_at,position,created_at,updated_at,completed_at,deleted_at FROM tasks WHERE workspace_id=?1 ORDER BY column_id,position,created_at"}else{"SELECT id,workspace_id,column_id,title,description,priority,due_at,position,created_at,updated_at,completed_at,deleted_at FROM tasks WHERE workspace_id=?1 AND deleted_at IS NULL ORDER BY column_id,position,created_at"};let mut s=c.prepare(sql).map_err(|e|sql_err("Could not prepare task list",e))?;let x = s.query_map([workspace_id],task_row).map_err(|e|sql_err("Could not list tasks",e))?.collect::<Result<Vec<_>,_>>().map_err(|e|sql_err("Could not read tasks",e)); x
}

pub fn task_get(app:&AppHandle,id:&str)->Result<Option<Task>,String>{require(id,"task id")?;let c=conn(app)?;c.query_row("SELECT id,workspace_id,column_id,title,description,priority,due_at,position,created_at,updated_at,completed_at,deleted_at FROM tasks WHERE id=?1",[id],task_row).optional().map_err(|e|sql_err("Could not get task",e))}
pub fn task_upsert(app:&AppHandle,input:TaskInput)->Result<Task,String>{require(&input.id,"task id")?;require(&input.workspace_id,"workspace id")?;require(&input.column_id,"task column")?;require(&input.title,"task title")?;let c=conn(app)?;let now=now_ms();c.execute("INSERT INTO tasks(id,workspace_id,column_id,title,description,priority,due_at,position,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,column_id=excluded.column_id,title=excluded.title,description=excluded.description,priority=excluded.priority,due_at=excluded.due_at,position=excluded.position,updated_at=excluded.updated_at,deleted_at=NULL,completed_at=CASE WHEN excluded.column_id='done' THEN COALESCE(tasks.completed_at,excluded.updated_at) ELSE NULL END",params![input.id,input.workspace_id,input.column_id,input.title,input.description.unwrap_or_default(),input.priority.unwrap_or_else(||"Normal".into()),input.due_at,input.position.unwrap_or(0.0),now]).map_err(|e|sql_err("Could not save task",e))?;task_get(app,&input.id)?.ok_or_else(||"Task disappeared after save".into())}
pub fn task_delete(app:&AppHandle,id:&str,hard:bool)->Result<bool,String>{require(id,"task id")?;let c=conn(app)?;let changed=if hard{c.execute("DELETE FROM tasks WHERE id=?1",[id])}else{c.execute("UPDATE tasks SET deleted_at=?1,updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",params![now_ms(),id])}.map_err(|e|sql_err("Could not delete task",e))?;Ok(changed>0)}

// -------------------- Calendar --------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct CalendarEvent { pub id:String,pub workspace_id:String,pub title:String,pub description:String,pub start_at:i64,pub end_at:i64,pub all_day:bool,pub color:Option<String>,pub recurrence:Option<String>,pub created_at:i64,pub updated_at:i64,pub deleted_at:Option<i64> }
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct CalendarEventInput { pub id:String,pub workspace_id:String,pub title:String,pub description:Option<String>,pub start_at:i64,pub end_at:i64,pub all_day:Option<bool>,pub color:Option<String>,pub recurrence:Option<String>,pub metadata_json:Option<String> }
fn event_row(r:&Row<'_>)->rusqlite::Result<CalendarEvent>{Ok(CalendarEvent{id:r.get(0)?,workspace_id:r.get(1)?,title:r.get(2)?,description:r.get(3)?,start_at:r.get(4)?,end_at:r.get(5)?,all_day:i64_bool(r.get(6)?),color:r.get(7)?,recurrence:r.get(8)?,created_at:r.get(9)?,updated_at:r.get(10)?,deleted_at:r.get(11)?})}
pub fn event_list(app:&AppHandle,workspace_id:&str,from_at:Option<i64>,to_at:Option<i64>,include_deleted:bool)->Result<Vec<CalendarEvent>,String>{require(workspace_id,"workspace id")?;let c=conn(app)?;let deleted=if include_deleted{""}else{" AND deleted_at IS NULL"};let mut sql=format!("SELECT id,workspace_id,title,description,start_at,end_at,all_day,color,recurrence,created_at,updated_at,deleted_at FROM calendar_events WHERE workspace_id=?1{}",deleted);if from_at.is_some(){sql.push_str(" AND end_at>=?2");}if to_at.is_some(){sql.push_str(if from_at.is_some(){" AND start_at<=?3"}else{" AND start_at<=?2"});}sql.push_str(" ORDER BY start_at,end_at");let mut s=c.prepare(&sql).map_err(|e|sql_err("Could not prepare calendar list",e))?;let mut rows=if from_at.is_some()&&to_at.is_some(){s.query(params![workspace_id,from_at.unwrap(),to_at.unwrap()])}else if from_at.is_some(){s.query(params![workspace_id,from_at.unwrap()])}else if to_at.is_some(){s.query(params![workspace_id,to_at.unwrap()])}else{s.query(params![workspace_id])}.map_err(|e|sql_err("Could not query calendar",e))?;let mut out=Vec::new();while let Some(r)=rows.next().map_err(|e|sql_err("Could not read calendar",e))?{out.push(event_row(r).map_err(|e|sql_err("Could not decode calendar event",e))?);}Ok(out)}
pub fn event_get(app:&AppHandle,id:&str)->Result<Option<CalendarEvent>,String>{require(id,"event id")?;let c=conn(app)?;c.query_row("SELECT id,workspace_id,title,description,start_at,end_at,all_day,color,recurrence,created_at,updated_at,deleted_at FROM calendar_events WHERE id=?1",[id],event_row).optional().map_err(|e|sql_err("Could not get calendar event",e))}
pub fn event_upsert(app:&AppHandle,input:CalendarEventInput)->Result<CalendarEvent,String>{require(&input.id,"event id")?;require(&input.workspace_id,"workspace id")?;if input.end_at<=input.start_at{return Err("Calendar event endAt must be after startAt".into())};let c=conn(app)?;let now=now_ms();c.execute("INSERT INTO calendar_events(id,workspace_id,title,description,start_at,end_at,all_day,color,recurrence,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,NULL) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,description=excluded.description,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,color=excluded.color,recurrence=excluded.recurrence,updated_at=excluded.updated_at,deleted_at=NULL",params![input.id,input.workspace_id,input.title,input.description.unwrap_or_default(),input.start_at,input.end_at,bool_i64(input.all_day.unwrap_or(false)),input.color,input.recurrence,now]).map_err(|e|sql_err("Could not save calendar event",e))?;event_get(app,&input.id)?.ok_or_else(||"Calendar event disappeared after save".into())}
pub fn event_delete(app:&AppHandle,id:&str,hard:bool)->Result<bool,String>{require(id,"event id")?;let c=conn(app)?;let changed=if hard{c.execute("DELETE FROM calendar_events WHERE id=?1",[id])}else{c.execute("UPDATE calendar_events SET deleted_at=?1,updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",params![now_ms(),id])}.map_err(|e|sql_err("Could not delete calendar event",e))?;Ok(changed>0)}

// -------------------- Flashcards --------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct Flashcard { pub id:String,pub workspace_id:String,pub question:String,pub answer:String,pub repetitions:i64,pub interval_days:f64,pub ease_factor:f64,pub next_review_at:Option<i64>,pub created_at:i64,pub updated_at:i64,pub deleted_at:Option<i64> }
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct FlashcardInput { pub id:String,pub workspace_id:String,pub question:String,pub answer:String,pub repetitions:Option<i64>,pub interval_days:Option<f64>,pub ease_factor:Option<f64>,pub next_review_at:Option<i64>,pub metadata_json:Option<String> }
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct FlashcardReview { pub id:String,pub flashcard_id:String,pub workspace_id:String,pub rating:i64,pub previous_interval:Option<f64>,pub new_interval:Option<f64>,pub reviewed_at:i64 }
#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct FlashcardReviewInput { pub id:String,pub flashcard_id:String,pub workspace_id:String,pub rating:i64,pub previous_interval:Option<f64>,pub new_interval:Option<f64>,pub reviewed_at:Option<i64> }
fn card_row(r:&Row<'_>)->rusqlite::Result<Flashcard>{Ok(Flashcard{id:r.get(0)?,workspace_id:r.get(1)?,question:r.get(2)?,answer:r.get(3)?,repetitions:r.get(4)?,interval_days:r.get(5)?,ease_factor:r.get(6)?,next_review_at:r.get(7)?,created_at:r.get(8)?,updated_at:r.get(9)?,deleted_at:r.get(10)?})}
pub fn card_list(app:&AppHandle,workspace_id:&str,due_before:Option<i64>,include_deleted:bool)->Result<Vec<Flashcard>,String>{require(workspace_id,"workspace id")?;let c=conn(app)?;let deleted=if include_deleted{""}else{" AND deleted_at IS NULL"};let sql=if due_before.is_some(){format!("SELECT id,workspace_id,question,answer,repetitions,interval_days,ease_factor,next_review_at,created_at,updated_at,deleted_at FROM flashcards WHERE workspace_id=?1{} AND (next_review_at IS NULL OR next_review_at<=?2) ORDER BY next_review_at",deleted)}else{format!("SELECT id,workspace_id,question,answer,repetitions,interval_days,ease_factor,next_review_at,created_at,updated_at,deleted_at FROM flashcards WHERE workspace_id=?1{} ORDER BY updated_at DESC",deleted)};let mut s=c.prepare(&sql).map_err(|e|sql_err("Could not prepare flashcard list",e))?;let result=if let Some(before)=due_before{s.query_map(params![workspace_id,before],card_row)}else{s.query_map(params![workspace_id],card_row)};let x = result.map_err(|e|sql_err("Could not list flashcards",e))?.collect::<Result<Vec<_>,_>>().map_err(|e|sql_err("Could not read flashcards",e)); x
}

pub fn card_get(app:&AppHandle,id:&str)->Result<Option<Flashcard>,String>{require(id,"flashcard id")?;let c=conn(app)?;c.query_row("SELECT id,workspace_id,question,answer,repetitions,interval_days,ease_factor,next_review_at,created_at,updated_at,deleted_at FROM flashcards WHERE id=?1",[id],card_row).optional().map_err(|e|sql_err("Could not get flashcard",e))}
pub fn card_upsert(app:&AppHandle,input:FlashcardInput)->Result<Flashcard,String>{require(&input.id,"flashcard id")?;require(&input.workspace_id,"workspace id")?;require(&input.question,"flashcard question")?;let c=conn(app)?;let now=now_ms();c.execute("INSERT INTO flashcards(id,workspace_id,question,answer,repetitions,interval_days,ease_factor,next_review_at,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,question=excluded.question,answer=excluded.answer,repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease_factor=excluded.ease_factor,next_review_at=excluded.next_review_at,updated_at=excluded.updated_at,deleted_at=NULL",params![input.id,input.workspace_id,input.question,input.answer,input.repetitions.unwrap_or(0),input.interval_days.unwrap_or(1.0),input.ease_factor.unwrap_or(2.5),input.next_review_at,now]).map_err(|e|sql_err("Could not save flashcard",e))?;card_get(app,&input.id)?.ok_or_else(||"Flashcard disappeared after save".into())}
pub fn card_delete(app:&AppHandle,id:&str,hard:bool)->Result<bool,String>{require(id,"flashcard id")?;let c=conn(app)?;let changed=if hard{c.execute("DELETE FROM flashcards WHERE id=?1",[id])}else{c.execute("UPDATE flashcards SET deleted_at=?1,updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",params![now_ms(),id])}.map_err(|e|sql_err("Could not delete flashcard",e))?;Ok(changed>0)}
pub fn card_review(app:&AppHandle,input:FlashcardReviewInput)->Result<FlashcardReview,String>{require(&input.id,"review id")?;require(&input.flashcard_id,"flashcard id")?;require(&input.workspace_id,"workspace id")?;if !(0..=5).contains(&input.rating){return Err("Flashcard rating must be between 0 and 5".into())};let c=conn(app)?;let reviewed=input.reviewed_at.unwrap_or_else(now_ms);c.execute("INSERT INTO flashcard_reviews(id,flashcard_id,workspace_id,rating,previous_interval,new_interval,reviewed_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![input.id,input.flashcard_id,input.workspace_id,input.rating,input.previous_interval,input.new_interval,reviewed]).map_err(|e|sql_err("Could not record flashcard review",e))?;Ok(FlashcardReview{id:input.id,flashcard_id:input.flashcard_id,workspace_id:input.workspace_id,rating:input.rating,previous_interval:input.previous_interval,new_interval:input.new_interval,reviewed_at:reviewed})}

// -------------------- Focus sessions --------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct FocusSession { pub id:String,pub workspace_id:String,pub subject:Option<String>,pub started_at:i64,pub ended_at:Option<i64>,pub duration_seconds:i64,pub session_type:String,pub completed:bool,pub created_at:i64 }
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all="camelCase")]
pub struct FocusSessionInput { pub id:String,pub workspace_id:String,pub subject:Option<String>,pub started_at:i64,pub ended_at:Option<i64>,pub duration_seconds:Option<i64>,pub session_type:Option<String>,pub completed:Option<bool>,pub metadata_json:Option<String> }
fn session_row(r:&Row<'_>)->rusqlite::Result<FocusSession>{Ok(FocusSession{id:r.get(0)?,workspace_id:r.get(1)?,subject:r.get(2)?,started_at:r.get(3)?,ended_at:r.get(4)?,duration_seconds:r.get(5)?,session_type:r.get(6)?,completed:i64_bool(r.get(7)?),created_at:r.get(8)?})}
pub fn session_list(app:&AppHandle,workspace_id:&str,from_at:Option<i64>,to_at:Option<i64>)->Result<Vec<FocusSession>,String>{require(workspace_id,"workspace id")?;let c=conn(app)?;let mut sql="SELECT id,workspace_id,subject,started_at,ended_at,duration_seconds,session_type,completed,created_at FROM focus_sessions WHERE workspace_id=?1".to_string();if from_at.is_some(){sql.push_str(" AND started_at>=?2");}if to_at.is_some(){sql.push_str(if from_at.is_some(){" AND started_at<=?3"}else{" AND started_at<=?2"});}sql.push_str(" ORDER BY started_at DESC");let mut s=c.prepare(&sql).map_err(|e|sql_err("Could not prepare session list",e))?;let mut rows=if from_at.is_some()&&to_at.is_some(){s.query(params![workspace_id,from_at.unwrap(),to_at.unwrap()])}else if from_at.is_some(){s.query(params![workspace_id,from_at.unwrap()])}else if to_at.is_some(){s.query(params![workspace_id,to_at.unwrap()])}else{s.query(params![workspace_id])}.map_err(|e|sql_err("Could not query sessions",e))?;let mut out=Vec::new();while let Some(r)=rows.next().map_err(|e|sql_err("Could not read sessions",e))?{out.push(session_row(r).map_err(|e|sql_err("Could not decode session",e))?);}Ok(out)}
pub fn session_get(app:&AppHandle,id:&str)->Result<Option<FocusSession>,String>{require(id,"session id")?;let c=conn(app)?;c.query_row("SELECT id,workspace_id,subject,started_at,ended_at,duration_seconds,session_type,completed,created_at FROM focus_sessions WHERE id=?1",[id],session_row).optional().map_err(|e|sql_err("Could not get session",e))}
pub fn session_upsert(app:&AppHandle,input:FocusSessionInput)->Result<FocusSession,String>{require(&input.id,"session id")?;require(&input.workspace_id,"workspace id")?;if input.duration_seconds.unwrap_or(0)<0{return Err("Session duration cannot be negative".into())};let c=conn(app)?;let now=now_ms();c.execute("INSERT INTO focus_sessions(id,workspace_id,subject,started_at,ended_at,duration_seconds,session_type,completed,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,subject=excluded.subject,started_at=excluded.started_at,ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,session_type=excluded.session_type,completed=excluded.completed",params![input.id,input.workspace_id,input.subject,input.started_at,input.ended_at,input.duration_seconds.unwrap_or(0),input.session_type.unwrap_or_else(||"focus".into()),bool_i64(input.completed.unwrap_or(false)),now]).map_err(|e|sql_err("Could not save focus session",e))?;session_get(app,&input.id)?.ok_or_else(||"Focus session disappeared after save".into())}

