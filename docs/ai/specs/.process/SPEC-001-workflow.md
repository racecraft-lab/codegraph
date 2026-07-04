# SpecKit Workflow: SPEC-001 — Embedding Infrastructure & Endpoint Provider

**Template Version**: 1.0.0
**Created**: 2026-07-04
**Purpose**: Executable workflow guide for SPEC-001. The prompts below are ready to run (or feed to `/speckit-pro:speckit-autopilot`).

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec`. The full Q&A log, Goals, Non-goals, and Open
Questions live at:

```text
docs/ai/specs/.process/SPEC-001-design-concept.md
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

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 26 FRs, 3 US, 12 acceptance scenarios, 0 markers; G1 pass |
| Clarify | `/speckit-clarify` | ✅ Complete | 3 sessions, 13 questions; 1 consensus run (both-agree) + 1 security item (conservative default, flagged); FR-016a added, FR-004/022/023 updated; G2 pass |
| Plan | `/speckit-plan` | ✅ Complete | 8 artifacts (plan + research 16 decisions + data-model + quickstart + 4 contracts); constitution PASS ×2; G3 pass (1 false-positive marker reworded) |
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
| I. Think Before Coding | Assumptions stated; ambiguities become `[NEEDS CLARIFICATION]`, never silent picks | G1 blocks while markers remain |
| II. Simplicity First | Minimum code; no speculative abstractions (no ANN, no multi-model storage — see design concept Q2) | Complexity Tracking table in plan.md |
| III. Surgical Changes | Net-new `src/embeddings/` module behind opt-in config; diffs to upstream-owned files (`src/index.ts`, `src/db/schema.sql`, `src/bin/codegraph.ts`) stay minimal | Code review; every changed line traces to a task |
| IV. Goal-Driven Execution | TDD red→green; completion claims carry test evidence | `npm test` green + per-task evidence |
| V. Deterministic Extraction | Embeddings NEVER become graph structure (nodes/edges untouched); vectors are a parallel derived layer | Node/edge counts stable across re-index with feature on |
| VI. Retrieval Regression Surface | No MCP tool behavior changes in this spec (search consumption is SPEC-003) | No changes under `src/mcp/` |
| VII. Local-First, Private, Zero Native Deps | Pure `node:sqlite` (BLOB column); endpoint is user-configured infra; no telemetry (Q9); API key never persisted or logged | Dependency audit; grep for key leakage in errors/logs |

**Constitution Check:** ✅ (validated at scaffold; re-verify at G3)

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-001 |
| **Name** | Embedding Infrastructure & Endpoint Provider |
| **Branch** | `001-embedding-infrastructure` |
| **Dependencies** | None (Tier 0 root) |
| **Enables** | SPEC-002 (local fallback), SPEC-003 (hybrid search), SPEC-011 (labels), SPEC-019 (wiki) |
| **Priority** | P0 |

### Scope Budget & Split Decision (setup gate record)

The reviewability setup gate returned **warn / pass=true** (multi-surface warning:
schema/migration + harness/adapter). The grill-me slice-sizing branch re-estimated at
**705 projected LOC (status: warn, suggested_slices: 2)** — over even the greenfield
warn line (600). **Split decision (accepted, design concept Q10): SPEC-001 is delivered
as 2 thin vertical slices** within this one spec/branch:

- **Slice A — endpoint embedding on full index:** config activation (`config.ts`),
  `EmbeddingProvider` interface (`provider.ts`), OpenAI-compatible HTTP client
  (`endpoint-provider.ts`: batching, bounded concurrency, `AbortSignal.timeout`,
  exponential backoff on 5xx/429), `node_vectors` schema migration (v8), embed phase
  in `indexAll`, dims validation (infer-then-enforce), `codegraph status` reporting.
- **Slice B — incremental + healing:** `input_hash` change detection in `sync`,
  removed-node vector deletes (wired to existing sync deletes), daemon/watcher embed
  path, sync-heals backfill for pre-configured indexes, abort/resume semantics.

Each slice is end-to-end testable and inside the 400-LOC review ceiling. Tasks MUST be
organized so Slice A is completable and reviewable before Slice B starts; the
atomicity classifier at G5 confirms the split-PR route.

