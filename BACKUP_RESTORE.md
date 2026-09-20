# Graphite Backup & Restore

## What the user-facing backup contains

`Settings → Data → Export Graphite Backup (.json)` creates a versioned, portable `graphite-backup-YYYY-MM-DD.json` file.

The backup serializes Graphite's complete application state, including:

- workspaces and active workspace
- dashboard goal and focus counters
- notes and current note
- Kanban columns/tasks
- flashcards / recall data
- calendar blocks
- canvas strokes and mindmap state when present
- settings and preferences (theme, palette, wallpaper settings, glass settings, soundscape, focus settings, AI settings, shortcuts, etc.)
- activity/KSS history
- journal
- habits
- reading list
- tutor chat
- session log
- exam countdowns
- XP and badges

On a native Tauri build, export also creates a private recovery snapshot containing the SQLite database and filesystem-backed `assets/` directory in Graphite's app-data backup folder. This is an additional safety copy and is not the portable file the user imports.

## Restoring

Use `Settings → Data → Import Graphite Backup` and select the exported `.json` file.

The restore:

1. validates the Graphite backup envelope and required state collections;
2. replaces the current in-memory state instead of merging it, so stale data cannot survive accidentally;
3. persists the restored state through the normal Graphite storage pipeline;
4. updates SQLite when SQLite is authoritative;
5. updates the IndexedDB compatibility snapshot;
6. reloads Graphite so every page starts from the restored state.

Older raw state-only JSON exports are also accepted when they contain the required `workspaces` and `notes` collections.

## Storage architecture

```text
Graphite UI
    ↓
state.js
    ↓
Graphite.dualWrite
    ↓
SQLite (authoritative after migration)
    ↓
filesystem assets
```

IndexedDB remains the compatibility/fallback store. The portable backup is deliberately based on the complete application state so it can reconstruct the SQLite-backed user data without requiring a raw database file from a specific operating system.

## Before a release

1. Build the app for the target platform.
2. Launch it and create representative data in every major module.
3. Export a Graphite backup.
4. Change/delete several pieces of data.
5. Import the backup.
6. Confirm notes, tasks, flashcards, calendar, sessions, preferences, and other state return.
7. Close and reopen Graphite and confirm the restored data persists.
8. On native builds, confirm a private SQLite/assets recovery snapshot was created in the app-data backup directory.

## Important

Do not rename the existing IndexedDB/SQLite compatibility database identifiers casually. They are kept stable so existing Graphite installations can continue to find their data after the user-facing brand changed from the older project name to Graphite.
