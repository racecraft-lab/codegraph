# Tests - Local Rules

Full detail: root `AGENTS.md` and `.specify/memory/constitution.md`.

- Use real files and real SQLite; do not mock the database.
- Create temp dirs with `fs.mkdtempSync` and clean them in `afterEach`.
- Gate platform-divergent behavior with `it.runIf(process.platform === 'win32')`
  or `!== 'win32'`; do not assume POSIX behavior.
- Validate Windows-gated behavior on the real Windows VM and Linux-sensitive
  behavior in Docker with `--init` before making merge claims.
- Do not rename `pr19-improvements.test.ts` or `frameworks-integration.test.ts`;
  those names anchor regression history.
- Installer changes extend `installer-targets.test.ts`.
- `evaluation/` runs through `npm run eval`, not `npm test`.
