# SpecKit Workflow: SPEC-014 — Control-Flow Graphs

**Template Version**: 1.0.0
**Created**: 2026-07-24
**Purpose**: Prepare and execute deterministic, opt-in, per-function CFG
analysis for TypeScript, JavaScript, and Python on branch
`014-control-flow-graphs`.

---

## Design Concept

This workflow was enriched from the required 28-question Grill Me interview
completed during `$speckit-pro:speckit-scaffold-spec SPEC-014`.

The full decision log, goals, non-goals, accepted scope expansion, and
reviewability decision live at:

```text
docs/ai/specs/.process/SPEC-014-design-concept.md
```

Re-read that file before every phase. It is the source of truth for the
decisions captured during scaffold, especially the conservative unsupported
function policy, persisted lifecycle, exact machine-surface parity, and accepted
two-slice decomposition. Grill Me is complete and is not part of autopilot;
later ambiguity is handled by `/speckit-clarify` and the consensus path.

---

## Reviewability Budget & Split Decision

The roadmap originally projected 485 net-new reviewable LOC over approximately
six production files and suggested two slices. The final Grill Me scope adds
CLI and MCP reads, aggregate status, explicit lifecycle states, and complete
common expression semantics.

The shared `estimate-spec-size` runner was rerun with the final setup signals:
four independently testable user-story groups, eight production
files/surfaces, 24 functional-requirement signals, and net-new work.

```text
estimated_loc=780
suggested_slices=2
status=warn
```

The warning is advisory and remains below the setup-mode 800-LOC block
threshold. The maintainer accepted two thin vertical slices:

1. **Slice 1 — TypeScript/JavaScript end-to-end:** shared lowering IR and CFG
   builder, persistence/status lifecycle, activation and refresh wiring,
   TypeScript/JavaScript semantics, library read, CLI read, MCP pagination,
   aggregate status, and focused performance evidence.
2. **Slice 2 — Python parity:** Python lowering through the same persistence and
   read surfaces, including `match`/`case`, comprehensions, generators as
   ordinary operations, shared diagnostics, parity fixtures, and final
   cross-language/dogfood verification.

Plan must preserve that data-variation split. If either slice exceeds the
authoritative plan-phase reviewability gate, re-slice before implementation
rather than hiding the overage in a single PR.

### Template Resolution Record

Resolved from the SPEC-014 worktree on 2026-07-24:

- `spec-template` → `speckit-pro-reviewability v1.0.0`
- `plan-template` → `speckit-pro-reviewability v1.0.0`
- `tasks-template` → `codegraph-project-overrides v1.0.0`, an intentional
  higher-priority project override

---

## Workflow Overview

| Phase | Command | Status | Notes |
|---|---|---|---|
| Specify | `/speckit-specify` | ✅ Complete | 34 FRs, 4 stories, 22 scenarios, zero unresolved markers; G1 passed. |
| Clarify | `/speckit-clarify` | ✅ Complete | All three sessions and consensus rows complete; G2 passed with zero clarification markers. |
| Plan | `/speckit-plan` | ✅ Complete | Eight artifacts complete; constitution checks, reviewability estimate, and G3 passed. |
| Checklist | `/speckit-checklist` | ✅ Complete | 76 items passed; 6 documentation gaps remediated; G4 passed with zero gap markers. |
| Tasks | `/speckit-tasks` | ✅ Complete | 43 sequential test-first tasks; all 34 FRs covered; G5 passed. |
| Analyze | `/speckit-analyze` | ✅ Complete | 1 medium and 1 low finding remediated; strict rerun clean; G6 passed. |
| Implement | `/speckit-implement` | 🔄 In Progress | T001–T015 complete; Slice 1 / US1 Library CFG (T016) is active. |
| Post | Autopilot post-implementation | ⏳ Pending | Run every canonical verification, reviewability, UAT, PR, remediation, and retrospective item. |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates

| Gate | Checkpoint | Approval Criteria |
|---|---|---|
| G1 | After Specify | All stories and requirements are independently testable; no unresolved clarification marker remains. |
| G2 | After Clarify | Function states, edge kinds, lifecycle transitions, pagination, command/tool contracts, and language constructs are exact. |
| G3 | After Plan | Constitution checks pass; schema, two-slice file tables, migration, benchmark, and UAT are approved. |
| G4 | After Checklists | Every genuine gap is resolved in spec or plan; intentional exclusions are explicit. |
| G5 | After Tasks | Every requirement maps to an ordered task and each vertical slice has an independent verification gate. |
| G6 | After Analyze | No critical issue or design-concept drift remains; warnings have explicit dispositions. |
| Confidence Gate | G6.5 | Pre-Implement confidence is measured at the configured 0.90 threshold; advisory mode records remediation guidance without blocking. |
| G7 | After Each Slice | Focused tests, full build/test gates, reviewability checks, and required UAT evidence pass. |

---

## Prerequisites

### Worktree Binding