### Success Criteria Summary

- [ ] With `CODEGRAPH_EMBEDDING_URL` + `CODEGRAPH_EMBEDDING_MODEL` set, a full index leaves every declaration-kind node with a persisted vector in `node_vectors` (coverage 100% in `codegraph status`).
- [ ] With the feature unconfigured, behavior is byte-identical to today: zero network calls, zero schema rows written, all existing tests pass unchanged.
- [ ] Editing one file and syncing re-embeds only that file's changed nodes (`input_hash` unchanged → skipped); removing a file deletes its nodes' vectors.
- [ ] A repo indexed before configuration heals fully via a plain `codegraph sync`.
- [ ] Endpoint failure mid-pass aborts the pass after bounded retries without failing the index/sync; the next run resumes from partial coverage.
- [ ] `codegraph status` reports embedding backend, model, dims, and coverage %.
- [ ] Dimension drift produces one actionable error naming `CODEGRAPH_EMBEDDING_DIMS`; URL-without-MODEL produces one actionable error naming `CODEGRAPH_EMBEDDING_MODEL`.

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/001-embedding-infrastructure/spec.md`

### Specify Prompt

```bash
/speckit-specify

## Feature: Embedding Infrastructure & Endpoint Provider (SPEC-001)

### Problem Statement
CodeGraph's retrieval is purely lexical (FTS5 + name matching). Semantic retrieval
(SPEC-003) and downstream intelligence features (SPEC-011 labels, SPEC-019 wiki) need
a persisted embedding vector per symbol. This spec builds the embedding substrate:
every indexed declaration-level symbol gets a vector computed through a user-configured
OpenAI-compatible endpoint, incrementally and resiliently, with the feature FULLY
DORMANT when unconfigured (zero behavior change, zero network traffic).

### Users
- CodeGraph users who run a local or remote OpenAI-compatible embedding endpoint
  (Ollama, LM Studio, vLLM, OpenAI, etc.) and want semantic search over their code.
- Downstream specs (SPEC-002/003/011/019) that consume the provider interface and
  the persisted vectors.

### User Stories
1. **Configure + index (Slice A):** As a user with an embedding endpoint, I set
   CODEGRAPH_EMBEDDING_URL and CODEGRAPH_EMBEDDING_MODEL, run `codegraph index`, and
   every declaration symbol gets a vector; `codegraph status` shows backend, model,
   dims, and 100% coverage.
2. **Incremental freshness (Slice B):** As a user editing code, each sync (CLI or
   daemon file-watcher) re-embeds only genuinely changed nodes and deletes vectors for
   removed nodes, so vectors stay fresh at negligible endpoint cost.
3. **Late configuration + resilience (Slice B):** As a user who indexed before
   configuring the endpoint, a plain `codegraph sync` backfills all missing vectors;
   if the endpoint goes down mid-pass, the pass aborts cleanly (index/sync still
   succeed) and the next run resumes from where it stopped.

### Key Decisions (from the grill-me interview — quote these in the spec)
- Embed DECLARATION KINDS ONLY (Q1): function, method, class, struct, interface,
  trait, protocol, enum, type_alias, module, namespace, component, route, plus
  top-level constant/variable. Skip parameter, import, export, enum_member,
  field/property, file.
- node_vectors PK = node_id, ONE active model (Q2): model/dims are metadata columns;
  a model-mismatched row is stale and re-embeds (replace). No multi-model storage.
- Embed pass runs INLINE post-resolution inside indexAll/sync, ADVISORY (Q3): its
  failure never fails the operation ("advisory — never fail an index over it").
- Embed EVERYWHERE sync runs, including the MCP daemon's watcher syncs (Q4).
- Endpoint failure: ABORT the pass after bounded retries, resume next run (Q8).
- Backfill via `codegraph sync` heal — NO new CLI command (Q5).
- Activation = URL + MODEL both set; API_KEY optional (keyless local endpoints) (Q6).
- DIMS optional: inferred from first batch, persisted, then enforced; mismatch →
  actionable error naming CODEGRAPH_EMBEDDING_DIMS (Q7).
