# DB - Local Rules

Full detail: root `AGENTS.md` and `.specify/memory/constitution.md`.

- `node:sqlite` (`DatabaseSync`) is the only backend. No native build step and
  no wasm fallback.
- New runtime dependencies must be pure JS or WASM.
- The adapter keeps a better-sqlite3-shaped surface; `codegraph status` reports
  `node-sqlite`.
- Changes to `schema.sql` ship only because `copy-assets` copies it into `dist`;
  wire any new SQL file into that build step.
