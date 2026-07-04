# Tests — conventions

Full detail: root CLAUDE.md → "Tests" + "Cross-platform validation".

- Real files, real SQLite — no DB mocking. Temp dirs via `fs.mkdtempSync`, cleaned up in `afterEach`.
- Platform-divergent behavior is gated: `it.runIf(process.platform === 'win32')` / `!== 'win32'` — never assume POSIX. Don't merge a platform-gated test you haven't seen run on the real platform (Parallels VM for Windows; Docker `--init` for Linux).
- Don't rename `pr19-improvements.test.ts` or `frameworks-integration.test.ts` — the names anchor to git history.
- Installer changes extend `installer-targets.test.ts` (the parameterized contract suite).
- `evaluation/` runs via `npm run eval`, not as part of `npm test`.
