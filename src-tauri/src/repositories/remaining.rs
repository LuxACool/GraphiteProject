use crate::database;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use tauri::AppHandle;

fn conn(app: &AppHandle) -> Result<Connection, String> { database::open(app).map(|(c, _)| c) }
fn now_ms() -> i64 { use std::time::{SystemTime, UNIX_EPOCH}; SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0) }
fn sql_err(ctx: &str, e: rusqlite::Error) -> String { format!("{ctx}: {e}") }
fn obj(v: &Value) -> Map<String, Value> { v.as_object().cloned().unwrap_or_default() }
fn s(m: &Map<String,Value>, key: &str, default: &str) -> String { m.get(key).and_then(Value::as_str).unwrap_or(default).to_string() }
fn i64v(m: &Map<String,Value>, key: &str) -> i64 { m.get(key).and_then(|v| v.as_i64()).or_else(|| m.get(key).and_then(|v| v.as_f64()).map(|n| n as i64)).unwrap_or(0) }
fn boolv(m: &Map<String,Value>, key: &str) -> bool { m.get(key).and_then(Value::as_bool).unwrap_or(false) }
fn json(m: &Map<String,Value>, key: &str, default: Value) -> String { serde_json::to_string(m.get(key).unwrap_or(&default)).unwrap_or_else(|_| "null".into()) }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct RemainingState {
    pub canvas_strokes: Vec<Value>,
    pub mindmaps: Vec<Value>,
    pub journal: Value,
    pub habits: Vec<Value>,
    pub reading: Vec<Value>,
    pub tutor_chat: Vec<Value>,
    pub exam_countdowns: Vec<Value>,
    pub xp: i64,
    pub badges: Vec<Value>,
    pub settings: Value,
    pub activity_history: Value,
    pub kss_history: Vec<Value>,
}

