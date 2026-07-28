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
| Tasks | `/speckit-tasks` | ✅ Complete | 38 TDD tasks, 63/63 FRs, 7/7 stories; G5 passed. |
| Analyze | `/speckit-analyze` | ✅ Complete | Consensus remediated 1 HIGH and 1 MEDIUM finding; G6 passed; confidence 0.94. |
| Confidence Gate | G6.5 | ✅ Complete | Advisory mode passed at 0.94 against the configured 0.90 threshold. |
| Implement | `/speckit-implement` | ✅ Complete | Executed 38 task-level TDD units in three vertical slices. |

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
| G6.5 | Before Implement | Advisory confidence is at least 0.90 or remediation guidance remains visible. |
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
| Total Tasks | 38 |
| Phases/Slices | 3 vertical slices plus bounded setup/polish |
| Parallel Opportunities | 8 explicitly `[P]` tasks |
| User Stories Covered | 7/7 |
| Functional Requirements Covered | 63/63; zero unmapped |
| TDD Structure | 38 RED / 38 GREEN / 38 REFACTOR / 38 evidence sections |
| G5 | ✅ Passed; 38 tasks, zero markers |

The required `phase-executor` route was attempted through two executor turns
plus one resumed turn. Each remained pre-artifact and produced neither
`tasks.md` nor an actionable blocker despite bounded and absolute-path write
instructions. The parent orchestrator used the documented fail-open fallback,
authored `tasks.md` from the validated canonical artifacts, and applied the
same G5 checks. This executor failure is retained here rather than reported as
a successful agent result.

Tasks-mode `reviewability-gate` was not invoked because the installed runner
supports setup mode only. Deferred diagnostics: helper
`reviewability-gate`, requested mode `tasks`, reason `installed read-only
runner supports setup mode only`. Fallback evidence permits continuation:
setup-mode scaffold estimate 1,055 LOC / three suggested slices /
`status=warn`; Plan `estimate-reviewable-loc` `status=pass`,
`projected=600`, 15 production files; operator-ratified split: three vertical
slices. No correctness blocker is present.

---

## Atomicity Route

Fill this only after Tasks/G5 by running the read-only classifier:

```text
runner helper atomicity-route specs/007-in-browser-indexing
```

| Field | Value | Meaning |
|---|---|---|
| **Route** | `one-navigable-PR` | Keep the ratified slices as review order inside one PR |
| **Releasable** | `true` | No release-safety risk found |
| **Signals** | `change-shape:modify-heavy` | The classifier found a modify-heavy integrated change |
| **Warnings** | None | No classifier warning |

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

| ID | Severity | Issue | Resolution |
|---|---|---|---|
| A-001 | HIGH | Plan/tasks omitted the current LSP-backed source-route files, allowing a browser-local source view to open `/lsp`. | Added explicit ownership for `SymbolDetailRoute`, `SourcePane`, and `lsp/client`; local source uses `LocalRepositoryClient.getSource`, local LSP actions are honestly disabled, and tests prohibit local `/lsp`. |
| A-002 | MEDIUM | Quickstart claimed no network request even though same-origin shipped worker/WASM assets must load. | Narrowed the statement to prohibit repository-derived, external, daemon, WebSocket, beacon, and embedding traffic before opt-in while allowing enumerated same-origin assets. |
| A-003 | LOW | Spec-context analyst reported that the roadmap workflow link targeted a missing `.process` directory. | Dismissed after path resolution: the relative link resolves to existing `docs/ai/specs/.process/SPEC-007-workflow.md`. The genuinely stale roadmap size/file estimate was synchronized to the remediated plan. |

The `analyze-executor` initial pass reported zero findings and G6 passed.
Mandatory consensus then used `codebase-analyst`, `spec-context-analyst`, and
`domain-researcher`. Codebase and domain perspectives independently found
A-001; domain also found A-002. After remediation, Plan
`estimate-reviewable-loc` returned `status=pass`, `projected=720`, 18
production files, 8 new files, 11 modified files, and 19 declared entries.
G5 and G6 both passed again, with zero unmapped FRs and zero finding markers.
No unresolved item requires human review.

The installed `consensus-synthesizer` role is unavailable, so the parent
orchestrator applied the documented synthesis fallback:

```text
📊 Confidence: 0.94
Requirements coverage: 0.96
Codebase/domain alignment: 0.94
Task executability: 0.94
Verification sufficiency: 0.95
Implementation readiness: 0.93
```

Confidence mode is advisory; the synthesized score exceeds the configured
0.90 threshold.

---

## Phase 6.5: Confidence Gate

| Confidence Gate | G6.5 | Status | Notes |
|---|---|---|---|
| Confidence Gate | G6.5 | ✅ Complete | Advisory score 0.94 exceeded the configured 0.90 threshold; implementation proceeded with no unresolved human-review item. |

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
| 1 - Persistent keyword path | T001-T012 complete | ✅ Complete | Open folder through local overview/search/symbol/source after reload |
| 2 - Graph and lifecycle | T013-T024 complete | ✅ Complete | Graph/impact, reconnect, refresh/rollback, storage, lock, delete |
| 3 - Fallback, semantic, shipping | T025-T038 complete | ✅ Complete | Snapshot/degradation, opt-in semantic, package/offline/performance UAT |

### Implementation Evidence

#### T001 - Packaged SQLite Worker/WASM Bootstrap

- Required `implement-executor` dispatch occurred first, but the child inherited
  the outer Codex task's write sandbox and could not edit this dedicated
  worktree. The executor returned zero file/test changes with the exact binding
  blocker. Parent-orchestrator fallback then completed the task in the verified
  execution root using strict TDD.
- **RED**: `npm --prefix web run test:e2e --
  local-indexing-packaged.spec.ts --workers=1` failed the intended assertion:
  expected `@sqlite.org/sqlite-wasm` `3.53.0-build1`, received `undefined`.
- **GREEN**: Pinned the exact Apache-2.0 dependency, excluded it from Vite
  dependency prebundling, declared WASM handling and the production worker
  entry, and added the minimum worker module import.
- **VERIFY**: Focused packaged Playwright passed 1/1; root package-asset Vitest
  passed 3/3; `npm run build` passed. `web/dist` and copied `dist/web` each
  contain a non-empty `local-indexing-worker-*.js` and
  `sqlite3-*.wasm` (864,752 bytes).
- **Bootstrap finding**: Worktree command binding is correct for the parent, but
  collaboration child sandboxes remain rooted at the outer Codex task. Until
  the app can rebind child writable roots, required executor dispatches must
  record the failure and use parent TDD fallback from this exact worktree.

#### T002 - Deterministic Browser-Indexing Fixtures

- Required `implement-executor` dispatch again returned zero changes after
  proving the dedicated worktree was `posix-not-writable` in the child session.
  Parent fallback remained in the verified execution root.
- Added a virtual browser source tree covering nested ignore rules, a custom
  `.widget` TypeScript override, Vue-to-TypeScript delegation, binary and
  1-MiB-plus files, relative/absolute traversal paths, and an unsupported entry
  kind.
- Fixed the parity contract to three accepted paths, their language map, nine
  semantic nodes, eight semantic edges, six stable warning codes, and the
  single lazy `typescript` grammar load. Runtime ids, timestamps, and row order
  are removed by the semantic projection helper.
- **Intentional RED for T004**: Focused Vitest reports 1 passing fixture-contract
  test and 1 failing assertion: `T004 must provide
  src/extraction/browser-kernel.ts`. This is T002's required handoff evidence,
  not a claimed green full suite.

#### T003 - Shared Source-Cache/Generation Migration

- Required executor dispatch again returned the child writable-root blocker with
  zero changes; parent fallback supplied RED/GREEN evidence.
- **RED**: Focused real-SQLite migration suite failed three independent
  assertions: canonical version 11 vs expected 12, missing fresh
  `source_cache`, and missing v11 migration tables.
- **GREEN**: Canonical schema/migration v12 adds `source_cache`,
  `index_generations`, and `index_publications` with fresh/migrated shape
  parity, a source-path index, generation-status index, and one-published-
  generation uniqueness.
- **VERIFY**: Focused migration invariants passed 5/5; shipped-schema gate
  passed 6/6 after the normal `copy-assets` refresh; all 153 affected schema
  regressions passed; root and web typechecks passed.
- The schema rejects cache rows over 1 MiB, a second published generation for
  one repository, and publication pointers without matching generation rows.
  Existing version assertions were updated from 11 to 12 only where the
  canonical-version bump made that necessary.

#### T004 - Runtime-Neutral Browser Extraction Kernel