Run every phase from the dedicated SPEC-014 worktree. Before each phase:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --show-toplevel
```

The branch must be:

```text
014-control-flow-graphs
```

The top-level path must end in:

```text
/codegraph/.worktrees/014-control-flow-graphs
```

Do not run this workflow from `main`, a detached checkout, or the parent Codex
worktree.

### Bootstrap Status

The repository now documents this nested-worktree-safe preflight:

```bash
set -e
npm ci
npm run build
git_common_dir="$(git rev-parse --git-common-dir)"
main_env="$(dirname "$git_common_dir")/.envrc.local"
(
  set -a
  [ ! -f "$main_env" ] || . "$main_env"
  set +a
  node dist/bin/codegraph.js init .
  status_json="$(node dist/bin/codegraph.js status . --json)"
  node -e '
    const status = JSON.parse(process.argv[1]);
    const pending = Object.values(status.pendingChanges ?? {}).some(Boolean);
    const healthy =
      status.initialized === true &&
      status.index?.state === "complete" &&
      status.index?.reindexRecommended === false &&
      status.index?.pendingRefs === 0 &&
      status.worktreeMismatch === null &&
      !pending &&
      status.embedding?.coverage?.percent === 100 &&
      status.hybridSearchAvailable === true &&
      status.lsp?.enabled === true;
    if (!healthy) {
      console.error("CodeGraph preflight health check failed");
      process.exit(1);
    }
  ' "$status_json"
  node dist/bin/codegraph.js status .
)
```

The initial scaffold requested explicit approval twice, and the native picker
returned no selection, so the worktree was deliberately left unbootstrapped.
On 2026-07-24 the operator selected **Full repair** and authorized dependency
installation, build/index writes, and source-derived embedding requests to the
configured HAL endpoint. The approved recovery completed:

- `npm install` added 589 packages under Node 24.11.1. npm rewrote peer-only
  lockfile metadata; that generated churn was removed and the tracked worktree
  was clean before continuing. Future fresh-worktree runs use `npm ci`.
- `npm run build` passed and produced the worktree-local CLI plus shipped SQL,
  WASM, OpenAPI, and web assets without tracked changes.
- The first sandboxed `init` built the structural index but could not reach
  HAL. An approved network-enabled `sync` completed the embedding backfill.
- Final status: 875 files, 15,533 nodes, 65,503 edges, embedding coverage
  9,924/9,924 (100%), hybrid search available, LSP enabled, and the index up to
  date. Individual unsupported/degraded language servers remain advisory.
- The exact project MCP launcher was smoke-tested under Node 24.11.1;
  `tools/list` returned `codegraph_explore`. The current Codex desktop process
  has that NVM runtime ahead of Homebrew Node 26 on its inherited PATH.

Bootstrap is complete. Autopilot must still start in a **new Codex task rooted
at this SPEC-014 worktree** because the current task remains attached to the
outer detached checkout and cannot dynamically replace its MCP tool surface.

### Agent and Preset Evidence

- The installed Codex-agent dry run reported all ten required TOML files current,
  including `uat-runbook-author.toml`; mutation status was `no_op`.
- The SpecKit CLI is available at
  `/Users/fredrickgabelmann/.local/bin/specify` (`0.12.12.dev0` at scaffold).
- The three required templates resolve through the preset layers recorded above.

### Constitution Validation

Apply `.specify/memory/constitution.md` throughout:

| Principle | SPEC-014 Requirement | Verification | Phase 1 Status |
|---|---|---|---|
| I. Think Before Coding | Preserve Q1–Q28 as resolved decisions; surface only genuinely new ambiguities. | Traceability from spec, clarifications, and plan to the Design Concept | ✅ Verified |
| II. Simplicity First | Persist CFG metadata, not lowering instructions; use function IDs only; model no implicit exception or async scheduler flow. | Scope review and Complexity Tracking | ✅ Verified |
| III. Surgical Changes | Add the CFG module under `src/analysis/`; keep schema, index/config, CLI, and MCP edits focused. | Declared file-operation table and diff review | ✅ Verified |
| IV. Goal-Driven Execution | Start each semantic/lifecycle contract from a failing golden, SQLite, CLI, or MCP test. | Red-green-refactor task evidence | ✅ Verified |
| V. Deterministic, LLM-Free Extraction | Derive all blocks and edges from AST/static analysis; skip unsupported functions rather than inventing or truncating paths. | Re-index determinism, unsupported-function, and no-speculative-edge tests | ✅ Verified |
| VI. Retrieval Performance | Bound and paginate MCP output; review `src/mcp/` changes with retrieval-guardian. | MCP contract tests and retrieval-guardian verdict | ✅ Verified |
| VII. Local-First | Make no network calls; write no CFG rows while disabled; use only `node:sqlite`; ship schema assets through the existing build. | Dormancy, offline, migration, and packaged-asset tests | ✅ Verified |
| Dogfooding | Exercise CFG reads against this repository and record results in the UAT runbook. | Self-repo library/CLI/MCP parity probe | ✅ Verified |

**Constitution check at scaffold:** PASS for scoping. Re-run before and after
Phase 1 design during Plan.

### Scoped Instructions

Before planning or changing files, read the nearest guidance:

- `src/db/AGENTS.md`
- `src/mcp/AGENTS.md`
- `__tests__/AGENTS.md`
- any new `src/analysis/AGENTS.md` present at implementation time

Changes under `src/mcp/` require the repository's retrieval-guardian review.
Tests must use real files and real SQLite; do not mock the database.

### Capability Path

At initial scaffold time no `codegraph_explore` capability was exposed, and the
target worktree had no build or CodeGraph repository index. Local branch files,
Git history, and runner helpers supplied the fallback evidence. The approved
bootstrap later produced a 100%-embedded worktree-local index and an exact MCP
handshake exposing `codegraph_explore`; the active outer-root task cannot adopt
that server retroactively. Future phases must start from this worktree,
enumerate the live tool surface again, and prefer the repository's CodeGraph
capability when healthy.

Capability path: codebase/spec context → current worktree files and Git;
workflow gates → installed `speckit_pro_runner`; human decisions → native
`request_user_input`. Evidence: constitution, roadmap, current `src/analysis`
patterns, runner JSON outputs, and Q1–Q28. Confidence: medium for structural
codebase exploration because the required graph capability was unavailable;
high for repository state and recorded decisions.

---

## Specification Context

### Basic Information

| Field | Value |
|---|---|
| **Spec ID** | SPEC-014 |
| **Name** | Control-Flow Graphs |
| **Branch** | `014-control-flow-graphs` |
| **Dependencies** | None |
| **Enables** | SPEC-015 → SPEC-016 → SPEC-017 |
| **Priority** | P2 |
| **Primary surface** | Schema/migration plus analysis harness/adapters |
| **Accepted slices** | 2 — TypeScript/JavaScript end-to-end, then Python parity |
| **MCP tools** | 1 planned read tool, provisionally `get_cfg`; Clarify freezes its exact contract |
| **Design Concept** | `docs/ai/specs/.process/SPEC-014-design-concept.md` |
| **Workflow** | `docs/ai/specs/.process/SPEC-014-workflow.md` |
| **Spec MOC** | `specs/014-control-flow-graphs/SPEC-MOC.md` |

### Roadmap and Grill Me Scope

- Shared language-neutral lowering IR for statements, expressions, branches,
  loops, explicit exceptions, abrupt transfers, and multi-way control.
- TypeScript/JavaScript lowerer: if/else, loops, switch/fallthrough,
  try/finally, guard exits, short-circuit logic, conditional expressions,
  optional chaining, nullish coalescing, nested function boundaries, and
  disconnected unreachable blocks.
- Python lowerer: equivalent shared constructs plus `match`/`case`,
  comprehensions, and generator expressions; `await`/`yield` remain ordinary
  intra-procedural operations without suspension edges.
- Unsupported, parse-unsafe, or over-10,000-block functions write no partial
  CFG; persist a stable function status/reason code instead.
- Persist status, block role/source spans, and distinct typed edges. Keep
  lowering instructions in memory only. Block IDs are deterministic for
  identical source but may change when a function changes.
- Persist `analysis.cfg=true` through the CLI opt-in. First enable performs a
  full supported-function backfill; later syncs transactionally replace CFGs
  for affected files and remove deleted functions.
- Unexpected refresh failure retains the prior atomic snapshot as explicitly
  stale. Disabling keeps rows inert and unreadable until a fresh re-enable.
- Export one stateful found/miss contract through `getCfg(functionId)`, CLI
  JSON, and paginated MCP responses. Human CLI output may render differently.
- Add aggregate enabled/freshness/available/skipped counts to
  `codegraph status`.
- Enforce a paired-median enabled index-time overhead budget of at most 20% on
  the existing benchmark monorepo.

### Out of Scope

- Dataflow, reaching definitions, def-use, PDG, and taint work.
- Languages beyond TypeScript, JavaScript, and Python.
- Implicit exception inference.
- Async scheduler/suspension/resumption edges.
- Persisted lowering instructions or edit-stable semantic block matching.
- Function lookup by name or source position.
- REST endpoints and any write/mutation surface.
- Partial or truncated CFGs presented as usable results.

### Success Criteria Summary

- [ ] Disabled CFG analysis makes no network calls and writes no CFG status,
      block, or edge rows; existing indexing/query behavior remains unchanged.
- [ ] First enable backfills every supported function even with an empty change
      set; later sync/change/delete transitions are atomic and exact.
- [ ] Identical source produces byte-equivalent ordered CFG responses and stable
      block IDs across repeated re-indexing.
- [ ] TypeScript/JavaScript and Python golden fixtures cover every accepted
      construct and nested/unreachable boundary.
- [ ] Unsupported, parse-unsafe, and over-limit functions return explicit,
      deterministic success-shaped states with no partial rows.
- [ ] Library, CLI JSON, and MCP responses pass exact shared-contract parity;
      MCP pages reconstruct the complete ordered CFG without overlap or gaps.
- [ ] `codegraph status` reports enabled/freshness state plus available and
      skipped function counts without listing sensitive or unbounded diagnostics.
- [ ] Enabled paired-median index overhead is at most 20% on the committed
      benchmark fixture; disabled-path behavior remains within normal noise.
- [ ] `npm run build`, focused suites, and `npm test` pass under supported Node.
- [ ] Self-repo UAT retrieves a real TypeScript function CFG through library,
      CLI, and MCP and proves parity; Python parity is demonstrated with a
      committed fixture.

---

## Phase 1: Specify

**When to run:** Start of the feature workflow. Define WHAT and WHY, not the
implementation. Output: `specs/014-control-flow-graphs/spec.md`.

### Specify Prompt

```text
/speckit-specify

