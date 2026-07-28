# SpecKit Workflow: SPEC-007 - In-Browser Indexing

**Template Version**: 1.0.0
**Created**: 2026-07-27
**Purpose**: Execute SPEC-007 from specification through implementation on
branch `007-in-browser-indexing`.

---

## Design Concept

This workflow was populated from the shared SpecKit Pro workflow template and
enriched by the required Grill Me interview run during
`$speckit-pro:speckit-scaffold-spec SPEC-007`.

The complete goals, non-goals, decision rationale, alternatives, current
documentation grounding, and reviewability estimate live at:

```text
docs/ai/specs/.process/SPEC-007-design-concept.md
```

Re-read that file before every phase. It is the source of truth for the
human-validated scoping decisions recorded during scaffold. Grill Me is not part
of the autopilot loop; downstream clarification uses `/speckit-clarify`.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|---|---|---|---|
| Specify | `/speckit-specify` | ✅ Complete | 7 user stories, 30 FRs, 23 acceptance scenarios; G1 passed with zero markers. |
| Clarify | `/speckit-clarify` | ✅ Complete | Four sessions applied; 49 unique FRs, zero markers; G2 passed. |
| Plan | `/speckit-plan` | ✅ Complete | Seven artifacts complete; G3 passed; estimator projected 600 LOC across 15 production files. |
| Checklist | `/speckit-checklist` | ✅ Complete | Four domains, 129/129 rows checked, 18 initial gaps resolved; G4 passed. |
| Tasks | `/speckit-tasks` | 🔄 In Progress | Generate TDD tasks ordered by the three vertical slices. |
| Analyze | `/speckit-analyze` | ⏳ Pending | Check cross-artifact scope, privacy, parity, and reviewability. |
| Implement | `/speckit-implement` | ⏳ Pending | Implement only after G1-G6 are clean. |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates

| Gate | Checkpoint | Approval Criteria |
|---|---|---|
| G1 | After Specify | All seven user stories are independently testable; no `[NEEDS CLARIFICATION]` marker remains. |
| G2 | After Clarify | SQLite package/VFS, browser schema/source cache, worker RPC, asset/CSP, and benchmark conditions are explicit. |
| G3 | After Plan | Constitution checks pass; three slices are vertical and reviewable; dependency and migration risks are owned. |
| G4 | After Checklist | Every `[Gap]` marker from all four required domains is resolved or explicitly scoped out. |
| G5 | After Tasks | Every FR and user story maps to dependency-ordered red-green-refactor tasks and UAT. |
| G6 | After Analyze | No CRITICAL issue remains; HIGH findings are fixed or ratified with evidence. |
| G7 | After Each Slice | Focused tests, root/web gates, real browser UAT, package checks, and Git cleanliness pass. |

### Canonical Post Gates

Autopilot must keep these post steps visible in durable state and complete or
explicitly skip each before final handoff:

- Post: Doctor Extension Check
- Post: Verify Implementation
- Post: Verify Tasks Phantom Check
- Post: Code Review
- Post: Integration Suite
- Post: Reviewability Diff Gate
- Post: Self-Review
- Post: UAT Runbook Generation
- Post: Final Reviewability Backstop
- Post: PR Packet/Body Generation
- Post: PR Body Generation
- Post: PR Creation
- Post: Review Remediation
- Post: Retrospective

---

## Prerequisites

### Worktree

Run this workflow only from:

```text
/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/007-in-browser-indexing
```

Required branch:

```text
007-in-browser-indexing
```

Do not run from the main checkout or the detached Codex app worktree. If a phase
reports that the workflow file is not in the current checkout, stop and reopen
the task at the absolute worktree path above.

### Bootstrap Evidence

The roadmap's binding Dogfooding Protocol rung 6 was completed during scaffold
with the runtime pinned by `.nvmrc`:

```text
node --version
npm ci
npm run build
source the main checkout's untracked .envrc.local in a subshell
node dist/bin/codegraph.js init .
node dist/bin/codegraph.js status . --json
git status --porcelain
```

Result on 2026-07-27:

- Node `v24.11.1`
- Dependency install: passed
- Root/web/package build: passed
- Self-index: 901 files, 16,127 nodes, 68,846 edges
- Embeddings: 10,395/10,395 (100%) through the operator-configured local endpoint
- Hybrid search: available
- LSP precision: enabled
- Index state: current, no pending refs or pending changes
- Git worktree: clean

The configured endpoint used during bootstrap is operator-local state and must
never be copied into committed artifacts. Bootstrap emitted a plaintext-HTTP
transport warning; browser implementation must follow the stricter secure-context
policy selected in the design concept.

### Preset Evidence

Template resolution from this worktree passed:

- `spec-template`:
  `.specify/presets/speckit-pro-reviewability/templates/spec-template.md`
- `plan-template`:
  `.specify/presets/speckit-pro-reviewability/templates/plan-template.md`
- `tasks-template`:
  `.specify/presets/codegraph-project-overrides/templates/tasks-template.md`

### Constitution Validation

Apply `.specify/memory/constitution.md` throughout:

| Principle | SPEC-007 requirement | Verification |
|---|---|---|
| I. Think Before Coding | Resolve SQLite asset/VFS, source persistence, browser permissions, and worker contracts before implementation. | `research.md`, `data-model.md`, contracts, G2/G3 |
| II. Simplicity First | One SPA, one typed repository-client boundary, one shared extraction kernel, and no speculative watcher/archive path. | Plan complexity table and diff review |
| III. Surgical Changes | Add browser modules under `web/src/local-indexing/`; refactor `src/extraction/` only as needed for injected pure-runtime seams. | `git diff --stat`, reviewability gates |
| IV. Goal-Driven Execution | Every slice starts with failing tests and ends with measured browser/self-repo evidence. | Vitest, Playwright, package tests, UAT |
| V. Deterministic Extraction | Browser and Node adapters produce stable graph semantics from the same accepted inputs; per-file failures are bounded and visible. | Cross-runtime golden fixtures and repeated-index counts |
| VI. Retrieval Performance | Local search/impact results remain correct and meet the selected p95 target without weakening existing retrieval. | Browser query benchmarks and existing retrieval gates where affected |
| VII. Local-First, Private, Zero Native Dependencies | No network by default; only explicit embedding egress; pure JS/WASM dependencies; OPFS data and secrets obey the selected lifecycle. | Network audit, dependency/license review, storage/credential tests |

**Constitution Check:** scaffold pre-check passed; `/speckit-plan` must run and
record both required plan-phase checks before G3.

### Autopilot Preflight Evidence

Recorded on 2026-07-28 from the bound `007-in-browser-indexing` worktree:

- Archive Sweep: installed archive extension contract executed in dry-run mode;
  `specs/007-in-browser-indexing` was the only active spec and was excluded as
  the current target, so no prior spec required archival or cleanup.
- Runner integrity and prerequisites: passed. The runner resolves linked
  worktrees through the repository control checkout, so the absolute workflow
  path was supplied; direct Git checks independently confirmed the execution
  root, branch, clean status, HEAD, and upstream.
- Runtime: Node `v24.11.1`, npm `11.6.2`, Python `3.11.0`.
- Build: passed.
- Typecheck: passed.
- Test baseline: 260 files passed, 4,663 tests passed, 181 skipped.
- Lint and separate integration commands: not defined by the project command
  detector; integration coverage is included in the Vitest suite.
- Reviewability setup gate: passed. The governing scaffold estimate remains
  `estimated_loc=1055`, `suggested_slices=3`, `status=warn`.
- Settings: defaults (`consensus=moderate`, `gate_failure=stop`,
  `auto_commit=per-phase`, confidence gate `advisory`, token discipline off).
- Required Codex agent bundle: current at the user destination; dry-run install
  reported no changes and no restart requirement.
- Capability path: repository files, Git, and the healthy worktree-local
  CodeGraph index for codebase evidence; local workflow/design/roadmap/
  constitution artifacts for spec evidence; Context7 for library documentation;
  installed web research for current external standards. Native
  `codegraph_explore` is not exposed in this task, so structural work uses the
  indexed CLI plus repository-local fallback evidence.

---

## Specification Context