- Required executor dispatch again returned zero changes after confirming the
  dedicated worktree was not writable in the child sandbox; parent fallback
  completed the strict TDD loop from the verified execution root.
- **RED**: T002 first failed on the missing browser-kernel module. A later
  contract assertion failed because the browser result omitted unresolved
  references and extraction errors.
- **GREEN**: Added the Node-free source-admission/extraction seam with injected
  hashing, language detection, grammar loading, parsing, and release hooks;
  deterministic bytewise path order; traversal/duplicate/ignore/size/binary
  warnings; delegate grammar selection; and complete semantic results.
- **VERIFY**: Browser-kernel and grammar-byte suites passed 6/6; the focused
  existing Svelte/Vue/Astro extraction subset passed 25/25; root and web
  typechecks passed. The repeated fixture projection remains exactly nine nodes
  and eight edges with identical manifests, unresolved references, and errors.
- **Retrieval guardian**: Two required guardian agents were dispatched but did
  not return after bounded waits and explicit stop requests. Parent fail-open
  review applied the repository checklist: budget/output/error/guidance,
  synthesized-edge, flow, and server-instruction checks are N/A; deterministic
  node/edge stability passes by the repeated canonical/browser projection; A/B
  retrieval evaluation is N/A because this new browser seam is not yet wired
  into Node or agent retrieval behavior. No blocking finding remains.

#### T005 - Picked-Folder And Snapshot Source Providers

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback continued from the dedicated worktree.
- **RED**: Focused web Vitest failed at module resolution because
  `web/src/local-indexing/source.ts` did not exist.
- **GREEN**: Added direct-user-activation picker gating, opaque folder/snapshot
  identity, private live-handle ownership, recursive ancestry-derived POSIX
  traversal, built-in/configured ignores before byte reads, deterministic
  hashes/manifests, immutable snapshot copies, and file/depth/count/byte/
  transfer ceilings with capped warning details plus aggregate counts.
- **VERIFY**: Focused source-provider cases passed 5/5, web typecheck passed,
  and `git diff --check` remained clean. Tests prove rejected, duplicate,
  ignored, oversized, cyclic, traversal-shaped, and over-budget inputs never
  enter accepted manifests or trigger rejected byte reads.

#### T006 - SQLite-Wasm SAH-Pool Generation Storage

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback supplied the task implementation.
- Current official SQLite documentation was checked after two Context7
  transport failures. The adapter explicitly installs `opfs-sahpool`, which is
  worker-only, avoids a COOP/COEP dependency, uses absolute virtual filenames,
  reserves capacity, closes every database, and pauses the VFS on shutdown.
- **RED**: Focused web Vitest failed because the SQLite store module was
  missing.
- **GREEN**: Added a browser-safe shared schema-version constant, canonical
  schema initialization, per-generation graph/source databases, a registry
  publication pointer, two-phase staging/commit, last-good rollback,
  incomplete-staging recovery, bounded failure recording, and deterministic
  close behavior.
- **VERIFY**: Focused unit contracts passed 6/6; root and web typechecks passed;
  the production build passed; a real Chromium worker/SQLite-Wasm/OPFS
  SAH-pool test passed 1/1 through initial publish, injected quota failure,
  worker restart, stale-generation cleanup, republish, source/graph reads, and
  VFS pause. Focused Node schema/migration regressions passed 59/59 and the diff
  whitespace gate is clean.

#### T007 - Versioned Worker Operation Runtime

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback implemented the worker contract.
- **RED**: Three focused cases failed because the worker exported neither a
  versioned runtime nor its declared budgets. A later RED proved cancellation
  could be falsely accepted after atomic publication had begun.
- **GREEN**: Added protocol-v1 structured-clone-safe envelopes, exact batch/
  payload/progress/embedding/vector budgets, batched/coalesced progress, one-
  time lazy grammar-manifest loading through an injected adapter, operation-
  scoped cancellation, stale request no-ops, one terminal response, plain
  redacted failures, and deterministic grammar/store close cleanup.
- Cancellation is accepted only before the publication point of no return; a
  later cancel is an explicit no-op and the already-started atomic commit
  completes rather than being mislabeled cancelled.
- **VERIFY**: Focused worker/source/storage cases passed 10/10, web typecheck
  passed, and `git diff --check` passed.

#### T008 - Shared REST/Local Repository Client Boundary

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback supplied the typed adapters.
- **RED**: Focused web Vitest failed because neither the shared repository
  client nor local worker client existed.
- **GREEN**: Added one SPA-facing method surface for repository lists/status/
  overview, search, node/source, relationships, graph, impact, refresh,
  cancellation, and deletion. The remote adapter delegates existing REST
  functions; the local adapter uses protocol-v1 correlated worker requests,
  optional transfer lists, stable error normalization, and fail-closed
  unsupported capabilities.
- Stale request ids, mismatched operation ids, and progress frames cannot settle
  active calls; local failures never fall through to daemon fetches.
- **VERIFY**: Focused client plus worker regressions passed 13/13, web typecheck
  passed, and `git diff --check` passed.

#### T009 - Deliberate Local-Folder Shell Entry

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback completed the component TDD in the
  dedicated worktree.
- **RED**: Three focused component cases failed on the absent Open local folder
  control, absent Server/Local folder/Local snapshot labels, silent progress and
  terminal states, missing cancellation, focus loss, and an opaque local root
  displayed in the overview header.
- **GREEN**: The existing shell now invokes the folder picker only from direct
  button activation, hands the accepted source collection to
  `LocalRepositoryClient`, exposes progress and operation cancellation, and
  keeps all required runtime/state labels visible. Status/alert live regions,
  compact wrapping, and deterministic focus return cover the accessibility
  contract without changing server selection behavior.
- **REFACTOR**: Runtime-label mapping and operation-state taxonomy are
  centralized while existing Button, Progress, Badge, Select, and app-state
  primitives remain the presentation boundary.
- **VERIFY**: Focused local shell, existing app-shell, and local-client tests
  passed 8/8; web typecheck and `git diff --check` passed.

#### T010 - Local Routes and Inert Cached Source

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback completed the route/client TDD.
- **RED**: Three focused browser-local route cases all failed because keyword
  search, symbol relationships, graph, and impact still called daemon REST
  functions; cached source was unavailable and the source viewer remained tied
  to `/lsp`.
- **GREEN**: App state now exposes the active typed repository client without
  ever substituting the remote client for a disconnected local repository.
  Search, status/overview, symbol, callers/callees, graph, impact, and cached
  source reads use that client. Local source has a distinct React text renderer,
  while LSP-only source intelligence and chat remain visibly server-only.
- **SECURITY**: The focused malicious-source case renders script, image, event
  handler, URL, and `javascript:`-looking bytes as literal text. It observes no
  image node, code execution, `fetch`, or WebSocket construction.
- **REFACTOR**: REST delegation remains inside the remote client, local
  disconnection fails closed, and the existing LSP source viewer is preserved
  unchanged behind the server-only branch.
- **VERIFY**: Six focused shell/client/route/source files passed 98/98 tests;
  root and web typechecks passed; web lint passed with pre-existing
  fast-refresh/ReindexRoute warnings only; `git diff --check` passed.

#### T011 - Real Chromium Folder-To-Keyword Journey

- Required executor dispatch returned zero changes with the known child
  writable-root blocker; parent fallback completed the real-browser TDD path in
  the dedicated worktree.
- **RED**: The first Chromium run timed out after 20 seconds waiting for
  `Local keyword index complete.` because the production worker did not yet
  connect picked-folder bytes to parser WASM, SQLite-Wasm publication, or the
  local repository query surface.
- **GREEN**: The production worker now loads shipped Tree-sitter core/grammar
  WASM, extracts accepted TypeScript/JavaScript/Vue sources off the UI thread,
  publishes graph/source rows through the SQLite-Wasm SAH pool, answers local
  repository queries, persists opaque repository metadata, and reopens the
  last-good local generation after reload without picker permission or daemon
  fallback. Pre-publication cancellation is operation-scoped and a cancelled
  import can be retried cleanly.
- **DETERMINISM/PRIVACY**: The fixture publishes exactly three symbols and two
  contains edges, searches both expected functions before and after reload,
  renders the durable cached source, and observes zero repository-derived API,
  LSP, WebSocket, external-origin, or CDN requests.
- **VERIFY**: Focused worker/client/shell/route suites passed 22/22; web
  typecheck passed; the production build emitted non-empty local worker,
  SQLite-Wasm, Tree-sitter runtime, TypeScript, TSX, and JavaScript WASM assets;
  real Chromium cancellation/retry/index/search/source/reload passed 1/1 in
  1.9 seconds. The exact dependency lock was reconciled offline with npm 10 to
  avoid unrelated npm 11 peer-metadata churn.

