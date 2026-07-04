# Installer — edit-time rules

Full detail: root CLAUDE.md → "Multi-agent installer" + House rules.

- Every change in this directory needs matching coverage in `__tests__/installer-targets.test.ts` (the parameterized contract suite) AND a `CHANGELOG.md` entry under `## [Unreleased]` — installer regressions break every new install silently.
- Adding an agent = one new file in `targets/` + one entry in `targets/registry.ts`. Targets write MCP config only — never an instructions block (#529); `instructions-template.ts` exports only the `<!-- CODEGRAPH_START/END -->` strip markers.
- Preserve Cursor's `--path` injection (absolute path for local installs, `${workspaceFolder}` for global) — Cursor launches MCP subprocesses with the wrong cwd and doesn't pass `rootUri`.
- opencode: prefer existing `.jsonc`, fall back to `.json`, create `.jsonc` greenfield; edit via `jsonc-parser` so user comments and formatting survive install/uninstall round-trips.
- `targets/toml.ts` stays scoped to `[mcp_servers.codegraph]`; sibling tables and `[[array_of_tables]]` are preserved verbatim. No new TOML dependency.