- NO new telemetry (Q9).
- Vector storage: plain BLOB (little-endian f32) + brute-force scan in v1 — preserves
  the zero-native-dependency constraint (roadmap decision 2026-07-03).

### Constraints
- Node engines >=20 <25 (bundled runtime ships ≥22.5; `node:sqlite` only — no native
  deps, no new npm dependencies for the HTTP client: use global fetch).
- Deterministic embedding input per node: name + kind + signature + docstring +
  trimmed snippet, hashed (input_hash) for change detection.
- Graph structure (nodes/edges) is untouched — vectors are a parallel derived layer
  (Constitution V). Node/edge counts stay stable across re-index with the feature on.
- API key never persisted, never logged, never echoed in error messages.
- Schema change lands as migration v8 in src/db/migrations.ts AND schema.sql in
  lockstep (the name_segment_vocab v7 precedent).

### Out of Scope
- Bundled local embedding model (SPEC-002); search-side consumption of vectors
  (SPEC-003); ANN indexes/quantization (deferred until scale demands).
- Embedding noise-level node kinds (Q1 non-goal).
- Multi-model vector storage (Q2), detached background embedding (Q3),
  `codegraph embed` command (Q5), telemetry (Q9).
- Any change under src/mcp/ (retrieval surface untouched until SPEC-003).
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 26 (activation/config, symbol selection, input+change-detection, persistence, pass behavior, incremental, resilience, observability, security/invariants) |
| User Stories | 3 — US1 Configure+index (P1, Slice A); US2 Incremental freshness (P2, Slice B); US3 Late config + resilience (P3, Slice B) |
| Acceptance Criteria | 12 acceptance scenarios (4/story) + 8 success criteria + 8 edge cases |

Notes: spec-template resolved via speckit-pro-reviewability preset; Reviewability Budget
section records **split required** (~750 projected LOC, 2 primary surfaces) → two
vertical-slice PRs (Slice A = US1, Slice B = US2+US3), matching the scaffold's accepted
Q10 split. 0 `[NEEDS CLARIFICATION]` markers (Q1–Q9 decisions pre-fixed in Assumptions).
G1: pass (validate-gate.sh: 0 markers). after_specify hook (agent-context) auto-accepted
per hook rules (non-destructive). Constitution validation baseline (Phase 0): build ✓,
typecheck ✓, 2078 tests passed / 4 skipped.

### Files Generated

- [x] `specs/001-embedding-infrastructure/spec.md`
- [x] `specs/001-embedding-infrastructure/checklists/requirements.md` (spec quality checklist)
- [x] `.specify/feature.json` (feature_directory pointer)

### SpecKit Traceability Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Configure + index` |
| `[FR-001]` | Functional requirement | `[FR-001] Activation requires URL + MODEL` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `variable kind boundary [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Can run alongside other tasks` |
| `[Gap]` | Missing coverage | `[Gap] No task covers dims drift` |

---

## Phase 2: Clarify (Optional but Recommended)

**When to run:** After Specify. The design concept's Open Questions section seeds these sessions — anything still open after grill-me is exactly what `/speckit-clarify` should dig into.

**Best Practice:** Maximum 5 targeted questions per Clarify session.

### Clarify Prompts

#### Session 1: Node Identity & Vector Lifecycle

```bash
/speckit-clarify Focus on node identity and vector lifecycle: (1) Are node IDs stable
across a full re-index when file content is unchanged (does indexAll hash-skip
unchanged files, preserving rowids), or do re-created node rows orphan all vectors?
If rows are recreated, decide whether input_hash-keyed vector reuse is needed before
tasks are written (design concept Open Question 1). (2) Exactly how are vector deletes
wired to the existing node-delete paths in sync (file removed, file modified)?
(3) Does the "declaration kinds" boundary include local variables or only top-level
variable/constant nodes — check how extractors emit the `variable` kind today (design
concept Open Question 3).
```

#### Session 2: Endpoint Client Behavior