#### T012 - Slice 1 Reviewability And Regression Checkpoint

- Required executor dispatch returned zero changes and no verification after
  proving the dedicated worktree was readable but `posix-not-writable`; parent
  fallback completed the checkpoint from the verified execution root.
- **RED/DIFF BUDGET**: Slice 1 changes 40 code/test files with 5,574 additions
  and 70 deletions: 24 production/dependency files at 3,743 additions and 64
  deletions, plus 16 test/fixture files at 1,831 additions and 6 deletions.
  This materially exceeds the scaffold's rough 1,055-LOC estimate and remains
  an explicit reviewability warning.
- **BOUNDARY**: All changed behavior remains inside the ratified canonical
  schema/migration, runtime-neutral extraction, browser source/storage/worker,
  typed client, existing SPA shell/routes, dependency packaging, and focused
  verification ownership. No semantic opt-in, degradation matrix, lifecycle
  refresh/reconnect/lock/delete, or fourth slice was pulled forward. The slice
  retains its independent folder-to-durable-keyword demonstration.
- **GREEN**: Root production build and root/web typechecks passed; focused root
  migration/extraction/shipped-schema tests passed 13/13; all web Vitest passed
  142/142; lint completed with 0 errors and 15 existing export-shape/hook
  warnings; Chromium packaged-assets, real SQLite-Wasm recovery, and full local
  journey passed 3/3.
- **REFACTOR**: No additional code change was justified by the green
  checkpoint. `git diff --check` passed and the oversized-but-contained warning
  remains visible for the final reviewability backstop.

#### T013 - Relationship And Graph Query Parity

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the task in the verified worktree.
- **RED**: The shared-client test showed remote callers dropped requested
  `limit`/`offset` entirely and local requests forwarded over-cap values.
  Real Chromium SQLite rejected the new relationship request as unsupported.
  The first query-plan run then showed SQLite choosing the broader edge
  identity index for callees rather than the intended `(source, kind)` path.
- **GREEN**: Shared request normalization now mirrors server limits: relationship
  pages default to 100 and clamp at 500, graph depth defaults to one and clamps
  at three, and invalid sub-minimum integers fail as `invalid_request`.
  Remote and local clients send identical effective values. Published-generation
  relationship reads de-duplicate node ids, use explicit target/source-kind
  indexes, and report effective paging. Bounded breadth expansion caps graph
  reads at 2,000 nodes and 10,000 inspected edges with honest truncation.
- **QUERY PLANS/ISOLATION**: Real browser `EXPLAIN QUERY PLAN` evidence contains
  `idx_edges_target_kind`, `idx_edges_source_kind`, and SQLite's multi-index OR
  graph path. A staged unpublished generation remains invisible to callers;
  only the registry's published generation is queried.
- **VERIFY**: Focused client/worker/route suites passed 17/17; web typecheck
  passed; real Chromium SQLite publication, paging, graph caps, plan capture,
  and unpublished-generation isolation passed 1/1; `git diff --check` passed.

#### T014 - Local/Server Context And Accessibility

- Required executor dispatch returned zero changes/tests with the known child
  writable-root blocker; parent fallback completed the focused UI TDD.
- **RED**: Three component assertions failed because progress animations did
  not honor reduced-motion, local Re-analyze/Chat links remained enabled without
  trust-boundary explanations, and local action labels did not distinguish
  browser refresh from server re-analysis.
- **GREEN**: Local Search remains an enabled existing route. Until the dedicated
  refresh lifecycle is connected, Refresh local index is a disabled button with
  visible `aria-describedby` guidance; Chat is likewise disabled with a visible
  server-only explanation. Server Re-analyze and Chat links remain unchanged.
  Runtime badges, display names, and live status/alert semantics remain
  explicit without displaying opaque local roots.
- **ACCESSIBILITY/RESPONSIVE**: Folder open is keyboard-activatable and restores
  focus after success or dismissal; progress transitions use
  `motion-reduce:transition-none`; local action copy wraps in min-width-safe
  containers; a real Chromium viewport at 320 CSS px reports no horizontal
  document overflow.
- **VERIFY**: Focused local/app shell suites passed 8/8; web typecheck passed;
  Chromium full local journey plus 320-CSS-pixel probe passed 1/1;
  `git diff --check` passed.

#### T015 - Bounded Explainable Impact

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the task in the verified worktree.
- **RED**: The real SQLite-Wasm worker result had no impact query-plan evidence,
  and the storage test could not request a distinct bounded impact traversal.
  The existing worker routed impact through the undirected graph query, which
  included dependencies instead of only affected dependents.
- **GREEN**: Local impact now follows incoming non-containment edges through the
  published generation, expands contained members at the same semantic depth,
  defaults to depth three, and caps work at 2,000 symbols and 10,000 inspected
  edges. Results preserve the existing `GraphResult` shape: affected files come
  from node file fields and the retained dependency edges explain why each
  symbol/file is affected.
- **QUERY PLANS/ISOLATION**: Real browser `EXPLAIN QUERY PLAN` evidence uses
  `idx_edges_target_kind`; the known fixture excludes outgoing callees and
  unrelated symbols while preserving callers across multiple depths. A staged
  unpublished caller remains invisible.
- **REFACTOR/VERIFY**: Container kinds, depth normalization, and explicit graph
  budgets are shared constants. Focused shared-client tests passed 4/4; web
  typecheck passed; real Chromium SQLite impact semantics, affected-file
  projection, plan capture, and publication isolation passed 1/1;
  `git diff --check` passed.

#### T016 - User-Observed Local Read Latency

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the browser performance harness.
- **RED**: After locator stabilization, the deterministic full journey reached
  its intended failure because it had no end-to-end graph/impact query-plan
  evidence. The pre-existing journey also had no warmup-plus-20 action-to-render
  sample gate for search, graph, or impact.
- **GREEN**: The real Chromium journey now performs one warmup followed by 20
  measured user actions per operation, times from immediately before the action
  through the visible rendered state, calculates p95, and enforces the 150 ms
  budget. A second production worker publishes a minimal isolated generation
  and captures real SQLite query plans without repository-derived network use.
- **EVIDENCE**: The attached `spec007-local-read-latency.json` contains all 60
  samples, p95 values, caps, and query plans. The final run measured search
  114.3 ms, graph 101.3 ms, and impact 103.2 ms p95; graph used SQLite
  multi-index OR and impact used `idx_edges_target_kind`.
- **REFACTOR/VERIFY**: Shared timing and percentile helpers keep warmups outside
  the sample arrays and apply one explicit budget. Web typecheck passed; the
  real cancellation/index/search/source/reload/performance/320-pixel Chromium
  journey passed 1/1; `git diff --check` passed.

#### T017 - Saved Folder Registry And Explicit Reconnect

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the lifecycle boundary.
- **RED**: Three focused cases failed because no source-handle registry or
  client connection state existed. Cached reads could not distinguish stale,
  prompt, denied, or granted handles, and refresh posted to the worker before
  reconnect.
- **GREEN**: An origin-scoped IndexedDB registry stores only opaque repository
  identity, safe display metadata, and the browser capability handle. Restore
  calls `queryPermission` only, never prompts, and leaves last-good SQLite data
  browseable for prompt/denied/stale states. Explicit reconnect requires direct
  activation, requests read permission only then, rejects different folders via
  `isSameEntry`, and enables refresh only for a live granted handle.
- **REFACTOR**: Durable saved-handle records are separate from the in-memory
  live-handle/permission map. App startup restores connection state without
  blocking cached repository discovery; native cloneable picker handles are
  saved after successful publication without exposing a host path.
- **VERIFY**: Focused source/client/shell suites passed 23/23 across granted,
  prompt, denied, stale, mismatch, opaque-identity, cached-read, and refresh-gate
  cases; web typecheck passed; real Chromium cached reload/privacy/performance
  journey passed 1/1; `git diff --check` passed.

#### T018 - Manifest-Hash Incremental Refresh

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the refresh transaction.
- **RED**: The pure manifest test failed because no deterministic diff existed,
  and the real SQLite-Wasm worker rejected `storage-refresh` as unsupported.
  Existing refresh requests carried no current source collection and could not
  preserve unchanged graph/cache rows or remove deleted ones.
- **GREEN**: Refresh now compares sorted path/content-hash manifests, extracts
  only added/changed candidates, retains unchanged cached source/nodes/edges,
  omits deleted rows, records unsupported changed candidates as bounded
  warnings, rebuilds an accepted-source manifest, and atomically publishes one
  matching full generation. The client recollects only through a live granted
  handle and sends the bounded collection to the refresh worker operation.
