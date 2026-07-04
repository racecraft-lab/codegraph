---
name: agent-eval
description: Benchmark CodeGraph retrieval quality on a real codebase by comparing agent behavior with vs without CodeGraph. Use when the user runs /agent-eval or asks to test, benchmark, audit, or validate a codegraph version (the local dev build or a published npm version) against a language's repo.
---

<!-- Codex mirror of .claude/skills/agent-eval/SKILL.md — keep the two in sync.
     Adaptation: questions are asked in plain conversation (one at a time)
     instead of Claude's AskUserQuestion tool. The canonical corpus lives at
     .claude/skills/agent-eval/corpus.json (single copy, shared). -->

# CodeGraph Quality Audit

Measures how much CodeGraph helps an agent versus plain grep/read, for a chosen
codegraph version on a chosen real-world repo. Drives the harness in
`scripts/agent-eval/`.

## Prerequisites
- `tmux` 3+, a logged-in `claude` CLI (the eval subject runs Claude regardless of
  which agent orchestrates the audit), `node`, `git` (macOS/Linux).
- Run from the codegraph repo root.

## Workflow

Copy this checklist:
```
- [ ] 1. Pick version (local or npm)
- [ ] 2. Pick language
- [ ] 3. Pick repo by size
- [ ] 4. Pick harness (headless / tmux / both)
- [ ] 5. Run audit.sh in the background
- [ ] 6. Report results
```

Ask the user each of steps 1–4 as a single plain question with the options
listed; wait for the answer before the next question.

**Step 1 — version.** Which codegraph version to test: "Local dev build" →
`local`; "Latest published" → `latest`; a typed version (e.g. `0.7.10`) → that
string.

**Step 2 — language.** Read `.claude/skills/agent-eval/corpus.json` (the
canonical corpus, shared with the Claude skill). Offer the languages that have
entries.

**Step 3 — repo.** From the chosen language's entries, offer each repo labeled
with its size and file count, e.g. `excalidraw — Medium (~600 files)`. Each
entry carries the `repo` URL and a representative `question`.

**Step 4 — harness.** Map the answer to a MODE token:
- "Headless" → `headless` — `claude -p` with stream-json: exact tokens/cost and a
  clean tool sequence (2 runs, fast, no TTY).
- "Interactive (tmux)" → `tmux` — drives the real Claude TUI in tmux: faithful
  Explore-subagent behavior, metrics from session logs (2 runs, slower).
- "Both" → `all` — headless + interactive (4 runs).

**Step 5 — run.** Launch in the background (sets the version, clones if missing,
wipes + re-indexes, runs the chosen arms — several minutes):
```bash
scripts/agent-eval/audit.sh <VERSION> <repo-name> <repo-url> "<question>" <MODE>
```

**Step 6 — report.** When the job finishes, read the log and report per arm:
- Headless (`parse-run.mjs`): total tool calls, file `Read`s, Grep/Bash,
  codegraph-tool calls, duration, **total cost**.
- Interactive (`parse-session.mjs`): the `VERDICT: codegraph_explore used Nx |
  Read N | Grep/Bash N` and `TOKENS:` lines.

Lead with cost + tool/Read counts — they are the reliable signals; raw token
in/out are confounded by subagent delegation and prompt caching. State whether
codegraph reduced effort and whether both arms reached a correct answer.

## Notes
- The index is rebuilt every run (`audit.sh` wipes `.codegraph`) — different
  versions extract differently, so an index must be served by the same binary
  that built it.
- `audit.sh` temporarily mutates the global `codegraph` install for the test,
  then restores your dev link via `local-install.sh`.
- Corpus repos are cloned to `/tmp/codegraph-corpus` (reused if already present).
- Add or edit repos in `.claude/skills/agent-eval/corpus.json` (fields: `name`,
  `repo`, `size`, `files`, `question`).

## Invariants (from CLAUDE.md validation methodology)

- **Model floor**: the harness defaults both arms to `--model sonnet --effort
  high` (`run-all.sh`). Never raise `MODEL`/`EFFORT` — Sonnet is the deliberate
  floor model — unless the maintainer explicitly asks.
- **Variance**: one pass is n=1 per arm. Never conclude from a single pass —
  run the audit at least twice and report ranges, not single numbers.
- **Pass bar**: a flow question reaches ~0 Read/Grep within the repo-size
  explore-call budget and runs faster than the without-codegraph arm.
- **Isolating a build change**: use `scripts/agent-eval/ab-new-vs-baseline.sh`
  (both arms codegraph-on, daemon pre-warm baked in) — not with-vs-without.
- **MCP attach**: don't trust the agent's MCP init snapshot; judge codegraph
  usage from `parse-run.mjs`'s `by type` output.