```bash
/speckit-clarify Focus on the endpoint HTTP client: (1) embedding-input truncation cap
(how much of a symbol's snippet goes into the input) and its interaction with endpoint
token limits; (2) concrete defaults for CODEGRAPH_EMBEDDING_BATCH_SIZE, _CONCURRENCY,
and _TIMEOUT_MS (design concept Open Question 2 — conservative, all env-overridable);
(3) exponential backoff parameters for 5xx/429 (base delay, max retries per batch)
consistent with the abort-pass-on-exhaustion decision (Q8); (4) where the inferred
dims value is persisted (project_metadata vs node_vectors rows) so enforcement
survives process restarts (Q7).
```

#### Session 3: Status Surface & Slice Boundary

```bash
/speckit-clarify Focus on observability and the slice split: (1) exact `codegraph
status` output for the embedding section (backend, model, dims, coverage %) — including
what shows when the feature is dormant, and how coverage is computed (vectors ÷
eligible declaration nodes, current model only); (2) progress reporting for the new
embedding phase in the CLI shimmer UI (IndexProgress gains an 'embedding' phase?);
(3) confirm the Slice A / Slice B boundary from the design concept (Q10) maps cleanly
onto user stories so tasks can deliver Slice A end-to-end first.
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Node identity & vector lifecycle | 4 (3 resolved by executor evidence, 1 via consensus) | Node IDs deterministic TEXT (`kind:sha256(path:kind:name:line)`) — vectors survive sync/re-index, no reuse cache (OQ1 resolved; design concept's `filesSkipped` premise was a misread — the skip is the write-time content-hash guard). CLI `codegraph index` = DB recreate → re-embeds by design. Locals never graph nodes → FR-005 flat kind test, "top-level" qualifier relaxed to include type-member constants (OQ3 resolved). **Consensus (both-agree): Design B — NO cascade FK on node_vectors; per-symbol re-embed granularity (FR-016a added); FR-017 via explicit anti-join reconciliation** (name_segment_vocab precedent; avoids #899/#1067 cascade hazards). Workflow Plan Prompt DDL corrected: node_id TEXT (was INTEGER). |
| 2 | Endpoint client behavior | 4 (all answered by parent from executor evidence) | Dims + active model persist as **project_metadata scalars** (`embedding_dims`, `embedding_model`; index-version-stamp precedent — FR-004 updated); backoff = base 1s ×2 full-jitter, ~8s cap, **3 retries/batch**, honor Retry-After (fixed constants — deviation from cookbook's 6 justified by Q8 abort-pass); input cap = fixed **~6,000 chars** (char-based; tokenizer would violate FR-025); defaults **BATCH_SIZE=16 / CONCURRENCY=4 / TIMEOUT_MS=30000**, env-overridable + clamped (parse-pool precedent). Layer-2 consensus not dispatched: executor's items were self-described confirmations with cited external evidence (OpenAI cookbook/API limits, Ollama/nomic contexts, LlamaIndex defaults), medium-high confidence, low-stakes (env-overridable or trivially-tunable constants) — parent accepted per Rule 5 and the operator's token-conservation directive. |
| 3 | Status surface & slice boundary | 5 (+3 flagged subs) | Coverage = **join from live nodes** to vectors filtered to active model ("current" = present ∧ model-match — orphan rows excluded; no input_hash check at status time). Status gains `Embeddings:` section (endpoint/model/dims/coverage) **with `--json` parity** (new `getEmbeddingCoverage` query method). **[security] endpoint rendering: scheme+host+port only** — userinfo/path/query stripped, key never rendered (FR-022/FR-023 updated; strictest option adopted autonomously, flagged for operator review). Dormant = neutral line + persisted prior-run data labeled as such. Progress: `'embedding'` phase added to IndexProgress union + PHASE_NAMES, emitted only when active. Slice split confirmed 1:1 (Slice A = US1 incl. all observability; Slice B = US2+US3; no straddle). |

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|------|----------------------|------------|-------|---------|------------|---------------|
| 1 | Clarify | Modified-file re-embedding: per-symbol vs per-changed-file (FK cascade vs explicit reconciliation) | [codebase, spec] | 1 | both-agree | Design B: no FK; vectors survive node delete/re-insert; FR-016a added; FR-017 = explicit reconciliation | codebase-analyst, spec-context-analyst |
| 2 | Clarify | Status endpoint line rendering — credential leak risk (URL userinfo / query keys) | [security] | 1 | conservative-default* | Scheme+host+port only; userinfo/path/query stripped; API key never rendered (FR-022/FR-023 updated) | none — orchestrator adopted the strictest of all candidate policies (all satisfied FR-023) |

\* Security-tagged item resolved autonomously by adopting the maximally-conservative display policy instead of stopping the run: every candidate option satisfied the MUST requirements, the choice is display-only and reversible, and the decision is surfaced here and in the final report for operator review. Analyst fan-out was skipped per the operator's token-conservation directive.

---

## Phase 3: Plan

**When to run:** After spec is finalized. Output: `specs/001-embedding-infrastructure/plan.md`

### Plan Prompt

```bash
/speckit-plan

