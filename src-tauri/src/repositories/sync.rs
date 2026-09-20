use super::{CalendarEventInput, FlashcardInput, FocusSessionInput, NoteInput, TaskInput, WorkspaceInput};
use crate::database;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DualWritePayload {
    pub workspaces: Vec<WorkspaceInput>,
    pub notes: Vec<NoteInput>,
    pub tasks: Vec<TaskInput>,
    pub calendar_events: Vec<CalendarEventInput>,
    pub flashcards: Vec<FlashcardInput>,
    pub sessions: Vec<FocusSessionInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub workspaces: usize,
    pub notes: usize,
    pub tasks: usize,
    pub calendar_events: usize,
    pub flashcards: usize,
    pub sessions: usize,
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn require(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() { Err(format!("{field} must not be empty")) } else { Ok(()) }
}

fn sql_err(context: &str, e: rusqlite::Error) -> String { format!("{context}: {e}") }

fn delete_missing(conn: &Connection, table: &str, ids: &[String]) -> Result<(), String> {
    // The dual-write payload is the authoritative IndexedDB snapshot during this
    // migration phase. Empty snapshots intentionally clear that table.
    if ids.is_empty() {
        conn.execute(&format!("DELETE FROM {table}"), []).map_err(|e| sql_err("Could not clear stale SQLite rows", e))?;
        return Ok(());
    }
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!("DELETE FROM {table} WHERE id NOT IN ({placeholders})");
    let mut stmt = conn.prepare(&sql).map_err(|e| sql_err("Could not prepare stale-row cleanup", e))?;
    let refs: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    stmt.execute(refs.as_slice()).map_err(|e| sql_err("Could not remove stale SQLite rows", e))?;
    Ok(())
}

pub fn apply_payload(tx: &rusqlite::Transaction<'_>, payload: &DualWritePayload) -> Result<SyncReport, String> {
    for w in &payload.workspaces { require(&w.id, "workspace id")?; require(&w.name, "workspace name")?; }
    for n in &payload.notes { require(&n.id, "note id")?; require(&n.workspace_id, "workspace id")?; }
    for t in &payload.tasks { require(&t.id, "task id")?; require(&t.workspace_id, "workspace id")?; require(&t.column_id, "task column")?; }
    for e in &payload.calendar_events { require(&e.id, "event id")?; require(&e.workspace_id, "workspace id")?; }
    for c in &payload.flashcards { require(&c.id, "flashcard id")?; require(&c.workspace_id, "workspace id")?; }
    for s in &payload.sessions { require(&s.id, "session id")?; require(&s.workspace_id, "workspace id")?; }

    let now = now_ms();

    for w in &payload.workspaces {
        tx.execute("INSERT INTO workspaces(id,name,color,last_app,focus_minutes,created_at,updated_at,archived_at) VALUES(?1,?2,?3,?4,?5,COALESCE((SELECT created_at FROM workspaces WHERE id=?1),?6),?6,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,last_app=excluded.last_app,focus_minutes=excluded.focus_minutes,updated_at=excluded.updated_at,archived_at=NULL", params![w.id,w.name,w.color,w.last_app,w.focus_minutes.unwrap_or(0),now]).map_err(|e| sql_err("Could not dual-write workspace", e))?;
    }

    for n in &payload.notes {
        tx.execute("INSERT INTO notes(id,workspace_id,title,body,tags,created_at,updated_at,deleted_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?6,NULL,?7) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,body=excluded.body,tags=excluded.tags,updated_at=excluded.updated_at,deleted_at=NULL,metadata_json=excluded.metadata_json", params![n.id,n.workspace_id,n.title,n.body,n.tags,now,n.metadata_json.clone().unwrap_or_else(||"{}".into())])
            .map_err(|e| sql_err("Could not dual-write note", e))?;
    }

    for t in &payload.tasks {
        tx.execute("INSERT INTO tasks(id,workspace_id,column_id,title,description,priority,due_at,position,created_at,updated_at,completed_at,deleted_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,NULL,?11) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,column_id=excluded.column_id,title=excluded.title,description=excluded.description,priority=excluded.priority,due_at=excluded.due_at,position=excluded.position,updated_at=excluded.updated_at,completed_at=excluded.completed_at,deleted_at=NULL,metadata_json=excluded.metadata_json", params![t.id,t.workspace_id,t.column_id,t.title,t.description.clone().unwrap_or_default(),t.priority.clone().unwrap_or_else(||"Normal".into()),t.due_at,t.position.unwrap_or(0.0),now,if t.column_id == "done" { Some(now) } else { None },t.metadata_json.clone().unwrap_or_else(||"{}".into())])
            .map_err(|e| sql_err("Could not dual-write task", e))?;
    }

    for e in &payload.calendar_events {
        tx.execute("INSERT INTO calendar_events(id,workspace_id,title,description,start_at,end_at,all_day,color,recurrence,created_at,updated_at,deleted_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,NULL,?11) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,description=excluded.description,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,color=excluded.color,recurrence=excluded.recurrence,updated_at=excluded.updated_at,deleted_at=NULL,metadata_json=excluded.metadata_json", params![e.id,e.workspace_id,e.title,e.description.clone().unwrap_or_default(),e.start_at,e.end_at,if e.all_day.unwrap_or(false){1}else{0},e.color,e.recurrence,now,e.metadata_json.clone().unwrap_or_else(||"{}".into())])
            .map_err(|e| sql_err("Could not dual-write calendar event", e))?;
    }

    for c in &payload.flashcards {
        tx.execute("INSERT INTO flashcards(id,workspace_id,question,answer,repetitions,interval_days,ease_factor,next_review_at,created_at,updated_at,deleted_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL,?10) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,question=excluded.question,answer=excluded.answer,repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease_factor=excluded.ease_factor,next_review_at=excluded.next_review_at,updated_at=excluded.updated_at,deleted_at=NULL,metadata_json=excluded.metadata_json", params![c.id,c.workspace_id,c.question,c.answer,c.repetitions.unwrap_or(0),c.interval_days.unwrap_or(1.0),c.ease_factor.unwrap_or(2.5),c.next_review_at,now,c.metadata_json.clone().unwrap_or_else(||"{}".into())])
            .map_err(|e| sql_err("Could not dual-write flashcard", e))?;
    }

    for s in &payload.sessions {
        tx.execute("INSERT INTO focus_sessions(id,workspace_id,subject,started_at,ended_at,duration_seconds,session_type,completed,created_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,subject=excluded.subject,started_at=excluded.started_at,ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,session_type=excluded.session_type,completed=excluded.completed,metadata_json=excluded.metadata_json", params![s.id,s.workspace_id,s.subject,s.started_at,s.ended_at,s.duration_seconds.unwrap_or(0),s.session_type.clone().unwrap_or_else(||"focus".into()),if s.completed.unwrap_or(false){1}else{0},now,s.metadata_json.clone().unwrap_or_else(||"{}".into())])
            .map_err(|e| sql_err("Could not dual-write focus session", e))?;
    }

    delete_missing(&tx, "workspaces", &payload.workspaces.iter().map(|x| x.id.clone()).collect::<Vec<_>>())?;
    delete_missing(&tx, "notes", &payload.notes.iter().map(|x| x.id.clone()).collect::<Vec<_>>())?;
    delete_missing(&tx, "tasks", &payload.tasks.iter().map(|x| x.id.clone()).collect::<Vec<_>>())?;
    delete_missing(&tx, "calendar_events", &payload.calendar_events.iter().map(|x| x.id.clone()).collect::<Vec<_>>())?;
    delete_missing(&tx, "flashcards", &payload.flashcards.iter().map(|x| x.id.clone()).collect::<Vec<_>>())?;
    delete_missing(&tx, "focus_sessions", &payload.sessions.iter().map(|x| x.id.clone()).collect::<Vec<_>>())?;

    Ok(SyncReport { workspaces: payload.workspaces.len(), notes: payload.notes.len(), tasks: payload.tasks.len(), calendar_events: payload.calendar_events.len(), flashcards: payload.flashcards.len(), sessions: payload.sessions.len() })
}

pub fn dual_write_state(app: &AppHandle, payload: DualWritePayload) -> Result<SyncReport, String> {
    let (conn, _) = database::open(app)?;
    let tx = conn.unchecked_transaction().map_err(|e| sql_err("Could not start dual-write transaction", e))?;
    let report = apply_payload(&tx, &payload)?;
    tx.commit().map_err(|e| sql_err("Could not commit dual-write transaction", e))?;
    Ok(report)
}


pub fn authoritative_snapshot(app: &AppHandle) -> Result<DualWritePayload, String> {
    let (conn, _) = database::open(app)?;
    let mut workspaces = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,name,color,last_app,focus_minutes FROM workspaces WHERE archived_at IS NULL ORDER BY created_at")
            .map_err(|e| sql_err("Could not prepare workspace snapshot", e))?;
        let rows = st.query_map([], |r| Ok(WorkspaceInput {
            id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, last_app: r.get(3)?, focus_minutes: r.get(4)?
        })).map_err(|e| sql_err("Could not query workspace snapshot", e))?;
        workspaces = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read workspace snapshot", e))?;
    }
    let mut notes = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,workspace_id,title,body,tags,metadata_json FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC")
            .map_err(|e| sql_err("Could not prepare note snapshot", e))?;
        let rows = st.query_map([], |r| Ok(NoteInput {
            id:r.get(0)?, workspace_id:r.get(1)?, title:r.get(2)?, body:r.get(3)?, tags:r.get(4)?, metadata_json:r.get(5)?
        })).map_err(|e| sql_err("Could not query note snapshot", e))?;
        notes = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read note snapshot", e))?;
    }
    let mut tasks = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,workspace_id,column_id,title,description,priority,due_at,position,metadata_json FROM tasks WHERE deleted_at IS NULL ORDER BY column_id,position,created_at")
            .map_err(|e| sql_err("Could not prepare task snapshot", e))?;
        let rows = st.query_map([], |r| Ok(TaskInput {
            id:r.get(0)?, workspace_id:r.get(1)?, column_id:r.get(2)?, title:r.get(3)?, description:r.get(4)?, priority:r.get(5)?, due_at:r.get(6)?, position:r.get(7)?, metadata_json:r.get(8)?
        })).map_err(|e| sql_err("Could not query task snapshot", e))?;
        tasks = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read task snapshot", e))?;
    }
    let mut calendar_events = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,workspace_id,title,description,start_at,end_at,all_day,color,recurrence,metadata_json FROM calendar_events WHERE deleted_at IS NULL ORDER BY start_at")
            .map_err(|e| sql_err("Could not prepare calendar snapshot", e))?;
        let rows = st.query_map([], |r| Ok(CalendarEventInput {
            id:r.get(0)?, workspace_id:r.get(1)?, title:r.get(2)?, description:r.get(3)?, start_at:r.get(4)?, end_at:r.get(5)?, all_day:Some(r.get::<_,i64>(6)? != 0), color:r.get(7)?, recurrence:r.get(8)?, metadata_json:r.get(9)?
        })).map_err(|e| sql_err("Could not query calendar snapshot", e))?;
        calendar_events = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read calendar snapshot", e))?;
    }
    let mut flashcards = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,workspace_id,question,answer,repetitions,interval_days,ease_factor,next_review_at,metadata_json FROM flashcards WHERE deleted_at IS NULL ORDER BY updated_at DESC")
            .map_err(|e| sql_err("Could not prepare flashcard snapshot", e))?;
        let rows = st.query_map([], |r| Ok(FlashcardInput {
            id:r.get(0)?, workspace_id:r.get(1)?, question:r.get(2)?, answer:r.get(3)?, repetitions:r.get(4)?, interval_days:r.get(5)?, ease_factor:r.get(6)?, next_review_at:r.get(7)?, metadata_json:r.get(8)?
        })).map_err(|e| sql_err("Could not query flashcard snapshot", e))?;
        flashcards = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read flashcard snapshot", e))?;
    }
    let mut sessions = Vec::new();
    {
        let mut st = conn.prepare("SELECT id,workspace_id,subject,started_at,ended_at,duration_seconds,session_type,completed,metadata_json FROM focus_sessions ORDER BY started_at DESC")
            .map_err(|e| sql_err("Could not prepare session snapshot", e))?;
        let rows = st.query_map([], |r| Ok(FocusSessionInput {
            id:r.get(0)?, workspace_id:r.get(1)?, subject:r.get(2)?, started_at:r.get(3)?, ended_at:r.get(4)?, duration_seconds:r.get(5)?, session_type:r.get(6)?, completed:Some(r.get::<_,i64>(7)? != 0), metadata_json:r.get(8)?
        })).map_err(|e| sql_err("Could not query session snapshot", e))?;
        sessions = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_err("Could not read session snapshot", e))?;
    }
    Ok(DualWritePayload { workspaces, notes, tasks, calendar_events, flashcards, sessions })
}
