# Graphite release audit

## Frontend

- Kanban desktop drag previews no longer use a cloned DOM drag image; the preview is a transparent 1×1 image to avoid HiDPI/WebView scaling. Touch drag ghosts are capped to the viewport and cannot inherit a scale transform.
- Wallpaper glass surfaces remain translucent when glass blur is enabled, with standard and WebKit backdrop filtering and release-safe stacking/isolation. The primary sidebar remains opaque and theme-colored.
- Missing legacy glass settings migrate to `glassOpacity=0.82` and `glassBlur=18`.
- Fresh state initializes with `preset=graphiteblue`, while explicit user palette choices are restored on reload.
- Route transitions use lightweight content animations; the persistent SPA viewport itself is not animated, preserving the no-blank-frame navigation architecture.
- Mobile app modules prevent horizontal overflow and retain safe-area/bottom-navigation spacing.
- Ordinary select controls avoid unwanted browser chrome; date/time inputs intentionally retain their OS picker.
- Task reminders use the unified notification system rather than directly constructing browser `Notification` objects.
- All 39 JavaScript files pass `node --check`.

## SQLite / native integration

The included `src-tauri/` tree is part of this release candidate. The frontend/native command boundary remains connected for:

- SQLite initialization/info/reset
- repository snapshots and writes
- migration begin/import/verify/complete/fail
- filesystem-backed assets
- backup creation and recovery snapshots
- system information

The SQLite dual-write path continues to verify expected row counts after synchronization. Once migration is complete, SQLite is the authoritative store and IndexedDB remains the compatibility/fallback snapshot.

## Backup and restore

`Settings → Data → Export Graphite Backup (.json)` creates a versioned portable Graphite backup containing the complete application state used to reconstruct SQLite:

- workspaces and active workspace
- dashboard goal/focus counters
- notes
- Kanban tasks
- calendar blocks
- flashcards/recall data
- sessions
- settings and preferences
- canvas/mindmap state
- journal
- habits
- reading list
- tutor chat
- exam countdowns
- XP/badges
- activity/KSS history
- related application state

Native Tauri builds additionally create a private recovery snapshot containing the SQLite database and filesystem-backed `assets/` directory.

Importing a Graphite backup validates the envelope, replaces the current state rather than merging it, persists through the normal storage pipeline, updates SQLite when authoritative, updates the IndexedDB compatibility snapshot, and reloads the application.

See `BACKUP_RESTORE.md` for the restore procedure and release-test checklist.

## Internationalization

The supported locales are English, Indonesian, Japanese, and German. Every English locale key is present in all four locale catalogs. Visible HTML labels are registered in the locale catalog, and missing translations use explicit English fallbacks so new UI text is translation-ready instead of silently absent.

## Branding

Visible legacy StudyOS branding has been removed from the user-facing UI and replaced with Graphite. Internal compatibility identifiers such as the existing IndexedDB/SQLite database name are retained where changing them would risk existing user data.

## Updater

The Tauri updater has intentionally been removed. Graphite does not perform automatic application updates. Releases can be distributed normally and users can install the next release through the platform's normal installation/package workflow.

## Native notifications

Tauri v2's notification plugin remains registered in the native application and the default/mobile capabilities include notification permissions. The frontend routes notifications through the unified notification layer. Platform-specific background/terminated-state behavior should still be validated on real Windows, macOS, Linux, Android, and iOS release builds because those behaviors depend on the target OS and packaging environment.

## Validation performed in this environment

- 39 JavaScript files: `node --check` passed.
- English/Indonesian/Japanese/German locale modules: imported successfully.
- Locale key coverage: every English key exists in all supported locales.
- `tauri.conf.json`: valid JSON.
- Active updater references: removed from frontend/native source and Tauri configuration.

A full Rust `cargo check` / platform build was not run in this environment because the Rust toolchain is not installed here. Run `cargo check` and your normal Tauri build on the Fedora development machine before signing a release.