## Feature: SPEC-014 Control-Flow Graphs

Create an implementation-independent specification for deterministic, opt-in,
per-function CFGs for TypeScript/JavaScript and Python. Treat
docs/ai/specs/.process/SPEC-014-design-concept.md as the source of truth.

Define four independently testable user-story groups:
1. enable CFG analysis and obtain deterministic library results;
2. keep persisted CFG state correct through enable, sync, delete, disable,
   stale failure, and re-enable transitions;
3. query the same stateful contract through CLI JSON/human output and a
   paginated MCP tool, with aggregate status visibility;
4. obtain Python semantic parity after the TypeScript/JavaScript vertical slice.

Carry every selected Q1-Q28 decision into normative requirements. In particular:
- skip an entire unsupported or over-10,000-block function and persist a stable
  status/reason; never expose a partial CFG;
- model explicit throws only, real short-circuit flow, switch/match,
  comprehensions, optional chaining/nullish flow, nested function boundaries,
  disconnected unreachable blocks, and distinct abrupt-transfer edges;
- persist CFG metadata but not lowering instructions;
- use function IDs only and one exact machine response shape;
- require first-enable full backfill and affected-file transactional refresh;
- retain only explicitly stale snapshots on unexpected refresh failure;
- enforce the 20% paired-median overhead budget;
- require the accepted two vertical language slices.