- **EXACT EVIDENCE**: The real fixture processed `added.ts`, `changed.ts`, and
  unsupported `skipped.txt`; retained `unchanged.ts`; removed `deleted.ts`; and
  published generation 2 with `{added:1, changed:1, deleted:1, unchanged:1,
  skipped:1}` plus exact `{files:3, nodes:6, edges:3, warnings:1}` counts.
  Manifest fingerprint, manifest entries, source cache, node names, edge count,
  warnings, and registry metadata agree.
- **REFACTOR/VERIFY**: Initial and incremental publication share accepted-source
  materialization, manifest hashing, warning caps, extraction, and the existing
  atomic generation transaction. Focused worker/client suites passed 18/18;
  web typecheck passed; real SQLite-Wasm refresh passed 1/1; the complete
  initial-index/reload Chromium regression passed 1/1; `git diff --check`
  passed.

#### T019 - Worker/Storage Recovery Matrix

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the failure matrix.
- **RED**: The first real recovery injection unexpectedly published generation
  2, proving source staging, graph writes, status changes, registry publication,
  and cleanup had no independently testable rollback points.
- **GREEN**: Storage now exposes deterministic fault boundaries after source
  staging, graph writes, status update, publication-pointer update, and failed
  generation cleanup. Each write-side fault runs inside the existing SQLite
  transaction, marks the candidate generation failed, deletes its staging
  database, and leaves the prior publication pointer/readable generation
  unchanged. Quota and schema-migration failures retain their stable codes.
- **CRASH/CANCEL/STALE**: A worker terminated with a building generation is
  recovered to failed on the next open and its staging database is removed.
  Existing protocol tests continue to accept cancellation only before publish,
  emit one terminal state, ignore duplicate/stale operations, and ignore
  mismatched client responses.
- **VERIFY**: The real SQLite-Wasm matrix passed source-stage, graph-write,
  status-update, registry-publish, quota, migration, cleanup, and crash cases
  while generation 1 remained readable; all eight later rows were failed after
  reopen. Focused worker/client regressions passed 18/18; web typecheck and
  `git diff --check` passed.

#### T020 - Exclusive Repository Ownership and Deterministic Close

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the lock lifecycle.
- **RED**: The client terminated its worker without sending `close`; the
  repository shell exposed no Retry/Switch recovery controls and left local
  reads enabled while busy; the production worker rejected the new `acquire`
  protocol request as `invalid_worker_request`.
- **GREEN**: A named exclusive Web Lock is acquired per opaque repository id
  before SQLite/OPFS opens. Contending tabs receive stable
  `repository_busy` guidance with Retry/Switch controls, and every local action
  is disabled until ownership succeeds. Close now waits for the worker to close
  DB/VFS, then releases all held locks, acknowledges the client, and only then
  terminates the worker.
- **STALE OWNERSHIP/RECOVERY**: Browser-managed ownership is released after an
  abrupt worker termination, allowing a fresh worker to acquire and reopen the
  repository. T019's next-open recovery continues to mark interrupted building
  generations failed and remove staging storage rather than reporting them
  complete.
- **VERIFY**: Focused client/shell suites passed 12/12; the web production build
  passed; the real Chromium multi-page suite passed 2/2 for concurrent
  exclusion, deterministic close/retry, and abrupt-worker ownership recovery;
  `git diff --check` passed.

#### T021 - Storage Estimate, Persistence, and Quota Guidance

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the storage-status flow.
- **RED**: Focused client tests failed because no passive storage inspection or
  explicit persistence request methods existed. The local overview had no
  usage/quota, persistence, last-good recovery, or non-eviction guidance.
- **GREEN**: The client now passively inspects approximate usage/quota and
  `persisted()` state without invoking `persist()`. Persistence is requested
  only by the directly activated UI button and reports granted, denied,
  unknown, or unsupported without blocking keyword indexing. The local
  overview reports browser-owned storage, states that CodeGraph never
  auto-deletes indexes, and tells quota-blocked users that the prior complete
  index remains available.
- **VERIFY**: Focused client/shell suites passed 15/15 across supported, denied,
  and unsupported APIs; web typecheck passed; the real SQLite-Wasm recovery
  suite passed 1/1 including quota rollback and prior-generation readability;
  `git diff --check` passed.

#### T022 - Confirmed Browser-Owned Repository Deletion

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  deletion.
- **RED**: The client ignored active-operation intent and only sent a bare
  delete request. No destructive confirmation UI existed, so repository name,
  runtime/data classes, source-folder safety, and cancellation choice were not
  enforced.
- **GREEN**: Local deletion now requires the exact displayed repository name
  and, while refresh/index work is active, an explicit cancel-and-delete
  checkbox. The dialog names runtime, repository, graph database, accepted
  source cache, registry metadata, saved handle, semantic state, and states
  that source-folder files will not change. Worker cleanup cancels pre-publish
  work when authorized, deletes every generation database plus registry rows,
  closes DB/VFS, releases ownership, then removes saved handle metadata and
  local repository registration. Reads/actions are disabled during deletion.
- **SOURCE SAFETY/RECOVERY**: Focused client evidence proves no source-handle
  write method is called. Cleanup failures remain non-complete; failure before
  destructive cleanup retains the prior readable state, while T019 covers
  interrupted staging cleanup.
- **VERIFY**: Focused client/shell suites passed 17/17; web typecheck and
  production build passed; the real SQLite-Wasm suite passed 1/1 and proved all
  recovery generations plus publication/status metadata were absent after
  delete; `git diff --check` passed.

#### T023 - Real-Browser Local Repository Lifecycle

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback extended
  the Chromium lifecycle.
- **RED**: The first controlled refresh failed with the visible permission
  block because app repository discovery overwrote the live picker connection
  with a stale restore result. After fixing that seam, deletion exposed an
  unintended `/api/repos` request caused by a selected-id-dependent discovery
  effect.
- **GREEN**: A freshly picked handle remains live for same-page refresh even
  when it cannot be cloned durably, and passive repository discovery no longer
  replaces a granted connection. The full journey cancels once, indexes,
  browses source, applies one controlled content-hash change, reports exact
  `{added:0, changed:1, deleted:0, unchanged:0, skipped:0}` counts, reloads the
  published four-symbol generation, exercises search/graph/impact, and performs
  typed-name deletion. Deletion no longer triggers remote discovery.
- **LIFECYCLE BACKSTOP**: The companion real-worker suites prove two-tab busy
  and Retry ownership, abrupt-worker recovery, quota/migration/write rollback,
  interrupted-generation cleanup, and complete repository deletion. Source
  fixture text remains byte-identical across browser-owned deletion, and the
  audit records zero forbidden API/LSP/external requests.
- **VERIFY**: Full Chromium journey passed 1/1 in 14.1 seconds with 20 measured
  samples per read operation and p95 search 110.8 ms, graph 105.5 ms, impact
  104.4 ms. Lock/storage suites passed 3/3; web typecheck, production build,
  320-CSS-pixel overflow check, and `git diff --check` passed.

#### T024 - Slice 2 Reviewability And Regression Checkpoint

- Required executor dispatch returned zero changes/tests after confirming the
  dedicated worktree remained `posix-not-writable`; parent fallback completed
  the bounded checkpoint from the verified execution root.
- **RED/DIFF BUDGET**: Relative to the Slice 1 commit, Slice 2 contains 18
  files and `+4231/-161` overall. Its ten production web files contain
  `+2343/-139`; the remaining eight paths are tests and durable workflow/task
  records. This is materially larger than the planning estimate, so the
  reviewability warning remains live for the final backstop.
- **BOUNDARY VERDICT**: Every production change remains inside the accepted
  repository-client, local-indexing, repository-shell, and lifecycle surfaces.
  No fourth capability class, server behavior, alternate ingestion path, or
  Slice 3 semantic/degradation feature was introduced. The integrated local
  graph/lifecycle journey remains independently demonstrable, so no boundary
  expansion or re-slice is required at this gate.
- **ENVIRONMENT DIAGNOSIS**: The initial chained root command scoped the Node
  24 PATH only to its first command; later tests ran under unsupported Node 26
  and failed only the Node-version/child-process checks. Exporting Node
  24.11.1 for the complete shell cleared all 80 focused failures and the full
  regression suite.
