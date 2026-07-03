# DB — edit-time rules

Full detail: root CLAUDE.md → Architecture (`src/db/` entry); constitution Principle VII.

- `node:sqlite` (`DatabaseSync`) is the only backend — no native build step, no wasm fallback. New runtime dependencies must be pure-JS/WASM.
- Changes to `schema.sql` ship only because `copy-assets` copies it into `dist/` — any new SQL file must be added there too.
- The adapter keeps a better-sqlite3-shaped surface; `codegraph status` reports the live backend (`node-sqlite`).
