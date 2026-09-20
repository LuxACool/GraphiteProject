# Graphite — multi-file architecture

Graphite is a Tauri v2 desktop/mobile application with a framework-free web frontend. The frontend remains plain HTML/CSS/JavaScript for portability, while core persistence and native capabilities are separated behind stable interfaces.

```text
src/
  index.html              app shell
  pages/                  screen markup
  css/                    global + feature styles
  js/
    core/                 runtime, persistence, state, theme, notifications, shortcuts
    features/             dashboard, notes, graph, flashcards, tasks, timer, canvas, navigation, workspaces
    rendering/            Markdown/KaTeX rendering helpers
    ui/                   shared dialogs/modals
    i18n/                 English / Indonesian / Japanese / German
    services/             integration services as they are migrated
    app/                  remaining legacy-compatible services during migration
    runtime/              application lifecycle
    pages/                page-specific bootstrap modules
```

## Tauri layer

```text
src-tauri/
  src/
    commands/              native command modules
      system.rs
      backup.rs
    lib.rs                 Tauri application entry
    main.rs                desktop entry
  capabilities/            permissions
  icons/                   desktop + Android + iOS icons
  tauri.conf.json          Tauri configuration
  Cargo.toml               Rust dependencies
```

## Architecture rules

- UI modules do not open IndexedDB transactions directly.
- Features communicate through `Graphite.events` where cross-feature events are needed.
- User-intent operations can be exposed through `Graphite.commands`.
- Native work goes through `Graphite.native` / `Graphite.services` so browser development still has safe fallbacks.
- User data stays local-first and portable through backup/restore.
- Feature modules are loaded as classic scripts for compatibility during the migration; they can later be converted to ES modules without changing the feature boundaries.

## Running the frontend

Because screens are loaded from separate files:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Running Tauri

```bash
npm install
npm run tauri dev
```

The Tauri application uses the same `src/` frontend through `frontendDist: "../src"`.


## Settings / App Shell Fix
The root Tauri layout no longer relies on Tailwind CDN utilities for body/main flex sizing. Native CSS explicitly makes the body a full-width flex shell, keeps the sidebar fixed-width, and makes the main content flex to the remaining viewport. This prevents Settings and other injected pages from collapsing to intrinsic content width when Tailwind is unavailable or delayed.