Out of scope: dataflow/PDG/taint, languages beyond TS/JS/Python, implicit
exception inference, async suspension edges, edit-stable block matching,
name/position lookup, REST, and write surfaces.

Include measurable acceptance scenarios for disabled dormancy, deterministic
re-indexing, every lifecycle transition, pagination reconstruction, cross-surface
parity, project status, performance, the safety cap, and self-repo UAT. Leave no
[NEEDS CLARIFICATION] marker at G1.
```

### Specify Results

| Metric | Value |
|---|---|
| Functional Requirements | 34 |
| User Stories | 4 |
| Acceptance Scenarios | 22 |
| Unresolved markers | 0 — G1 passed |

### Files Generated

- [x] `specs/014-control-flow-graphs/spec.md`

---

## Phase 2: Clarify

**When to run:** After Specify. These sessions freeze exact contracts without
reopening choices already ratified in the Design Concept.

### Clarify Session 1 — State and Data Integrity

```text
/speckit-clarify

Using the SPEC-014 Design Concept as binding input, verify that spec.md defines
an exhaustive function/project state machine for disabled, not indexed, not
computed, available, empty, stale, unavailable, unsupported, resource-limited,
unknown function, deleted function, cancellation, first enable, refresh failure,
and re-enable. Confirm source-version rules, atomic replacement boundaries,
cascade/deletion behavior, and stable machine-readable reason codes. Ask only
questions whose answer is not already fixed by Q1-Q28.
```

### Clarify Session 2 — Language Semantics

```text
/speckit-clarify

Verify exact TS/JS and Python construct coverage, block/edge semantics, entry and
exit behavior, try/finally routing, switch fallthrough, match cases,
break/continue targets, short-circuit evaluation, optional chaining, nullish
coalescing, comprehensions, nested function boundaries, unreachable blocks, and
the 10,000-block pre-persistence cap. Preserve explicit-throw-only exception
edges and ordinary-operation await/yield semantics.
```

### Clarify Session 3 — Public Contracts and Bounds

```text
/speckit-clarify