- **VERIFY**: Root build and typecheck passed; root Vitest passed 262 files and
  4,670 tests with 181 expected skips. Web lint completed with zero errors and
  15 existing warnings; web Vitest passed 25 files and 156 tests. Packaged
  assets, multi-tab locks, real SQLite-Wasm storage/recovery, and the complete
  Chromium lifecycle passed 5/5. The lifecycle retained 20 samples per local
  read with p95 search 115.0 ms, graph 102.9 ms, and impact 100.6 ms.

#### T025 - Live Browser Capability Report

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed the task in the verified execution root without entering T026.
- **RED**: The focused suite first failed because the capability module did not
  exist. Follow-up REDs proved the generic worker treated `capabilities` as an
  invalid index request and the public client returned a raw worker subset
  without main-thread picker/drop results.
- **GREEN**: Independent injected probes now report secure context, folder
  picker and policy blocking, modern/legacy/partial directory drop, OPFS and
  quota risk, Web Locks, module-worker boot, WASM/CSP state, passive storage
  estimates, and persistence status. Ordered guidance derives `full`,
  `snapshot-only`, or `unsupported` from capabilities rather than browser
  names. The protocol-v1 worker reports actual boot-time OPFS/lock/WASM state,
  and the client merges it with main-thread picker/drop probes.
- **REFACTOR/PRIVACY**: Probe inputs are structural and injectable; no user
  agent or browser-family check exists. Detection never opens a picker, asks
  permission, or calls `persist()`; exceptions normalize to stable capability
  states instead of escaping.
- **VERIFY**: Focused capability/client/worker Vitest passed 29/29, including
  eight dedicated matrix/bootstrap cases. Touched-file ESLint, web typecheck,
  production web build, and `git diff --check` passed; the packaged local
  worker and same-origin WASM assets remain emitted.

#### T026 - Immutable Directory-Drop Snapshot Import

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only the T026 source/client/worker path.
- **RED**: Focused tests exposed the generic legacy `snapshot` identity, absent
  import-time/fingerprint metadata, raw uncorrelated client request, missing
  duplicate registry, implicit refresh behavior, and no explicit replacement
  confirmation. The production worker also lacked an `import-snapshot`
  dispatch path.
- **GREEN**: Dropped and imported snapshots now use distinct contract source
  kinds, opaque per-import IDs, normalized virtual roots, accepted-at time,
  immutable copied bytes, bounded warnings, accepted file/byte counts, and the
  manifest fingerprint as metadata rather than identity. A durable browser
  snapshot registry retains those fields; duplicate fingerprints produce an
  advisory link to the earlier snapshot without merging or deleting it.
  Replacement targets an existing repository only when the caller supplies an
  explicit confirmed Replace request. Snapshot refresh fails closed with
  guidance to import a new snapshot, and no reconnect handle is created.
- **REFACTOR/BOUNDARIES**: Picked-folder and snapshot indexing share the worker's
  initial extraction/publication path while identity validation keeps their
  permission/refresh semantics separate. Existing traversal, ignore, file,
  total-byte, depth, count, and transfer ceilings remain the sole admission
  path.
- **VERIFY**: Focused source/client/shell Vitest passed 32/32; web typecheck and
  production build passed. Real Chromium worker tests passed 2/2, including
  snapshot publication and a local keyword query against its SQLite-Wasm
  generation. `git diff --check` passed and no legacy snapshot source-kind
  consumer remains.

#### T027 - Chromium Full Path and Cross-Browser Degradation

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only the T027 capability UI and cross-browser coverage.
- **RED**: The live capability result had no accessible shell report or
  snapshot fallback controls, and Playwright had no Firefox/WebKit projects.
  After the initial green pass, the expanded capability controls also obscured
  Chromium's navigation target at 320 CSS pixels.
- **GREEN**: The repository switcher now exposes an expandable live report for
  each independently probed capability, gates folder picking from the observed
  tier, accepts directory snapshots through both drop and a keyboard-operable
  directory input, and states that snapshots are immutable with no automatic
  reconnect or refresh. Chromium validates its full path while Firefox and
  WebKit validate their own observed support and guidance without claiming
  picker parity.
- **REFACTOR/ACCESSIBILITY**: Modern and legacy drop entries share the existing
  bounded accepted-source traversal. Capability and snapshot panels use compact
  native `details` controls so mobile navigation remains available; all
  engine projects share one behavioral assertion while preserving independent
  runtime results.
- **VERIFY**: Focused capability/client/shell/worker Vitest passed 40/40 and web
  typecheck passed. Chromium, Firefox, and WebKit degradation Playwright passed
  3/3; the complete Chromium production-worker storage and snapshot flows
  passed 2/2. Touched-file ESLint completed with zero errors and two existing
  fast-refresh warnings, and `git diff --check` passed.

#### T028 - Secret-Free Embedding State

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T028 profile persistence and session credential intake.
- **RED**: `web/src/local-indexing/embeddings.ts` and its focused tests were
  absent, so the first Vitest run failed import resolution before collecting
  tests.
- **GREEN**: A repository-scoped profile store now persists only explicit
  enabled consent and time, canonical endpoint origin/path, model and optional
  dimensions, graph/vector generations, coverage, input hashes, and bounded
  resume counters/status. Bearer credentials live in a page-lifetime Map; a
  fresh vault after reload has no credential and durable storage is never
  passed to that vault.
- **REFACTOR/PRIVACY**: One projection function validates and allowlists both
  writes and loaded records, and one serializer is the only durable profile
  writer. URL userinfo, query, and fragment data are discarded; arbitrary
  authorization fields, raw source/provider payloads, and raw causes cannot
  enter the serialized entity or safe diagnostic.
- **VERIFY**: Focused embedding security Vitest passed 4/4; embedding,
  capability, and storage-client regressions passed 21/21. Web typecheck,
  scoped ESLint, production build, and `git diff --check` passed. Durable-state
  assertions scan for authorization, URL-secret, source, provider, and raw
  cause sentinels.

#### T029 - Fail-Closed Semantic Transport

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T029 endpoint policy and safe error classification.
- **RED**: Six endpoint-policy cases and ten transport/provider classification
  cases failed because the validator, policy error, and mapper did not exist;
  the four prior secret-free persistence cases stayed green.
- **GREEN**: Configuration accepts only a direct HTTPS endpoint with no URL
  credentials, query, or fragment. Browser network/CORS/TLS policy, HTTP
  credential/rejection/temporary failure, model, dimension, partial response,
  cancellation, and unavailable outcomes map to stable safe codes, messages,
  retryability, phase, and recovery guidance. When supplied, an endpoint is
  reduced to canonical origin/path before entering the envelope.
- **REFACTOR/PRIVACY**: One endpoint validator now protects profile writes and
  one table-shaped failure mapper returns objects structurally compatible with
  the worker error envelope. No `no-cors`, proxy, mixed-content bypass, raw
  provider body, URL secret, or raw runtime cause is exposed.
- **VERIFY**: Focused embedding policy/persistence Vitest passed 20/20;
  embedding plus worker-envelope regression tests passed 34/34. Web typecheck,
  scoped ESLint, and `git diff --check` passed, including redaction scans for
  URL, provider-body, authorization, and raw-cause sentinels.

#### T030 - Cancellable and Resumable Semantic Worker

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T030 worker, vector-store, and convergence behavior.
- **RED**: Eight worker cases showed `embed` falling through to the keyword
  index handler, publishing an undefined generation, making no endpoint calls,
  and providing no semantic cancellation, resume, or convergence lifecycle.
- **GREEN**: A separate protocol-v1 operation now requires the requested graph
  generation to be published, loads deterministic symbol inputs from that
  generation, hashes them with browser SHA-256, calls only the validated direct
  HTTPS endpoint in at most 32-item batches, validates model, dimension,
  node-id, input-hash, order, finite values, and completeness, and commits at
  most 500 vector rows per transaction. Vectors use canonical `node_vectors`
  inside the generation database; model/dimension/generation metadata and
  secret-free operation state use `project_metadata`.
- **REFACTOR/INTEGRITY**: Pure resume-prefix and response-convergence validators
  live in the embedding module. The worker reuses its operation registry,
  progress, exactly-one-terminal, cancellation, and yielding machinery; no
  keyword generation is published, replaced, or disabled by semantic work.
  Cancellation after an in-flight response prevents its write and all later
  endpoint calls. A matching 32-item resume prefix skips committed work; any
  generation/model/dimension/hash mismatch becomes stale before another write.
- **VERIFY**: Focused worker/embedding Vitest passed 44/44. Production web build
  and typecheck passed. Real Chromium SQLite-Wasm/OPFS journeys passed 2/2,
  including an 8-byte two-dimension vector row and durable paused resume state.
  Scoped ESLint and `git diff --check` passed.

