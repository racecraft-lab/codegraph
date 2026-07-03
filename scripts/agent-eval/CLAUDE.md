# Agent-eval — methodology invariants

Full detail: root CLAUDE.md → "Validation methodology".

- Model policy: every A/B arm runs `--model sonnet --effort high` — never Opus/Fable. Sonnet is the deliberate floor model; both arms always use the same model. Don't raise `MODEL`/`EFFORT` without an explicit reason from the maintainer.
- ≥2 runs per arm, always — run-to-run variance is large; report ranges, never conclude from n=1.
- Pre-warm a persistent daemon before runs (high `CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS`, spawn `serve --mcp --path <target> </dev/null &`, wait for `.codegraph/daemon.sock`, set `CODEGRAPH_WASM_RELAUNCHED=1`).
- Judge codegraph usage from `parse-run.mjs`'s `by type` output — never trust claude's `init` snapshot.
- To isolate a change, use `ab-new-vs-baseline.sh` (new-build vs baseline-build, both codegraph-on) instead of `run-all.sh`'s with-vs-without.
