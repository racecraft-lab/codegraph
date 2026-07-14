# SpecKit Workflow: SPEC-011 — Execution Flows & Clusters

**Template Version**: 1.0.0
**Created**: 2026-07-14
**Purpose**: Prepare and execute SPEC-011 so CodeGraph persists deterministic
execution-flow and functional-cluster catalogs, exposes them consistently over
MCP and REST, and dogfoods them without regressing core indexing or retrieval.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec SPEC-011` on 2026-07-14. The full
21-question Q&A log, Goals, Non-goals, and Open Questions live at:

```text
docs/ai/specs/.process/SPEC-011-design-concept.md
```

Re-read it before each phase. It is the source of truth for setup decisions:
static-registration entrypoints only; one bounded branching graph per
entrypoint; fixed caps of 12 hops / 20 outgoing edges per step / 200 unique
steps with persisted truncation metadata; flows traverse all resolved edge
provenance classes (static, LSP, heuristic) with per-step provenance;
deterministic Louvain only, over a count-weighted undirected file graph;
Jaccard ≥ 0.5 one-to-one identity matching; explicit singleton clusters;
canonical heuristic labels with an optional separate SPEC-018 display label;
atomic full recompute after every successful index and sync; analysis failure
keeps the prior catalog marked stale; opt-in via `codegraph.json` (this repo
opts in); paged MCP/REST contracts with shared field semantics;
`codegraph_explore` untouched; CLI index pipeline as the self-repo UAT anchor;
**delivery as ONE PR** (Q21 — the maintainer declined the two-slice split).

> **Provenance note:** a prior 2026-07-13 scaffold (run by Codex) auto-accepted
> its own interview and was discarded; its branch commits were reset on
> 2026-07-14. This workflow derives from the fresh, human-ratified interview.

> **Note:** Grill Me is human-in-the-loop only. It is **not** part of
> the autopilot loop. Once the workflow file is populated and autopilot
> begins, clarifications happen via `/speckit-clarify` and the
> consensus protocol — never via grill-me.

---

## Reviewability Budget & Split Decision (setup gate record)

The setup-mode `reviewability-gate` ran on 2026-07-14 against the extracted
SPEC-011 roadmap section. Result: **WARN, pass=true**. The sole warning is
`reviewable LOC 525 exceeds warn threshold 400`; blockers are empty. The
roadmap records ~6 production files, ~13 total files, primary surface
schema/migration + API, greenfield allowance, and an advisory two-slice
estimate.

**Split decision (Q21, human-ratified 2026-07-14): NO split — one PR.**
The maintainer explicitly declined the recommended two-slice
(flows-first/clusters-second) delivery and accepted the 525-LOC warning:
525 is 31% over the 400 warn threshold and well under the 800 block
threshold, and a single PR keeps one integration point. This recorded
decision is what permits proceeding on a WARN per the setup gate's rules.
Planning must keep the actual reviewable-LOC estimate visible at G3; if the
plan-phase estimate materially exceeds 525 (approaching the 800 block
threshold), re-surface the split question to the maintainer rather than
silently proceeding.

### Template Resolution Record

Resolved from this worktree on 2026-07-14:

- `spec-template` → `speckit-pro-reviewability v1.0.0`
- `plan-template` → `speckit-pro-reviewability v1.0.0`
- `tasks-template` → `codegraph-project-overrides v1.0.0`, the intentional
  higher-priority layer that carries the reviewability section plus CodeGraph's
  constitutional test-policy exceptions

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 33 FR, 5 US, 21 AC, 10 SC, 5 entities; 0 [NEEDS CLARIFICATION] (G1 pass) |
| Clarify | `/speckit-clarify` | ✅ Complete | 3 sessions → 16 spec contract-refinements; G2 pass; 2 persistence decisions adversarially verified |
| Plan | `/speckit-plan` | ✅ Complete | plan+research+data-model+2 contracts+quickstart; G3 pass; Constitution I–VII pass; 5 tables + graph_write_version |
| Checklist | `/speckit-checklist` | ✅ Complete | 4 domains (~121 items); 36 gaps consolidated & applied (+6 FRs, +2 SCs across 7 artifacts); G4 pass |
| Tasks | `/speckit-tasks` | ✅ Complete | 68 tasks (T001–T068), 38 [P]; by user story; all required tasks present; G5 pass |
| Analyze | `/speckit-analyze` | ✅ Complete | 2 findings (1 HIGH, 1 LOW) remediated; 0 CRITICAL; G6 pass; REST-topology premise corrected |
| Implement | `/speckit-implement` | ⏳ Pending | TDD, dogfood UAT, paired benchmark |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | No unresolved markers; requirements agree with design-concept Q1–Q21 |
| G3 | After Plan | Constitution passes; atomic lifecycle explicit; actual reviewable-LOC estimate recorded and compared to the accepted 525 |
| G4 | After Checklist | All `[Gap]` markers addressed across the four required domains |
| G5 | After Tasks | Full FR/SC coverage; dogfood and benchmark tasks present |
| G6 | After Analyze | No `CRITICAL` issues or unresolved drift from the design concept |
| G7 | After Each Implementation Phase | Targeted and full tests pass; self-repo UAT and benchmark evidence recorded |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Treat Q1–Q21 as resolved; surface conflicting interpretations in Clarify rather than guessing. | Marker scan plus design-concept traceability in spec and plan |
| II. Simplicity First | One Louvain implementation; fixed caps; no incremental sync algorithm, no fallback clusterer, no cap configurability. | Plan complexity table empty or carries a ratified exception |
| III. Surgical Changes | New work lives in `src/analysis/`; edits to `schema.sql`, index/sync lifecycle, `src/mcp/`, `src/server/`, config, and build assets are minimal and declared. | File-operation table and diff review |
| IV. Goal-Driven Execution | Behavioral tests precede implementation; completion claims carry deterministic probes, UAT, benchmark, build, and suite evidence. | Red/green records and verification report |
| V. Deterministic, LLM-Free Extraction | Membership, identity, flow structure, and canonical labels derive only from graph/static evidence; optional LLM display label cannot change structure. | Repeat-index fixtures, provenance assertions, dormancy tests |
| VI. Retrieval Performance | New MCP outputs bounded and success-shaped; `codegraph_explore` untouched (Q16); no `isError` for expected conditions. | MCP contract tests; retrieval-guardian review of the `src/mcp/` diff |
| VII. Local-First | Analysis opt-in; disabled mode performs no analysis work, writes, or network calls; no native dependency; label endpoint user-configured. | Dormancy, dependency, config, and network-call tests |

**Constitution Check:** ✅ Setup alignment reviewed 2026-07-14. Worktree
preflight verified: 536 files indexed, embeddings 5,237/5,237 (100%), LSP
enabled, `node:sqlite` WAL backend. Each phase must re-run its required
constitution checks; setup did not substitute for `npm test`.

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-011 |
| **Name** | Execution Flows & Clusters |
| **Branch** | `011-execution-flows-clusters` |
| **Dependencies** | None (LLM display labels via SPEC-018 optional; dormant without `CODEGRAPH_LLM_*`) |
| **Enables** | SPEC-012 (flow impact enrichment), SPEC-019 (wiki chapters/walkthroughs) |
| **Priority** | P1 |
| **MCP tools** | 3 — `list_flows`, `get_flow`, `list_clusters` (final tool names/prefix resolved in Specify/Plan; existing tools use a `codegraph_` prefix) |
| **REST endpoints** | `/api/flows`, `/api/clusters` (extend SPEC-005 `src/server/` + `openapi.yaml`) |

### Success Criteria Summary

- [ ] Flow catalog: statically-registered entrypoints (routes, CLI, event/queue registrations, externally-exposed exports) each own one bounded branching flow graph persisted with per-step edge provenance and truncation metadata (Q1, Q2, Q5, Q7).
- [ ] Fixed caps 12 hops / 20 edges per step / 200 unique steps, versioned in code, cycle-safe (Q3, Q4).
- [ ] Flow names: route method+path, else CLI command, else qualified root symbol (Q6).
- [ ] Cluster catalog: deterministic Louvain over count-weighted undirected file graph; repeat index of an unchanged repo yields identical clusters (Q8–Q10).
- [ ] Cluster IDs stable across re-indexes via Jaccard ≥ 0.5 one-to-one overlap matching; singletons persisted explicitly (Q11, Q18).
- [ ] Heuristic labels canonical; optional SPEC-018 display label is separate presentation metadata; fully dormant without LLM env (Q12).
- [ ] Catalogs recompute in full and swap atomically after every successful index AND sync; analysis failure keeps prior catalog readable, marked stale with the graph version it reflects; core indexing never fails because of analysis (Q13, Q14).
- [ ] Opt-in per-catalog flags in `codegraph.json`; zero analysis cost when disabled; this repo opted in (Q15).
- [ ] MCP list tools return stable-sorted paged summaries; `get_flow` returns one bounded flow graph + truncation metadata; REST mirrors share field semantics; all responses success-shaped, never `isError` for expected conditions (Q16, Q17).
- [ ] `codegraph_explore` output byte-identical for existing queries (Q16 — do-not-regress).
- [ ] ≤20% median full-index overhead: ≥3 paired runs on the fixture monorepo, analysis off vs both catalogs on, embeddings/LSP held constant; recorded as evidence (Q19).
- [ ] Self-repo UAT: `codegraph index` CLI entrypoint flow reaches extraction → resolution → LSP → embedding stages with correct provenance/truncation; `src/` clusters coherent with IDs stable across two re-indexes (Q20).
- [ ] Delivered as one PR (Q21) with CHANGELOG entry under `[Unreleased]`.

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/011-execution-flows-clusters/spec.md`