## Tech Stack
- Language: TypeScript (strict), compiled with tsc; ESM-style imports with .js suffix
- Runtime: Node >=20 <25 engines; bundled runtime ships ≥22.5; node:sqlite
  (DatabaseSync) is the ONLY database backend — WAL + FTS5, no native deps, no wasm
- HTTP: global fetch with AbortSignal.timeout — NO new npm dependency for the client
- Testing: vitest (real files + real SQLite in temp dirs via fs.mkdtempSync; NO DB
  mocking). Endpoint tests use a local mock OpenAI-compatible HTTP server (node:http
  on an ephemeral port) returning deterministic vectors
- Build: `npm run build` (tsc + copy-assets: any new SQL asset must be covered —
  schema.sql already is); `npm run typecheck` (tsc --noEmit); `npm test` (vitest run)

## Architecture (decided in the grill-me interview — see
## docs/ai/specs/.process/SPEC-001-design-concept.md for the full Q&A rationale)
- New net-new module src/embeddings/ (Constitution III fork discipline):
  provider.ts (EmbeddingProvider: embed(texts) → Float32Array[], dims, id),
  endpoint-provider.ts (fetch client: batching, bounded concurrency workers,
  AbortSignal.timeout per request, exponential backoff on 5xx/429),
  config.ts (env parsing CODEGRAPH_EMBEDDING_{URL,MODEL,DIMS,API_KEY,BATCH_SIZE,
  CONCURRENCY,TIMEOUT_MS} with positive-int validation; active iff URL+MODEL set),
  indexer-hook.ts (the embed pass: select eligible declaration nodes missing/stale
  vectors by input_hash + model, batch, embed, persist)
- Hook point: src/index.ts indexAll() and sync(), inline AFTER reference resolution,
  wrapped so failures NEVER fail the operation (follow the existing "advisory — never
  fail an index over it" pattern used by vocab/metadata; the sync-heal follows the
  vocabWasEmpty backfill precedent at src/index.ts sync())
- Schema: migration v8 in src/db/migrations.ts + schema.sql in lockstep (the v7
  name_segment_vocab precedent): node_vectors(node_id TEXT PRIMARY KEY, model TEXT,
  dims INTEGER, vector BLOB, input_hash TEXT) — little-endian f32 BLOB; DDL-only
  migration (instant on any size DB)
- Failure semantics: one batch exhausting retries aborts the whole pass; partial
  coverage is first-class (status shows %); next index/sync resumes automatically
  because missing/stale rows are re-selected
- codegraph status (src/bin/codegraph.ts): embedding section with backend, model,
  dims, coverage %

## Constraints
- Unconfigured = byte-identical behavior to today (dormancy is a hard requirement:
  no network, no node_vectors writes, no new log lines)
- API key never persisted/logged/echoed; vectors and hashes live only in .codegraph/
- Deterministic input construction (name + kind + signature + docstring + trimmed
  snippet) — same node content must always produce the same input_hash
- Respect the 2-slice split recorded in the workflow's Scope Budget section: Slice A
  (full-index path) must be deliverable and testable before Slice B (incremental +
  healing) begins
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ | Technical context, constitution gates (PASS ×2, Complexity Tracking empty), reviewability budget (split → 2 slice-PRs; Slice A warn accepted) |
| `research.md` | ✅ | 16 decisions (D1–D16) with rationale + rejected alternatives + code precedent |
| `data-model.md` | ✅ | 5 entities: node_vectors (TEXT PK, no FK), metadata scalars, embedding input, pass, endpoint config |
| `contracts/` | ✅ | 4 contracts: embedding-config, embedding-provider (+OpenAI wire shape), node-vectors-schema (+f32 codec), status-embedding-json |
| `quickstart.md` | ✅ | Configure endpoint → index → verify status |