pub fn upsert_state(app: &AppHandle, workspace_ids: &BTreeSet<String>, state: &RemainingState) -> Result<(), String> {
    let c = conn(app)?;
    let tx = c.unchecked_transaction().map_err(|e| sql_err("Could not start remaining-domain transaction", e))?;
    let now = now_ms();

    // Canvas strokes are normalized into one document per workspace. The full
    // stroke object remains in payload_json so no drawing-specific fields are lost.
    let mut workspaces = BTreeSet::new();
    for stroke in &state.canvas_strokes {
        let m=obj(stroke); let ws=s(&m,"workspaceId",""); if !ws.is_empty() { workspaces.insert(ws); }
    }
    for ws in workspaces {
        let doc_id=format!("canvas-{ws}");
        tx.execute("INSERT INTO canvas_documents(id,workspace_id,title,viewport_json,created_at,updated_at,deleted_at) VALUES(?1,?2,'Main Canvas','{}',?3,?3,NULL) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,deleted_at=NULL", params![doc_id,ws,now]).map_err(|e|sql_err("Could not save canvas document",e))?;
    }
    for (idx, stroke) in state.canvas_strokes.iter().enumerate() {
        let m=obj(stroke); let ws=s(&m,"workspaceId",""); if ws.is_empty(){continue;} let doc_id=format!("canvas-{ws}");
        let id=s(&m,"id",&format!("stroke-{ws}-{idx}"));
        tx.execute("INSERT INTO canvas_elements(id,document_id,workspace_id,element_type,position,payload_json,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7,NULL) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id,workspace_id=excluded.workspace_id,element_type=excluded.element_type,position=excluded.position,payload_json=excluded.payload_json,updated_at=excluded.updated_at,deleted_at=NULL", params![id,doc_id,ws,s(&m,"tool","stroke"),idx as f64,serde_json::to_string(stroke).unwrap_or_else(|_|"{}".into()),now]).map_err(|e|sql_err("Could not save canvas element",e))?;
    }

    // Mindmaps are normalized when the legacy state already exposes the common
    // {id, workspaceId, title, nodes, edges} shape. The original map is also
    // retained in legacy_domain_snapshots so future schema upgrades cannot lose fields.
    tx.execute("DELETE FROM mindmap_edges", []).map_err(|e|sql_err("Could not replace mindmap edges",e))?;
    tx.execute("DELETE FROM mindmap_nodes", []).map_err(|e|sql_err("Could not replace mindmap nodes",e))?;
    tx.execute("DELETE FROM mindmaps", []).map_err(|e|sql_err("Could not replace mindmaps",e))?;
    for map in &state.mindmaps {
        let mm=obj(map); let id=s(&mm,"id",""); if id.is_empty(){continue;}
        let ws=s(&mm,"workspaceId",workspace_ids.iter().next().map(String::as_str).unwrap_or("")); if ws.is_empty(){continue;}
        tx.execute("INSERT INTO mindmaps(id,workspace_id,title,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?4,NULL)",params![id,ws,s(&mm,"title","Untitled Mindmap"),now]).map_err(|e|sql_err("Could not save mindmap",e))?;
        if let Some(nodes)=mm.get("nodes").and_then(Value::as_array){
            for (idx,node) in nodes.iter().enumerate(){let n=obj(node);let nid=s(&n,"id",&format!("{id}-node-{idx}"));tx.execute("INSERT INTO mindmap_nodes(id,mindmap_id,workspace_id,parent_id,label,position_x,position_y,payload_json,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL)",params![nid,id,ws,n.get("parentId").and_then(Value::as_str),s(&n,"label",s(&n,"text","").as_str()),n.get("x").and_then(Value::as_f64).unwrap_or(0.0),n.get("y").and_then(Value::as_f64).unwrap_or(0.0),serde_json::to_string(node).unwrap_or_else(|_|"{}".into()),now]).map_err(|e|sql_err("Could not save mindmap node",e))?;}
        }
        if let Some(edges)=mm.get("edges").and_then(Value::as_array){
            for (idx,edge) in edges.iter().enumerate(){let e=obj(edge);let eid=s(&e,"id",&format!("{id}-edge-{idx}"));let source=s(&e,"source",s(&e,"sourceNodeId","").as_str());let target=s(&e,"target",s(&e,"targetNodeId","").as_str());if source.is_empty()||target.is_empty(){continue;}tx.execute("INSERT INTO mindmap_edges(id,mindmap_id,workspace_id,source_node_id,target_node_id,payload_json,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7,NULL)",params![eid,id,ws,source,target,serde_json::to_string(edge).unwrap_or_else(|_|"{}".into()),now]).map_err(|e|sql_err("Could not save mindmap edge",e))?;}
        }
    }

    // Journals are keyed by local YYYY-MM-DD and retain the original object in wins_json.
    tx.execute("DELETE FROM journals", []).map_err(|e|sql_err("Could not replace journals",e))?;
    if let Some(map)=state.journal.as_object(){ for (day,v) in map { let m=obj(v); let ws=s(&m,"workspaceId",""); let ws=if ws.is_empty(){workspace_ids.iter().next().cloned().unwrap_or_default()}else{ws}; if ws.is_empty(){continue;} tx.execute("INSERT INTO journals(workspace_id,day,mood,energy,entry,wins_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(workspace_id,day) DO UPDATE SET mood=excluded.mood,energy=excluded.energy,entry=excluded.entry,wins_json=excluded.wins_json,updated_at=excluded.updated_at", params![ws,day,m.get("mood").and_then(Value::as_i64),m.get("energy").and_then(Value::as_i64),s(&m,"entry",""),json(&m,"wins",Value::Array(vec![])),now]).map_err(|e|sql_err("Could not save journal",e))?; }}

    tx.execute("DELETE FROM habit_logs", []).map_err(|e|sql_err("Could not replace habit logs",e))?;
    tx.execute("DELETE FROM habits", []).map_err(|e|sql_err("Could not replace habits",e))?;
    for h in &state.habits { let m=obj(h); let id=s(&m,"id",""); if id.is_empty(){continue;} let ws=s(&m,"workspaceId",workspace_ids.iter().next().map(String::as_str).unwrap_or("")); if ws.is_empty(){continue;} tx.execute("INSERT INTO habits(id,workspace_id,name,created_at,updated_at,archived_at) VALUES(?1,?2,?3,?4,?4,NULL) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,name=excluded.name,updated_at=excluded.updated_at",params![id,ws,s(&m,"name","Habit"),now]).map_err(|e|sql_err("Could not save habit",e))?; if let Some(log)=m.get("log").and_then(Value::as_object){for (day,done) in log {tx.execute("INSERT INTO habit_logs(habit_id,workspace_id,day,completed) VALUES(?1,?2,?3,?4) ON CONFLICT(habit_id,day) DO UPDATE SET completed=excluded.completed",params![id,ws,day,if done.as_bool().unwrap_or(false){1}else{0}]).map_err(|e|sql_err("Could not save habit log",e))?;}} }

    tx.execute("DELETE FROM reading_items", []).map_err(|e|sql_err("Could not replace reading list",e))?;
    for r in &state.reading { let m=obj(r); let id=s(&m,"id",""); if id.is_empty(){continue;} let ws=s(&m,"workspaceId",workspace_ids.iter().next().map(String::as_str).unwrap_or("")); if ws.is_empty(){continue;} tx.execute("INSERT INTO reading_items(id,workspace_id,title,url,note,completed,added_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,url=excluded.url,note=excluded.note,completed=excluded.completed,updated_at=excluded.updated_at",params![id,ws,s(&m,"title",""),m.get("url").and_then(Value::as_str),s(&m,"note",""),if boolv(&m,"done"){1}else{0},i64v(&m,"added").max(now)]).map_err(|e|sql_err("Could not save reading item",e))?; }

    tx.execute("DELETE FROM tutor_messages", []).map_err(|e|sql_err("Could not replace tutor messages",e))?;
    let ws=workspace_ids.iter().next().cloned();
    for (idx,msg) in state.tutor_chat.iter().enumerate(){let m=obj(msg); let id=s(&m,"id",&format!("tutor-{idx}")); let conv=s(&m,"conversationId","default"); tx.execute("INSERT INTO tutor_messages(id,workspace_id,conversation_id,role,content,created_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,conversation_id=excluded.conversation_id,role=excluded.role,content=excluded.content",params![id,ws,conv,s(&m,"role","user"),s(&m,"content",""),now+idx as i64]).map_err(|e|sql_err("Could not save tutor message",e))?;}

    tx.execute("DELETE FROM exam_countdowns", []).map_err(|e|sql_err("Could not replace exam countdowns",e))?;
    for e in &state.exam_countdowns { let m=obj(e); let id=s(&m,"id",""); if id.is_empty(){continue;} let ws=s(&m,"workspaceId",workspace_ids.iter().next().map(String::as_str).unwrap_or("")); if ws.is_empty(){continue;} let target=i64v(&m,"targetAt").max(i64v(&m,"date")); tx.execute("INSERT INTO exam_countdowns(id,workspace_id,title,subject,target_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,subject=excluded.subject,target_at=excluded.target_at,updated_at=excluded.updated_at",params![id,ws,s(&m,"title","Exam"),m.get("subject").and_then(Value::as_str),target,now]).map_err(|e|sql_err("Could not save exam countdown",e))?;}

    let badges_json=serde_json::to_string(&state.badges).unwrap_or_else(|_|"[]".into());
    for ws in workspace_ids { tx.execute("INSERT INTO achievements(id,workspace_id,xp,badges_json,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET xp=excluded.xp,badges_json=excluded.badges_json,updated_at=excluded.updated_at",params![format!("achievements-{ws}"),ws,state.xp,badges_json,now]).map_err(|e|sql_err("Could not save achievements",e))?; }

    // Settings are key/value JSON. Never store secrets in logs; they remain encrypted/obscured only by the OS storage boundary in future native work.
    if let Some(settings)=state.settings.as_object(){ for (key,value) in settings { tx.execute("INSERT INTO settings(scope,workspace_id,key,value_json,updated_at) VALUES('global',NULL,?1,?2,?3) ON CONFLICT(scope,workspace_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![key,serde_json::to_string(value).unwrap_or_else(|_|"null".into()),now]).map_err(|e|sql_err("Could not save setting",e))?; }}
    if let Some(activity)=state.activity_history.as_object(){ for (day,v) in activity {let m=obj(v); let ws=workspace_ids.iter().next().cloned().unwrap_or_default(); if ws.is_empty(){continue;} tx.execute("INSERT INTO activity_daily(workspace_id,day,pomodoros,tasks_completed,focus_seconds) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,day) DO UPDATE SET pomodoros=excluded.pomodoros,tasks_completed=excluded.tasks_completed,focus_seconds=excluded.focus_seconds",params![ws,day,i64v(&m,"pomodoros"),i64v(&m,"tasks"),i64v(&m,"focusSeconds")]).map_err(|e|sql_err("Could not save activity",e))?; }}
    tx.execute("INSERT INTO app_metadata(key,value,updated_at) VALUES('xp',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",params![state.xp.to_string(),now]).map_err(|e|sql_err("Could not save app metadata",e))?;
    tx.execute("INSERT INTO app_metadata(key,value,updated_at) VALUES('remaining_domains_initialized','1',?1) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at",params![now]).map_err(|e|sql_err("Could not mark remaining domains initialized",e))?;
    tx.execute("INSERT INTO legacy_domain_snapshots(domain,workspace_id,payload_json,updated_at) VALUES('mindmaps',NULL,?1,?2) ON CONFLICT(domain) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at",params![serde_json::to_string(&state.mindmaps).unwrap_or_else(|_|"[]".into()),now]).map_err(|e|sql_err("Could not preserve mindmaps",e))?;
    tx.execute("INSERT INTO legacy_domain_snapshots(domain,workspace_id,payload_json,updated_at) VALUES('kss_history',NULL,?1,?2) ON CONFLICT(domain) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at",params![serde_json::to_string(&state.kss_history).unwrap_or_else(|_|"[]".into()),now]).map_err(|e|sql_err("Could not preserve KSS history",e))?;
    tx.commit().map_err(|e|sql_err("Could not commit remaining-domain transaction",e))
}

pub fn snapshot(app:&AppHandle, workspace_id:Option<&str>) -> Result<RemainingState,String> {
    let c=conn(app)?;
    let mut strokes=Vec::new();
    {let mut st=c.prepare("SELECT payload_json FROM canvas_elements WHERE deleted_at IS NULL ORDER BY document_id,position").map_err(|e|sql_err("Could not prepare canvas snapshot",e))?; for r in st.query_map([],|r|r.get::<_,String>(0)).map_err(|e|sql_err("Could not query canvas snapshot",e))? {let raw=r.map_err(|e|sql_err("Could not read canvas element",e))?; strokes.push(serde_json::from_str(&raw).unwrap_or(Value::Null));}}
    let mut journal=Map::new(); {let mut st=c.prepare("SELECT day,mood,energy,entry,wins_json,workspace_id FROM journals ORDER BY day").map_err(|e|sql_err("Could not prepare journal snapshot",e))?; for r in st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,Option<i64>>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?))).map_err(|e|sql_err("Could not query journals",e))? {let(day,mood,energy,entry,wins,ws)=r.map_err(|e|sql_err("Could not read journal",e))?; let mut m=Map::new(); if let Some(v)=mood{m.insert("mood".into(),Value::from(v));} if let Some(v)=energy{m.insert("energy".into(),Value::from(v));} m.insert("entry".into(),Value::from(entry)); m.insert("wins".into(),serde_json::from_str(&wins).unwrap_or(Value::Array(vec![]))); m.insert("workspaceId".into(),Value::from(ws)); journal.insert(day,Value::Object(m));}}
    let mut habits=Vec::new(); {let mut st=c.prepare("SELECT id,workspace_id,name,created_at,updated_at FROM habits WHERE archived_at IS NULL ORDER BY created_at").map_err(|e|sql_err("Could not prepare habits",e))?; for r in st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|sql_err("Could not query habits",e))? {let(id,ws,name)=r.map_err(|e|sql_err("Could not read habit",e))?; let mut log=Map::new(); let mut ls=c.prepare("SELECT day,completed FROM habit_logs WHERE habit_id=?1").map_err(|e|sql_err("Could not prepare habit logs",e))?; for x in ls.query_map([&id],|x|Ok((x.get::<_,String>(0)?,x.get::<_,i64>(1)?))).map_err(|e|sql_err("Could not query habit logs",e))? {let(d,v)=x.map_err(|e|sql_err("Could not read habit log",e))?;log.insert(d,Value::from(v!=0));} habits.push(serde_json::json!({"id":id,"workspaceId":ws,"name":name,"log":log}));}}
    let mut reading=Vec::new(); {let mut st=c.prepare("SELECT id,workspace_id,title,url,note,completed,added_at FROM reading_items ORDER BY added_at DESC").map_err(|e|sql_err("Could not prepare reading list",e))?; for r in st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,i64>(6)?))).map_err(|e|sql_err("Could not query reading list",e))? {let(id,ws,title,url,note,done,added)=r.map_err(|e|sql_err("Could not read reading item",e))?;reading.push(serde_json::json!({"id":id,"workspaceId":ws,"title":title,"url":url,"note":note,"done":done!=0,"added":added}));}}
    let mut tutor=Vec::new(); {let sql=if workspace_id.is_some(){"SELECT id,workspace_id,conversation_id,role,content,created_at FROM tutor_messages WHERE workspace_id=?1 ORDER BY created_at"}else{"SELECT id,workspace_id,conversation_id,role,content,created_at FROM tutor_messages ORDER BY created_at"}; let mut st=c.prepare(sql).map_err(|e|sql_err("Could not prepare tutor snapshot",e))?; let rows=if let Some(ws)=workspace_id{st.query_map([ws],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?))).map_err(|e|sql_err("Could not query tutor",e))?.collect::<Result<Vec<_>,_>>().map_err(|e|sql_err("Could not read tutor",e))?}else{st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?))).map_err(|e|sql_err("Could not query tutor",e))?.collect::<Result<Vec<_>,_>>().map_err(|e|sql_err("Could not read tutor",e))?}; for (id,ws,conv,role,content,created) in rows{tutor.push(serde_json::json!({"id":id,"workspaceId":ws,"conversationId":conv,"role":role,"content":content,"createdAt":created}));}}
    let mut exams=Vec::new(); {let mut st=c.prepare("SELECT id,workspace_id,title,subject,target_at FROM exam_countdowns ORDER BY target_at").map_err(|e|sql_err("Could not prepare exams",e))?; for r in st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,i64>(4)?))).map_err(|e|sql_err("Could not query exams",e))? {let(id,ws,title,subject,target)=r.map_err(|e|sql_err("Could not read exam",e))?; exams.push(serde_json::json!({"id":id,"workspaceId":ws,"title":title,"subject":subject,"targetAt":target,"date":target}));}}
    let mut xp = 0;