### Specify Prompt

```text
/speckit-specify

## Feature: Execution Flows & Clusters (SPEC-011)

The CodeGraph knowledge graph gains two navigable, persisted catalogs — named
execution flows and functional clusters — exposed over MCP and REST, computed
deterministically from the existing graph (no LLM involvement in structure).
Source of truth for every scoping decision: the 21-question design concept at
docs/ai/specs/.process/SPEC-011-design-concept.md (all decisions Q1–Q21 are
resolved; do not re-open them as [NEEDS CLARIFICATION]).

### Problem Statement
Agents and downstream features (SPEC-012 change impact, SPEC-019 wiki) need
pre-computed answers to "what are this repo's execution paths?" and "which
files form functional units?" — today every consumer re-derives these from raw
nodes/edges per query.

### Users
- Downstream CodeGraph features: SPEC-012 (flow-impact enrichment) and
  SPEC-019 (per-cluster chapters, per-flow walkthroughs).
- AI agents and web/REST consumers browsing a repo's structure.
- CodeGraph maintainers dogfooding on this repo.

### Key Requirements (from the ratified design concept)
1. Entry-point detection: static registration evidence ONLY — existing route
   nodes, AST-resolved CLI/event/queue handler registrations, and
   externally-exposed exports (exports with zero project-internal callers).
   No name-based heuristics (Q1, Q5).
2. One flow per entrypoint: a single bounded branching call graph (cycle-safe
   DAG), NOT enumerated paths (Q2).
3. Fixed versioned caps: 12 hops deep, 20 outgoing edges per step, 200 unique
   steps per flow; truncation state persisted so bounded never implies
   complete (Q3, Q4).
4. Flows traverse all resolved call-edge provenance classes — static, LSP,
   heuristic/synthesized — and every persisted step carries its edge's
   provenance (Q7).
5. Flow naming: route method+path when rooted at a route; CLI command name for
   CLI entrypoints; else qualified root symbol (Q6, roadmap OQ-7).
6. Clusters: deterministic Louvain over an undirected file graph weighted by
   count-aggregated cross-file call+import evidence; files are vertices,
   symbols inherit their file's cluster (Q8–Q10). No second algorithm.
7. Cluster identity: Jaccard ≥ 0.5 greedy one-to-one overlap matching against
   the prior catalog; best-matching descendant of a split keeps the ID;
   deterministic tie-breaks; singletons persisted explicitly (Q11, Q18).
8. Labels: heuristic canonical label (dominant directory/name tokens);
   optional SPEC-018 LLM display label stored separately, presentation-only,
   never affecting membership/identity/canonical names; no model calls when
   unconfigured (Q12).
9. Lifecycle: full recompute after every successful index AND sync, atomic
   swap (readers never see partial catalogs); on analysis failure the index
   succeeds and the prior catalog stays readable, marked stale with its graph
   version; first-run failure yields an explicit "unavailable" state (Q13, Q14).
10. Activation: opt-in per-catalog flags in codegraph.json; disabled projects
    pay zero analysis cost; this repository enables both (Q15).
11. Surfaces: MCP list_flows/get_flow/list_clusters (paged, stable-sorted,
    bounded summaries; get_flow returns one bounded graph + truncation
    metadata) and REST /api/flows + /api/clusters mirroring the same field
    semantics; success-shaped guidance for expected conditions (not-indexed,
    analysis-disabled, stale, unknown id) — never isError (Q16, Q17).
12. codegraph_explore is NOT modified (Q16).
13. Performance: ≤20% median full-index overhead, proven by ≥3 paired runs on
    the fixture monorepo with embeddings/LSP config held constant (Q19).
14. Dogfood UAT: the codegraph index CLI pipeline flow end-to-end, plus
    cluster coherence/ID stability across two self-repo re-indexes (Q20).

### Constraints
- Constitution V: catalog structure, membership, identity, and canonical
  labels are deterministic and LLM-free.
- Constitution VI: bounded outputs; success-shaped errors; explore untouched.
- Constitution VII: local-first; opt-in; no new native dependencies.
- Delivery: ONE PR (Q21 — maintainer declined the two-slice split; 525-LOC
  warning accepted and recorded in the workflow file).

### Out of Scope
- UI panels (SPEC-006 consumes the API later); wiki prose (SPEC-019).
- Name-based entry-point heuristics; path enumeration; representative-path
  sampling; cap configurability; label-propagation fallback; tuned edge-weight
  ratios; incremental analysis maintenance; default-on activation; a separate
  analyze command; any codegraph_explore change; CI wall-clock gates.
- CLI listing subcommands (codegraph flows / codegraph clusters) — record as
  out-of-scope for v1 (design-concept Open Question; revisit on dogfood need).
```

