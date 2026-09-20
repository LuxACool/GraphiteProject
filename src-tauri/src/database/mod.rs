use rusqlite::{Connection, Result as SqlResult};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const CURRENT_SCHEMA_VERSION: i32 = 5;

pub struct GraphiteDb {
    pub path: PathBuf,
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("Could not resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create app data directory: {e}"))?;
    Ok(dir.join("graphite.db"))
}

pub fn open(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("Could not open SQLite database: {e}"))?;
    configure(&conn).map_err(|e| format!("Could not configure SQLite: {e}"))?;
    migrate(&conn).map_err(|e| format!("SQLite migration failed: {e}"))?;
    Ok((conn, path))
}

fn configure(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
}

fn migrate(conn: &Connection) -> SqlResult<()> {
    let mut current: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current > CURRENT_SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if current < 1 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(include_str!("schema.sql"))?;
        let now = chrono_like_now_ms();
        tx.execute("INSERT OR REPLACE INTO migration_log(version, name, applied_at) VALUES(1, ?1, ?2)", ("initial_schema", now))?;
        tx.execute("INSERT OR REPLACE INTO migration_log(version, name, applied_at) VALUES(2, ?1, ?2)", ("dual_write_metadata", now))?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
        current = 2;
    }
    if current < 2 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "ALTER TABLE notes ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';\n             ALTER TABLE tasks ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';\n             ALTER TABLE calendar_events ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';\n             ALTER TABLE flashcards ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';\n             ALTER TABLE focus_sessions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';"
        )?;
        let now = chrono_like_now_ms();
        tx.execute("INSERT OR REPLACE INTO migration_log(version, name, applied_at) VALUES(2, ?1, ?2)", ("dual_write_metadata", now))?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }
    if current < 3 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS migration_state (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL DEFAULT 'idle', run_id TEXT, source_version INTEGER, started_at INTEGER, completed_at INTEGER, backup_path TEXT, last_error TEXT, updated_at INTEGER NOT NULL);")?;
        let now = chrono_like_now_ms();
        tx.execute("INSERT OR REPLACE INTO migration_log(version, name, applied_at) VALUES(3, ?1, ?2)", ("migration_engine_state", now))?;
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
    }
    if current < 4 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(include_str!("schema.sql"))?;
        let now = chrono_like_now_ms();
        tx.execute("INSERT OR REPLACE INTO migration_log(version, name, applied_at) VALUES(4, ?1, ?2)", ("remaining_domain_persistence", now))?;
        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;
    }
    if current < 5 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, category TEXT NOT NULL, relative_path TEXT NOT NULL, mime_type TEXT, bytes INTEGER NOT NULL DEFAULT 0, checksum TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER); CREATE INDEX IF NOT EXISTS idx_assets_workspace_category ON assets(workspace_id, category, updated_at DESC);")?;
        let now = chrono_like_now_ms();
        tx.execute("INSERT OR REPLACE INTO migration_log(version, name, applied_at) VALUES(5, ?1, ?2)", ("filesystem_assets_and_backup_metadata", now))?;
        tx.pragma_update(None, "user_version", 5)?;
        tx.commit()?;
    }
    Ok(())
}

// Keep the Tauri layer dependency-light: UNIX epoch milliseconds are enough for
// database metadata and match the JS Date.now() representation.
fn chrono_like_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn schema_version(conn: &Connection) -> SqlResult<i32> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
}

pub fn db_exists(path: &Path) -> bool {
    path.exists()
}