Freeze the exported TypeScript result union, CLI command/flags and exit behavior,
the MCP tool name and schema, deterministic ordering, limit/offset clamps,
pagination totals, human versus JSON rendering, codegraph status fields, and
success-shaped expected-state guidance. Require exact machine-shape parity and
bounded MCP output. No REST or fuzzy target resolution.
```

### Clarify Results

| Session | Focus | Status | Result |
|---|---|---|---|
| 1 | State and data integrity | ✅ Complete | Aggregate-only `empty`; opaque per-function source versions; explicit affected-file swaps and deletion tombstones; cancellation no-op; stable reason enum. No unresolved consensus item. |
| 2 | Language semantics | ✅ Complete | Exact entry/exit roles and edge kinds; lexical `finally` routing; precise break/continue targets; ordered Python match predicates/guards; deterministic Python lambda identity. |
| 3 | Public contracts and bounds | ✅ Complete | `CodeGraph.getCfg`, `codegraph cfg`, `codegraph_get_cfg`, exported types, exact ordering, 100/500 paging, status fields, and success-shaped exit behavior frozen. |

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|---|---|---|---|---|---|---|
| 1 | Clarify | Function-like forms requiring CFG-addressable IDs | [codebase, spec] | 1 | both-agree | Every separately addressable CFG requires a deterministic CodeGraph function ID; Python lambdas gain deterministic identity in the Python slice. | codebase-analyst, spec-context-analyst |
| 2 | Clarify | CFG page default and maximum | [codebase] | 1 | high-confidence | Default 100, maximum 500, offset 0; blocks and edges expose independent deterministic page windows. | codebase-analyst |
| 3 | Clarify | CLI exit behavior for expected CFG states | [codebase, spec] | 1 | both-agree | Every valid typed CFG state exits 0; nonzero is reserved for failures that prevent a valid result. | codebase-analyst, spec-context-analyst |

The named `consensus-synthesizer` role was installed but not exposed by this
Codex task runtime. A dedicated default subagent performed each required
independent synthesis; all three Round-1 results were high confidence with no
Round-2 flag.

---

## Phase 3: Plan

**When to run:** After G2. Output:
`specs/014-control-flow-graphs/plan.md` and supporting artifacts.

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Runtime: TypeScript on Node >=20 <25; source paths touching node:sqlite need
  Node 22.5+ and project commands use Node 24.11.1.
- Parsing: existing tree-sitter extraction and function nodes.
- Database: node:sqlite only; schema.sql is a shipped asset copied by build.
- Interfaces: public CodeGraph library, CLI, and MCP; no REST for SPEC-014.
- Testing: Vitest with real files and real SQLite; deterministic golden fixtures.

## Binding Inputs
- docs/ai/specs/.process/SPEC-014-design-concept.md
- specs/014-control-flow-graphs/spec.md
- .specify/memory/constitution.md
- docs/ai/specs/intelligence-platform-technical-roadmap.md

## Architecture and Data Model
Design the smallest language-neutral IR and builder that satisfy the accepted
construct matrix. Persist a compact per-function status/source-version record,
CFG block role and ordered source spans, and typed edges. Do not persist IR
instructions. Use deterministic same-source block IDs. Define migration,
foreign-key/cascade behavior, indexes, atomic affected-file swap, first-enable
backfill, disabled inert retention, stale failure retention, cancellation
no-op, and deleted-function cleanup.

Quote and preserve the decisions "Add CLI and MCP", "Function ID only",
"Exact shared shape", "Skip function", "Retain stale CFG", and "Two language
slices" when they drive architecture choices.

## Two-Slice Plan
Produce separate file-operation tables and verification gates for:
1. shared infrastructure + TS/JS end-to-end through library/CLI/MCP/status;
2. Python match/comprehension parity through the same contracts.

Do not create horizontal schema-only or interface-only slices. Run the
authoritative reviewability estimator per slice and revise the cut if either
slice exceeds the allowed budget.

## Performance and Reliability
Reuse the committed benchmark-monorepo paired-median method with CFG disabled
versus enabled and a <=1.20 ratio. Specify deterministic warmup/sample handling,
the 10,000-block cap, cooperative cancellation/yield points where needed, MCP
pagination bounds, and disabled-path dormancy.

## UAT
Define a self-repo TypeScript probe that activates CFG, discovers a real
function ID through existing graph queries, compares library/CLI JSON/MCP pages,
checks status counts, mutates a controlled fixture through sync/delete, and
records results. Add a committed Python parity fixture. Never expose or persist
.envrc.local secrets.

Run the Constitution Check before Phase 0 research and again after Phase 1
design. Record any unavoidable complexity in the required table.
```

### Plan Results

| Artifact | Status | Required Content |
|---|---|---|
| `plan.md` | ✅ Complete | Two vertical slices, file tables, constitution checks |
| `research.md` | ✅ Complete | Tree-sitter node mapping and safety-cap validation |
| `data-model.md` | ✅ Complete | Function status, block, edge, version, and cascade rules |
| `contracts/` | ✅ Complete | Shared library/CLI JSON/MCP/status schemas |
| `quickstart.md` | ✅ Complete | Enable, query, paginate, sync, and disable examples |

Plan reviewability evidence: authoritative `estimate-reviewable-loc` returned
`projected=360`, `status=pass`, with 9 declared production file operations.
Both vertical slice estimates returned 390 LOC, one suggested slice, and
`status=ok`. G3 passed with zero unresolved plan markers.

---

## Phase 4: Domain Checklists

Run after Plan. Target four requirement-quality domains.

### 1. API Contracts

```text
/speckit-checklist api-contracts

Focus on SPEC-014:
- exact shared found/miss/state response type;
- CLI JSON and MCP field-for-field parity;
- function-ID validation and expected-state guidance;
- deterministic block/edge ordering and pagination reconstruction;
- aggregate status fields and human-output separation.
- Pay special attention to: no field/state drift among library, CLI JSON, and MCP.
```

### 2. Data Integrity

```text
/speckit-checklist data-integrity

Focus on SPEC-014:
- schema constraints, foreign keys, indexes, and source versions;
- first-enable backfill and affected-file atomic replacement;
- change/delete/disable/re-enable transitions;
- stale snapshot retention versus unsupported replacement;
- cancellation and migration behavior with real SQLite.
- Pay special attention to: no stale or retained row may appear fresh.
```

### 3. Error Handling