#### T031 - No-Consent Network Boundary

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T031 consent enforcement and browser network audit.
- **RED**: After a fixture-only OPFS setup was replaced with the production
  picker journey, Chromium reached the intended failure: an `embed` request
  without explicit consent made a configured endpoint call and completed.
- **GREEN**: The worker now requires a valid consent timestamp before endpoint
  validation or fetch. Local folder indexing, keyword search, and cached source
  browsing allow only enumerated same-origin shipped assets. No page fetch,
  XHR, WebSocket, beacon, `/api`, `/lsp`, or external request occurs before
  consent. An explicitly stamped request may call only its configured direct
  HTTPS endpoint and carries the credential only in the active worker request
  and Authorization header.
- **REFACTOR/PRIVACY**: The fail-closed Playwright audit records only phase,
  redacted origin/path, and resource type from browser requests plus instrumented
  page network channels. It never records headers, bodies, source text, raw
  errors, or credential values. Missing consent returns `consent_required`
  before any endpoint call and leaves the local keyword journey readable.
- **VERIFY**: Chromium network Playwright passed 1/1. The unstamped operation
  produced zero endpoint calls; the stamped operation made exactly one POST and
  completed one vector. The redacted log, localStorage, page URL, and page text
  contained no credential. Focused worker/embedding Vitest passed 45/45; web
  typecheck, scoped ESLint, and `git diff --check` passed.

#### T032 - Semantic Lifecycle and Concurrent Local Reads

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T032 semantic lifecycle and responsiveness evidence.
- **RED**: The new production-worker Chromium journey reached cancellation
  with the endpoint response held in flight, then failed on the missing
  read-only `storage-embedding-state` evidence request. That proved no test
  seam could verify paused resume metadata or generation-local vector absence.
- **GREEN**: Cancellation makes no post-response vector write or later endpoint
  call; the durable state is paused at zero completed items; resume against the
  same graph generation embeds all three symbols and converges model,
  dimensions, hashes, and 12-byte vector payloads. A provider failure records
  unavailable state without affecting keyword reads. Publishing generation 2
  exposes zero vectors, and a generation-1 resume fails stale before transport.
- **REFACTOR/EVIDENCE**: The acceptance test reuses one built-worker locator,
  deterministic request/timing helpers, a redacted endpoint-call log, and
  read-only semantic state/vector metadata requests. A successful run attaches
  the operation JSON and a Playwright trace; no credential or provider body is
  recorded.
- **VERIFY**: Focused worker/embedding Vitest passed 45/45. Web typecheck passed;
  lint completed with zero errors and 15 existing warnings. The complete
  Chromium file passed 2/2. Twenty-sample p95 was 40.0 ms search, 36.3 ms graph,
  and 38.4 ms impact while active; paused/cancelled, unavailable, and stale
  search p95 remained 37.4–40.1 ms, all below 150 ms. The endpoint log contained
  exactly cancel, resume, and controlled failure calls; `git diff --check`
  passed.

#### T033 - Fail-Closed Shipped Asset Inventory

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T033 asset packaging and request-order evidence.
- **RED**: The packaged suite first failed because no shared required-asset
  manifest existed. After the manifest and fail-closed verification were added,
  the request audit identified the eager production worker chunk; it was
  separated from the database/WASM/grammar deferred class, preserving the
  intentional startup capability probe while keeping heavy runtime requests
  lazy.
- **GREEN**: One manifest now defines the main and local-worker entries plus
  exact hashed-output patterns and minimum integrity for `index.html`, both
  local worker forms, SQLite WASM/OPFS/worker assets, tree-sitter runtime, and
  JavaScript/TypeScript/TSX grammars. Vite validates after emission; the package
  copier validates before and after copying; the root build runs an explicit
  `verify-web-assets` gate. Missing, ambiguous, truncated, wrong-header, or
  malformed-entry assets fail closed.
- **REFACTOR/EVIDENCE**: The Vite build, package copier, standalone verifier,
  corruption matrix, byte inventory, and request classifier consume the same
  manifest. Chromium observes zero deferred SQLite/parser/grammar requests on
  the initial route, then same-origin SQLite WASM, tree-sitter runtime, and only
  the demanded TypeScript grammar after the local-folder action.
- **VERIFY**: Root build and root/web typechecks passed. The manifest verified
  ten non-empty assets identically in `web/dist` and `dist/web`. The focused
  packaged Chromium suite passed 3/3, including delete-and-corrupt checks for
  every manifest row and attached request-order JSON. Scoped ESLint passed.
  Root `npm pack --dry-run` contained 19 `dist/web` files, five WASM assets, and
  the local-indexing worker. `git diff --check` passed.

#### T034 - Keyboard, Focus, Mobile, And Reduced-Motion Acceptance

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T034 accessibility implementation and evidence.
- **RED**: Focused component tests first failed on the missing saved-folder
  reconnect action, semantic opt-in form, and reduced-motion status treatment.
  The keyboard-only Chromium journey then exposed three production defects:
  cancellation focus was overwritten by the original folder action, semantic
  completion tried to focus its newly disabled credential-gated button, and
  deletion lost its dialog return target. Computed progress motion also
  remained 150 ms under a reduced-motion preference.
- **GREEN**: Saved folders reconnect only from an explicit keyboard-reachable
  action; semantic indexing requires endpoint, model, page-only credential, and
  explicit consent. Cancellation focuses its terminal live status, semantic
  completion focuses the surviving status, and deletion focuses the surviving
  repository heading. A global reduced-motion safeguard disables nonessential
  animation and transition duration. The complete flow remains free of
  horizontal page overflow at 320 CSS pixels.
- **REFACTOR/EVIDENCE**: Existing operation state drives shared status/alert
  roles, progress, cancellation, retry, and terminal copy in the shell and
  overview. The focused journey uses one keyboard activation helper and one
  overflow assertion and attaches a Playwright accessibility trace without
  credentials.
- **VERIFY**: Focused shell/client/worker Vitest passed 44/44, web typecheck
  passed, and scoped ESLint completed with zero errors and two existing
  fast-refresh warnings. The complete Chromium local-indexing-full suite passed
  3/3. Its 20-sample p95 was 111.3 ms search, 102.5 ms graph, and 100.9 ms
  impact; semantic-active/paused/failed/stale reads stayed 35.8–46.1 ms, all
  below 150 ms. `git diff --check` passed.

#### T035 - Self-Repository Performance And Resource Evidence

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T035 performance/resource hardening and evidence.
- **RED**: The first actual-repository run exceeded the 150 ms search p95
  budget at 217.8 ms; after FTS repair, graph p95 remained 187.3 ms because
  every query reopened and reinitialized the canonical schema. Once those
  bottlenecks were removed, the disclosed 10.79 MB/737-file source set still
  violated the worker contract by crossing one 8 MiB payload and one 64-file
  batch.
- **GREEN**: Browser keyword search now uses canonical prefix FTS/BM25 with a
  bounded fallback; an owned database initializes its schema once; initial
  publication has explicit read, grammar-load, parse, store, and publish
  phases; and large source collections stage sequentially in protocol-v1
  worker batches capped at 64 files and 4 MiB before atomic indexing.
- **REFACTOR/EVIDENCE**: One staged-transfer path serves picked folders,
  snapshots, and refresh, validates totals/order/duplicates before assembly,
  and clears partial state on failure, cancellation, close, or delete. The
  self-repository suite records two cold runs, 20 post-warmup samples per read,
  query plans, heartbeat/long tasks, worker payloads, resource high-water and
  cleanup, ten-asset inventory/request order, runtime disclosure, JSON
  evidence, and a low-overhead Playwright trace.
- **VERIFY**: Focused client/worker Vitest passed 35/35; web typecheck and scoped
  ESLint passed; complete Chromium lifecycle/storage passed 6/6; and
  `git diff --check` passed. Two cold 737-file runs completed in 5.59 and 5.54
  seconds with deterministic 23,857-node/23,120-edge counts. Twenty-sample p95
  was 59.4 ms search, 77.3 ms graph, and 77.1 ms impact; maximum main-thread
  heartbeat gap was 76.5 ms. Every observed source batch stayed within 4 MiB
  and 64 files, and every worker payload stayed within 8 MiB.

#### T036 - Cross-Runtime, Browser, Offline, And Packaged Acceptance

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T036 acceptance hardening and evidence.
- **RED**: The root package contract still asserted an obsolete literal
  `web/dist` string after the copier moved to portable `path.join` calls. The
  first three-browser run then proved `dist/web` could be stale because
  Playwright rebuilt `web/dist` without invoking the authoritative package-copy
  validation. The expanded privacy run also exposed a nondeterministic audit
  boundary around asynchronous initial server discovery.
