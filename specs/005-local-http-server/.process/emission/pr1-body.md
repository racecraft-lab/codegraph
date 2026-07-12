## What changed

`codegraph serve --web` now starts a local HTTP server that exposes the indexed code graph as a documented REST API. Everything the graph knows — project status, symbol search, node details, callers and callees, impact analysis, and graph neighborhoods for a canvas view — is reachable as JSON over `http://127.0.0.1:11235/api/*`, served from the same warm background daemon the MCP tools already use, so queries are fast and nothing is re-indexed.

Highlights:

- **Eight read endpoints** (`/api/status`, `/api/repos`, `/api/search`, `/api/node/:id`, `/api/callers/:id`, `/api/callees/:id`, `/api/impact/:id`, `/api/graph/:id`) with consistent paging and a small, fixed error vocabulary — responses never leak file paths, stack traces, or raw exception text.
- **Safe by default.** The server binds to localhost only. Binding to a network address refuses to start unless `CODEGRAPH_SERVER_TOKEN` is set, and then every API request requires that token as a Bearer credential (constant-time comparison, token never logged). The `Host` header is allowlisted even on localhost as a DNS-rebinding defense.
- **Multi-repo aware.** `/api/repos` lists every indexed project on the machine; any read can target one with `?repo=<id>`, attaching that repo's daemon lazily on first use.
- **Ships its own contract.** An OpenAPI document is included in the package, and a contract test walks every documented path, method, and status — an undocumented route or a drifted shape fails CI.
- **Nothing changes unless you opt in.** Without `--web`, `codegraph serve` and `serve --mcp` behave byte-for-byte as before; no HTTP port is ever opened.

Visiting `/` serves a minimal placeholder page pointing at the API — the browser UI arrives in the next spec (SPEC-006) and mounts on this server unchanged.

## Why it matters

This is the foundation for the CodeGraph web dashboard and for any local tooling that wants graph answers without speaking MCP. Editors, scripts, and the upcoming UI can query one warm, shared index over plain HTTP — locally, with no cloud round-trip and no new runtime dependencies (the server is built entirely on Node's standard library).

## Anything reviewers should know

- Suggested review order and per-requirement traceability live in the committed packet: `specs/005-local-http-server/.process/slice1-pr-packet.md`; hands-on acceptance evidence is in `slice1-quickstart-evidence.md`.
- The REST layer needed structured results (node ids, edges) that the daemon's MCP tool surface doesn't return, so the daemon gained one additive, read-only RPC used exclusively by this server. An adversarial check confirmed the MCP tool surface, budgets, and outputs are byte-for-byte unaffected.
- The slice is larger than the ~400-reviewable-LOC target (~1,280 logic LOC) — recorded as a size-only finding in the packet; the review-order section is designed to make the walk manageable.
- Rollback lever: simply don't pass `--web` — the feature is fully dormant behind the flag.

## Self-Review Findings

No gaps. Full test evidence, edge-case coverage, requirement traceability, and tidiness checks are recorded in the workflow log Self-Review block (`docs/ai/specs/.process/SPEC-005-workflow.md`); an independent fresh-session audit verified all tasks against real code with zero phantom completions.

## UAT Runbook

Skipped: the runbook generator is deferred on the installed runner. Committed acceptance evidence stands in: `specs/005-local-http-server/.process/slice1-quickstart-evidence.md` (scenarios 1–7, all PASS).

<details><summary>Reviewer checklist &amp; scope details</summary>

- Scope: 14 production files under `src/` (+2,356 / −9), tests +205 across 4 suites, at marker checkpoint `17cef94`
- Verification: full suite green at checkpoint (2,912 → 3,117 tests); typecheck exit 0; zero new runtime dependencies
- Rollback: omit `--web` (no other surface changes)
</details>
