# Graphite

Graphite is a local-first, cross-platform study workspace built with a web frontend and Tauri v2 native runtime.

## Architecture

The frontend is organized into layers:

- `src/js/core/` — runtime, persistence, state, theme, notifications, native bridge, shortcuts
- `src/js/features/` — dashboard, notes, graph, flashcards, tasks, focus timer, canvas, navigation, workspaces
- `src/js/rendering/` — Markdown/KaTeX rendering
- `src/js/ui/` — shared dialogs and UI infrastructure
- `src/js/i18n/` — English, Indonesian, Japanese, German
- `src/js/runtime/` — application lifecycle
- `src-tauri/` — Rust/Tauri native layer

See `ARCHITECTURE.md` for the migration plan and architectural rules.

## Development

Frontend-only development:

```bash
python3 -m http.server 8000
```

Tauri development:

```bash
npm install
npm run tauri dev
```

## Supported targets

Graphite is designed for Windows, Linux, macOS, Android, and iOS through Tauri v2.