### Specify Results

<!-- Fill in after running the command -->

| Metric | Value |
|--------|-------|
| Functional Requirements | 33 (FR-001–FR-033) |
| User Stories | 5 (US1 flows P1; US2 clusters, US3 identity, US4 lifecycle P2; US5 opt-in P3) |
| Acceptance Criteria | 21 scenarios + 9 edge cases |
| Success Criteria | 10 (SC-001–SC-010, measurable) |
| Gate G1 | ✅ pass — spec.md exists, 0 [NEEDS CLARIFICATION] |

### Files Generated

- [x] `specs/011-execution-flows-clusters/spec.md`
- [x] `specs/011-execution-flows-clusters/checklists/requirements.md` (spec-quality, 16/16 pass)

### SpecKit Traceability Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Agent lists a repo's execution flows` |
| `[FR-001]` | Functional requirement | `[FR-001] Flow tracing stops at 12 hops` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | Should not re-open Q1–Q21 decisions |
| `[P]` | Parallel-safe task | `[P] Can run alongside other tasks` |
| `[Gap]` | Missing coverage | `[Gap] No task covers stale marking` |

---

## Phase 2: Clarify

**When to run:** After Specify. The 21 setup decisions are resolved; Clarify
exists to catch drift and to pin the details the interview deliberately left
to Specify/Plan. Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: Contract & Naming Details

