# Installer - Local Rules

Full detail: root `AGENTS.md`.

- Every change here needs matching coverage in
  `__tests__/installer-targets.test.ts` and a `CHANGELOG.md` entry under
  `## [Unreleased]`.
- Adding an agent means one new file in `targets/` plus one entry in
  `targets/registry.ts`.
- Targets own MCP config only. Agent-facing tool guidance comes from
  `src/mcp/server-instructions.ts`; installed instruction blocks are legacy
  cleanup surfaces.
- Preserve Cursor's `--path` injection: absolute path for local installs,
  `${workspaceFolder}` for global installs.
- opencode prefers existing `.jsonc`, falls back to `.json`, and creates
  `.jsonc` for greenfield installs; edit through `jsonc-parser`.
- `targets/toml.ts` stays scoped to `[mcp_servers.codegraph]`; preserve sibling
  tables and array-of-table blocks verbatim.
