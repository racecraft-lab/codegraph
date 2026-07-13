# Error Handling Checklist: Local HTTP Server & REST API

**Purpose**: Unit-test the *error-handling requirements* of the Local HTTP Server & REST API for completeness, clarity, and cross-artifact consistency across `spec.md`, `plan.md`, `data-model.md`, and `contracts/openapi.yaml` — startup failure modes, runtime/downstream degradation, the error-envelope contract and its info-leak posture, input/request handling, the strict 404 fallback rules, and connection-level non-functional posture. Tests the requirements, not the implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · [openapi.yaml](../contracts/openapi.yaml)

**Scope note**: The error-handling posture is largely settled by HUMAN-APPROVED Clarify sessions — FR-015a (closed 6-code envelope, whitelisted details, generic 401), FR-021a (lock contention = job `lock_unavailable`, never an HTTP code; watcher-restore duty), FR-011/FR-024 (404 `resource:repo` incl. malformed ids and the no-job case), FR-004a (malformed node id → 404), FR-006a (bad `mode` → 400), FR-012 (Host allowlist → 400; port-in-use → clear error + non-zero exit, FR-026), FR-013 (fail-closed non-loopback startup), FR-017b (traversal → 404), FR-018 (unknown `/api/*` → 404 `resource:route`; unsupported method on a known path → 404 `resource:route`). Items covering these VERIFY coverage/clarity/consistency; they do NOT reopen the decision. Only genuinely missing requirement-level coverage is marked as a Gap.

## Startup Failure Modes (exit non-zero, actionable)

