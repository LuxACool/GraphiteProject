# Graphite SQLite Architecture

## Goal

SQLite becomes Graphite's long-term source of truth for structured study data. IndexedDB remains a compatibility/migration source only until the migration is complete.

## Storage split

- `graphite.db`: structured application data, queries, indexes, relationships, migration metadata.
- `assets/`: large binary files such as imported images/attachments/canvas exports. SQLite stores metadata/references rather than large blobs.
- IndexedDB: legacy compatibility layer used only by the migration process.

## Core rules

1. Every user-owned record is workspace-scoped unless it is genuinely global.
2. IDs are stable text IDs so existing Graphite IDs can migrate without remapping unless necessary.
3. Timestamps are Unix epoch milliseconds, matching JavaScript `Date.now()`.
4. Soft-delete columns are used where future sync/undo/import workflows benefit from retaining deletion history.
5. Ordering uses explicit `position` values for Kanban/canvas collections rather than array order.
6. Foreign keys use `ON DELETE CASCADE` for workspace-owned data.
7. SQLite is opened with foreign keys enabled and WAL journaling.
8. Schema changes are versioned through `PRAGMA user_version` and `migration_log`.
9. Feature code must not issue raw SQL. Rust/domain repositories are the persistence API.
10. The first migration from IndexedDB must create a safety backup before writing SQLite and must be restartable/idempotent.

## Schema v1

- `workspaces`
- `notes`
- `tasks`
- `calendar_events`
- `flashcards`
- `flashcard_reviews`
- `canvas_documents`
- `canvas_elements`
- `mindmaps`, `mindmap_nodes`, `mindmap_edges`
- `focus_sessions`
- `activity_daily`
- `journals`
- `habits`, `habit_logs`
- `reading_items`
- `tutor_messages`
- `exam_countdowns`
- `achievements`
- `settings`
- `app_metadata`
- `migration_log`

## Migration plan

### Phase A — foundation

Create and validate the SQLite file/schema without changing the existing UI data path. This is the current phase.

### Phase B — read repositories

Add typed Rust commands/repositories for workspaces, notes, tasks, calendar, flashcards and sessions. The UI can read SQLite behind the same repository boundary while IndexedDB remains the write source.

### Phase C — dual-write

For a short compatibility window, writes go to both SQLite and IndexedDB. Add consistency checks and telemetry/error reporting locally. Do not silently discard a SQLite write failure.

### Phase D — one-time migration

1. Lock writes.
2. Export/backup the IndexedDB state.
3. Validate and normalize legacy state.
4. Insert in dependency order inside SQLite transactions.
5. Verify counts and workspace references.
6. Mark migration complete in `app_metadata`.
7. Keep the IndexedDB backup untouched for rollback.

### Phase E — SQLite primary

Feature repositories read/write SQLite. IndexedDB code becomes a legacy importer and can be removed only after a later release proves the migration path is reliable.

## Important design choice: canvas

The current app stores canvas strokes in one large array. SQLite should not reproduce that as one giant JSON state object. A canvas document has many `canvas_elements`, each with its own ID/order/payload. This keeps future editing, undo, partial loading, and large canvases manageable.

## Phase B — typed repository layer

Phase B adds a stable domain boundary over SQLite without changing the app's current IndexedDB source of truth. The Tauri layer now exposes typed repositories for:

- Workspaces
- Notes
- Tasks / Kanban
- Calendar events
- Flashcards + review history
- Focus sessions

Frontend feature code should call `Graphite.repositories.*`. It should not call `Graphite.native.invoke()` for data operations or embed SQL. Browser builds continue using IndexedDB until the dual-write/migration phase is explicitly enabled.

### Command naming

Commands use `repository_<domain>_<operation>`, with camelCase JSON at the JS boundary and snake_case Rust fields internally. Workspace IDs are mandatory on all workspace-owned records. Deletes default to soft-delete where the schema supports `deleted_at`; hard deletion is an explicit `hard: true` operation.

### Migration sequence after Phase B

1. Add read/write adapters in the existing feature modules.
2. Run dual-write in Tauri builds while IndexedDB remains authoritative.
3. Verify row counts and content hashes per workspace/entity.
4. Take a pre-cutover backup.
5. Promote SQLite to the primary repository.
6. Retain IndexedDB import/rollback support for at least one schema generation.

## Dual-write safety

During migration, `IndexedDB -> SQLite` is one-way. SQLite receives a debounced full snapshot after successful IndexedDB persistence. The native transaction mirrors the core tables atomically and stale IDs are removed so SQLite represents the current IndexedDB snapshot. The frontend then asks SQLite for actual table counts and records a verification report.

A failed SQLite write or verification mismatch is logged and surfaced through the Graphite event bus, but does not roll back or block the existing IndexedDB save path. This is deliberate: the migration layer must fail safe while SQLite is still being proven.


## Phase D — Migration Engine

Phase D adds a resumable IndexedDB → SQLite migration engine while IndexedDB remains authoritative. Each run validates the IndexedDB snapshot, creates a native JSON backup, records a migration run in SQLite, imports supported core entities in one SQLite transaction, verifies counts and deterministic ID sets before commit, and only then marks the run completed. If the process stops before completion, a later run can safely resume or re-run because the import is transactional and idempotent. Migration failures are recorded without blocking normal IndexedDB operation.

Frontend entry point: `Graphite.migration.status()` and `Graphite.migration.run({ force: true })`.
