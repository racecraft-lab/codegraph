# Agent Eval - Local Rules

Full detail: root `AGENTS.md` and the dynamic-dispatch playbook.

- Every A/B arm uses `--model sonnet --effort high` unless the maintainer gives
  an explicit reason to change it.
- Run at least two runs per arm and report ranges; never conclude from one run.
- Pre-warm a persistent daemon before runs, then set `CODEGRAPH_WASM_RELAUNCHED=1`
  so the agent connects before its first turn.
- Judge usage from `parse-run.mjs` output, especially `by type`; do not trust
  the host's initial MCP snapshot alone.
- To isolate a retrieval change, use `ab-new-vs-baseline.sh` with both arms
  codegraph-on instead of a with-vs-without comparison.