```text
/speckit-clarify Focus on API contract details the design concept left open:
final MCP tool names (existing tools use the codegraph_ prefix — do the new
tools follow it?), page-size defaults and limits for list_flows/list_clusters,
the min-size filter parameter for singleton suppression (Q18), stable sort
keys for both catalogs, and the exact shape of truncation metadata on get_flow.
Do NOT re-open Q1–Q21 of docs/ai/specs/.process/SPEC-011-design-concept.md.
```

#### Session 2: Persistence & Lifecycle Details

```text
/speckit-clarify Focus on persistence details: flows/flow_steps and cluster
table shapes, how the atomic swap is implemented in SQLite (transaction over
generation-tagged rows), where the "analyzed graph version" token comes from,
how staleness is represented and surfaced (Q13/Q14), and how prior-catalog
membership is loaded for Jaccard identity matching (Q11). Confirm schema.sql
changes ship via the existing copy-assets path.
```

#### Session 3: Entry-Point Evidence Inventory

```text
/speckit-clarify Focus on entry-point detection evidence (Q1/Q5): which
existing graph facts identify route nodes, CLI command registrations,
event/queue handler registrations, and "externally-exposed exports" (exports
with zero project-internal callers) — and what happens on repos where none
exist (empty catalog is valid, success-shaped).
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Contract & Naming | 5 | `codegraph_`-prefixed tool names; shared offset/limit paging (MCP 20/100, REST 100/500, `{items,total,limit,offset}`); `minSize` (default 1); truncation `{truncated,{depth,width,totalSteps}}`; deterministic sorts (flows: name,id / clusters: count desc,label,id) |
| 2 | Persistence & Lifecycle | 5 | monotonic `graph_write_version` + derived staleness (FR-022); no-CASCADE by-value rows +denormalized name/kind (FR-022a); single-WAL-txn swap +single-snapshot composite reads (FR-021/021a); opaque cluster id (FR-017a); schema.sql + lockstep migration |
| 3 | Entry-Point Evidence | 5 | CLI commander AST recognizer (FR-001); event/queue via callback registrars (fixture-validated); exposed-export = `isExported` + 0 inbound `calls`/`references`; traverse `calls`+`references` (FR-008); empty entry-point set → available-empty |

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|------|----------------------|------------|-------|---------|------------|---------------|
| 1 | Clarify | FR-022a: no `ON DELETE CASCADE` on catalog rows | [codebase] | 1 | survives (+refined) | By-value refs, no cascade (confirmed *necessary* — line-dependent node ids dangle on any edit); added denormalized `name`/`kind` so stale rows stay displayable | codebase-analyst (adversarial) |
| 2 | Clarify | FR-021: single-WAL-txn swap, no generation rows | [codebase, domain] | 1 | partial→refined | Write-side confirmed; added FR-021a requiring single-snapshot composite reads (`total`+page) to close the `queryPool:true` daemon torn-read gap | codebase-analyst (adversarial) |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Output: `specs/011-execution-flows-clusters/plan.md`

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Language: TypeScript (strict), Node >=20 <25 engines; node:sqlite
  (DatabaseSync) via src/db/sqlite-adapter.ts — WAL + FTS5, no native deps.
- Modules: new code in src/analysis/flows/ and src/analysis/clusters/
  (opt-in module discipline — this is a tracking fork; keep diffs to
  upstream-owned files minimal and declared).
- Existing seams: src/db/schema.sql + QueryBuilder prepared statements;
  index/sync lifecycle in src/index.ts (CodeGraph.indexAll/sync); MCP tools in
  src/mcp/tools.ts with server-instructions.ts as the agent-guidance source of
  truth; REST in src/server/ with committed openapi.yaml (SPEC-005); config
  via codegraph.json (SPEC-008 LSP flag is the precedent).
- Testing: vitest, real files + real SQLite in temp dirs (no DB mocking),
  tests in __tests__/ mirroring modules.

## Constraints (from the ratified design concept — quote Q-numbers in the plan)
- Deterministic Louvain only (Q8); files as vertices (Q9); count-aggregated
  equal weights, undirected, self-loops dropped (Q10); Jaccard >= 0.5 greedy
  one-to-one identity with deterministic tie-breaks (Q11); explicit singletons
  (Q18).
- Static-registration entrypoints only (Q1, Q5); one bounded branching graph
  per entrypoint (Q2); fixed caps 12/20/200 with truncation metadata (Q3, Q4);
  all edge provenance classes traversed, provenance per step (Q7); naming per
  Q6.
- Atomic full recompute after every successful index AND sync (Q13); failure
  keeps prior catalog marked stale, never fails the index (Q14); opt-in
  codegraph.json flags, zero cost disabled (Q15).
- MCP/REST: paged summaries + detail, shared field semantics, bounded,
  success-shaped (Q17); codegraph_explore untouched (Q16).
- <=20% median paired-benchmark overhead on the fixture monorepo (Q19).
- Delivery: ONE PR (Q21). Record the actual reviewable-LOC estimate at G3 and
  compare against the accepted 525; if it approaches the 800 block threshold,
  stop and re-surface the split to the maintainer.

## Architecture Notes
- Re-read docs/ai/specs/.process/SPEC-011-design-concept.md before planning.
- Analysis reads the graph AFTER reference resolution (and LSP pass when
  enabled) so flows ride synthesized/corrected edges.
- Prefer generation-tagged rows + a single transactional pointer swap for
  atomicity; readers always see exactly one complete catalog generation.
- LSP precision (SPEC-008) and embeddings must be held constant in the
  benchmark harness (Q19).
- src/mcp/ diff will be reviewed by the retrieval-guardian agent before PR.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ | Technical context + execution flow; Constitution I–VII PASS (re-checked post-design); complexity table empty |
| `research.md` | ✅ | R1–R6 implementation-research decisions resolved |
| `data-model.md` | ✅ | 5 tables (flows, flow_steps, clusters, cluster_members, catalog_meta) + `graph_write_version` metadata; no-cascade by-value + denormalized name/kind; opaque cluster id |
| `contracts/` | ✅ | `mcp-tools.md` (3 tools) + `rest-api.md` (2 endpoints + `/api/flows/{id}`); shared field semantics |
| `quickstart.md` | ✅ | Developer onboarding |

**G3 reviewability update (Plan phase, 2026-07-14):** plan-time grounded
re-estimate ≈ **620 reviewable LOC central** (range ~525–720; upper-bound
~865), ~18% above the accepted 525 but under the 800 block. The deterministic
`estimate-reviewable-loc` helper returned `not_estimated` (plan.md's template
format carries no machine-parseable NEW/MODIFIED file declarations), so the
plan agent's grounded estimate is operative. Per the advisory rule this does
NOT block the autonomous run; the ratified Q21 one-PR decision covers this warn
(still under block). **Hard checkpoint:** at PR time, measure the ACTUAL
reviewable diff — if it exceeds ~700 (approaching the 800 block), STOP and
re-surface the flows/clusters split to the maintainer before opening the PR.

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates spec AND plan together.

### Step 1: Recommended Domains (from spec analysis)

| Signal in SPEC-011 | Domain |
|---|---|
| flows/flow_steps/cluster tables, atomic generation swap, identity matching state | **data-integrity** |
| 3 MCP tools + 2 REST mirrors with shared paged contracts | **api-contracts** |
| ≤20% index-overhead gate, fixed trace caps, Louvain runtime | **performance** |
| stale marking, first-run unavailable state, success-shaped MCP guidance | **error-handling** |

### Step 2: Run Enriched Checklist Prompts

#### 1. data-integrity Checklist

```text
/speckit-checklist data-integrity