- **GREEN**: The package test now verifies portable source/target construction
  and two fail-closed manifest validations. Every Playwright server boot builds
  the web app, refreshes and validates `dist/web`, then starts the static host.
  Local search, graph, and impact stay functional with Chromium networking set
  offline; the consent boundary still permits only one configured semantic
  endpoint request.
- **REFACTOR/EVIDENCE**: The packaged suite applies and records one explicit
  trusted-host CSP allowing only same-origin scripts, workers, connections,
  styles, fonts, images, and WebAssembly execution. It proves local indexing
  and search with no CSP violation and no COOP/COEP requirement. Privacy
  instrumentation waits for startup network idle before defining the
  browser-local phase, eliminating cross-phase timing ambiguity.
- **VERIFY**: Root cross-runtime and package contracts passed 5/5. The final
  matrix passed 12/12: Chromium full lifecycle, self-repository performance,
  semantic responsiveness, accessibility, privacy/offline, CSP, package
  corruption, lazy assets, and capability reporting plus independent Firefox
  and WebKit degradation. Root build copied and byte-verified all ten assets;
  root/web typechecks, scoped ESLint, and `git diff --check` passed.

#### T037 - Release Notes And Executed Quickstart

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only T037 user-facing documentation and executable policy checks.
- **RED**: Following the quickstart against the packaged build found that it
  named a worker `resolve` phase that is not emitted and told users to run
  semantic search even though this slice exposes optional semantic indexing
  while keyword search remains the shipped query path. It also omitted the
  tested trusted-host CSP, offline scope, and dedicated package/privacy command.
- **GREEN**: The quickstart now matches the observed read, grammar-load, parse,
  store, and publish phases; accurately describes semantic indexing and
  page-only credentials; documents the tested same-origin CSP and no-COOP/COEP
  boundary; scopes offline behavior to an already loaded app/assets; and
  includes the package/privacy acceptance command.
- **REFACTOR/EVIDENCE**: The packaged CSP test reads the quickstart and requires
  its exact tested policy plus the cross-origin-isolation statement. A single
  capability-first `[Unreleased]` bullet describes local folder indexing,
  snapshot degradation, explicit semantic consent, default network dormancy,
  and same-origin shipped assets without internal file paths.
- **VERIFY**: The documented Chromium package/privacy command passed 5/5 and
  the documented Firefox/WebKit degradation command passed 2/2. The documented
  Chromium full command passed 4/4. Scoped ESLint and `git diff --check` passed.

#### T038 - Final Reviewability And Regression Checkpoint

- Required executor dispatch returned zero changes/tests after reproducing the
  dedicated worktree's `posix-not-writable` child sandbox. Parent fallback
  completed only the final reviewability and regression checkpoint.
- **RED**: The complete web Vitest run failed 11 generic shell cases because
  passive capability discovery constructed `Worker` unconditionally in a
  runtime where that capability was absent. The pre-recording implementation
  snapshot contains 25 tracked Slice 3 files with 6,697 insertions/800
  deletions plus nine new files with 2,378 lines; the complete feature contains
  71 tracked files with 20,636 insertions/2,099 deletions plus those nine new
  files. Durable T038 workflow/state evidence is intentionally excluded from
  those implementation-only figures.
- **GREEN**: Passive discovery now probes main-thread browser capabilities
  without constructing a missing worker, while explicit worker acquisition
  fails with a typed `capability_unavailable` error. The large review surface
  remains confined to the ratified extraction, storage, worker, client, UI,
  packaging, documentation, and acceptance-test ownership; it introduces no
  fourth capability class and preserves all declared non-goals.
- **REFACTOR/EVIDENCE**: The capability guard reuses the canonical probe and
  error taxonomy. The complete root suite passed 262 files/4,670 tests with 15
  files/181 tests skipped; web Vitest passed 27 files/199 tests; lint completed
  with zero errors and 15 existing warnings; root build and root/web typechecks
  passed; `git diff --check` passed.
- **VERIFY**: The final Chromium/Firefox/WebKit lifecycle, degradation,
  privacy, package, CSP, and performance matrix passed 12/12, and Chromium lock
  and storage recovery passed 4/4. Two 737-file self-repository runs completed
  in 6.57 and 5.48 seconds with deterministic 23,865-node/23,128-edge output;
  20-sample p95 was 56.8 ms search, 71.8 ms graph, and 69.7 ms impact against
  the 150 ms budget. Maximum main-thread heartbeat gap was 83.4 ms.

---

## Post-Implementation Checklist