```text
/speckit-checklist error-handling

Focus on SPEC-014:
- unsupported syntax, parse errors, explicit throws, and resource limits;
- unexpected first-run versus later refresh failures;
- stable reason codes with bounded safe messages;
- success-shaped disabled/unknown/unsupported states;
- index/sync containment and cancellation no-op behavior.
- Pay special attention to: no failure exposes a partial CFG or fails indexing.
```

### 4. Performance

```text
/speckit-checklist performance

Focus on SPEC-014:
- <=20% paired-median enabled index overhead;
- disabled-path dormancy and zero CFG row writes;
- 10,000-block per-function safety cap;
- affected-file incremental rebuild rather than full recompute;
- bounded MCP pages and deterministic output limits.
- Pay special attention to: benchmark methodology must be reproducible and non-flaky.
```

### Checklist Results

| Checklist | Items | Gaps | Status |
|---|---:|---:|---|
| api-contracts | 18 | 0 | ✅ Complete — no unresolved consensus item |
| data-integrity | 20 | 0 | ✅ Complete — 2 documentation gaps remediated; no unresolved consensus item |
| error-handling | 20 | 0 | ✅ Complete — 2 documentation gaps remediated; no unresolved consensus item |
| performance | 18 | 0 | ✅ Complete — 2 documentation gaps remediated; no unresolved consensus item |

Every genuine `[Gap]` must update `spec.md` or `plan.md`; intentional exclusions
must cite the Design Concept.

Checklist phase result: 76 items passed across four domains, 6 first-pass
documentation gaps were remediated, every mandatory consensus row completed
with no unresolved item, and G4 passed with zero `[Gap]` markers.

---

## Phase 5: Tasks

### Tasks Prompt

```text
/speckit-tasks

Read spec.md, plan.md, every checklist, and
docs/ai/specs/.process/SPEC-014-design-concept.md.

Generate small, dependency-ordered, test-first tasks grouped by independently
testable user story and the two accepted vertical slices. Do not organize the
work as "all schema, then all lowering, then all interfaces."

For Slice 1, order red-green tasks so a minimal TS/JS function travels through
IR -> CFG -> SQLite -> stateful library read -> CLI JSON/human -> MCP pages ->
status, then add lifecycle and construct cases incrementally.

For Slice 2, drive Python through the already working vertical path, then add
match/case, comprehension/generator, nested-function, and parity fixtures.

Every behavior task must begin with a failing test or deterministic probe.
Include explicit tasks for migration/package assets, first-enable empty-change
backfill, affected-file replacement, delete, disable/re-enable, stale failure,
unsupported/resource-limited states, deterministic re-indexing, shared response
parity, MCP bounds, the paired benchmark, self-repo UAT, full build/test gates,
reviewability gates, and retrieval-guardian review for src/mcp changes.

Mark parallel-safe fixture/renderer work [P] only when it cannot race shared
types, schema, or contract decisions. Reference the relevant FR and Q-number in
each task's acceptance criteria.
```

### Tasks Results

| Metric | Value |
|---|---|
| Total Tasks | 43 |
| Slice 1 Tasks | 23, plus 8 setup/foundational tasks |
| Slice 2 Tasks | 7 |
| Parallel Opportunities | 2 explicit `[P]` tasks |
| Requirements Covered | 34/34 (100%); G5 passed |

Tasks-mode `reviewability-gate` is deferred by the installed runner and was not
invoked. The fallback evidence chain is current and permits progress: setup
estimate `780`/`warn` below the 800-LOC block with the operator-ratified
two-slice split; plan estimate `360`/`pass`; 43 sequential tasks with 34/34 FR
coverage and explicit final reviewability task T043.

---

## Atomicity Route

After Tasks/G5, run:

```text
runner helper atomicity-route specs/014-control-flow-graphs
```

Record the classifier result here. The accepted two-slice design is advisory
input; the classifier remains authoritative for PR emission and releasability.

| Field | Value | Meaning |
|---|---|---|
| **Route** | `one-navigable-PR` | `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope` |
| **Releasable** | `true` | Whether the classified change can be released independently |
| **Signals** | `change-shape:modify-heavy` | Structural evidence behind the route |
| **Warnings** | None | Release-safety warnings, if any |

---

## Phase 6: Analyze

### Analyze Prompt