Focus on Execution Flows & Clusters requirements:
- flows/flow_steps/cluster tables: constraints, foreign keys to nodes/files,
  generation tagging, and the atomic swap (no reader ever sees a partial or
  mixed-generation catalog)
- prior-catalog retention for Jaccard identity matching and for
  failure-with-stale-mark (Q11, Q14) — including first-run failure
- truncation metadata persisted with each flow (Q3/Q4) and provenance
  persisted with each step (Q7)
- deterministic recomputation: same graph in, byte-identical catalogs out
- Pay special attention to: the atomic swap under concurrent daemon readers
```

#### 2. api-contracts Checklist

```text
/speckit-checklist api-contracts

Focus on Execution Flows & Clusters requirements:
- list_flows/list_clusters paging: stable sort, page-size bounds, min-size
  filter for singletons (Q18)
- get_flow bounded graph shape + truncation metadata; unknown-id and
  analysis-disabled responses success-shaped, never isError (Q17,
  Constitution VI)
- REST /api/flows and /api/clusters mirror MCP field semantics exactly;
  openapi.yaml updated (SPEC-005 precedent)
- codegraph_explore byte-identical for existing queries (Q16)
- Pay special attention to: MCP/REST drift — one shared contract definition
```

#### 3. performance Checklist

```text
/speckit-checklist performance

Focus on Execution Flows & Clusters requirements:
- ≤20% median full-index overhead: ≥3 paired fixture-monorepo runs, analysis
  off vs both catalogs on, embeddings + LSP held constant (Q19)
- trace-cap enforcement actually bounds work (12/20/200, cycle-safe) on
  god-function fan-out
- Louvain runtime and memory on the largest supported repos (file-vertex graph
  keeps this tractable — Q9)
- sync-path overhead: full recompute after every sync (Q13) must not make
  watch-driven syncs sluggish on this repo (dogfood)
- Pay special attention to: the benchmark harness holding env constant
```

#### 4. error-handling Checklist

```text
/speckit-checklist error-handling

Focus on Execution Flows & Clusters requirements:
- analysis failure after successful graph update: index succeeds, prior
  catalog readable + stale-marked with its graph version (Q14)
- first-run analysis failure: explicit "unavailable" state, not empty-catalog
  ambiguity (Q14, Q18 rationale)
- disabled/unconfigured states: no analysis work, no writes, no model calls
  (Q12, Q15) — dormancy is testable
- MCP expected conditions (not indexed, disabled, stale, unknown id) return
  success-shaped guidance — isError reserved per src/mcp error-shaping rules
