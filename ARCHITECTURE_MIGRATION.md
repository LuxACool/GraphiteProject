# Architecture v2 migration notes

This release is a foundation pass, not a destructive rewrite.

- The former `src/js/app/core-ui-navigation.js` monolith has been split into feature modules.
- IndexedDB access now lives behind `src/js/core/persistence.js`.
- App startup now lives in `src/js/runtime/lifecycle.js`.
- Tauri/native capabilities have a frontend bridge in `src/js/core/native-bridge.js`.
- Rust commands are modularized under `src-tauri/src/commands/`.
- Existing global feature functions remain intentionally compatible so current HTML handlers and stored data keep working during the next migration phases.

## Dual-write phase (implemented)

Graphite now has a migration-safe dual-write window:

1. IndexedDB remains the live source of truth for the existing UI.
2. A successful IndexedDB save schedules a debounced SQLite snapshot (700 ms).
3. The SQLite snapshot is written atomically through `repository_dual_write_state`.
4. After the transaction commits, `repository_dual_write_counts` verifies that SQLite contains the expected core entity counts.
5. Verification status is emitted as `dualwrite:verified`; failures emit `dualwrite:error` and never invalidate the IndexedDB save.
6. On initial Tauri startup, the current IndexedDB state is snapshotted into SQLite once the native database is initialized.
7. Page visibility/teardown performs a best-effort flush of pending writes.

The synchronized domains are workspaces, notes, Kanban tasks, calendar events, flashcards, and focus sessions. Extra legacy fields are retained in `metadata_json` so the mirror does not discard current UI-only properties (for example flashcard MCQ options and calendar block metadata).

This phase intentionally does **not** read SQLite back into the UI. That comes only after the mirror has been exercised and migration verification proves reliable.


## Phase D — Migration Engine

Phase D adds a resumable IndexedDB → SQLite migration engine while IndexedDB remains authoritative. Each run validates the IndexedDB snapshot, creates a native JSON backup, records a migration run in SQLite, imports supported core entities in one SQLite transaction, verifies counts and deterministic ID sets before commit, and only then marks the run completed. If the process stops before completion, a later run can safely resume or re-run because the import is transactional and idempotent. Migration failures are recorded without blocking normal IndexedDB operation.

Frontend entry point: `Graphite.migration.status()` and `Graphite.migration.run({ force: true })`.


## Phase E — SQLite authoritative

SQLite is now the source of truth for the migrated core entities (workspaces, notes, tasks, calendar events, flashcards, and focus sessions) after a successful migration.

- Startup checks migration state and hydrates migrated state from SQLite when `state=completed`.
- Writes commit to SQLite first; IndexedDB is updated afterward as a compatibility snapshot.
- If SQLite is unavailable or a primary write fails, the app falls back to IndexedDB and emits `storage:degraded`.
- `Graphite.dualWrite.readAuthoritative()` provides the typed snapshot boundary; feature modules never execute SQL.
- The existing migration backup remains the recovery point for the pre-cutover state.
- A rollback/recovery can be performed with `Graphite.migration.rollbackToCompatibilitySnapshot()`, which restores the last IndexedDB compatibility snapshot into SQLite through the existing transactional sync boundary and verifies it before keeping SQLite authoritative.
- Unmigrated domains remain in the legacy state object until their own repository migration is implemented.

## Phase F — Remaining domains

SQLite now also owns persistence for Canvas, Mindmaps, Journals, Habits, Reading, Tutor, Exam Countdowns, Achievements, Settings, Activity history, and preserved legacy domain fragments. See `SQLITE_REMAINING_DOMAINS.md` for the import and recovery contract.