- [x] CHK001 Is the port-in-use (`EADDRINUSE`) startup failure specified to produce a clear error naming the port, suggest `--port`/`--port 0`, exit non-zero, and leave no half-open listener? [Completeness, Spec §FR-026, Edge Cases]
- [x] CHK002 Is the non-loopback-without-`CODEGRAPH_SERVER_TOKEN` bind specified as a fail-closed startup refusal (nothing binds), release-blocking per SC-002? [Completeness, Spec §FR-013/012, SC-002]
- [x] CHK003 Is the `--web`/`--mcp` mutual-exclusion startup failure ("choose one mode") specified as a clear error at startup? [Consistency, Spec §FR-001]
- [x] CHK004 Is `serve --web`'s behavior specified when the **startup repo has no `.codegraph/` index** — refuse startup with an actionable message vs start-degraded — distinct from FR-011's request-time 404 for an unregistered `?repo`/`:repo`? [Resolved → spec Edge Case "`serve --web` started in a repo with no `.codegraph/` index" + FR-005: a missing startup-repo index does NOT refuse startup (unlike the FR-013/026/001 hard failures); the server binds, `/api/status` reports the un-indexed `index.state`, dormancy holds (never auto-inits, Constitution VII), and multi-repo `?repo=` reads against other registered repos are unaffected — mirroring the MCP server's un-indexed-root start (`startDirect('no .codegraph/ root found')` / `SERVER_INSTRUCTIONS_NO_ROOT_INDEX`, #964). Consensus-flagged: start-degraded vs refuse-at-startup.]
- [x] CHK005 Are the startup failure modes consistently required to exit non-zero without leaving a partially-bound/half-open listener? [Consistency, Spec §FR-026]

## Runtime Degradation & Downstream Failures

- [x] CHK006 Is a read against a repo whose daemon cannot be attached/spawned specified as 503 `unavailable` with a `Retry-After`, treated as transient (never an unhandled crash, never a client error)? [Completeness, Spec §FR-015a, Edge Cases, FR-025]
- [x] CHK007 Is index-lock contention (watcher / concurrent CLI holding the file lock) specified as a job `error` `lock_unavailable` after a bounded retry — explicitly NOT mapped to 409 or 503? [Consistency, Spec §FR-021a]
- [x] CHK008 Is the watcher-restore duty specified — a long full rebuild that exhausts the watcher's contention budget must have its sync capability restored on job completion/abort? [Completeness, Spec §FR-021a, Edge Cases]
- [x] CHK009 Is a duplicate active job for a repo specified as 409 `conflict` (at most one active job per repo), and 409 reserved to that case only? [Consistency, Spec §FR-022/021a]
- [x] CHK010 Is a **generic in-job failure** (an extraction/parse or DB-write error from `sync()`/`indexAll()`, distinct from lock-timeout and shutdown-abort) required to be contained — caught and recorded as a terminal `error` outcome over SSE + latest-job-state, never crashing the serve process or leaving the job stuck `running`? [Resolved → FR-021 in-job-containment clause + data-model Job Lifecycle: any `sync()`/`indexAll()` error that is not lock contention (FR-021a) or a shutdown abort (FR-023) is caught → terminal `error` with a whitelisted `reason`, delivered over SSE (FR-023) + latest-job-state (FR-024); it never crashes the serve process, surfaces as a 5xx on the already-returned `202`, or leaves the job stuck `running`.]

## Error-Envelope Completeness & Information Leak

- [x] CHK011 Is the single envelope shape `{ error: { code, message, details? } }` required on EVERY non-2xx response across the API? [Consistency, Spec §FR-015/015a, openapi ErrorEnvelope]
- [x] CHK012 Is per-endpoint status-code enumeration complete and consistent in the contract — 503 on every daemon-backed read, 400 on every client-parameter endpoint — so the FR-025 contract-test walk has a documented target for each emittable status? [Consistency, Spec §FR-025, openapi paths]
- [x] CHK013 Is `message`/`details` constrained to whitelisted, schema-defined fields — never raw exception text, absolute filesystem paths, stack traces, or cause chains? [Completeness, Spec §FR-015a, data-model Error envelope]
- [x] CHK014 Is there a **top-level catch-all** requirement — any unexpected/otherwise-unhandled fault in a request handler is caught and returned as the 500 `internal` envelope, never a raw Node error page, a leaked stack, or a dropped/hung connection? [Resolved → FR-015a top-level-catch clause + data-model `internal` row: every handler is wrapped so an unanticipated throw becomes the 500 `internal` envelope — never a raw runtime error page, leaked stack, or dropped/hung connection; generalizes the Edge Cases' "never an unhandled crash" and introduces no new code (uses the existing closed-vocabulary `internal`).]

## Input & Request Handling

- [x] CHK015 Is the malformed/negative-parameter boundary specified as 400 `invalid_request` while an over-cap `limit`/`depth` clamps (echoing the effective value) rather than erroring? [Consistency, Spec §FR-015a/006/007, openapi Limit/depth]
- [x] CHK016 Is invalid-value handling consistent across the input surface — bad `mode` → 400, malformed/unknown node id → 404 `resource:node`, malformed/unknown repo id → 404 `resource:repo` (malformed indistinguishable from unknown)? [Consistency, Spec §FR-006a/004a/011]
- [x] CHK017 Is the API's **request-body posture** specified — that no documented endpoint parses a request body (reads are GET; `POST /api/reindex/:repo` is URL/query-driven), so a malformed or oversized body cannot produce a parse error or stall a handler, and any body-size bound is stated or scoped? [Resolved → spec Edge Case "Unexpected request body on any endpoint" + FR-020 (`POST /api/reindex/:repo` is URL-only and MUST NOT read/require a body) + openapi POST no-`requestBody` note: no endpoint parses a body, so a malformed/oversized body cannot parse-error or stall a handler; body size is bounded by `node:http` defaults, sufficient under the loopback-default bind (FR-012).]

## Route Fallback & Static-Mount Errors (Q11)

- [x] CHK018 Are the strict fallback rules specified unambiguously — unknown `/api/*` → 404 JSON envelope; a missing asset-extension path (`.js`, `.css`) → 404 with NO app-shell fallback; only an extensionless browser route falls back to the shell? [Clarity, Spec §FR-018, Edge Cases]
- [x] CHK019 Is an unsupported HTTP method on a KNOWN path specified within the closed vocabulary as 404 `not_found` (`resource:route`), with no 405 introduced? [Consistency, Spec §FR-018]
- [x] CHK020 Is a static path that escapes the web root specified as 404 `not_found` (`resource:route`) — reading no out-of-root file, never 403, never the file contents, indistinguishable from any other miss? [Consistency, Spec §FR-017b, Edge Cases]
- [x] CHK021 Is the placeholder-vs-error interplay specified — with `dist/web/` absent (all of SPEC-005's life) `/` serves the data-free placeholder rather than a raw 404, without contradicting the strict `/api/*` and asset-extension 404 rules? [Consistency, Spec §FR-017/017a/018, Assumptions]

## Connection-Level & Non-Functional Posture

- [x] CHK022 Are the SSE failure/degradation semantics specified — a client disconnect stops writes but never cancels the job, and per-subscriber backpressure coalesces (bounded memory) so a slow/disconnected subscriber never stalls the job or other subscribers? [Completeness, Spec §FR-023, data-model]
- [x] CHK023 Is the server's **connection-level abuse posture** (slow-loris, per-request/idle socket timeouts, max-connection caps) specified as in-scope or explicitly out-of-scope (e.g., reverse-proxy territory, as TLS is)? [Resolved → spec Out of Scope "Connection-level abuse mitigation" + FR-023: slow-loris / socket-timeout / connection-cap / rate-limit hardening is reverse-proxy territory (like TLS), out of scope for the loopback-default server; a non-loopback deployment fronts its own proxy. The only long-lived-connection concern the API addresses is the SSE heartbeat / idle-timeout + backpressure (FR-023). Consensus-flagged: in-scope vs explicitly-out scoping.]

## Notes

- A standalone Gap marker on an item denotes a requirement-quality problem to remediate (missing, ambiguous, or inconsistent requirement). Non-marked (`[x]`) items are verified complete/clear/consistent on the current artifacts and do NOT reopen the human-approved Clarify decisions.
- Traceability: every item carries a spec §, plan, data-model, or openapi reference (≥80% target met).
- Remediation flips a resolved item's checkbox to `[x]` and replaces its Gap marker with `[Resolved → <artifact ref>]`.