- Pay special attention to: staleness surfaced but never blocking reads
```

### Checklist Results

| Checklist | Items | Gaps | Key remediations applied |
|-----------|-------|------|--------------------------|
| data-integrity | 33 | 8 | FR-008a (deterministic tracing order), FR-017a (content-hash cluster-id mint), FR-021a (composite-read completeness + REST topology), FR-022a (denormalized display), FR-025 (enabled→disabled flag-first) |
| api-contracts | 32 | 8 | FR-009/data-model (3-value provenance enum, root=null, MUST NOT reuse Edge.provenance), FR-028a (drift parity test), FR-030 (state enum), SC-012 (explore golden test), REST envelopes + BINARY collation |
| performance | 27 | 11 | FR-005 (unbounded-flows note), SC-006/007 (benchmark fixture + method + zero-overhead def), plan (cooperative-yield), research R1 (Louvain large-repo) |
| error-handling | 29 | 13→9 | FR-019 (LLM credential redaction), FR-020 (partial-index + serialization), FR-022b (failure taxonomy), FR-030/SC-009 (unavailable+empty, isError boundary), SC-011 (dormancy), edge cases (mixed-outcome, cancellation) |
| **Total** | ~121 | 36 | Report-only parallel domains → orchestrator-consolidated & applied by one writer; 0 [Gap]/[NEEDS CLARIFICATION] (G4 pass) |

**Approach:** the 4 domains ran read-only in parallel; the orchestrator deduplicated ~36 gaps (3 domains independently flagged the provenance/root defect; 2 flagged the state enum; 2 flagged tracing determinism), decided each faithfully to the ratified design, and delegated application to one writer to avoid contention. Correctness-critical fixes prevented real defects: silent LSP-provenance drop, non-deterministic cluster-id minting, torn composite reads on the REST shared-writer connection.

### Addressing Gaps

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why (cite the
   design-concept Q-number when the cut was ratified there)

---

## Phase 5: Tasks

**When to run:** After checklists complete. Output: `specs/011-execution-flows-clusters/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, testable chunks (1-2 hours each); TDD-shaped: each task names the
  failing test it starts from
- Clear acceptance criteria referencing FR-xxx
- Dependency ordering: schema/persistence foundation → flows (entrypoints →
  tracer → naming → persistence) → clusters (file graph → Louvain → identity →
  labels) → MCP tools → REST mirrors → lifecycle wiring → dogfood UAT +
  benchmark
- Mark parallel-safe tasks explicitly with [P]
- Organize by user story, not by technical layer
- ONE PR delivery (Q21) — do NOT split tasks into per-PR groups

## Bounds (from the design concept — flag any task crossing these)
- No codegraph_explore changes; no CLI subcommands; no cap configurability;
  no second clustering algorithm; no incremental maintenance; no LLM calls in
  structure-affecting paths (Non-goals, design concept)

## Required tasks (do not drop)
- Determinism fixture: index twice, catalogs byte-identical
- Identity fixture: membership churn across re-index keeps/mints IDs per Q11
- Dormancy tests: disabled flags → zero analysis writes; no CODEGRAPH_LLM_* →
  zero model calls (Q12, Q15)
- Paired benchmark harness + recorded ≤20% median evidence (Q19)
- Self-repo UAT: CLI index pipeline flow + cluster stability (Q20)
- CHANGELOG entry under [Unreleased] (user-facing: new catalogs + MCP/REST)
- retrieval-guardian review of the src/mcp/ diff before PR
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | 68 (T001–T068) |
| **Phases** | 8 (Setup, Foundational, US1 flows/MVP, US2 clusters, US3 identity, US4 lifecycle, US5 activation, Polish) |
| **Parallel Opportunities** | 38 `[P]` |
| **User Stories Covered** | US1=14, US2=12, US3=4, US4=8, US5=7; all FRs (39) + SCs (12) cited |

**Verify-tasks (phantom check):** trivially clean — 0 tasks marked `[X]` pre-implementation (nothing to phantom-verify yet). **Reviewability tasks-mode gate:** deferred on the installed runner (per skill); falling back to the committed evidence chain — setup-gate WARN (525, accepted Q21), plan-phase estimate ~620 (advisory, under 800 block), and the ratified one-PR decision. Hard re-check deferred to PR time (measure actual diff; >~700 → re-surface split).

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

Note: the maintainer's Q21 decision (one PR) is a setup-time delivery decision;
the classifier's route is recorded alongside it for downstream tooling, not to
overturn it silently. If the classifier strongly recommends `split-PR`, surface
that to the maintainer at G5 rather than acting on it.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | `single-atomic-PR` | Recorded from the read-only classifier 2026-07-14. NOT `split-PR` → aligns with the ratified Q21 one-PR delivery; no split to surface. |
| **Releasable** | `false` (keyword false-positive — see assessment) | Classifier flag on a `destructive-migration` keyword match. |
| **Signals** | `hard-atomic:destructive-migration`, `change-shape:modify-heavy`, `releasability:destructive-migration` | Triggered by `DELETE FROM` near a `.sql`/`schema` token in the corpus. |
| **Warnings** | `destructive migration: CI-green ≠ releasable` | Carried forward as a PR-verification caution (see assessment). |