| Field | Value |
|---|---|
| Spec ID | SPEC-007 |
| Name | In-Browser Indexing |
| Branch | `007-in-browser-indexing` |
| Dependencies | SPEC-006 (complete in PR #153); SPEC-001 and SPEC-003 behavior reused for optional embeddings/search |
| Enables | Zero-install local-folder demo and evaluation path |
| Priority | P1 |
| Roadmap | `docs/ai/specs/intelligence-platform-technical-roadmap.md` |

### Roadmap Scope

Open a local folder from the existing web app, index it entirely in the browser
with the shipped tree-sitter WASM grammars, persist its SQLite-Wasm graph in
OPFS, and provide the existing browse/search/impact experience. Keyword search
always works; semantic search is optional through an explicitly configured
browser-accessible endpoint. Capability gaps must degrade clearly.

### Human-Validated Product Decisions

- One SPA with server and browser-local repository runtimes.
- Explicit "Open local folder" workspace action; no automatic permission prompt.
- The same build works from the CLI or a trusted HTTPS static host.
- Chromium gets the full picker/reconnect path; drag-drop snapshots provide the
  fallback where directory-entry APIs work; other gaps are explained precisely.
- Accepted source files and graph data persist in origin-private storage and are
  deleted together only by explicit user command.
- All shipped WASM grammars load lazily according to detected files.
- A shared pure extraction kernel is the only cross-runtime semantic source.
- SQLite uses official `opfs-sahpool` in a worker, with one active tab per repo.
- The UI uses a typed repository-client interface with REST and worker-RPC
  implementations.
- Core local parity is overview, keyword/optional semantic search,
  symbol/source, relationships, graph, impact, refresh, reconnect, and delete.
- Refresh is manual and incremental; successful transactions replace the last
  good state, and bounded file errors remain visible.
- Embeddings run after the keyword index, require explicit consent, keep bearer
  keys in memory only, and obey secure-context/mixed-content rules.
- Input selection matches the Node non-git walker contract.
- Storage is estimated, persistence is requested after a user action, and the
  app never evicts indexes automatically.

### Success Criteria Summary

- [ ] A deliberate folder-picker action creates a browser-local repository on
  current Chromium with no server dependency.
- [ ] A supported directory drop creates a clearly labeled snapshot repository;
  unsupported browsers receive capability-specific guidance.
- [ ] Parsing and SQLite writes run off the UI thread using lazily loaded shipped
  grammar assets and official SQLite-Wasm OPFS persistence.
- [ ] Browser and Node extraction agree on deterministic fixture graph semantics
  for the shared kernel.
- [ ] The local repository survives reload, can reconnect to its saved handle,
  retains accepted source for source views, and can be deleted without touching
  the original folder.
- [ ] Local overview, search, symbol/source, relationships, graph, and impact use
  the existing result types and visibly disable server-only features.
- [ ] Manual incremental refresh applies adds/changes/deletes transactionally and
  keeps the last good index on cancel or fatal failure.
- [ ] No repository-derived network request occurs by default.
- [ ] Optional semantic indexing starts only after explicit consent, stores no
  bearer key, is resumable/advisory, and never disables keyword search.
- [ ] A per-repository Web Lock prevents concurrent SAH-pool database access and
  gives other tabs a clear busy/retry state.
- [ ] Quota, persistence, permission, parse, CORS, TLS, and capability failures
  are actionable and never silently corrupt or discard an index.
- [ ] On current desktop Chromium, this repository indexes in at most 60 seconds
  without embeddings, the UI stays responsive, and local keyword/search/impact
  reads meet p95 at or below 150 ms.
- [ ] The packaged and static-host builds include every required worker/WASM
  asset, make no CDN request, and pass self-repo dogfood UAT.

### Reviewability Budget

Roadmap estimate:

```text
projected_reviewable_loc=580
production_files≈7
total_files≈14
suggested_slices=2
status=within_greenfield_allowance
```

Post-interview required estimator:

```text
user_stories=7
projected_production_files=13
functional_requirements=24
new_vs_modify=new
estimated_loc=1055
suggested_slices=3
status=warn
```

Decision: use three vertical slices. The warning is accepted only while scope
stays inside this workflow. If the plan crosses the greenfield block threshold
or requires a fourth capability class, split before implementation rather than
ratifying an oversized change.

---

## Phase 1: Specify

**When to run:** Start of feature specification. Focus on WHAT and WHY.

### Specify Prompt

```text
/speckit-specify

## Feature: In-Browser Indexing

### Problem Statement
CodeGraph's shipped SPA can browse repositories only through a running local
server. Evaluation users need to select a local source folder and receive the
same core graph experience without installing or running CodeGraph, while
preserving the project's deterministic, local-first, private behavior.

### Users
- A developer evaluating CodeGraph against a local repository with no CLI setup.
- A maintainer who wants an origin-private, persistent browser graph and manual
  refresh.
- A developer on an unsupported browser who needs an honest fallback or precise
  capability guidance.
- A privacy-conscious operator who may optionally opt into a self-chosen
  embedding endpoint without persisting credentials.

### User Stories
1. As an evaluator, I can deliberately open a folder in current Chromium and see
   progress until a persistent keyword-searchable local repository is ready.
2. As a developer, I can browse local overview, search, symbol/source,
   relationships, and graph views through the same SPA used for server repos.
3. As a maintainer, I can inspect a local symbol's bounded impact and affected
   files using the browser graph.
4. As a returning user, I can reopen a persisted local repository, explicitly
   reconnect its saved folder handle, refresh it incrementally, and delete its
   browser-owned data without changing source files.
5. As a user on another browser or tab, I get a supported drag-drop snapshot or
   a precise capability/busy/quota/permission message instead of an opaque error.
6. As an opted-in user, I can configure a secure embedding endpoint after the
   keyword index is usable and receive semantic search without storing the key or
   breaking keyword fallback.
7. As a maintainer, I can verify the same build and assets from CLI and HTTPS
   static hosting, with deterministic extraction and measured self-repo
   performance.

### Constraints
- Treat `docs/ai/specs/.process/SPEC-007-design-concept.md` as the scoping source
  of truth and preserve all twenty-two selected decisions.
- Use one SPA with a typed repository-client boundary; do not fork routes into a
  separate browser product.
- Use an explicit user-activated picker or supported directory drop; never prompt
  automatically.
- Run parsing/database work in a Web Worker.
- Reuse all shipped web-tree-sitter grammars lazily through a shared deterministic
  extraction kernel.
- Use official SQLite-Wasm with an OPFS SAH-pool VFS unless plan research proves
  that this selected design is no longer viable.
- Persist accepted source plus derived graph data in origin-private storage;
  never write the selected source folder.
- Match the Node non-git input-selection contract.
- Publish index changes transactionally and preserve the last good index.
- No network calls by default. Embedding egress is explicit, secure-context
  constrained, post-keyword, resumable, and credential-memory-only.
- Preserve package/offline constraints and add every new WASM/static asset to the
  root copy-assets path.
- Meet the selected 60-second self-repo and 150 ms p95 read targets.

### Out of Scope
- Separate browser app, ZIP/archive ingestion, or automatic filesystem prompts.
- Browser-side LSP, dataflow, flows/clusters, chat, daemon jobs, or daemon sync.
- Experimental filesystem watching, polling auto-refresh, or multi-tab database
  concurrency.
- Persisted embedding credentials, insecure LAN transport overrides, automatic
  index eviction, or writes to the user's source folder.
- Full picker/reconnect parity on Firefox and Safari.
```

### Specify Results

Populate after `/speckit-specify`:

| Metric | Expected baseline |
|---|---|
| Functional Requirements | 30, mapped to AC-7.1 through AC-7.4 and the design decisions |
| User Stories | 7 |
| Acceptance Scenarios | 23 |
| Acceptance Criteria | AC-7.1, AC-7.2, AC-7.3, AC-7.4 plus measurable privacy/performance/package criteria |
| G1 | Passed: zero `[NEEDS CLARIFICATION]` markers |
| Requirements Checklist | 16/16 complete; zero `[Gap]` markers |

Executor: `phase-executor`. Unresolved for consensus: none.

### Files Generated

- [x] `specs/007-in-browser-indexing/spec.md`
- [x] `specs/007-in-browser-indexing/checklists/requirements.md`
- [x] `.specify/feature.json`

---

## Phase 2: Clarify

**When to run:** After Specify. Ask at most five targeted questions per session
and do not reopen decisions already settled in the design concept without new
evidence.

### Clarify Prompts

#### Session 1: Browser Capability and UX Contracts

```text
/speckit-clarify Focus on local-workspace UX: explicit mode switching, picker
activation, saved-handle reconnect, drag-drop snapshot identity, capability
diagnostics, local/server labels, busy-tab behavior, destructive delete
confirmation, and disabled server-only routes. Treat Q1-Q7, Q11, Q18, Q20, and
Q21 in the design concept as already decided.
```

#### Session 2: Storage, Integrity, and Runtime Contracts

```text
/speckit-clarify Focus on the remaining planning contracts: exact browser
repository identity, source-cache retention, canonical schema reuse, migration
versioning, transaction boundaries, bounded per-file errors, cancellation,
incremental add/change/delete semantics, worker RPC errors, and last-good-index
recovery. Preserve the SAH-pool single-owner decision.
```

#### Session 3: Embedding, Security, and Delivery

```text
/speckit-clarify Focus on explicit embedding consent, persisted non-secret
settings, memory-only keys, TLS/mixed-content/CORS messages, resumable vector
state, no-network default audits, CSP/WASM requirements, static-host asset paths,
and package-copy failure behavior. Do not add a server proxy or insecure override.
```

#### Session 4: Performance and Cross-Runtime Parity

```text
/speckit-clarify Focus on deterministic Node/browser fixture parity, benchmark
hardware disclosure, the 60-second self-repo index target, 150 ms p95 local read
target, UI responsiveness measurement, grammar lazy-loading evidence, and the
minimum Firefox/Safari graceful-degradation matrix.
```

### Clarify Results

Populate after the sessions:

| Session | Focus Area | Required outcome |
|---|---|---|
| 1 | Capability and UX | ✅ Complete: shell entry, runtime labels, cached pre-reconnect browsing, snapshot identity, busy interstitial, disabled-route explanations, and destructive delete contract |
| 2 | Storage and runtime | ✅ Complete: opaque identity, generation publication, shared schema/migrations, manifest refresh, bounded errors, cancellation, and versioned worker RPC |
| 3 | Embedding and delivery | ✅ Complete: persisted secret-free profile, memory-only credentials, redacted failures, no-consent audit, CSP/WASM hosting, and fail-closed package assets |
| 4 | Performance and parity | ✅ Complete: semantic fixture projection, disclosed self-repo benchmark, 20-sample user-observed p95 reads, responsiveness evidence, and Chromium/Firefox/WebKit matrix |

Session 1 executor: `clarify-executor`. Five parent-owned recommended answers
were applied as FR-031 through FR-036 and recorded in `spec.md` Clarifications.
Unresolved for consensus: none; consensus companion completed without analyst
dispatch.

Session 2 executor: `clarify-executor`. Five parent-owned recommended answers
were applied as FR-037 through FR-041 and recorded in `spec.md` Clarifications.
Unresolved for consensus: none; consensus companion completed without analyst
dispatch.

Session 3 executor: `clarify-executor`. Five parent-owned recommended answers
were applied as FR-042 through FR-046 and recorded in `spec.md` Clarifications.
The credential-persistence item followed the mandatory security route. All
three analysts agreed, and the existing human-ratified Q14/Q15 decision selected
the same memory-only credential boundary, satisfying the human-review
requirement without reopening the settled product choice.

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|---|---|---|---|---|---|---|
| 1 | Clarify | Which semantic settings may persist while bearer keys stay memory-only? | [security] | 1 | [HUMAN REVIEW] satisfied by prior ratification | Persist only a secret-free repository profile, vectors, and resumable metadata; require credential re-entry for endpoint traffic after reload. Q14/Q15 already record the user's explicit choice. | codebase-analyst, spec-context-analyst, domain-researcher |

Session 4 executor: `clarify-executor`. Five parent-owned recommended answers
were applied as FR-047 through FR-049 plus SC-008/SC-009 refinements and
recorded in `spec.md` Clarifications. Unresolved for consensus: none; consensus
companion completed without analyst dispatch. G2 passed with zero
`[NEEDS CLARIFICATION]` or `HUMAN REVIEW NEEDED` markers.

---

## Phase 3: Plan

**When to run:** After G1/G2. Output the technical implementation blueprint
under `specs/007-in-browser-indexing/`.

### Plan Prompt

```text
/speckit-plan

## Sources of Truth
- `.specify/memory/constitution.md`
- `docs/ai/specs/intelligence-platform-technical-roadmap.md`
- `docs/ai/specs/.process/SPEC-007-design-concept.md`
- `specs/007-in-browser-indexing/spec.md`
- Existing web types/clients under `web/src/lib/api/`
- Existing extraction, grammar, schema, query, and package-asset paths

## Tech Stack
- Language: TypeScript, preserving the repository's Node and web compiler
  boundaries.
- UI: existing React 19 SPA, React Router, Tailwind, shadcn/ui, and current
  context/state conventions.
- Browser execution: dedicated module Web Worker with typed request,
  progress, result, cancellation, and error messages.
- Parsing: existing `web-tree-sitter` 0.25.x runtime and shipped grammar WASM
  assets, detected and loaded lazily.
- Browser database: official SQLite-Wasm, `opfs-sahpool`, one active tab per
  local repository through Web Locks.
- Source acquisition: File System Access API picker; directory drag snapshot
  where entry APIs permit.
- Storage: OPFS for SQLite and accepted source; browser metadata/handle registry
  using the minimum durable browser store supported by current APIs.
- Testing: existing root Vitest, web Vitest, and Playwright; real WASM/SQLite/
  OPFS browser UAT rather than database mocks.

## Required Research
1. Select and pin the official SQLite-Wasm package/version with permissive
   licensing; document `opfs-sahpool`, worker initialization, file naming,
   transaction/recovery behavior, CSP, and asset-copy needs using
   https://sqlite.org/wasm/doc/trunk/.
2. Verify Vite worker and WASM delivery for `web-tree-sitter` using
   `Parser.init({ locateFile })` and `Language.load`, preserving the existing
   shipped grammar catalog and package build.
3. Inspect `src/db/schema.sql`, migrations, `QueryBuilder`, graph/impact reads,
   and symbol-source routes to define the smallest browser store/query adapter
   with no semantic schema fork.
4. Inspect `src/extraction/` to identify the minimum pure kernel seam. Do not
   pull Node filesystem, child-process, worker-thread, process-env, or
   `node:sqlite` code into the browser bundle.
5. Define folder-walk parity for built-in ignores, nested `.gitignore`,
   `codegraph.json`, extension overrides, UTF-8/binary checks, and the 1 MB cap.
6. Validate current picker, handle permission, directory-drop, OPFS,
   `StorageManager`, and Web Locks behavior against MDN and Playwright engines.
7. Reuse existing embedding input/hash/search semantics where they are
   runtime-neutral; define direct endpoint consent, CORS/TLS failures, vector
   schema, resume, and model/dimension convergence without persisting keys.
8. Define reproducible self-repo performance/UAT conditions and cross-runtime
   golden fixtures before implementation.

## Architecture Decisions to Preserve
- "One SPA, two runtimes": introduce one typed repository-client interface.
  Current REST/fetch behavior remains one implementation; worker RPC is the
  local implementation.
- "Shared pure extraction kernel": the same deterministic source-to-graph
  materialization logic serves Node and browser adapters.
- "SAH-pool, single active tab": no COOP/COEP requirement and no unsupported
  concurrent database opens.
- "Persist indexed source in OPFS": retain only accepted source and remove it
  with the derived index; never mutate source handles.
- "Manual incremental refresh" and "Keep last good index": detect hashes first,
  apply one successful transaction, roll back cancellation/fatal failure, and
  surface bounded file errors.
- "After keyword index": publish a complete keyword graph before optional
  endpoint work begins.
- "Node non-git parity": browser input scope must not invent a divergent ignore
  contract.

## Data and Contract Artifacts
- `data-model.md`: LocalRepository, SourceHandleRef, SnapshotImport,
  BrowserIndexMetadata, SourceCacheEntry, WorkerOperation, ProgressEvent,
  CapabilityReport, StorageReport, EmbeddingProfile, and error taxonomy.
- `contracts/local-repository-client.md`: methods and result types required by
  overview/search/symbol/source/relationships/graph/impact/refresh/delete.
- `contracts/local-index-worker.md`: init/index/refresh/query/embed/cancel/close
  requests, progress events, transfer rules, and error envelopes.
- `contracts/browser-capabilities.md`: picker/drop/OPFS/storage/locks/security
  capability matrix and exact user-visible degradation.
- `quickstart.md`: local development, HTTPS/localhost browser setup, full and
  snapshot imports, reload/reconnect, refresh, delete, semantic opt-in, offline
  audit, package build, and self-repo benchmark.

## Three Vertical Slices
1. Chromium open-folder through persistent keyword browse/search/source:
   typed data source, minimum pure extraction seam, worker, lazy grammars,
   SQLite-Wasm SAH-pool, source cache, progress/cancel, and first local UI flow.
2. Local graph/impact and lifecycle:
   relationships/graph/impact queries, reload/reconnect, manual incremental
   refresh, last-good transactions, delete, quota/persistence, and Web Lock busy
   state.
3. Degradation, semantic search, and shipping:
   directory-drop snapshot, capability matrix, explicit secure endpoint
   consent, resumable embeddings, Firefox/Safari messaging, package/static
   assets, offline/network audit, accessibility, performance, and self-repo UAT.

## Constraints
- Keep upstream-owned modifications minimal and justify every new abstraction.
- No separate SPA, service-worker REST emulation, Node-polyfill bundle, archive
  parser, watcher, daemon sync, LSP, catalogs, chat, or dataflow.
- No source/network egress before explicit semantic consent.
- No bearer key in OPFS, IndexedDB, local/session storage, URL, logs, errors, or
  committed fixtures.
- No automatic local-index eviction and no filesystem writes.
- Any new SQL, WASM, worker, or static asset must be included in root build/copy
  and package contract tests.
- Record any complexity exception in the plan's constitution table before G3.
```

### Plan Results

| Artifact | Status | Required content |
|---|---|---|
| `plan.md` | ✅ Complete | Two passing constitution checks, runtime architecture, machine-readable file map, three slices, complexity table |
| `research.md` | ✅ Complete | Nine decisions covering official docs, dependency/license, browser matrix, and alternatives |
| `data-model.md` | ✅ Complete | Browser repository, storage, worker, source, embedding, generation, and error entities |
| `contracts/` | ✅ Complete | Repository client, worker RPC, capability, degradation, and security contracts |
| `quickstart.md` | ✅ Complete | Deterministic local/package/static-host/UAT procedures |

Plan executor: `phase-executor`. It produced seven canonical artifacts covering
the then-current 49 functional requirements and three vertical slices. Both pre-research and
post-design constitution checks passed; Principle VI retains the accepted
complexity warning, with no fourth slice permitted without consensus.

G3 passed: `plan.md` exists with zero unresolved markers. The first
`estimate-reviewable-loc` call returned `not_estimated` because the file map was
not in the helper's machine-readable format. A bounded plan follow-up added
`## Declared File Operations`, after which the authoritative rerun returned
`status=pass`, `projected=600`, 15 production files, 8 new files, 8 modified
files, and 16 total declared entries (warn threshold 400; block threshold 800).
The earlier scaffold estimate remains advisory evidence: 1,055 LOC, three
suggested slices, `status=warn`. No unresolved item required consensus.

---

## Phase 4: Domain Checklists

Run all four after `/speckit-plan`. Every `[Gap]` must be fixed in `spec.md` or
`plan.md` and the affected checklist rerun before G4.

### UX Checklist

```text
/speckit-checklist ux

Focus on SPEC-007:
- Explicit local/server workspace switching without surprise permission prompts.
- Picker, drag snapshot, progress, cancel, success, partial-file warning,
  reconnect, stale, busy-tab, quota, unsupported, and delete-confirmation states.
- Reuse of overview/search/symbol/source/relationships/graph/impact routes with
  honest server-only disabled states.
- Keyboard, focus, screen-reader status announcements, mobile layout, and
  reduced-motion behavior during long worker operations.
- Pay special attention to preventing local and server repositories from looking
  interchangeable at trust-boundary moments.
```

### Security Checklist

```text
/speckit-checklist security

Focus on SPEC-007:
- No network request or source egress before explicit embedding consent.
- Memory-only bearer credentials and complete redaction from durable state,
  URLs, logs, errors, analytics, and tests.
- Secure-context, HTTPS, mixed-content, CORS, CSP, and untrusted static-host
  behavior.
- Path/handle traversal, dropped entry recursion, source size/binary validation,
  malicious repository content, and source-folder write prohibition.
- OPFS origin isolation, deletion boundaries, and no automatic eviction.
- Pay special attention to HTML/script content from source files never executing
  in the application origin.
```

### Data Integrity Checklist

```text
/speckit-checklist data-integrity

Focus on SPEC-007:
- Canonical schema/migration compatibility and deterministic Node/browser graph
  parity.
- Last-good transaction publication, cancel/worker-crash recovery, bounded file
  errors, and no falsely complete index.
- Incremental add/change/delete hashing, source-cache synchronization, vector
  model/dimension convergence, and resumable embedding state.
- Web Lock ownership, database close/release, stale metadata, quota failure, and
  explicit complete deletion.
- Pay special attention to crash boundaries between source cache, graph DB,
  registry metadata, and user-visible status.
```

### Performance Checklist

```text
/speckit-checklist performance

Focus on SPEC-007:
- Lazy grammar loading, worker responsiveness, bounded messages, file read
  batching, SQLite transaction/query plans, and memory release.
- The 901-file/16k-node self-repo ≤60-second keyword-index target.
- p95 ≤150 ms local keyword/search/impact reads with a documented measurement
  method.
- Package size and lazy WASM asset behavior from both CLI and HTTPS static
  hosting.
- Embedding work isolated from the usable keyword index and cancellable/resumable.
- Pay special attention to proving the main thread remains interactive throughout
  scan, parse, store, and embed phases.
```

### Checklist Results

Populate after all four runs:

| Checklist | Items | Gaps | Resolution status |
|---|---:|---:|---|
| ux | 31 | 5 initial / 0 final | ✅ Complete; FR-050–FR-052 and SC-012 added |
| security | 31 | 2 initial / 0 final | ✅ Complete; FR-053–FR-054 and SC-013–SC-014 added |
| data-integrity | 34 | 6 initial / 0 final | ✅ Complete; FR-055–FR-058 and SC-015–SC-018 added |
| performance | 33 | 5 initial / 0 final | ✅ Complete; FR-059–FR-063 and SC-019–SC-021 added |
| **Total** | **129** | **18 initial / 0 final** | ✅ G4 passed |

UX executor: `checklist-executor`. It researched and resolved five requirements
gaps in one loop: keyboard/focus behavior, assistive-technology progress and
terminal announcements, 320 CSS px/reduced-motion behavior, active-operation
delete semantics, and measurable accessibility success criteria. The final
runner `count-markers(type=gaps)` result was zero across spec, plan, and
checklists. No unresolved item required consensus, so the UX consensus
companion completed without analyst dispatch.

Performance executor: `checklist-executor`. It researched and resolved five
requirements gaps in one loop: bounded read/message/progress budgets, query-plan
evidence, resource release, lazy packaged-asset evidence, and embedding
isolation. An independent parent check found all 33 checklist rows were still
unchecked despite the zero-marker result; a bounded correction marked all rows
checked and annotated the five remediated items. Final validation: UX 31/31,
Security 31/31, Data Integrity 34/34, Performance 33/33, zero unchecked rows,
and zero `[Gap]` markers. G4 passed. No unresolved item required consensus, so
the Performance consensus companion completed without analyst dispatch.

Security executor: `checklist-executor`. It researched and resolved two
requirements gaps in one loop: traversal/drop-recursion admission rules and
inert rendering for malicious source text. The final runner
`count-markers(type=gaps)` result was zero across spec, plan, and checklists.
No unresolved security judgment remained, so mandatory analyst consensus was
not triggered and the Security consensus companion completed without dispatch.

Data Integrity executor: `checklist-executor`. It researched and resolved six
requirements gaps in one loop: database/lock lifecycle, vector convergence,
named crash boundaries, deterministic refresh synchronization, measurable
failure recovery, and measurable add/change/delete outcomes. The final runner
`count-markers(type=gaps)` result was zero across spec, plan, and checklists.
No unresolved item required consensus, so the Data Integrity consensus
companion completed without analyst dispatch.

---

## Phase 5: Tasks

**When to run:** After G4 passes.

### Tasks Prompt

```text
/speckit-tasks

Read all of:
- `specs/007-in-browser-indexing/spec.md`
- `specs/007-in-browser-indexing/plan.md`
- `specs/007-in-browser-indexing/research.md`
- `specs/007-in-browser-indexing/data-model.md`
- `specs/007-in-browser-indexing/contracts/`
- `docs/ai/specs/.process/SPEC-007-design-concept.md`

## Task Rules
- Order tasks by the three vertical slices, then by independently testable user
  story; do not create a layer-only foundation PR with no user-visible path.
- Every behavior task follows RED → GREEN → REFACTOR and names its test/UAT
  evidence.
- Mark truly parallel-safe tasks `[P]`; do not parallelize files sharing the
  extraction seam, worker protocol, schema, or SPA data-source boundary.
- Reference FR and user-story IDs in every implementation/test task.
- Include asset/package/license/docs tasks in the same slice that introduces the
  dependency or asset.
- Include reviewability checks at the end of each slice.

## Slice 1
- Failing cross-runtime extraction fixtures and browser end-to-end import test.
- Minimum pure extraction seam and Node regression coverage.
- Browser file source, nested ignore parity, lazy grammar loading, worker RPC,
  SQLite-Wasm SAH-pool, accepted-source persistence, and transaction/progress.
- Typed repository-client boundary and first local overview/search/symbol/source
  user journey.

## Slice 2
- Relationships, graph, and impact local queries through existing result types.
- Stable repository registry, saved-handle permission/reconnect, manual
  incremental refresh, cancel/rollback, parse-warning summaries, and delete.
- Quota estimate/persist request, Web Lock ownership, busy/retry state, and
  lifecycle tests.

## Slice 3
- Directory-drop snapshot and the capability/degradation matrix.
- Explicit endpoint consent, non-secret profile persistence, memory-only key,
  post-keyword resumable embeddings, CORS/TLS/mixed-content failure behavior,
  and keyword fallback.
- CLI/static-host asset checks, CSP/offline/network audit, accessibility,
  Firefox/Safari degradation checks, performance benchmarks, and CodeGraph
  self-repo UAT.

## Non-goals Guard
Generate no task for a separate app, ZIP parser, watcher, daemon sync, LSP,
catalogs, chat, dataflow, service-worker API shim, Node polyfill bundle,
multi-tab DB concurrency, persisted credentials, insecure endpoint override,
automatic eviction, or source-folder writes.
```

### Tasks Results

Populate after `/speckit-tasks`:

| Metric | Value |
|---|---|
| Total Tasks | ⏳ Pending |
| Phases/Slices | 3 vertical slices plus bounded setup/polish |
| Parallel Opportunities | ⏳ Pending |
| User Stories Covered | Must be 7/7 |

---

## Atomicity Route

Fill this only after Tasks/G5 by running the read-only classifier:

```text
runner helper atomicity-route specs/007-in-browser-indexing
```

| Field | Value | Meaning |
|---|---|---|
| **Route** | | `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope` |
| **Releasable** | | `true` unless the classifier proves a release-safety risk |
| **Signals** | | Decisive structural findings |
| **Warnings** | | Release-safety warnings, if any |

The interview's three slices are review units, not permission to create branches
or PRs before this classifier and the normal autopilot gates run.

---

## Phase 6: Analyze

**When to run:** Always after Tasks.

### Analyze Prompt

```text
/speckit-analyze

Cross-check:
1. `.specify/memory/constitution.md`
2. `docs/ai/specs/.process/SPEC-007-design-concept.md`
3. `specs/007-in-browser-indexing/spec.md`
4. `specs/007-in-browser-indexing/plan.md`
5. `specs/007-in-browser-indexing/tasks.md`
6. Every checklist and contract artifact

Focus on:
- Drift from any of the twenty-two selected Grill Me answers.
- Requirement/task coverage for all seven stories and AC-7.1 through AC-7.4.
- Accidental expansion into server-only features or alternate ingestion paths.
- Node/browser extraction semantic divergence or unnecessary upstream-owned
  refactors.
- Schema/source-cache/registry transaction gaps that can expose a partial index.
- Filesystem permission, Web Lock, quota, cancellation, and deletion races.
- Any network path before consent, any durable credential, or insecure endpoint
  escape hatch.
- Missing WASM/worker/static copy-assets/package tests.
- Unsupported browser claims that exceed the capability matrix.
- Missing self-repo UAT, deterministic parity, accessibility, offline, or
  performance evidence.
- Whether the current plan remains below the greenfield block threshold and
  preserves three reviewable vertical slices.

No CRITICAL finding may survive G6. Fix HIGH findings unless a documented,
constitution-compatible exception is approved.
```

### Analysis Results

Populate after `/speckit-analyze`:

| ID | Severity | Issue | Resolution |
|---|---|---|---|
| Pending | | | |

---

## Phase 7: Implement

**When to run:** After G1-G6 pass and the atomicity route is recorded.

### Implement Prompt

```text
/speckit-implement

## Sources
Re-read `tasks.md`, `plan.md`, all contracts, and
`docs/ai/specs/.process/SPEC-007-design-concept.md` before each slice. The Q&A
log explains why the boundaries exist; do not replace selected decisions with
locally convenient alternatives.

## TDD Cycle
For each task:
1. RED: Add the smallest failing behavioral test or real-browser reproduction.
2. GREEN: Implement the minimum code that satisfies it.
3. REFACTOR: Remove duplication and unnecessary branching while tests stay green.
4. VERIFY: Record focused command output and observable browser evidence.

## Pre-Implementation Setup
1. `git branch --show-current` must print `007-in-browser-indexing`.
2. Activate Node `24.11.1` from `.nvmrc`.
3. Verify `git status --porcelain` is clean.
4. Run `npm run build` and the smallest relevant baseline tests.
5. Verify the self-index health gate from the roadmap preflight remains green.
6. Confirm the current slice, exact file ownership, acceptance checks, and
   reviewability budget before editing.

## Implementation Rules
- Never weaken Node behavior to make browser bundling convenient.
- Keep all Node-only imports outside the browser dependency graph.
- Use real SQLite-Wasm/OPFS in Playwright integration/UAT; unit-test pure
  contracts separately, but do not mock away persistence correctness.
- Treat repository contents as hostile text/data. Render source safely.
- Do not log source content, endpoint keys, or private infrastructure values.
- Keep keyword capability complete when embeddings are absent or fail.
- Close database/worker/lock resources deterministically.
- Add new SQL/WASM/worker/static assets to root build and package tests in the
  same commit that introduces them.
- Stop and re-plan if a slice exceeds its declared boundary or the plan's
  reviewability block threshold.

## Slice Verification
After each slice:
- Focused root and web Vitest suites pass.
- `npm run typecheck` and `npm --prefix web run typecheck` pass.
- `npm --prefix web run lint` passes for touched web code.
- `npm run build` passes and all worker/WASM/static assets are present.
- Relevant Playwright journeys pass using real browser storage/runtime.
- `git diff --check` and `git status --porcelain` are reviewed.
- Deterministic Node behavior and package/offline/privacy guards remain green.

## Final UAT
- Index this CodeGraph worktree through the browser-local path.
- Record files/nodes/edges, elapsed keyword-index time, main-thread
  responsiveness, p95 local reads, and repeated-index determinism.
- Browse search, symbol/source, relationships, graph, and impact locally.
- Reload, reconnect, refresh a controlled edit, cancel a refresh, verify rollback,
  and delete the browser index without changing source.
- Exercise another-tab busy state, quota/capability messages, and a directory
  snapshot fallback.
- Audit zero network calls by default.
- With explicit safe test configuration, exercise semantic success and
  endpoint/CORS/TLS failure while keyword search remains usable.
- Repeat package/static-host offline asset checks and record browser versions.
```

### Implementation Progress

| Slice | Tasks | Status | Required demonstration |
|---|---|---|---|
| 1 - Persistent keyword path | Assigned after G5 | ⏳ Pending | Open folder through local overview/search/symbol/source after reload |
| 2 - Graph and lifecycle | Assigned after G5 | ⏳ Pending | Graph/impact, reconnect, refresh/rollback, storage, lock, delete |
| 3 - Fallback, semantic, shipping | Assigned after G5 | ⏳ Pending | Snapshot/degradation, opt-in semantic, package/offline/performance UAT |

---

## Post-Implementation Checklist

- [ ] All tasks in `tasks.md` are genuinely implemented and verified.
- [ ] `npm run build` passes with shipped worker/WASM/static assets.
- [ ] `npm test` passes.
- [ ] Root and web typechecks pass.
- [ ] Web lint and web Vitest pass.
- [ ] Playwright full-mode and degradation-mode suites pass.
- [ ] Cross-runtime extraction fixtures are deterministic across repeated runs.
- [ ] No default network request or durable embedding credential exists.
- [ ] Package/offline/static-host audits pass.
- [ ] Self-repo UAT meets the 60-second and 150 ms targets or records an approved,
  evidence-based scope decision before merge.
- [ ] Reviewability, code review, verify, verify-tasks, cleanup, retrospective,
  PR packet, and PR gates are complete or explicitly skipped with durable reason.
- [ ] Roadmap, workflow, autopilot state, task state, UAT evidence, and
  retrospective agree.

---

## Reviewability Notes

The governing scaffold estimate is:

```text
estimated_loc=1055
suggested_slices=3
status=warn
```

Review in this order:

1. Shared extraction seam plus persistent keyword journey.
2. Local graph/impact and index lifecycle.
3. Capability degradation, semantic opt-in, packaging, privacy, and UAT.

Do not hide generated assets or dependency churn inside the LOC number. If any
slice loses an independently demonstrable user journey, re-slice before code.

---

## Lessons Learned

Populate from the post-implementation retrospective. Preserve lessons about
browser capability detection, OPFS recovery, shared extraction boundaries,
package assets, privacy, and measured performance.

---

## Project Structure Reference

The plan must confirm exact paths before implementation. Expected ownership:

```text
codegraph/
├── src/
│   ├── extraction/                 # Minimal shared pure-runtime seam; Node adapter remains authoritative
│   └── db/schema.sql               # Canonical graph schema; no browser fork
├── web/
│   └── src/
│       ├── app/                    # Shared SPA state/runtime selection
│       ├── components/             # Open-folder, progress, capability, storage, delete UI
│       ├── lib/                    # Typed repository-client boundary
│       ├── local-indexing/         # Browser source, worker, SQLite/OPFS, registry, embeddings
│       └── routes/                 # Local workspace entry using shared browse routes
├── __tests__/                      # Node/kernel/package regression coverage
├── web/src/tests/                  # Web unit/component/Playwright coverage
├── docs/ai/specs/.process/         # Design concept and durable workflow
└── specs/007-in-browser-indexing/  # Spec, plan, contracts, tasks, evidence, SPEC-MOC
```

---

Template based on the shared SpecKit Pro workflow template. This populated file
is ready for `$speckit-autopilot`; setup itself must not run autopilot.
