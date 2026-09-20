# Graphite Architecture v2

Graphite is being migrated from a monolithic classic-script application into a layered, feature-oriented Tauri application without requiring a full rewrite of the UI.

## Layers

```text
┌───────────────────────────────────────────────┐
│ UI / Pages                                     │
│ HTML + CSS + js/ui                             │
└──────────────────────┬────────────────────────┘
                       │
┌──────────────────────▼────────────────────────┐
│ Features                                       │
│ dashboard / notes / graph / flashcards / ... │
└──────────────────────┬────────────────────────┘
                       │
┌──────────────────────▼────────────────────────┐
│ Core                                           │
│ runtime / events / commands / persistence    │
└──────────────────────┬────────────────────────┘
                       │
┌──────────────────────▼────────────────────────┐
│ Native Bridge                                  │
│ filesystem / backup / notifications / etc.   │
└──────────────────────┬────────────────────────┘
                       │
                 Tauri 2 / Rust
```

## Rules

1. Features own their behavior; shared infrastructure belongs in `js/core`.
2. UI components should not open IndexedDB transactions directly.
3. Native OS work goes through `Graphite.native` or `Graphite.services`.
4. Cross-feature communication should prefer `Graphite.events` over direct DOM coupling.
5. Commands that represent user intent should eventually move behind `Graphite.commands`.
6. User data remains local-first and must remain portable through backup/restore.
7. Browser fallback must remain functional for the frontend/PWA-like development environment.

## Current migration status

### Completed in this foundation pass
- Split the 2,700+ line navigation/feature monolith into feature modules.
- Added a central runtime, event bus, command registry, and native bridge.
- Moved IndexedDB transaction mechanics into a persistence repository.
- Added native Rust command modules for platform information and application backups.
- Added an application lifecycle module instead of embedding startup behavior in a feature file.
- Kept the existing public/global feature functions temporarily so the UI can migrate incrementally.

### Next migrations
- Move workspace management into `features/workspaces`.
- Move settings into `features/settings` and theme services into `core/theme`.
- Replace direct `saveDataToDB()` calls with domain repositories/commands.
- Move notifications, shortcuts, and background timer work into native services where appropriate.
- Introduce versioned data migrations independent from UI boot.
- Add automated smoke tests for desktop and mobile builds.


### Persistence authority (Phase E)
For migrated core entities, SQLite is the authoritative store after a successful migration. IndexedDB is retained as a compatibility/recovery snapshot and is written after a successful SQLite transaction. If native SQLite is unavailable, the UI falls back to IndexedDB rather than becoming unusable.