**Assessment (advisory route; does not block — layer_plan: skipped, non-split route).**
The `destructive-migration` / `releasable:false` reading is a **keyword false-positive**. The matched `DELETE FROM` statements are the catalog **atomic-swap** mechanism (delete-all + insert-all inside one transaction, FR-021) operating on THIS feature's OWN new tables (`flows`/`flow_steps`/`clusters`/`cluster_members`/`catalog_meta`); migration **v10 is purely additive** (`CREATE TABLE`, the `node_vectors` v9 pattern) and drops/alters no existing table or user data. No existing schema or data is destroyed. The `CI-green ≠ releasable` caution is nonetheless honored: PR verification MUST include the self-repo dogfood sync + UAT (SC-010, T063) proving the migration and swap behave correctly on a real already-initialized project — not passing unit tests alone.

To produce the decision, run the classifier against the feature directory:

```text
runner helper atomicity-route specs/011-execution-flows-clusters
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment — Principles V (deterministic structure), VI
   (bounded, success-shaped MCP; explore untouched), VII (opt-in, local-first)
2. Design-concept drift — every requirement in spec.md/plan.md/tasks.md must
   trace to Q1–Q21 of docs/ai/specs/.process/SPEC-011-design-concept.md or to
   a Clarify outcome; the design concept wins unless a revision is recorded
3. Coverage gaps — all FRs and user stories have tasks; the required tasks
   list from the Tasks prompt (determinism, identity, dormancy, benchmark,
   UAT, CHANGELOG, retrieval-guardian) is present
4. Consistency between task file paths and the actual project structure
   (src/analysis/, src/db/schema.sql, src/mcp/tools.ts, src/server/,
   __tests__/)
5. One-PR delivery (Q21) reflected consistently — no phantom slice boundaries
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
| F1 | HIGH | REST read-path topology mischaracterized (a "shared-writer connection" premise originating in checklist CHK007, adopted into FR-021a) — would misdirect REST wiring to add a forbidden DB connection to the web `serve` process (SPEC-005 FR-002, Constitution III) | Corrected across spec FR-021a / plan / tasks (T025/T037/T043) / data-model: web `serve` is a daemon *client* (`src/server/daemon-client.ts`) with no DB handle; both surfaces read on the daemon's worker connections (one topology). Single-fetch mandate preserved. |
| F2 | LOW | `contracts/rest-api.md` openapi-additions list omitted the `minSize` query param for `/api/clusters` (specified elsewhere) | Added `MinSize` query param (integer, default 1, min 1) to the additions list (FR-029) |
| — | — | **G6: 0 CRITICAL / 0 HIGH remain** (verified over 2 remediation loops + a forked re-run) | — |

### Pre-Implement Confidence (G6.5)

📊 Confidence: 0.96

- Task understanding: 0.95
- Approach clarity: 0.92
- Requirements alignment: 0.95
- Risk assessment: 1.00
- Completeness: 0.98

Basis: spec (39 FR / 12 SC / 5 US, 0 markers); plan + data-model + contracts coherent and adversarially verified; tasks.md (68) trace every FR/SC with all required tasks present; 0 open CRITICAL/HIGH after Analyze. Approach-clarity carries a mild deduction for the REST-topology premise that survived Clarify + Checklist before Analyze corrected it against ground truth (now fixed). Gate mode: advisory, threshold 0.90 → PASS.

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```text
/speckit-implement

## Approach: TDD-First

For each task:
1. **RED**: Write failing test defining expected behavior
2. **GREEN**: Implement minimum code to make the test pass
3. **REFACTOR**: Clean up while tests still pass
4. **VERIFY**: Manual verification of acceptance criteria