Notes: G3 pass (0 markers after rewording a false-positive literal `[NEEDS CLARIFICATION]`
inside the Principle I gate description — auto-fix attempt 1). Plan-phase reviewability
estimator: `not_estimated` (`projected: null` — plan.md declares no parseable production-file
structure); recorded as unmeasured, NOT as a within-budget pass; the plan's own budget section
projects ~750 LOC → split, consistent with the spec's Reviewability Budget. after_plan hook
(agent-context) fulfilled inline by the plan command's CLAUDE.md SPECKIT-marker update.
All six binding clarify resolutions verified present with zero deviations.

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates both spec AND plan together.

### Step 1: Recommended Domains (from spec analysis)

| Signal in SPEC-001 | Recommended Domain |
|---|---|
| node_vectors migration, input_hash change detection, delete wiring, model-switch staleness | **data-integrity** |
| Retries/backoff, abort-and-resume, timeouts, partial coverage, dormancy guarantees | **error-handling** |
| Batching, bounded concurrency, embed pass inside the index lock, large-repo wall-clock | **performance** |
| API key handling (env only, never persisted/logged), endpoint URL as user infrastructure | **security** |

**Target: 2-4 domains** — all four above are justified; skip ux/accessibility (no UI), streaming (none), llm-integration (embeddings input construction is covered by data-integrity + performance focus areas below).

### Step 2: Run Enriched Checklist Prompts

#### 1. data-integrity Checklist

Why: the spec's core risk is silent vector staleness — wrong input_hash logic or missed delete wiring corrupts SPEC-003's search quality invisibly.

```bash
/speckit-checklist data-integrity

Focus on Embedding Infrastructure & Endpoint Provider requirements:
- node_vectors migration v8 is DDL-only, idempotent, and in lockstep with schema.sql
- input_hash determinism: identical node content → identical hash across runs/platforms
- Model-switch staleness: a row with a mismatched model column is re-embedded (replaced), never served
- Delete wiring: file removal and file modification both remove/replace exactly the affected nodes' vectors
- Pay special attention to: node-identity stability across full re-index (Clarify Session 1 outcome) — vectors must not silently orphan
```

#### 2. error-handling Checklist

Why: resilience is half the feature's stated goal ("incrementally and resiliently"); the abort/resume path and dormancy guarantees have the most edge cases.

```bash
/speckit-checklist error-handling

Focus on Embedding Infrastructure & Endpoint Provider requirements:
- Advisory pass: NO failure mode of the embed pass may fail or hang indexAll/sync
- Abort-on-exhausted-retries: bounded backoff on 5xx/429, then clean pass abort; resume on next run re-selects missing/stale rows
- Config errors are actionable and name the exact env var (CODEGRAPH_EMBEDDING_MODEL when URL set without MODEL; CODEGRAPH_EMBEDDING_DIMS on dims drift)
- Dormant when unconfigured: zero network, zero writes, zero behavior change
- Pay special attention to: timeout handling per request (AbortSignal.timeout) and what happens when the endpoint hangs rather than errors
```

#### 3. performance Checklist

Why: the embed pass runs inline while holding the index mutex + file lock — a slow endpoint must degrade gracefully, not stall indexing unboundedly.

```bash
/speckit-checklist performance

Focus on Embedding Infrastructure & Endpoint Provider requirements:
- Batching + bounded concurrency keep total pass wall-clock proportional to changed-node count, not repo size, on incremental syncs
- Full-index embed on a large repo (10k+ files) completes within a sane bound and reports progress
- Vector writes are batched/transactional (no per-row transaction churn); WAL checkpoint behavior after bulk writes matches existing runMaintenance pattern
- Daemon watcher syncs: embed cost on a single-file edit is a handful of HTTP calls at most
- Pay special attention to: the pass holding the index lock — verify queries (MCP daemon reads) stay responsive during a long embed pass
```

