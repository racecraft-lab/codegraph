# Implementation Plan: Local HTTP Server & REST API

**Branch**: `005-local-http-server` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-local-http-server/spec.md`

## Summary

`codegraph serve --web` stands up a local REST API over the existing per-project
daemon: every read capability the graph already exposes (status, symbol search,
callers, callees, impact, graph neighborhood, repo discovery) plus on-demand
re-index jobs streamed as live Server-Sent Events. The serve process is a daemon
**client** — it attaches to (or spawns) the per-project daemon and forwards
queries over its socket, sharing the one warm index MCP sessions already use
(Q1); it opens no second in-process query copy. The server binds loopback by
default, fails closed on any non-loopback bind without `CODEGRAPH_SERVER_TOKEN`,
validates the `Host` header even on loopback, and adds **zero new runtime
dependencies** — a hand-rolled `node:http` router, hand-rolled SSE, and a minimal
static mount (Q4, research-backed).

The technical approach is fixed by the design concept
(`docs/ai/specs/.process/SPEC-005-design-concept.md`, Q1–Q13) and the binding
SPEC-004 handoff (`docs/design/web-framework-decision.md`, Shipping Strategy +
Deferred Concerns). This plan resolves the three plan-time decisions the Clarify
phase delegated (loopback predicate extraction FR-012, watcher-restore mechanism
FR-021a, terminal `result` union FR-023/024 — see [research.md](./research.md)),
and lays out the module structure so the two review slices layer cleanly:

- **Slice 1 (PR 1) — read API end-to-end**: `serve --web` activation, the
  `node:http` server + router, safe binding + `Host`-allowlist + Bearer auth, all
  read endpoints, the placeholder page + static/fallback rules, the committed
  `openapi.yaml`, and the contract test. Independently shippable; unblocks
  SPEC-006.
- **Slice 2 (PR 2) — job subsystem** layered on Slice 1: `POST /api/reindex/:repo`,
  the per-repo SSE progress stream, the single-active-job 409 rule, the
  lock-contention `lock_unavailable` outcome, shutdown-abort, and the daemon
  watcher re-arm (FR-021a). `jobs.ts` + the SSE writer are isolated modules that
  attach to seams Slice 1 already exposes — no rework of Slice 1.

## Technical Context

**Language/Version**: TypeScript (strict), compiled by `tsc` to `dist/` via
`npm run build`. Runtime Node `>=22.5` from source (the `node:sqlite` gate); npm
`engines` stays `>=20 <25` (gates the thin-installer shim — Constitution VII).

**Primary Dependencies**: **None new.** `node:http`, `node:crypto`
(`timingSafeEqual` + SHA-256 for token compare, FR-014), and `node:net`
(daemon socket) only. The HTTP server, method+path router (~7 routes, one
`:repo`/`:id` param pattern), SSE writer, and static mount are hand-rolled on the
runtime's standard library (Q4; the `src/installer/targets/toml.ts` hand-rolled-
serializer precedent). `sirv` is the researched static-serving escape hatch,
**deferred** to a later spec — not added here.

**Storage**: No new store. Reads are forwarded to the daemon (which owns the
`node:sqlite` index); re-index jobs call the library's `sync()` / `indexAll()`
which write through the existing DB layer under the existing cross-process file
lock. No schema change. In-memory only for job state (latest-per-repo, lost on
restart — Q8).

**Testing**: vitest, real files + real SQLite over a fixture index — repo
convention: `fs.mkdtempSync` temp dirs, cleanup in `afterEach`, **no DB mocking**
(Constitution "Quality Gates"). The FR-025 contract test walks every documented
path/method/status in `openapi.yaml` against a running fixture server started on
`--port 0` (OS-assigned free port → collision-free CI, FR-026). Unit test command
strips embedding env: `env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL
-u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS npm test`.

**Target Platform**: macOS (dev + default `npm test`), Linux, Windows. Platform-
divergent surfaces here are the daemon socket (unix socket vs named pipe — reused
unchanged via the MCP proxy) and process lifecycle (SIGINT/SIGTERM shutdown +
port release, FR-026). Any platform-gated assertion uses `it.runIf(...)` and is
validated for real (Docker for Linux, Parallels VM for Windows) before merge.

**Project Type**: Local CLI + library gaining a new opt-in server surface. New
code lives in a new module `src/server/` (Constitution III's allowed new-module
list names `src/server` explicitly).

**Performance Goals**: No hard latency target — reads are served from the warm
daemon index (sub-ms graph reads; the daemon already meets the retrieval budget).
Paging + caps bound every response (FR-006 `limit` default 100 / max 500;
FR-007 depth default 1 / max 3, node cap 2000 + `truncated`). SSE heartbeats keep
quiet long jobs alive; a full-rebuild job's lock-hold is bounded only by the
rebuild itself and is abortable within a shutdown grace window.

**Constraints**: Zero new runtime dependencies (Principle II/VII, load-bearing).
Dormancy (Constitution VII, FR-001): bare `codegraph serve` and `serve --mcp` stay
byte-identical to today — `--web` is the only activation path, and the `serve`
command stays `hidden` in Commander so `--help` output is unchanged. Same-origin
only, no CORS (FR-019). Fail-closed auth (FR-013). No new **indexing** daemon RPC
(FR-021) — the daemon keeps its no-indexing invariant; the FR-021a watcher re-arm
is a control-plane message, not indexing (see research.md). Upstream-owned files
(`src/bin/codegraph.ts`, `src/embeddings/config.ts`, `src/mcp/*`) get the smallest
possible diff (fork discipline).

**Scale/Scope**: ~7 production files, ~14 total files, ~620 net-new reviewable LOC
— over the greenfield warn line, under every hard block; resolved by the recorded
2-slice split (below). One primary surface: API.

**Reviewability Budget**: Primary surface **API**; secondary surfaces CLI
(`serve --web` activation + bind/auth flags), scheduler/runtime (Slice 2 job
subsystem), docs/process (the committed `openapi.yaml` + its contract test).
Projected ~620 reviewable LOC / ~7 production files / ~14 total → **warn, no hard
block**; accepted resolution is a **2-slice split** (each slice < ~400 LOC), not
one oversized PR (Q13). See Split Decision below.

## Constitution Check

*GATE: evaluated before Phase 0 and re-affirmed after Phase 1 design. Result:
**PASS** — no violations; Complexity Tracking table is empty.*

| Principle | Verdict | Evidence |
|-----------|---------|----------|
| **I. Think Before Coding** | PASS | Spec carries 0 `[NEEDS CLARIFICATION]`; all 13 design-concept Q's resolved; the 3 delegated plan-time decisions (FR-012, FR-021a, FR-023/024) are resolved in research.md with competing options and rationale, not silently picked. |
| **II. Simplicity First** | PASS | Zero new runtime deps; hand-rolled router/SSE/static on `node:http`; offset paging (no cursors); no `/api/v1`; in-memory job state (no persistence). The FR-021a watcher re-arm is the *minimum* mechanism that satisfies a hard correctness FR (a control message reusing existing `CodeGraph.watch()`/`unwatch()`), and its heavier alternative (rewrite the watcher's degrade semantics) was rejected — see research.md. No speculative surface. |
| **III. Surgical Changes / Fork Discipline** | PASS | All new capability in the new `src/server/` module. Upstream-owned diffs are minimal and enumerated: `src/bin/codegraph.ts` (+1 `--web` option, +1 action branch, +1 mutual-exclusion guard); `src/embeddings/config.ts` (delete private `isLoopbackHost`, import shared); `src/utils.ts` (+ shared `isLoopbackHost`); `src/mcp/engine.ts` + daemon request handler (+1 additive `rearmWatcher` control op); `package.json` copy-assets (+ copy `openapi.yaml`). No upstream file is rewritten. |
| **IV. Goal-Driven Execution** | PASS | Success is verifiable: the FR-025 contract test fails on any undocumented route or mismatched shape (SC-005); SC-001–008 are measurable; implement phase is TDD (failing test first). |
| **V. Deterministic, LLM-Free Extraction** | PASS (n/a) | No extraction or graph-structure change. Re-index jobs reuse the existing deterministic `sync()`/`indexAll()`; no new nodes/edges, no LLM in any path. |
| **VI. Retrieval Performance Is a Regression Surface** | PASS (guarded) | The read API forwards existing daemon queries verbatim — no change to MCP tool output, `getExploreBudget`/`getExploreOutputBudget`, error shaping, or edge synthesis. The one `src/mcp/` touch (additive `rearmWatcher` control op) is control-plane only and never alters a tool response. Guardrail: run the retrieval-guardian check before the Slice-2 PR since it touches `src/mcp/`. |
| **VII. Local-First, Private, Zero Native Deps, Dormancy** | PASS | Zero new runtime deps; loopback default; no telemetry; no external network calls (same-origin, no CORS); bare `serve`/`serve --mcp` byte-identical (dormancy verified by SC-006); `openapi.yaml` wired into `copy-assets` (VII's "any static asset must be in copy-assets or it doesn't ship"). |

**Split Decision** (budget warn resolution): two vertical, sequenced,
review-markered PRs on this one branch (`005-local-http-server`). **Slice 1** =
read API end-to-end (US1, US2, US4): `serve --web`, router, safe binding + auth,
all read endpoints, `openapi.yaml`, contract tests — independently shippable,
unblocks SPEC-006. **Slice 2** = job subsystem (US3) layered on top:
`POST /api/reindex/:repo`, SSE progress stream, the 409 single-active-job rule,
`lock_unavailable` handling, shutdown-abort, and the watcher re-arm. Each slice
cuts end-to-end through CLI → server → daemon/library → tests and stays under the
~400-LOC ceiling. Deferred work names its follow-up: SPEC-006 (web UI) and
SPEC-009 (LSP-over-WebSocket handler; SPEC-005 only reserves the `'upgrade'`
attach point).

**PR Review Packet source**: each slice's PR body carries what changed, why,
non-goals, review order, scope budget, traceability (each major FR/SC → changed
files + verification evidence, incl. the SC-008 self-repo dogfood), verification
evidence, known gaps, and the rollback lever — the `--web` dormancy flag (absent
it, no behavior changes).

## Project Structure

### Documentation (this feature)

```text
specs/005-local-http-server/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — the 3 delegated decisions + tech rationale
├── data-model.md        # Phase 1 — entities (Repo, Job, envelopes, results)
├── quickstart.md        # Phase 1 — runnable validation guide (SC-001..008)
├── contracts/
│   └── openapi.yaml      # Phase 1 — hand-written API contract (design source;
│                         #   ships as src/server/openapi.yaml, FR-025)
├── spec.md              # Feature spec (final; 0 NEEDS CLARIFICATION)
├── checklists/          # Clarify/checklist artifacts
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/server/                     # NEW module — all feature code (Constitution III)
├── index.ts        # Slice 1: bootstrap — createServer(node:http), bind + port
│                   #   handling (--port/--host/--port 0, EADDRINUSE, FR-026),
│                   #   'request' + reserved 'upgrade' (SPEC-009) attach points,
│                   #   ordered SIGINT/SIGTERM shutdown, daemon-client wiring.
├── routes.ts       # Slice 1: method+path matcher + read handlers (status,
│                   #   search, node, callers, callees, impact, graph, repos).
│                   #   Slice 2 registers reindex routes via the same seam.
├── auth.ts         # Slice 1: shared isLoopbackHost (from src/utils.ts) +
│                   #   Host-header allowlist (FR-012) + fail-closed bind gate
│                   #   (FR-013) + constant-time Bearer check (FR-014); the
│                   #   token is never logged or echoed (FR-014a).
├── daemon-client.ts# Slice 1: attach-or-spawn per repo via the MCP proxy
│                   #   machinery; lazy multi-repo attach (Q2); /api/repos from
│                   #   the daemon registry; read-query forwarding.
├── static.ts       # Slice 1: placeholder page (FR-017/017a) + strict
│                   #   static/fallback rules (FR-018, binding SPEC-004) +
│                   #   path-traversal confinement via validatePathWithinRoot
│                   #   (FR-017b — src/utils.ts #527 chokepoint).
├── errors.ts       # Slice 1: the 6-code error envelope (FR-015/015a).
├── jobs.ts         # Slice 2 (ISOLATED): in-memory latest-job-per-repo registry,
│                   #   AbortSignal, sync()/indexAll() drive, lock-retry →
│                   #   lock_unavailable (FR-021a), watcher re-arm trigger.
├── sse.ts          # Slice 2 (ISOLATED): SSE writer (snapshot/progress/terminal
│                   #   events; ~15s comment heartbeat; text/event-stream +
│                   #   no-cache + X-Accel-Buffering:no headers; per-subscriber
│                   #   backpressure coalescing, FR-023) on index.ts's response seam.
└── openapi.yaml    # committed API contract; copied into dist/ by copy-assets.

src/bin/codegraph.ts            # MODIFIED (minimal): +--web option, +action
                                #   branch, +--web/--mcp mutual-exclusion guard.
src/utils.ts                    # MODIFIED: + shared isLoopbackHost (FR-012).
src/embeddings/config.ts        # MODIFIED: drop private predicate, import shared.
src/mcp/engine.ts (+ daemon)    # MODIFIED (additive): rearmWatcher control op.
package.json                    # MODIFIED: copy-assets copies src/server/openapi.yaml.

__tests__/                      # mirror the module under test
├── server-read-api.test.ts     # Slice 1: read endpoints over a fixture index.
├── server-auth-binding.test.ts # Slice 1: loopback/no-auth, fail-closed, Host, Bearer.
├── server-openapi-contract.test.ts # Slice 1: FR-025 contract walk (SC-005).
├── server-static-fallback.test.ts  # Slice 1: placeholder + strict fallback.
└── server-reindex-jobs.test.ts # Slice 2: POST, SSE, 409, lock_unavailable, abort.
```

**Structure Decision**: Single new module `src/server/`, matching Constitution
III's named new-module list. Slice 1 delivers `index/routes/auth/daemon-client/
static/errors.ts` + `openapi.yaml`; Slice 2 adds only `jobs.ts` + `sse.ts` and a
route registration in `routes.ts`, attaching to the response-stream seam and the
route-registration seam that Slice 1 already exposes — so Slice 2 layers on
without reworking Slice 1. The `'upgrade'` attach point is exposed in Slice 1's
`index.ts` but wired to nothing (reserved for SPEC-009).

## Complexity Tracking

> No Constitution Check violations. **Zero new runtime dependencies.** This table
> is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                    |
