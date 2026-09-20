# Graphite — Remaining Domain Persistence

## Phase F

SQLite is now the authoritative persistence boundary for the remaining application domains that previously lived only inside the IndexedDB `AppState` blob.

### SQLite-authoritative domains

- Canvas strokes/elements — normalized into one canvas document per workspace, with the complete legacy stroke object retained in `payload_json`.
- Mindmaps — normalized into `mindmaps`, `mindmap_nodes`, and `mindmap_edges` when the legacy shape exposes nodes/edges; the original map is also retained as a compatibility snapshot.
- Journals — one row per workspace/day.
- Habits — definitions plus per-day completion logs.
- Reading list — one row per item.
- Tutor messages — individual messages with conversation IDs.
- Exam countdowns — individual exam rows with target timestamps.
- Achievements — workspace XP and badges.
- Settings — key/value JSON rows.
- Activity history — workspace/day aggregate rows.
- KSS history and unknown mindmap fields — preserved in `legacy_domain_snapshots`.

## Startup behavior

1. Existing IndexedDB state is loaded first so legacy users can still boot safely.
2. The existing Phase-D migration is verified.
3. On the first Phase-F startup, the remaining domains are imported from that IndexedDB snapshot in one SQLite transaction.
4. A `remaining_domains_initialized` metadata flag prevents repeated destructive re-imports.
5. The complete authoritative snapshot is then read from SQLite and merged into application state.

## Runtime writes

`saveDataToDB()` continues to provide one persistence boundary. When SQLite is authoritative, it writes the core repositories plus the remaining-domain repository in SQLite first, then updates IndexedDB as the compatibility/recovery snapshot.

When SQLite is unavailable, Graphite falls back to IndexedDB and emits a degraded-storage event rather than silently discarding a save.

## Data-loss protection

Unknown legacy fields are retained in JSON payload columns or `legacy_domain_snapshots` instead of being discarded during normalization. This is intentional: normalized tables can be tightened in later schema migrations without losing data from older app versions.

## Security note

Settings are currently stored as JSON in the app's SQLite database. This preserves existing Graphite behavior, including provider configuration fields. A later native security pass should move API credentials to the OS credential/keychain facility instead of relying on SQLite file permissions.

## Build verification

JavaScript syntax validation was run successfully with Node.js. Rust compilation was not run in this environment because Cargo/Rust tooling is unavailable here; run `cargo check` from `src-tauri` on a Rust-enabled development machine before packaging.