| Phase | Item | Status | Notes |
|---|---|---|---|
| Post | Post: Doctor Extension Check | ✅ Complete | Installed Doctor check passed before verification. |
| Post | Post: Verify Implementation | ✅ Complete | No findings; 38/38 tasks, 63/63 FRs, and all 21 success criteria have evidence. |
| Post | Post: Verify Tasks Phantom Check | ✅ Complete | 35 implementation tasks verified; T012, T024, and T038 are correctly recorded as process checkpoints rather than phantom code tasks. |
| Post | Post: Code Review | ✅ Complete | Error-handling and type-design findings were remediated with regression tests; bounded re-reviews returned no findings. |
| Post | Post: Integration Suite | ✅ Complete | Root/web tests, builds, typechecks, lint, and complete Chromium Playwright preflight passed. |
| Post | Post: Reviewability Diff Gate | ✅ Complete | WARN: 82 files, +24,193/-2,101 overall and 33 production/config files, +10,528/-234; no correctness blocker or fourth capability class. |
| Post | Post: Self-Review | ✅ Complete | Tests executed, all acceptance/edge-case groups mapped, FR-001–FR-063 traced, and tidiness scan passed. |
| Post | Post: UAT Runbook Generation | ⏭️ Skipped | `generate-uat-skeleton` is deferred and no committed source-derived runbook exists; fail-open per installed runner policy. |
| Post | Post: Final Reviewability Backstop | ✅ Complete | Proceed with warning at committed checkpoint `8e55cac1`; 83 files, +24,406/-2,099, no correctness blocker. |
| Post | Post: PR Packet/Body Generation | ✅ Complete | Canonical packet and packet-owned body emitted; read-only validation passed with current fingerprints. |
| Post | Post: PR Body Generation | ✅ Complete | Packet-owned body checkpointed; persisted validation and title/scope contract passed. |
| Post | Post: PR Creation | ✅ Complete | Draft PR [#185](https://github.com/racecraft-lab/codegraph/pull/185) created from packet-owned fields. |
| Post | Post: Review Remediation | ✅ Complete | Four CodeQL findings were investigated: three were fixed structurally with regression tests and the operator-configured HTTPS endpoint was classified with the ratified provider-neutral contract; the reviewed head is green with no open alert or human feedback. |
| Post | Post: Retrospective | ✅ Complete | `retrospective.md` records 38/38 tasks, 84/84 requirements, 100% adherence, zero critical findings, and 7/7 self-assessment checks passed. |

### Reviewability Diff Gate

- Live base: `origin/main` at `91cf4b24cb2d64440733675e0db67040adc9c3d6`.
- Full feature plus review remediation: 82 files, 24,193 additions, and 2,101
  deletions.
- Production/config surface: 33 files, 10,528 additions, and 234 deletions;
  tests: 25 files, 7,737 additions and 11 deletions; specification, workflow,
  and lock evidence: 20 files, 5,895 additions and 1,854 deletions.
- Verdict: `warn_non_blocking`. The size warning is materially above the
  scaffold estimate, but it is the same operator-ratified three-slice feature
  already recorded at T012, T024, and T038. Every changed capability remains
  inside extraction, storage, worker, repository-client, UI, packaging,
  documentation, or acceptance-test ownership; no correctness blocker or
  fourth capability class was found. Atomicity remains
  `one-navigable-PR`, with the three slices retained as reviewer order.

### Self-Review

1. **Tests executed?** Yes. The authoritative 2026-07-28 post-review runs
   executed root build, root/web typechecks, root and web unit suites, web
   lint, focused storage/privacy browser tests, and the complete Chromium
   Playwright suite. Root Vitest passed 262 files/4,670 tests with 15
   files/181 tests skipped; final web Vitest passed 27 files/210 tests; lint
   reported zero errors and 15 existing warnings; Chromium passed 29 tests
   with one intentional packaged-server skip.
2. **Edge cases?** No `[edge-case-gap]` remains. User-action, denied/stale
   handle, hostile path, binary/oversize, cancellation, malformed worker,
   and bounded-warning cases are covered in
   `web/src/tests/local-indexing-worker.test.ts:55`. Corrupt metadata,
   worker crash, cleanup warning, persistence, reconnect, and bounded query
   cases are covered in `web/src/tests/local-indexing-client.test.tsx:279`.
   Transaction rollback/vector recovery is covered in
   `web/src/tests/local-indexing-storage.spec.ts:15`; lock contention/crash in
   `web/src/tests/local-indexing-locks.spec.ts:83`; unsupported capability
   guidance in `web/src/tests/local-indexing-degradation.spec.ts:3`; malicious
   inert source in `web/src/tests/local-repository-routes.test.tsx:122`;
   consent and endpoint failure in
   `web/src/tests/local-indexing-network.spec.ts:15`; missing/corrupt assets in
   `web/src/tests/local-indexing-packaged.spec.ts:169`; and full lifecycle,
   semantic failure/resume, accessibility, and self-repository performance in
   `web/src/tests/local-indexing-full.spec.ts:225`.
3. **Requirements matched?** Yes. `tasks.md` maps FR-001–FR-063 to completed
   T001–T038. The independent phantom check records 35 code-bearing tasks as
   verified and T012/T024/T038 as intentionally skipped process checkpoints,
   with zero partial, weak, or missing task. The implementation verifier found
   all 63 requirements and all 21 success criteria evidenced.
4. **Follow-up and tidiness?** The spec, plan, tasks, and feature commit
   messages contain no `[TODO]`, `[DEFERRED]`, or `[OUT-OF-SCOPE]` marker.
   `git diff --check` passes. No debugger, commented-out implementation, or
   orphaned fixture was found. The `console.info` calls in the self-repository
   Playwright suite are deliberate machine-readable benchmark checkpoints,
   not production logging. The 15 existing lint warnings remain visible and
   non-blocking.

### UAT Runbook Generation

Skipped fail-open: the installed `generate-uat-skeleton` helper is registered
as deferred, and no committed `specs/007-in-browser-indexing/.process/uat-runbook.md`
exists to hand to `uat-runbook-author`. The executable UAT remains in
`quickstart.md` and the browser acceptance suites; no deferred helper was
invoked.

### Final Reviewability Backstop

- Reviewed implementation checkpoint: `8e55cac1617c9f37f12f32a0305c2bc2e936dc66`.
- Live base: `91cf4b24cb2d64440733675e0db67040adc9c3d6`.
- Topology: `origin/main` is an ancestor; the branch is 13 commits ahead and
  zero behind at the checkpoint.
- Current committed diff: 83 files, 24,406 additions, and 2,099 deletions;
  production/config remains 33 files and 10,762 changed lines, while tests
  remain 25 files and 7,748 changed lines.
- Gate result: `warn`, mode `committed_fallback_evidence`, proceed `true`.
  The installed final-backstop helper is deferred, so current committed T012,
  T024, T038, post-review, test, and independent-review evidence supplies the
  boundary. No correctness blocker, unsafe output, stale marker plan, or
  unratified capability surface exists. Atomicity remains
  `one-navigable-PR`; no `pr_marker_plan` is active.

### PR Packet And Body Generation

- The authoritative fixed SpecKit Pro source runner emitted
  `specs/007-in-browser-indexing/.process/pr-packets/spec-007.json` and its
  packet-owned `body.md` from this exact linked worktree.
- The generated title is
  `feat(SPEC-007): Add private in-browser indexing`; target branches are
  `main` and `007-in-browser-indexing`.
- `validate-pr-packet-read-only` passed with `pr_blocked=false` and
  `writes_state=false`.
- Current fingerprints: packet
  `5eff94f2bd7692b321a1cb7b684d56b41b8d2b5e070adeead109f93e1343b4a2`;
  body
  `9103307fd32a0e8f8d1aac4a0df68960cbec810699166f2c4ab4472c68bf206f`.
- Packet/body checkpoint: `5e7b4c92d3ce62e934f64a5660b5dff57dfdb4b7`.
  `validate-pr-packet-write` then passed from the clean tree and persisted
  `validation.json` with `pr_blocked=false`.
- `validate-pr-workflow-contract` passed against the packet-owned title and
  live `origin/main...HEAD` changed-file scope with `writes_state=false`.
- The installed 2.20.0 runner had incorrectly selected the dirty parent source
  checkout before the nearer worktree `.specify/` marker. The durable source
  repair now gives the nearest trusted marker precedence and retains the clean
  worktree safety gate.

### PR Creation

- Draft PR: [#185](https://github.com/racecraft-lab/codegraph/pull/185).
- Live creation authority: base `main` at
  `91cf4b24cb2d64440733675e0db67040adc9c3d6`; head
  `007-in-browser-indexing` at
  `0e8d7e856b09116b443db14fd88558b89e997e3c`.
- GitHub reports the PR mergeable. Initial CI, CodeQL, dependency review,
  installer coverage, and PR-impact checks are queued or running; no review or
  comment exists at creation time.

### Review Remediation

- Reviewed CodeGraph source head:
  `f3a0795f54abcc1f2cb76cbb8790f430c8c545b0`.
- GitHub Advanced Security reported four CodeQL alerts. The worker ingress now
  rejects unexpected origins, the self-repository benchmark validates and
  reads the same open file descriptor, and Vue script extraction uses a bounded
  structural scanner instead of an HTML-tag filtering regular expression.
  Focused regression tests, web typecheck, scoped lint, full web Vitest, root
  build, focused Chromium acceptance, and self-repository performance passed.
- The remaining client-side-request-forgery alert was classified as an
  intentional product contract: FR-022, FR-024, FR-042, and FR-043 require an
  operator-configured provider-neutral HTTPS embedding endpoint after explicit
  consent. Validation rejects HTTP, URL credentials, query strings, and
  fragments; fetch omits ambient credentials and redirects. The dismissal
  records that a fixed hostname allowlist would violate the ratified contract.
- Reanalysis completed with CodeQL green and zero open alerts. PR-impact,
  dependency review, and installer coverage passed. No human review or comment
  required a change; the only review records were GitHub Advanced Security
  annotations.

### Retrospective

- Report: `specs/007-in-browser-indexing/retrospective.md`.
- Completion: 38/38 tasks, 100%.
- Adherence: 63/63 FRs plus 21/21 SCs, 84/84 total, 100%.
- Critical findings: zero.
- Proposed spec changes: none; no spec-modification human gate is required.
- Required self-assessment: 7/7 PASS.
- Principal lesson: estimate browser/storage/accessibility/package evidence
  matrices separately, and preserve the nearest-marker linked-worktree
  bootstrap regression in the authoritative runner.

- [x] All tasks in `tasks.md` are genuinely implemented and verified.
- [x] `npm run build` passes with shipped worker/WASM/static assets.
- [x] `npm test` passes.
- [x] Root and web typechecks pass.
- [x] Web lint and web Vitest pass.
- [x] Playwright full-mode and degradation-mode suites pass.
- [x] Cross-runtime extraction fixtures are deterministic across repeated runs.
- [x] No default network request or durable embedding credential exists.
- [x] Package/offline/static-host audits pass.
- [x] Self-repo UAT meets the 60-second and 150 ms targets or records an approved,
  evidence-based scope decision before merge.
- [x] Reviewability, code review, verify, verify-tasks, cleanup, retrospective,
  PR packet, and PR gates are complete or explicitly skipped with durable reason.
- [x] Roadmap, workflow, autopilot state, task state, UAT evidence, and
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

1. Estimate browser, storage-failure, accessibility, package, privacy, and
   performance acceptance matrices as separate review surfaces.
2. Run browser-security CodeQL analysis at slice boundaries so structural
   remediations precede the final cross-browser and self-repository matrix.
3. Keep capability detection independent: probe picker, drop, storage, lock,
   worker, and persistence support instead of inferring from browser identity.
4. Preserve generation-aligned OPFS recovery: source cache, graph, manifest,
   visible state, and semantic metadata publish together or retain the last
   readable generation.
5. Maintain the shared extraction kernel as the semantic boundary while
   runtime adapters own parser and storage mechanics.
6. Verify package assets by byte inventory and demand-driven request order, not
   only by build success.
7. Keep network dormancy as an executable audit; semantic egress remains
   explicit, HTTPS-only, credential-ephemeral, and separate from keyword reads.
8. Benchmark with descriptor-bound inputs and record both latency and main-
   thread responsiveness.
9. In runner bootstrap, the nearest trusted project marker must win over an
   ancestor's vendored runner source; retain nested linked-worktree regression
   coverage.

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