```text
/speckit-analyze

Analyze spec.md, plan.md, tasks.md, all checklists, and
docs/ai/specs/.process/SPEC-014-design-concept.md together.

Treat the Design Concept as the source of truth for Q1-Q28. Flag any drift in:
- skip-whole-function soundness and stable reason states;
- explicit-only exception edges and accepted expression semantics;
- first-enable, incremental, delete, disable, re-enable, stale, and failure flow;
- metadata-only persistence and deterministic same-source identity;
- library/CLI JSON/MCP exact parity and pagination;
- aggregate status and <=20% benchmark gate;
- 10,000-block cap;
- two vertical language slices and all non-goals.

Verify every FR and acceptance scenario has a task, each task names a real
project path, both slices are independently testable, reviewability evidence is
current, scoped AGENTS guidance is obeyed, and no task broadens into dataflow,
REST, fuzzy lookup, implicit exceptions, or async suspension modeling.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|---|---|---|---|
| A001 | MEDIUM | Plan treated stale per-slice setup estimates as authoritative plan evidence. | Replaced with current setup 780/warn, plan 360/pass, and explicit slice re-check boundary. |
| A002 | LOW | Slice 1 count mixed foundational T006–T008 with 23 behavior tasks. | Corrected behavior range to T009–T031 after T001–T008 setup/foundation. |

Analyze rerun: 0 CRITICAL, 0 HIGH, 0 MEDIUM, and 0 LOW findings.
No item remained for Analyze consensus. Direct G6 passed.

The installed `consensus-synthesizer` role was not exposed by this Codex task
runtime, so the recorded dedicated default-role fallback emitted the required
canonical pre-implementation score:

📊 Confidence: 1.00

- Task understanding: 1.00
- Approach clarity: 1.00
- Requirements alignment: 1.00
- Risk assessment: 1.00
- Completeness: 1.00

---

## Phase 6.5: Pre-Implement Confidence Gate

Run after Analyze consensus and before any implementation task.

| Gate | Mode | Threshold | Status |
|---|---|---:|---|
| G6.5 | advisory | 0.90 | ✅ Passed — composite 1.00; proceed |

The runner reads the confidence emit produced at the end of Analyze. A failing
advisory result triggers up to three focused remediation iterations and is
recorded without overriding any correctness gate.

---

## Phase 7: Implement

### Implement Prompt

```text
/speckit-implement

Execute tasks.md in dependency order using strict red-green-refactor TDD.
Re-read plan.md and docs/ai/specs/.process/SPEC-014-design-concept.md before
each vertical slice.

For every task:
1. RED — add the smallest failing behavioral test or deterministic probe.
2. GREEN — implement only enough to satisfy the requirement.
3. REFACTOR — simplify without changing behavior.
4. VERIFY — run the focused test and record evidence.

Complete Slice 1 and its G7 evidence before Slice 2. Never persist or return a
partial unsupported CFG. Keep all expected absence states success-shaped.
Preserve disabled dormancy and no-network behavior. Use real SQLite tests.

