# Agent dogfooding — Claude Code ↔ Codex parity

This repo dogfoods CodeGraph in both Claude Code and OpenAI Codex with functional
parity. This doc is the capability map and the sync contract; every Codex mechanism
below is the officially documented one (developers.openai.com/codex).

## Parity matrix

| Capability | Claude Code | Codex | Notes |
|---|---|---|---|
| Repo instructions | `CLAUDE.md` (loaded automatically) | `AGENTS.md` → `CLAUDE.md` symlink; `.codex/config.toml` sets `project_doc_max_bytes = 65536` (CLAUDE.md is ~37 KB, over Codex's 32 KiB default cap) | Codex concatenates docs root→cwd ([agents-md guide](https://developers.openai.com/codex/guides/agents-md)) |
| Area tripwires (7 dirs) | Subdirectory `CLAUDE.md` — injected when Claude reads files there | Subdirectory `AGENTS.md` → `CLAUDE.md` symlinks — loaded when the Codex session's cwd is inside that dir | Same content via symlink (single source). Trigger differs by host design: on-read vs on-launch-path |
| MCP dogfooding (HEAD build) | `.mcp.json` | `.codex/config.toml` `[mcp_servers.codegraph]` — project-scoped MCP is official, trusted projects only ([mcp docs](https://developers.openai.com/codex/mcp)) | Both launch via **`scripts/mcp-dogfood.sh`** — pins cwd to the checkout root, sources the untracked `.envrc.local` (spec worktrees fall back to the main checkout's copy), then execs `node dist/bin/codegraph.js serve --mcp`. Per clone: `npm run build && node dist/bin/codegraph.js init .`; Codex asks to trust the project on first run |
| Command guardrails | `.claude/hooks/origin-guard.mjs` (PreToolUse, blocks with exit 2) | `.codex/hooks/origin-guard.mjs` — tokenizing PreToolUse hook wired by `.codex/hooks.json`, byte-identical to the Claude hook ([hooks docs](https://developers.openai.com/codex/hooks)) — **plus** `.codex/rules/origin-guard.rules` (execpolicy `prefix_rule`, `forbidden`/`prompt`; [rules docs](https://developers.openai.com/codex/rules)) | The tokenizing hook now runs on **both** hosts and catches flag-shuffled forms (`git -C . push upstream`); execpolicy `prefix_rule` is the secondary layer but matches literal token prefixes only, so those forms slip past it. Verify rules: `codex execpolicy check --pretty --rules .codex/rules/origin-guard.rules -- <cmd>` |
| Turn-end coverage sentinel | `.claude/hooks/ship-coverage.mjs` (Stop hook: installer coverage + copy-assets checks) | `.codex/hooks/ship-coverage.mjs` — the same Stop hook, wired by `.codex/hooks.json` ([hooks docs](https://developers.openai.com/codex/hooks)) | Parity — Codex CLI supports project-level lifecycle hooks (`Stop` among them), so both hosts run the sentinel as a real hook. Codex trusts a non-managed command hook only after you review it via `/hooks` on first run |
| Prompt front-load hook | `.claude/settings.json` `UserPromptSubmit` → `dist/bin/codegraph.js prompt-hook` (guarded: silently skipped until `dist/` is built; mirrors the product's `codegraph prompt-hook`) | Not wired — Codex has a `UserPromptSubmit` hook event, but the product's prompt-hook speaks Claude's hook stdin/stdout contract; the AGENTS.md retrieval policy carries the function | Candidate future parity item |
| LSP precision dogfood (SPEC-008) | Root `codegraph.json` `{"lsp": {"enabled": true}}` — host-agnostic | Same file; any index/sync from either host runs the pass | Needs a language server on PATH (e.g. `typescript-language-server`); degrades gracefully with reason codes when absent |
| Skills (27 mirrored: `agent-eval`, `validate-linux`, `add-lang`, the `speckit-*` family) | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` — scanned cwd→repo-root ([skills docs](https://developers.openai.com/codex/skills)) | Mirrored files, each marked with a keep-in-sync comment. `corpus.json` is canonical at `.claude/skills/agent-eval/corpus.json` (both sides read it) |
| Review agent: `retrieval-guardian` | `.claude/agents/retrieval-guardian.md` (subagent, auto-delegated by `description` match) | `.codex/agents/retrieval-guardian.toml` (Codex custom subagent — `name`/`description`/`developer_instructions`; [subagents docs](https://developers.openai.com/codex/subagents)) **plus** `.agents/skills/retrieval-guardian/SKILL.md` (description-matched skill) | Same checklist body. The `.codex/agents/*.toml` subagent is spawned only when the user **explicitly** asks (its `description` does not auto-trigger); the mirrored skill is Codex's description-matched path |
| MCP tool pre-approval | Tracked `.claude/settings.json` ships `mcp__codegraph__*` allow + `enableAllProjectMcpServers` (mirrors the product installer's `autoAllow`; Claude ignores repo-tracked approvals in untrusted folders) | Not needed — Codex does not prompt per MCP tool call | Functional parity once the folder is trusted |

## Sync rules

- Every mirrored `.agents/skills/<name>/SKILL.md` (28 today — the 27 skills mirrored from
  `.claude/skills/`, e.g. `agent-eval`, `validate-linux`, `add-lang`, and the `speckit-*`
  family, plus `retrieval-guardian` which mirrors `.claude/agents/`) carries an HTML comment
  naming its `.claude/` counterpart — **edit both or neither**.
- Instruction content needs no syncing: every `AGENTS.md` is a symlink to the
  `CLAUDE.md` beside it.
- Guardrail changes land in **three** files: `.claude/hooks/origin-guard.mjs` and
  `.codex/hooks/origin-guard.mjs` (byte-identical tokenizing hooks — the Codex one wired by
  `.codex/hooks.json`, its path resolved from the git root via `$(git rev-parse --show-toplevel)`;
  [hooks docs](https://developers.openai.com/codex/hooks)), plus `.codex/rules/origin-guard.rules`
  (execpolicy prefix rules). Re-run the execpolicy check battery after editing the rules file.
- MCP launch behavior changes land ONCE in `scripts/mcp-dogfood.sh` — both hosts'
  configs point at it. Spec-worktree bootstrap (build + init + coverage check before
  agent work) is normative in the roadmap's § Dogfooding Protocol, rung 6.
- **Quote any SKILL.md frontmatter `description` containing `: ` (colon-space).** An
  unquoted colon-space is invalid YAML, so the frontmatter fails to parse and the skill is
  skipped — observed making `validate-linux` invisible to Codex while Claude's quoted copy
  worked. This is general YAML hygiene, not a documented Codex behavior (the official skills
  docs don't call it out), so keep it as a defensive convention. Probe after adding a skill:
  `codex exec "is a skill named <name> available? yes or no"`.