### Project Commands
- BUILD: npm run build   (copies schema.sql + wasm into dist/ — any new SQL
  must ship via copy-assets or it won't reach dist)
- UNIT TEST: npm test    (vitest run, all)
- SINGLE FILE: npx vitest run __tests__/<file>.test.ts
- FULL VERIFY: npm run build && npm test

### Pre-Implementation Setup
1. Work in .worktrees/011-execution-flows-clusters/ on branch
   011-execution-flows-clusters — never main
2. Verify all tests pass before making changes
3. Worktree is bootstrapped (node_modules, dist, .codegraph with 100%
   embeddings + LSP); re-run npm run build after pulling changes

### Implementation Notes
- Tests write real files and exercise real SQLite in mkdtempSync temp dirs —
  no DB mocking; clean up in afterEach
- New modules in src/analysis/flows/ and src/analysis/clusters/; keep diffs
  to upstream-owned files (src/index.ts, src/mcp/tools.ts, src/db/schema.sql,
  src/server/) minimal and surgical (Constitution III)
- MCP guidance text changes belong in src/mcp/server-instructions.ts (single
  source of truth); success-shaped responses for expected conditions
- Platform-sensitive behavior must be gated, not assumed (analysis itself is
  pure computation; the lifecycle hooks into sync, which is already
  platform-tested)
- Before opening the PR: run the retrieval-guardian agent on the diff
  (src/mcp/ is touched), record the paired-benchmark evidence (Q19), run the
  self-repo UAT (Q20), add the CHANGELOG entry under [Unreleased]
- Dogfooding Protocol: after merge to main — npm run build, then
  codegraph sync
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Foundation (schema/persistence) | T001–T012 | ✅ 12/12 | 5 tables + v10 migration + `graph_write_version` + catalog-store (atomic swap / single-fetch reads / 6-state) + shared wire types; 32 TDD tests green; build+typecheck pass |
| 2 - Flows end-to-end (US1) | T013–T026 | ✅ 14/14 | entry-points (routes + commander CLI recognizer + event/queue registrars + exposed exports) + deterministic DFS tracer (caps 12/20/200, calls+references, per-axis truncation) + naming + `runFlowAnalysis` + 2 MCP tools + 2 REST endpoints (daemon-forwarded) + openapi; 31 flow tests green; `explore`/`server-instructions` untouched |
| 3 - Clusters + identity (US2/US3) | T027–T042 | ✅ 16/16 | file-graph + pure-TS deterministic Louvain (no new dep) + labels + Jaccard identity (content-hash mint, best-descendant, deterministic tie-break) + `runClusterAnalysis` + `list_clusters` MCP + `/api/clusters` REST + openapi; 38 tests green; full analysis suite 101/101 |
| 4 - Lifecycle wiring (US4) | T043–T050 | ✅ 8/8 | surgical additive `indexAll`/`sync` recompute hook (AbortSignal-honored) + `maybeRunCatalogAnalysis` + bounded failure taxonomy (index never fails on analysis error) + per-catalog independence + cooperative-yield; 10 lifecycle tests green; sync(30)/index-command(6) isolation green |

**Phase 7 test-environment notes (for G7 + PR verification):**
- **Run regressions with `CODEGRAPH_EMBEDDING_*` cleared and capture vitest's real exit (`PIPESTATUS[0]`, not `tail`'s).** This worktree's direnv sets `CODEGRAPH_EMBEDDING_URL=http://hal:1234`; with it set, 3 tests fail because they assume an embeddings-stripped env — `server-read-api.test.ts` (`/api/status` hybrid, `/api/search` degradation) and `mcp-staleness-banner.test.ts` (banner↔footer). All pass with the vars cleared — **env-driven, NOT SPEC-011 regressions** (no group modified those code paths).
- **Concurrency-timeout flakes**: a shifting subset of parse-heavy suites (`refactor-apply`, `graph-traversal`, `backend-delegation`, …) intermittently time out at 5000ms under full-suite load; all pass in isolation. Known repo characteristic, not regressions.
- **Fixed v10 schema-version test-debt**: the v10 migration (T005) bumped the DB schema version; `pr19-improvements.test.ts` (Group A), `embeddings-index.test.ts:114`, and `foundation.test.ts:399` all asserted `9` → corrected to `10`.
| 5 - Activation (US5) | T051–T057 | ✅ 7/7 | opt-in flags (T054 via US1) + dormancy gating (T055 via US4) verified byte-identical; LLM display-label advisory dormant + credential-redaction-safe, no client added (T056); `codegraph.json` enables both catalogs for dogfood (T057); 16 activation tests green; full suite 3618 passed / 0 failed |
| 6 - Polish | T058–062, 064, 065 | ✅ | cross-surface parity + explore-unchanged golden (do-not-regress) + end-to-end determinism fixture + paired benchmark harness (median B/A ≈ 1.01–1.06, ≤1.20 **PASS**) + zero-overhead evidence + CHANGELOG (3 [Unreleased] bullets); full suite 3626 passed / 0 failed. T063 UAT · T066 guardian · T067 PR-packet · T068 LOC-remeasure → post-implementation |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Build succeeds: `npm run build` (new schema assets ship in dist/)
- [ ] Tests pass: `npm test`
- [ ] Determinism + identity + dormancy fixtures green
- [ ] Paired benchmark recorded: ≤20% median overhead (Q19 evidence)
- [ ] Self-repo UAT recorded: CLI index pipeline flow + cluster stability (Q20)
- [ ] `codegraph_explore` regression check: existing queries unchanged (Q16)
- [ ] retrieval-guardian review of src/mcp/ diff passed
- [ ] CHANGELOG entry under `[Unreleased]` (user-facing wording, no internals)
- [ ] PR created against origin (racecraft-lab/codegraph) — one PR (Q21); no
      session URLs in the PR body
- [ ] Merged to main; post-merge: `npm run build` + `codegraph sync`
      (Dogfooding Protocol)

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
│   ├── analysis/            # NEW — flows/ and clusters/ (this spec)
│   ├── db/                  # schema.sql (modify), QueryBuilder, sqlite-adapter
│   ├── extraction/          # tree-sitter extractors (read-only for this spec)
│   ├── resolution/          # resolvers + synthesizers (read-only; flows ride their edges)
│   ├── graph/               # GraphTraverser/GraphQueryManager (read-only seams)
│   ├── mcp/                 # tools.ts (+3 tools), server-instructions.ts
│   ├── server/              # REST /api/flows, /api/clusters + openapi.yaml
│   ├── sync/                # FileWatcher — lifecycle trigger (minimal touch)
│   └── index.ts             # CodeGraph class — lifecycle wiring (minimal touch)
├── __tests__/               # vitest suites mirroring modules
├── specs/011-execution-flows-clusters/   # spec.md, plan.md, tasks.md, SPEC-MOC.md
└── docs/ai/specs/.process/  # SPEC-011-design-concept.md, this workflow file
```

---

Template based on SpecKit best practices; populated from the technical roadmap
(SPEC-011 section) and the 2026-07-14 human-ratified design concept.