Before any completion or merge claim:
- run focused CFG, schema, lifecycle, CLI, MCP, status, and parity suites;
- run `npm run build` and `npm test` under Node 24.11.1;
- run the paired benchmark and prove ratio <=1.20;
- run deterministic repeated re-index probes;
- run self-repo UAT and record the runbook outcome;
- run reviewability gates per slice and the final backstop;
- run retrieval-guardian because src/mcp is in scope;
- verify shipped schema assets exist in dist.
```

### Implementation Progress

| Slice | Scope | Tasks | Status |
|---|---|---:|---|
| 1 | Shared infrastructure + TS/JS + all read surfaces | 23 behavior + 8 setup/foundation | 🔄 In Progress — foundation complete; US1 active |
| 2 | Python semantic parity + final hardening | 7 behavior + 5 cross-cutting gates | ⏳ Pending |

### Implementation Task Groups

| Group | Task IDs | Status |
|---|---|---|
| Setup and Reviewability Baseline | T001–T003 | ✅ Complete — fixture tests 2/2 green |
| Foundational Contract and Storage | T004–T008 | ✅ Complete — focused CFG 16/16, build, and full Node 24 suite green |
| Slice 1 / US1 Library CFG | T009–T016 | 🔄 In Progress — T009–T015 complete; T016 function boundaries/unreachable flow active |
| Slice 1 / US2 Lifecycle | T017–T023 | ⏳ Pending |
| Slice 1 / US3 CLI, MCP, and Status | T024–T031 | ⏳ Pending |
| Slice 2 / US4 Python Parity | T032–T038 | ⏳ Pending |
| Polish, Gates, and Review Packet | T039–T043 | ⏳ Pending |

Foundation evidence (2026-07-25): schema v11 fresh/migration/shipped-asset
parity, default-off CFG dormancy, frozen public contract, source-version/status
resolution, bounded messages, no-partial payload construction, and independent
block/edge paging are implemented. The focused CFG suites passed 16/16, the
Node 24 build passed, and the authoritative full suite passed 258 files with
4553 tests passed and 178 skipped. The full gate also exposed and remediated
legacy schema/config expectations and one repeated daemon cold-parallel timeout
budget before the group was closed.

T009 evidence (2026-07-25): a real enabled TypeScript project now flows
through tree-sitter parsing, a conservative linear IR/builder, atomic CFG-owned
SQLite writes, and `CodeGraph.getCfg`. Explicit returns persist a `return`
edge, unsupported nested semantics are not flattened, and cancellation cannot
commit a partial transaction. The focused TypeScript/contract/lifecycle suites
passed 16/16 and the Node 24 build passed.

T010 evidence (2026-07-25): three unchanged index runs returned identical
function, graph, and block IDs, deterministic block/edge ordering, and
byte-equivalent serialized `getCfg` results. The characterization passed on its
first run because T009 already satisfied the frozen determinism contract; 17
focused CFG tests and the Node 24 build passed.

T011 evidence (2026-07-25): out-of-scope Go functions, unsupported
constructs, unavailable parsers, file-level parse errors, and parse-unsafe
function regions now persist distinct stable skip reasons with zero blocks,
zero edges, and no read payload. The focused CFG suites passed 22/22 and the
Node 24 build passed.

T012 evidence (2026-07-25): a generated 5,001-branch function now crosses
the exact 10,000-basic-block safety threshold through iterative control-flow
demand accounting. It persists `resource_limited` /
`block_limit_exceeded` before generic skip handling and exposes no blocks,
edges, or payload. The focused CFG suites passed 23/23 and the Node 24 build
passed.

T013 evidence (2026-07-25): structured TS/JS lowering now handles explicit
throws and path-precise lexical finally routing without speculative
cross-products. Pending return/throw continuations receive cloned finally
paths, abrupt transfers inside finally supersede them, empty finally bodies
remain explicit, only explicit throws create exception edges, edges use the
frozen order, and cloned graphs are capped before persistence. The focused CFG
suites passed 30/30 and the Node 24 build passed.

T014 evidence (2026-07-25): AST-based expression lowering now preserves
evaluation order for logical short-circuiting, ternaries, nullish coalescing,
optional members/calls/subscripts, nested wrappers, and branchy
arguments/initializers/returns. Ordinary arithmetic and comparisons stay
non-branching, and any still-unhandled branch wrapper fails closed rather than
flattening. The focused CFG suites passed 35/35 and the Node 24 build passed.

T015 evidence (2026-07-25): structured switch/loop lowering now preserves
case/default dispatch, source-order fallthrough, exact break/continue targets,
lexical finally routing, chained loop labels, and loop re-entry. Branchy
conditions and `for` updates reuse the T014 expression path on every
evaluation, while `for (;;)` exposes no synthetic false exit and non-loop
continue labels stay unsupported. Parent-review regressions failed before each
fix; the focused CFG/contract/lifecycle suites passed 50/50 and the Node 24
build passed.

---

## Post-Implementation Checklist

| Item | Status | Notes |
|---|---|---|
| Post: Doctor Extension Check | ⏳ Pending | Skip with explicit evidence if doctor/speckit-utils is absent. |
| Post: Verify Implementation | ⏳ Pending | Run the installed verify extension. |
| Post: Verify Tasks Phantom Check | ⏳ Pending | Run the installed verify-tasks extension. |
| Post: Code Review | ⏳ Pending | Run independent specialized review. |
| Post: Integration Suite | ⏳ Pending | Run the authoritative project integration gate. |
| Post: Reviewability Diff Gate | ⏳ Pending | Evaluate the final changed-file surface. |
| Post: Self-Review | ⏳ Pending | Complete the four-question audit. |
| Post: UAT Runbook Generation | ⏳ Pending | Generate and author the executable runbook. |
| Post: Final Reviewability Backstop | ⏳ Pending | Validate current committed reviewability evidence. |
| Post: PR Packet/Body Generation | ⏳ Pending | Emit and validate feature-local PR packets. |
| Post: PR Body Generation | ⏳ Pending | Generate the packet-owned PR body. |
| Post: PR Creation | ⏳ Pending | Create the authorized PR or marker stack. |
| Post: Review Remediation | ⏳ Pending | Poll and resolve CI and review findings. |
| Post: Retrospective | ⏳ Pending | Run last, after every other Post item. |

- [ ] Every task is implemented and verified, not merely checked off.
- [ ] `npm run build` passes under supported Node.
- [ ] `npm test` passes.
- [ ] Focused CFG determinism, lifecycle, CLI, MCP, status, and schema suites pass.
- [ ] Paired benchmark ratio is at most 1.20 with recorded samples.
- [ ] Disabled mode makes no network calls and writes no CFG content/status rows.
- [ ] Library, CLI JSON, and MCP parity tests pass.
- [ ] Self-repo UAT and Python fixture UAT are recorded.
- [ ] Retrieval-guardian returns no blocking finding.
- [ ] Reviewability gates pass for each emitted slice/PR.
- [ ] Roadmap/workflow/autopilot state remains synchronized.

---

## Project Structure Reference

```text
src/
├── analysis/
│   └── cfg/                       # shared IR, builder, language lowerers, store/read facade
├── db/
│   └── schema.sql                 # CFG function status, blocks, edges
├── bin/
│   └── codegraph.ts               # activation, read command, status rendering
├── mcp/
│   └── tools.ts                   # bounded paginated CFG read tool
├── project-config.ts              # persisted analysis.cfg opt-in
└── index.ts                       # public library API and index/sync integration
__tests__/
└── analysis/
    └── cfg/                       # real SQLite, golden, lifecycle, parity fixtures
scripts/
└── bench-cfg-analysis.mjs         # paired disabled/enabled benchmark
specs/
└── 014-control-flow-graphs/       # CONTRACT artifacts and later UAT runbook
docs/ai/specs/.process/
├── SPEC-014-design-concept.md
└── SPEC-014-workflow.md
```

Keep exact file names negotiable until Plan confirms existing seams. New
capabilities belong under `src/analysis`; edits to upstream-owned files must
remain minimal.