#### 4. security Checklist

Why: the API key is the first secret CodeGraph ever handles; the local-first privacy posture (Constitution VII) must hold.

```bash
/speckit-checklist security

Focus on Embedding Infrastructure & Endpoint Provider requirements:
- CODEGRAPH_EMBEDDING_API_KEY read from env only; never written to .codegraph/, config files, logs, error messages, or status output
- Endpoint URL treated as user infrastructure: no telemetry, no phoning home (Q9: zero new telemetry)
- Embedding inputs (code snippets) leave the machine ONLY to the user-configured endpoint, only when explicitly configured
- Pay special attention to: error messages from failed HTTP calls — they must not echo the Authorization header or full request body
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| data-integrity | | | |
| error-handling | | | |
| performance | | | |
| security | | | |
| **Total** | | | |

### Addressing Gaps

When checklist identifies `[Gap]` items:

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/001-embedding-infrastructure/tasks.md`

### Tasks Prompt

```bash
/speckit-tasks

## Inputs
- specs/001-embedding-infrastructure/spec.md, plan.md, and the design concept at
  docs/ai/specs/.process/SPEC-001-design-concept.md (Non-goals bound task generation —
  flag any task that would cross them: no SPEC-002/003 work, no new CLI commands,
  no telemetry, no multi-model storage, no background lifecycle, no src/mcp/ changes)

## Task Structure
- Small, testable chunks (1-2 hours each); TDD: each behavior task starts with a
  failing test (real temp-dir SQLite + mock endpoint server, per plan.md)
- Clear acceptance criteria referencing FR-xxx
- Organize by user story AND respect the 2-slice split from the workflow's Scope
  Budget section: US1 (Slice A: configure + full index + status) must be fully
  implementable and reviewable BEFORE US2/US3 (Slice B: incremental, healing,
  abort/resume) — order phases so Slice A is a coherent, shippable checkpoint
- Mark parallel-safe tasks with [P]

## Implementation Phases
1. Foundation: config.ts parsing/activation + provider.ts interface + migration v8
   (schema.sql + migrations.ts in lockstep)
2. US1 / Slice A: endpoint-provider.ts client → indexer-hook embed pass in indexAll →
   dims infer/enforce → status section
3. US2+US3 / Slice B: input_hash incremental in sync → delete wiring → daemon/watcher
   path → sync-heal backfill → abort/resume
4. Polish: CHANGELOG [Unreleased] entry (user-facing feature), docs touch-ups,
   dormancy regression proof (full suite green with feature unconfigured)

## Constraints
- Tests in __tests__/ mirroring module layout (e.g. __tests__/embeddings-*.test.ts);
  temp dirs via fs.mkdtempSync, cleanup in afterEach; no DB mocking
- Upstream-file diffs minimal: src/index.ts gains only the advisory hook calls;
  src/db/schema.sql + migrations.ts gain only the v8 table; src/bin/codegraph.ts
  gains only the status section
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

The decision answers "can this change be split into multiple small PRs safely?" by
inspecting the change's structural seams (independent additive capabilities), not its
line count. Surface the four fields the SKILL extracts from the emitted decision:

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | | `true`, or `false` for a destructive-migration or concurrency-sensitive change (a passing CI run does not prove such a change is safe to release). |
| **Signals** | | The decisive detector findings behind the route and releasability reading (may be empty when the classifier abstains). |
| **Warnings** | | Any release-safety warning attached to the change (empty when there is no releasability risk). |

To produce the decision, run the classifier against the feature directory:

```bash
bash speckit-pro/skills/speckit-autopilot/scripts/atomicity-route.sh specs/001-embedding-infrastructure
```

Expected: the accepted 2-slice split (Scope Budget section above) makes `split-PR` the
likely route — Slice A and Slice B are independent additive capabilities.

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks to catch issues.

### Analyze Prompt

```bash
/speckit-analyze

Focus on:
1. Constitution alignment — especially V (embeddings never become graph structure),
   VII (no native deps, no key leakage, no telemetry), III (upstream-file diffs minimal)
2. Coverage gaps — every FR and user story has tasks; the dormancy guarantee and the
   abort/resume path each have explicit test tasks