let mut badges = Vec::new();

if let Some(ws) = workspace_id {
    if let Some((x, b)) = c
        .query_row(
            "SELECT xp, badges_json
             FROM achievements
             WHERE workspace_id = ?1
             LIMIT 1",
            [ws],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| sql_err("Could not read achievements", e))?
    {
        xp = x;
        badges = serde_json::from_str(&b).unwrap_or_default();
    }
} else if let Some((x, b)) = c
    .query_row(
        "SELECT xp, badges_json
         FROM achievements
         ORDER BY updated_at DESC
         LIMIT 1",
        [],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .map_err(|e| sql_err("Could not read achievements", e))?
{
    xp = x;
    badges = serde_json::from_str(&b).unwrap_or_default();
}
    let mut settings=Map::new(); {let mut st=c.prepare("SELECT key,value_json FROM settings WHERE scope='global' AND workspace_id IS NULL").map_err(|e|sql_err("Could not prepare settings",e))?; for r in st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|sql_err("Could not query settings",e))? {let(k,v)=r.map_err(|e|sql_err("Could not read setting",e))?;settings.insert(k,serde_json::from_str(&v).unwrap_or(Value::Null));}}
    let mut mindmaps=Vec::new(); if let Some(raw)=c.query_row("SELECT payload_json FROM legacy_domain_snapshots WHERE domain='mindmaps'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|sql_err("Could not read mindmaps",e))? {mindmaps=serde_json::from_str(&raw).unwrap_or_default();}
    let mut kss=Vec::new(); if let Some(raw)=c.query_row("SELECT payload_json FROM legacy_domain_snapshots WHERE domain='kss_history'",[],|r|r.get::<_,String>(0)).optional().map_err(|e|sql_err("Could not read KSS history",e))? {kss=serde_json::from_str(&raw).unwrap_or_default();}
    let mut activity=Map::new(); {let mut st=c.prepare("SELECT day,pomodoros,tasks_completed,focus_seconds FROM activity_daily ORDER BY day").map_err(|e|sql_err("Could not prepare activity",e))?; for r in st.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?))).map_err(|e|sql_err("Could not query activity",e))? {let(d,p,t,f)=r.map_err(|e|sql_err("Could not read activity",e))?;activity.insert(d,serde_json::json!({"pomodoros":p,"tasks":t,"focusSeconds":f}));}}
    Ok(RemainingState{canvas_strokes:strokes,mindmaps,journal:Value::Object(journal),habits,reading,tutor_chat:tutor,exam_countdowns:exams,xp,badges,settings:Value::Object(settings),activity_history:Value::Object(activity),kss_history:kss})
}

pub fn initialized(app: &AppHandle) -> Result<bool, String> {
    let c = conn(app)?;
    let value: Option<String> = c.query_row("SELECT value FROM app_metadata WHERE key='remaining_domains_initialized'", [], |r| r.get(0)).optional().map_err(|e| sql_err("Could not read remaining-domain migration state", e))?;
    Ok(value.as_deref() == Some("1"))
}
