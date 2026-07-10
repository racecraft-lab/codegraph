# SpecKit Workflow: SPEC-005 — Local HTTP Server & REST API

**Template Version**: 1.0.0
**Created**: 2026-07-10
**Purpose**: Executable workflow for SPEC-005. The prompts below are what `/speckit-pro:speckit-autopilot` (or a human) feeds each SpecKit phase.

---

## How to Use This Template

Populated by `/speckit-pro:speckit-scaffold-spec SPEC-005` on 2026-07-10. All
placeholders are resolved; run phases in order via
`/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-005-workflow.md`.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec`. The full Q&A log, Goals, Non-goals, and Open
Questions live at:

```text
docs/ai/specs/.process/SPEC-005-design-concept.md
```

Re-read it before each phase if you need to disambiguate a prompt. The
Specify and Clarify Prompts below were populated from that interview,
so the design concept doc is the source of truth for any decision
captured during scoping.

> **Note:** Grill Me is human-in-the-loop only. It is **not** part of
> the autopilot loop. Once the workflow file is populated and autopilot
> begins, clarifications happen via `/speckit-clarify` and the
> consensus protocol — never via grill-me.

---

## Reviewability Budget & Split Decision (recorded at scaffold)

Setup-mode reviewability gate (2026-07-10): **warn, no blockers** — 620 projected
reviewable LOC (greenfield warn line 600), ~7 production files (warn threshold 6),
~14 total files, primary surface API. Per the gate contract, this warning may
proceed because the budget and split decision are recorded here:

**Split decision (design concept Q13, accepted):** 2 vertical slices on this one
branch, delivered as two sequenced review-markered PRs, each under the ~400
reviewable-LOC ceiling:

- **Slice 1 — Read API end-to-end:** `codegraph serve --web` bootstrap, zero-dep
  router, bind/auth policy, all GET endpoints (`/api/repos`, `/api/search`,
  `/api/nodes/:id`, `/api/impact/:id`, `/api/graph`, `/api/status`), JSON error
  envelope, request logging, static mount + placeholder page + strict fallback,
  `openapi.yaml` + contract test. Independently shippable; unblocks SPEC-006.
- **Slice 2 — Job subsystem:** `POST /api/reindex/:repo` (sync default,
  `?full=true`), in-memory job manager (one active job per repo, 409 on duplicate,
  latest-job retention), `GET /api/jobs/:id/events` SSE progress stream, openapi +
  contract-test extension.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ⏳ Pending | |
| Clarify | `/speckit-clarify` | ⏳ Pending | Optional but recommended |
| Plan | `/speckit-plan` | ⏳ Pending | |
| Checklist | `/speckit-checklist` | ⏳ Pending | Run for each domain |
| Tasks | `/speckit-tasks` | ⏳ Pending | |
| Analyze | `/speckit-analyze` | ⏳ Pending | |
| Implement | `/speckit-implement` | ⏳ Pending | |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | Ambiguities resolved, decisions documented |
| G3 | After Plan | Architecture approved, constitution gates pass, dependencies identified |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified, dependencies ordered |
| G6 | After Analyze | No `CRITICAL` issues, `WARNING` items reviewed |
| G7 | After Each Implementation Phase | Tests pass, manual verification complete |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Assumptions stated; competing interpretations surfaced (`[NEEDS CLARIFICATION]`) | G1 blocks while markers remain |
| II. Simplicity First | Zero new runtime deps (design concept Q4); no speculative surface (no /v1, no job history, no CORS) | Plan Complexity Tracking table; `npm ls --omit=dev` unchanged |
| III. Surgical Changes | Net-new `src/server/` module; minimal diff to `src/bin/codegraph.ts` (upstream-owned) | PR diff review — every changed line traces to SPEC-005 |
| IV. Goal-Driven Execution | TDD; integration tests over a fixture index; contract test walks openapi.yaml | `npm test` output attached at each G7 |
| V–VI. Retrieval no-regress | No changes to `src/mcp/tools.ts` budgets, error shaping, or `src/resolution/` | `retrieval-guardian` agent if any retrieval file is touched (should be none) |
| VII. Dormancy discipline | No web server starts by default — `serve --web` is explicit opt-in; loopback default; fail-closed non-loopback | Integration test: bare `codegraph serve` / `serve --mcp` opens no HTTP port |

**Constitution Check:** ✅ (validated at scaffold; re-verify at G3)

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-005 |
| **Name** | Local HTTP Server & REST API |
| **Branch** | `005-local-http-server` |
| **Dependencies** | SPEC-004 (complete — `docs/design/web-framework-decision.md`) |
| **Enables** | SPEC-006 (Web UI), SPEC-007 (app shell), SPEC-009 (LSP-over-WebSocket) |
| **Priority** | P0 |

### Success Criteria Summary

From the roadmap scope + design concept:

- [ ] `codegraph serve --web` starts a loopback HTTP server exposing the full graph read surface: `GET /api/repos`, `/api/search?q&mode`, `/api/nodes/:id` (detail + callers/callees pages), `/api/impact/:id?depth`, `/api/graph?root&depth&limit`, `/api/status`
- [ ] Queries ride the existing per-project daemon (attach-or-spawn, like MCP) — one warm index shared across MCP sessions and the web server (Q1)
- [ ] Multi-repo: `/api/repos` lists indexed projects from the daemon registry; startup repo is default; others lazy-attach by repo id (Q2)
- [ ] `POST /api/reindex/:repo` runs sync (default) or full index (`?full=true`) in the serve process; `GET /api/jobs/:id/events` streams SSE progress; 409 on duplicate active job (Q6–Q8)
- [ ] Bind 127.0.0.1 default with `--port`/`--host`; non-loopback refuses to start without `CODEGRAPH_SERVER_TOKEN`; token enforced as Bearer on `/api/*` (Q5)
- [ ] JSON error envelope `{error: {code, message, details?}}` on every error path; no `/v1` prefix; version reported in `/api/status` (Q9)
- [ ] Static mount serves `dist/web/` when present, built-in placeholder page otherwise; `/api/*` and asset-extension 404s never fall back to the app shell; WebSocket upgrade hook reserved for SPEC-009 (Q11)
- [ ] `src/server/openapi.yaml` committed and enforced by a contract test against a fixture server (Q10)
- [ ] Zero new runtime dependencies (Q4, research-backed)
- [ ] Delivered as 2 vertical slices / 2 PRs per the recorded split decision

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/005-local-http-server/spec.md`

### Specify Prompt

```text
/speckit-specify

## Feature: Local HTTP Server & REST API (SPEC-005)

### Problem Statement
CodeGraph's knowledge graph is reachable today only through MCP (for agents) and
the CLI (for terminal users). SPEC-006's web graph browser and SPEC-009's LSP
facade need a documented local HTTP surface. `codegraph serve --web` must expose
the full graph read surface plus re-index jobs over a local REST API riding the
existing daemon/query-pool — local-first, dormant by default, no hosted services.

### Users
- A developer who runs `codegraph serve --web` in an indexed project and browses
  the graph from a local browser (directly in SPEC-005 via /api/*; visually once
  SPEC-006 ships).
- The SPEC-006 web UI (same-origin, shipped in the same npm package).
- The SPEC-009 LSP-over-WebSocket handler (reserves the upgrade hook only).

### User Stories
- [US1] As a developer, I start `codegraph serve --web` in an indexed repo and
  query symbols, callers/callees, impact, graph neighborhoods, and server status
  over documented REST endpoints, served from the same warm daemon index my MCP
  sessions use.
- [US2] As a developer with several indexed projects, I list them via /api/repos
  and address any of them by repo id; daemons attach lazily on demand
  (design concept Q2).
- [US3] As a developer (or the SPEC-006 UI), I trigger a re-index job
  (incremental sync by default, ?full=true for a rebuild), watch live progress
  over SSE, get a 409 if a job is already running for that repo, and can read
  the last job's outcome after it finishes (Q6–Q8).
- [US4] As a security-conscious user, the server binds 127.0.0.1 by default,
  refuses to start on a non-loopback host without CODEGRAPH_SERVER_TOKEN, and
  enforces the token as a Bearer header on /api/* (Q5).

### Constraints (from the design concept — quote Q-numbers in the spec)
- Zero new runtime dependencies: hand-rolled router/SSE/static on node:http (Q4;
  deep-research verified: Storybook migrated off Express to cut dep bloat, Vite
  uses connect+sirv, SSE is trivial on bare node:http; sirv is the escape hatch
  if SPEC-006's static needs outgrow the hand-rolled mount).
- Serve process is a daemon CLIENT for queries (attach-or-spawn like MCP, Q1);
  reindex jobs run IN the serve process via library sync()/indexAll(), arbitrated
  by the existing cross-process file lock — the daemon keeps its no-indexing
  invariant (Q7).
- Job state is in-memory, latest job per repo, lost on restart; SSE sends a
  snapshot then live events, ends on terminal done/error, no Last-Event-ID
  replay (Q8).
- No /api/v1 prefix — client and server ship in one package; version in
  /api/status; single error envelope {error: {code, message, details?}} (Q9).
- Static/fallback rules are binding from SPEC-004: /api/* 404s as JSON,
  asset-extension requests 404, only extensionless routes fall back to the
  shell; placeholder page while dist/web/ is absent; same-origin only, no CORS
  (Q11).
- Offset paging (?limit&offset, default 100, max 500, response carries total);
  /api/graph default depth 1, max 3, node cap 2000 with truncated flag (Q12).
- Dormancy (constitution VII): no HTTP behavior unless --web is passed.
- Reviewability: 2 vertical slices / 2 PRs (recorded split decision) — the spec's
  user stories must partition cleanly into read-API (US1/US2/US4) and jobs (US3).

### Out of Scope
- The web UI itself (SPEC-006); LSP-over-WebSocket handler (SPEC-009 — only the
  upgrade hook is reserved); TLS (reverse-proxy territory); daemon reindex RPC
  (Q7); job history/persistence (Q8); CORS/cross-origin access (Q11);
  cursor pagination (Q12); URL versioning (Q9).
```

### Specify Results

<!-- Fill in after running the command -->

| Metric | Value |
|--------|-------|
| Functional Requirements | |
| User Stories | |
| Acceptance Criteria | |

### Files Generated

- [ ] `specs/005-local-http-server/spec.md`

### SpecKit Traceability Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Developer queries the graph over REST` |
| `[FR-001]` | Functional requirement | `[FR-001] /api/search returns paginated results` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `IPv6 loopback handling [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Can run alongside other tasks` |
| `[Gap]` | Missing coverage | `[Gap] No task covers SSE client disconnect` |

---

## Phase 2: Clarify (Optional but Recommended)

**When to run:** The grill-me interview resolved the major branches; these sessions dig into the edge cases the interview deliberately left to specification. Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: API Contract Edge Cases

```text
/speckit-clarify Focus on the REST contract's edge semantics: exact status codes
per endpoint (404 unknown node id vs 404 unknown repo id vs 400 malformed
params), node-id format in URLs (DB ids are opaque — encoding/escaping rules),
search ?mode values and their mapping to the existing hybrid search modes
(SPEC-003), /api/status payload fields (version, repo list, index state,
embeddings/LSP availability), and what /api/nodes/:id includes inline vs behind
callers/callees paging. The error envelope is fixed at
{error: {code, message, details?}} (design concept Q9) — enumerate the code
vocabulary.
```

#### Session 2: Jobs & SSE Lifecycle

```text
/speckit-clarify Focus on the job subsystem's failure and lifecycle semantics:
what happens when the file lock is held by another indexer (CLI or daemon
watcher) when a job starts — queue, fail, or 409/423; job id format and the
job-state machine (queued/running/done/error + progress phases from
IndexProgress); SSE framing (event names, JSON payload shape, snapshot event on
subscribe, terminal event closes stream — design concept Q8); behavior when the
SSE client disconnects mid-job (job continues); and whether POST /api/reindex on
an un-indexed repo initializes or refuses (indexing is the user's call — check
against the roadmap's dormancy posture).
```

#### Session 3: Bind, Auth & Process Lifecycle

```text
/speckit-clarify Focus on serve lifecycle and security posture: --host parsing
and what counts as loopback (127.0.0.0/8, ::1, localhost); constant-time token
comparison; whether the token also guards the SSE endpoint and static mount or
only /api/*; port-in-use behavior and --port 0 (ephemeral) support; graceful
shutdown (SIGINT closes SSE streams, in-flight job handling); and interaction
with the daemon lifecycle — serve keeps the daemon alive (client liveness) but
must not leak daemons on exit (design concept Q1).
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | API contract edges | | |
| 2 | Jobs & SSE lifecycle | | |
| 3 | Bind/auth/lifecycle | | |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Output: `specs/005-local-http-server/plan.md`

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Language: TypeScript (strict), compiled by tsc to dist/ (npm run build)
- Runtime: Node >=22.5 from source (node:sqlite gate); npm engines >=20 <25
- HTTP: node:http ONLY — zero new runtime dependencies (design concept Q4).
  Hand-rolled method+path router (~7 routes, one :param pattern), hand-rolled
  SSE, minimal static mount. sirv is the researched escape hatch — do NOT add
  it in SPEC-005.
- Graph access: daemon client via the existing MCP proxy/attach machinery in
  src/mcp/ (attach-or-spawn per-project daemon over unix socket / named pipe) —
  the serve process holds NO CodeGraph query instance of its own (Q1)
- Indexing: library entrypoints CodeGraph.sync()/indexAll() called in the serve
  process for jobs, guarded by the existing cross-process file lock (Q7)
- Testing: vitest, real files + real SQLite over a fixture index (repo test
  convention: fs.mkdtempSync temp dirs, cleanup in afterEach, no DB mocking)

## Constraints
- 2 vertical slices / 2 PRs (recorded split decision — see workflow header):
  Slice 1 read API end-to-end; Slice 2 job subsystem. Plan the module layout so
  slice 2 layers onto slice 1 without reworking it (jobs.ts + SSE isolated).
- Key files (roadmap): src/server/index.ts (bootstrap + serve --web wiring),
  src/server/routes.ts, src/server/jobs.ts, src/server/auth.ts,
  src/server/openapi.yaml; src/bin/codegraph.ts modified minimally (this is an
  upstream-owned file — tracking-fork discipline, smallest possible diff).
- openapi.yaml must ship: extend the build's copy-assets step to copy it into
  dist/ (CLAUDE.md: any new non-TS asset must be copied or it won't ship).
- Static mount + placeholder + strict fallback rules per SPEC-004 handoff
  (binding): /api/* and asset-extension 404s never fall back to the app shell.
- WebSocket upgrade hook reserved for SPEC-009: expose the server's 'upgrade'
  attach point; implement nothing.
- Auth fail-closed (Q5); paging caps (Q12); error envelope + no /v1 (Q9);
  in-memory latest-job-per-repo (Q8); multi-repo lazy attach via the daemon
  registry (Q2).
- Dormancy (constitution VII): bare `codegraph serve` and `serve --mcp` behavior
  must be byte-identical to today; --web is the only activation path.

## Architecture Notes
- Re-read docs/ai/specs/.process/SPEC-005-design-concept.md (the Q&A log) for
  the WHY behind every decision above; quote Q-numbers in plan rationale.
- SPEC-004 handoff constraints live in docs/design/web-framework-decision.md
  ("Shipping Strategy" + "Deferred Concerns" sections).
- Constitution check: Principle II — zero-dep is load-bearing; any new
  dependency requires a Complexity Tracking row and is presumed wrong.
- The daemon registry (src/mcp/daemon-registry.ts) is the /api/repos source of
  truth; the MCP proxy (src/mcp/proxy.ts) is the reference for attach-or-spawn.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ⏳ | Technical context, execution flow |
| `research.md` | ⏳ | Decision rationales (if needed) |
| `data-model.md` | ⏳ | Entities and types |
| `contracts/` | ⏳ | API specifications |
| `quickstart.md` | ⏳ | Developer onboarding |

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates both spec AND plan together.

### Step 1: Analyze Spec for Recommended Domains

Domains selected from the spec's signals and the grill-me branches walked
(REST endpoints → api-contracts; token auth + bind policy → security; SSE →
streaming-protocol; error envelope + fail-closed startup → error-handling):

### Step 2: Run Enriched Checklist Prompts

#### 1. api-contracts Checklist

Why this domain: seven REST endpoints + a committed OpenAPI contract that SPEC-006/009 build against; drift is the top product risk (design concept Q10).

```text
/speckit-checklist api-contracts

Focus on Local HTTP Server & REST API requirements:
- Every endpoint's params, status codes, and response shape appear in BOTH the
  spec's FRs and openapi.yaml; the contract test walks every documented
  path/method/status (Q10)
- Paging contract: ?limit&offset defaults/caps and the total field on every list
  endpoint; /api/graph depth/limit caps + truncated flag (Q12)
- Error envelope {error: {code, message, details?}} on every non-2xx, including
  auth failures and 404 fallback rules (Q9, Q11)
- Pay special attention to: node-id encoding in URL paths and the /api/repos
  repo-id contract (lazy multi-repo addressing, Q2)
```

#### 2. security Checklist

Why this domain: the server exposes a code index over HTTP; bind/auth posture is fail-closed by decision (Q5) and must stay that way through implementation.

```text
/speckit-checklist security

Focus on Local HTTP Server & REST API requirements:
- Non-loopback bind refuses startup without CODEGRAPH_SERVER_TOKEN; token
  required as Bearer on /api/* when set; constant-time comparison (Q5)
- Loopback determination correctness (127.0.0.0/8, ::1, localhost resolution)
- No CORS headers — same-origin only (Q11); no directory traversal through the
  static mount; request logging stays local and never logs the token
- Pay special attention to: the SSE endpoint and static mount auth posture
  (clarify session 3 outcome) and that the placeholder page leaks no repo data
  to unauthenticated non-loopback clients
```

#### 3. streaming-protocol Checklist

Why this domain: SSE progress streaming is slice 2's core and the roadmap names it explicitly; lifecycle edges (snapshot, terminal event, disconnect) were decided in Q8 but need requirement-level coverage.

```text
/speckit-checklist streaming-protocol

Focus on Local HTTP Server & REST API requirements:
- SSE framing: content-type, event names, JSON payloads, snapshot-on-subscribe,
  terminal done/error event closes the stream (Q8)
- Reconnect semantics: no Last-Event-ID replay — a reconnect re-snapshots; job
  continues when the client disconnects (Q8)
- Backpressure/keep-alive: heartbeat or comment frames so proxies and the
  browser don't time out a quiet long job
- Pay special attention to: progress mapping from IndexProgress phases
  (scanning/parsing/resolving/embedding) to SSE events without buffering the
  whole stream in memory
```

#### 4. error-handling Checklist

Why this domain: fail-closed startup, 409 duplicate jobs, daemon-attach failures, and lock contention are the spec's riskiest runtime paths; the envelope is a single fixed shape (Q9).

```text
/speckit-checklist error-handling

Focus on Local HTTP Server & REST API requirements:
- Startup failures exit non-zero with actionable messages: port in use,
  non-loopback without token, un-indexed startup repo
- Runtime degradation: daemon attach/spawn failure per request; file lock held
  by another indexer when a job starts (clarify session 2 outcome); 409 on
  duplicate active job (roadmap)
- Every error path emits the envelope — no bare strings, no stack traces in
  responses; codes enumerated in openapi.yaml
- Pay special attention to: the strict 404 fallback rules (Q11 — /api/* and
  asset-extension requests must NEVER receive the app shell)
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| api-contracts | | | |
| security | | | |
| streaming-protocol | | | |
| error-handling | | | |
| **Total** | | | |

### Addressing Gaps

When checklist identifies `[Gap]` items:

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/005-local-http-server/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, testable chunks (1-2 hours each); TDD-shaped: each task names the
  failing test written first
- Clear acceptance criteria referencing FR-xxx
- Dependency ordering: foundation → slice 1 (read API) → slice 2 (jobs/SSE) →
  polish; mark parallel-safe tasks [P]
- Organize by user story WITHIN the two recorded slices — the slice boundary is
  a hard partition (2 PRs): US1/US2/US4 tasks belong to slice 1, US3 tasks to
  slice 2. Flag any task that would straddle the boundary.

## Implementation Phases
1. Foundation (src/server/ module skeleton, serve --web flag wiring, fixture
   index test harness)
2. Slice 1 — read API end-to-end (router, auth, GET endpoints, envelope,
   paging, static mount + placeholder + strict fallback, openapi.yaml +
   contract test)
3. Slice 2 — job subsystem (job manager, POST /api/reindex, SSE stream, 409,
   openapi/contract-test extension)
4. Polish & cross-cutting (request logging, graceful shutdown, docs, CHANGELOG)

## Constraints
- Tests in __tests__/ mirroring src/server/ (repo convention: real files, real
  SQLite, fs.mkdtempSync + afterEach cleanup, no mocking)
- The design concept's Non-goals bound generation: NO tasks for daemon reindex
  RPC, job history, CORS, cursor paging, /v1 prefix, sirv/router deps, TLS, or
  WebSocket implementation (hook reservation only)
- src/bin/codegraph.ts diff stays minimal (upstream-owned file)
- copy-assets must gain openapi.yaml (ship check)
- Every spec's UAT includes a self-repo step (constitution Dogfooding): final
  task validates `codegraph serve --web` against THIS repo's own index
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | |
| **Phases** | |
| **Parallel Opportunities** | |
| **User Stories Covered** | |

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot SKILL runs
the read-only atomicity classifier and records its decision here. This is a
**placeholder** until then — leave the cells blank during scoping. The classifier
emits one machine-readable decision; the SKILL is what writes it into this section
(the script never writes a file of its own). This route is recorded only here in the
workflow file — never in the spec map. It is read downstream by the layer-planner and
multi-PR emission work that builds on top of it; recording it now wires no PR creation
or branch splitting on its own.

The recorded scaffold-time split decision (2 slices / 2 PRs) is the expected
outcome; if the classifier disagrees, surface the conflict at G5 rather than
silently following either.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | | `true`, or `false` for a destructive-migration or concurrency-sensitive change. |
| **Signals** | | The decisive detector findings behind the route and releasability reading. |
| **Warnings** | | Any release-safety warning attached to the change. |

To produce the decision, run the classifier against the feature directory:

```text
runner helper atomicity-route specs/005-local-http-server
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks to catch issues.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment — Principle II (zero new deps anywhere in plan/tasks),
   Principle VII (dormancy: no default-on behavior), tracking-fork discipline on
   src/bin/codegraph.ts
2. Coverage gaps — every FR and user story has tasks; the 2-slice partition is
   clean (no task straddles the slice boundary)
3. Design-concept drift — compare spec.md/plan.md/tasks.md against
   docs/ai/specs/.process/SPEC-005-design-concept.md: the Q&A log is the source
   of truth for scoping decisions (Q1 daemon-client, Q2 lazy multi-repo, Q4
   zero-dep, Q5 fail-closed auth, Q7 job locus, Q8 job lifetime, Q9 no /v1,
   Q11 strict fallback, Q12 caps, Q13 split). A downstream artifact that
   contradicts it is wrong unless it carries an explicit revision note.
4. SPEC-004 handoff compliance — fallback rules, dormant-by-default serving,
   static mount expectations (docs/design/web-framework-decision.md)
5. Consistency between task file paths and the actual project structure
```

### Analyze Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| `CRITICAL` | Blocks implementation, violates constitution | **Must fix before G6 gate** |
| `HIGH` | Significant gap, impacts quality | Should fix |
| `MEDIUM` | Improvement opportunity | Review and decide |
| `LOW` | Minor inconsistency | Note for future |

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| | | | |

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```text
/speckit-implement

## Approach: TDD-First

For each task, follow this cycle:

1. **RED**: Write failing test defining expected behavior
2. **GREEN**: Implement minimum code to make test pass
3. **REFACTOR**: Clean up while tests still pass
4. **VERIFY**: Manual verification of acceptance criteria

### Pre-Implementation Setup

Before starting any task:
1. `npm install && npm run build` in the worktree (already bootstrapped at
   scaffold; re-run build after pulling)
2. `npm test` must be green before changes
3. `git rev-parse --abbrev-ref HEAD` → must be 005-local-http-server

### Implementation Notes
- Consult docs/ai/specs/.process/SPEC-005-design-concept.md for the WHY behind
  decisions when writing tests and handling edges; decisions captured there but
  missing from tasks.md are gaps — surface them before coding, don't drop them
- Zero-dep discipline: if you find yourself wanting a router/static/SSE package,
  stop — the design concept Q4 research settled this; sirv is a documented
  future escape hatch, not a SPEC-005 option
- Tests: real fixture index (fs.mkdtempSync + codegraph init/index over a tiny
  fixture project), real HTTP requests against an ephemeral port; no mocking
- Retrieval policy: use codegraph_explore for pre-edit surveys of src/mcp/
  (proxy, daemon-registry, daemon-manager) before wiring the daemon client
- Slice boundary is a PR boundary: complete + verify slice 1 (with contract
  test green) before starting slice 2 tasks
- CHANGELOG: add one user-facing bullet under [Unreleased] ### New Features
  (plain language, no internal paths/symbols)
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Foundation | | | |
| 2 - Slice 1: Read API | | | |
| 3 - Slice 2: Jobs/SSE | | | |
| 4 - Polish | | | |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Build succeeds: `npm run build` (openapi.yaml lands in dist/ via copy-assets)
- [ ] Tests pass: `npm test` (including the openapi contract test)
- [ ] Zero-dep check: `package.json` dependencies unchanged
- [ ] Dormancy check: `serve --mcp` behavior unchanged; no HTTP port without `--web`
- [ ] Self-repo UAT (Dogfooding Protocol): `node dist/bin/codegraph.js serve --web`
      against this repo's own index; verify `/api/status`, a search, a node
      detail, a graph neighborhood, and a sync job with SSE progress
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] PRs created (2, per recorded split) and reviewed — no session URLs in PR
      bodies or commits; PRs target origin (racecraft-lab), never upstream
- [ ] Merged to main; then `npm run build` + `codegraph sync` (protocol step 1)

---

## Lessons Learned

### What Worked Well

-

### Challenges Encountered

-

### Patterns to Reuse

-

---

## Project Structure Reference

```
codegraph/
├── src/
│   ├── bin/codegraph.ts       # CLI (commander) — serve --web wiring (minimal diff)
│   ├── server/                # NEW: this spec — index.ts, routes.ts, jobs.ts,
│   │                          #   auth.ts, openapi.yaml
│   ├── mcp/                   # daemon, daemon-registry, proxy (the attach path
│   │                          #   the server rides) — read, don't modify
│   ├── index.ts               # CodeGraph class — sync()/indexAll() job entrypoints
│   └── db/, graph/, search/   # query layers reached via the daemon
├── __tests__/                 # vitest; server tests mirror src/server/
├── docs/ai/specs/.process/    # this workflow + design concept
└── specs/005-local-http-server/  # spec.md, plan.md, tasks.md, SPEC-MOC.md
```

---

Template based on SpecKit best practices, populated from the SPEC-005 roadmap
entry and the grill-me design concept (2026-07-10).