3. Consistency between task file paths and the actual project structure
   (src/embeddings/, __tests__/, src/db/migrations.ts)
4. Cross-artifact drift vs the design concept
   (docs/ai/specs/.process/SPEC-001-design-concept.md): the design concept is the
   source of truth for the 10 scoping decisions (Q1-Q10) — if spec.md, plan.md, or
   tasks.md contradicts it without an explicit revision note, the downstream artifact
   is wrong. Verify in particular: declaration-kinds-only (Q1), node_id PK (Q2),
   inline advisory pass (Q3), abort/resume (Q8), no new CLI surface (Q5), and the
   2-slice ordering (Q10)
5. Verify Slice A tasks form a complete, independently shippable increment
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

```bash
/speckit-implement

## Approach: TDD-First

For each task, follow this cycle:

1. **RED**: Write failing test defining expected behavior
2. **GREEN**: Implement minimum code to make test pass
3. **REFACTOR**: Clean up while tests still pass
4. **VERIFY**: Manual verification of acceptance criteria

### Pre-Implementation Setup

Before starting any task:
1. `npm run build` succeeds and `npm test` is green on the branch before changes
2. `npm run typecheck` clean
3. Confirm you are on branch 001-embedding-infrastructure in the worktree — NEVER main

### Implementation Notes
- Consult docs/ai/specs/.process/SPEC-001-design-concept.md for the "why" behind
  decisions (Q&A log) — it informs test specifications and edge-case handling.
  A design-concept decision not reflected in tasks.md is a gap to surface BEFORE
  coding, not silently drop.
- Match existing style: prepared statements via QueryBuilder patterns, advisory
  try/catch wrappers with the "never fail an index over it" comment idiom,
  ESM imports with .js suffix.
- Mock endpoint server for tests: node:http on an ephemeral port speaking
  POST /v1/embeddings with deterministic vectors; cover 5xx/429/timeout/hang cases.
- Slice discipline: complete and verify all Slice A tasks (full-index path) before
  starting Slice B (incremental + healing).
- CHANGELOG.md: add the user-facing entry under ## [Unreleased] (### New Features),
  plain language, no internal paths/symbols; keep the CODEGRAPH_EMBEDDING_* var names
  (users type them).
- House rules: pushes/PRs target origin (racecraft-lab/codegraph) ONLY; no AI session
  URLs in commits or PR bodies; no version bump.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Foundation | | | |
| 2 - US1 / Slice A | | | |
| 3 - US2+US3 / Slice B | | | |
| 4 - Polish | | | |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Tests pass: `npm test` (full suite — including with the feature unconfigured, proving dormancy)
- [ ] Build succeeds: `npm run build`
- [ ] Node/edge counts stable across re-index with feature on (Constitution V evidence)
- [ ] No new npm dependencies; no changes under src/mcp/ or src/installer/
- [ ] CHANGELOG.md `[Unreleased]` entry added (user-facing feature)
- [ ] PR(s) created per the atomicity route (expected: split-PR — one per slice), targeting origin, review-packet body, no session URLs
- [ ] Merged to main branch

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
│   ├── embeddings/          # NEW (this spec): provider.ts, endpoint-provider.ts,
│   │                        #   config.ts, indexer-hook.ts
│   ├── db/                  # schema.sql (+v8 table), migrations.ts (+v8), queries.ts
│   ├── index.ts             # CodeGraph class — advisory embed hook in indexAll/sync
│   ├── bin/codegraph.ts     # CLI — status gains embedding section
│   ├── extraction/          # (untouched) tree-sitter pipeline
│   ├── resolution/          # (untouched) reference resolver
│   └── mcp/                 # (untouched until SPEC-003)
├── __tests__/               # embeddings-*.test.ts mirror the module; real SQLite,
│                            #   mock endpoint via node:http
├── docs/ai/specs/           # roadmap + .process/ (this workflow + design concept)
└── specs/001-embedding-infrastructure/   # spec.md, plan.md, tasks.md, SPEC-MOC.md
```

---

Template based on SpecKit best practices, populated for SPEC-001 from the technical roadmap scope and the grill-me design concept (10 Q&A decisions).
