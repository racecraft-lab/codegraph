# Agent dogfooding — Claude Code ↔ Codex parity

This repo dogfoods CodeGraph in both Claude Code and OpenAI Codex with functional
parity. This doc is the capability map and the sync contract; every Codex mechanism
below is the officially documented one (developers.openai.com/codex).

## Parity matrix

| Capability | Claude Code | Codex | Notes |
|---|---|---|---|
| Repo instructions | `CLAUDE.md` (loaded automatically) | `AGENTS.md` → `CLAUDE.md` symlink; `.codex/config.toml` sets `project_doc_max_bytes = 65536` (CLAUDE.md is ~37 KB, over Codex's 32 KiB default cap) | Codex concatenates docs root→cwd ([agents-md guide](https://developers.openai.com/codex/guides/agents-md)) |
| Area tripwires (7 dirs) | Subdirectory `CLAUDE.md` — injected when Claude reads files there | Subdirectory `AGENTS.md` → `CLAUDE.md` symlinks — loaded when the Codex session's cwd is inside that dir | Same content via symlink (single source). Trigger differs by host design: on-read vs on-launch-path |
| MCP dogfooding (HEAD build) | `.mcp.json` | `.codex/config.toml` `[mcp_servers.codegraph]` — project-scoped MCP is official, trusted projects only ([mcp docs](https://developers.openai.com/codex/mcp)) | Both run `node dist/bin/codegraph.js serve --mcp`. Per clone: `npm run build && node dist/bin/codegraph.js init .`; Codex asks to trust the project on first run |
| Command guardrails | `.claude/hooks/origin-guard.mjs` (PreToolUse, blocks with exit 2) | `.codex/rules/origin-guard.rules` (execpolicy `prefix_rule`, `forbidden`/`prompt` decisions; [rules docs](https://developers.openai.com/codex/rules)) | Verify Codex side: `codex execpolicy check --pretty --rules .codex/rules/origin-guard.rules -- <cmd>`. Codex rules match literal token prefixes only — flag-shuffled forms (`git -C . push upstream`) rely on the instructions backstop; the Claude hook tokenizes and catches those |
| Turn-end coverage sentinel | `.claude/hooks/ship-coverage.mjs` (Stop hook: installer coverage + copy-assets checks) | No lifecycle hooks exist in Codex (per the [features doc](https://developers.openai.com/codex/cli/features)) — the function is carried by the instructions layer (root doc house rules + subdir tripwires) and the prompt-gated `gh`/`git tag` rules | The one mechanism-level difference between hosts |
| Skills: `agent-eval`, `validate-linux` | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` — scanned cwd→repo-root ([skills docs](https://developers.openai.com/codex/skills)) | Mirrored files, marked with a keep-in-sync comment. `corpus.json` is canonical at `.claude/skills/agent-eval/corpus.json` (both sides read it) |
| Review agent: `retrieval-guardian` | `.claude/agents/retrieval-guardian.md` (subagent) | `.agents/skills/retrieval-guardian/SKILL.md` (description-matched skill) | Same checklist body; Codex triggers skills by description match, which mirrors subagent description triggering |
| MCP tool pre-approval | `settings.json` `mcp__codegraph__*` allow (written by the product installer with `autoAllow`) | Not needed — Codex does not prompt per MCP tool call | Functional parity by default |

## Sync rules

- The mirrored files (`.agents/skills/{agent-eval,validate-linux,retrieval-guardian}/SKILL.md`)
  carry an HTML comment naming their `.claude/` counterpart — **edit both or neither**.
- Instruction content needs no syncing: every `AGENTS.md` is a symlink to the
  `CLAUDE.md` beside it.
- Guardrail changes land twice: `.claude/hooks/origin-guard.mjs` (tokenizing hook) and
  `.codex/rules/origin-guard.rules` (prefix rules). Re-run the execpolicy check battery
  after editing the rules file.
- **Quote any SKILL.md frontmatter `description` containing `: ` (colon-space).** An
  unquoted one is invalid YAML and Codex silently skips the skill — this exact bug made
  `validate-linux` invisible to Codex while Claude's quoted copy worked. Probe after
  adding a skill: `codex exec "is a skill named <name> available? yes or no"`.
