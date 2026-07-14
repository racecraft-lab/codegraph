---
description: "Task list for SPEC-011 Execution Flows & Clusters"
---

# Tasks: Execution Flows & Clusters

**Input**: Design documents from `/specs/011-execution-flows-clusters/`

**Prerequisites**: plan.md, spec.md (39 FRs, 12 SCs, 5 user stories), research.md (R1–R6 + Q1–Q21 decision log), data-model.md (5 tables + `graph_write_version`), contracts/mcp-tools.md, contracts/rest-api.md, quickstart.md

**Tests**: TESTS ARE REQUIRED for this feature. The feature request explicitly asks for a TDD-shaped decomposition (each task names the failing test it starts from) and enumerates a set of required test tasks; every user story therefore leads with failing tests written and confirmed red before implementation (Constitution IV). This is a new-module feature, not a bug fix or installer change, so the two constitutional test exceptions do not apply here.

**Reviewability**: The spec carries an accepted PRD-time warning (~525 reviewable LOC) and a plan-time grounded re-estimate of ≈620 (range ~525–720, upper ~865) — above the 400 warn line, under the 800 block line — delivered as **one PR** under the ratified Q21 one-PR exception (the maintainer explicitly declined the flows/clusters split). A reviewability checkpoint (T012) records the exception before implementation and T068 re-measures actual LOC at PR time. Do NOT expand this list past the reviewability budget instead of splitting; the split was ratified as declined.

**Organization**: Tasks are grouped by user story (US1 flows, US2 clusters, US3 identity, US4 lifecycle, US5 activation), NOT by technical layer. All work lands in one PR (Q21) — the phase order is dependency order, not PR boundaries.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (setup / foundational / polish tasks carry no story label)
- Every task names an exact file path.

## Path map (from plan.md → Source Code)

New module `src/analysis/` (Principle III sanctioned): `index.ts` (orchestrator), `catalog-store.ts`, `types.ts`, `flows/{entry-points,tracer,naming}.ts`, `clusters/{file-graph,louvain,identity,labels}.ts`. Wiring: `src/db/schema.sql`, `src/db/migrations.ts` (v10, head is v9), `src/db/queries.ts` (`graph_write_version` mirrors `vectors_write_version`), `src/index.ts` (hook at the `maybeRunEmbeddingPass` site — indexAll ~L1018, sync ~L1466), `src/mcp/tools.ts` (3 tools), `src/server/routes.ts` + `src/server/openapi.yaml` (2 endpoints), `src/project-config.ts` (opt-in flags). Tests: `__tests__/analysis/`. Benchmark: `scripts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module skeleton and shared fixtures. No behavior.

- [x] T001 [P] Scaffold the `src/analysis/` module tree (placeholder-export `index.ts`, `catalog-store.ts`, `types.ts`, and `flows/`, `clusters/` subdirs) per plan.md; must `npm run build` clean.
- [x] T002 [P] Create the `__tests__/analysis/` tree (subdirs `flows/`, `clusters/`, `catalog-lifecycle/`, `activation/`) and `__tests__/analysis/fixtures/` mirroring `src/analysis/`.
- [x] T003 [P] Add the committed, deterministically-generated benchmark-monorepo fixture generator at `__tests__/analysis/fixtures/benchmark-monorepo/` (≥3 languages/frameworks, a god-function fan-out, one route entry point, one commander CLI entry point), materialized by the test harness — shared by the SC-004 determinism fixture (T060) and the SC-006 benchmark (T061).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + catalog-store persistence substrate that every user story builds on. Matches the ratified dependency ordering "schema/persistence foundation → catalog-store (swap, single-fetch composite reads, staleness)".

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Add the five catalog tables (`flows`, `flow_steps`, `clusters`, `cluster_members`, `catalog_meta`) plus the deterministic-sort indexes (`flows(name,id)`, `clusters(member_count DESC,canonical_label,id)`, `flow_steps(flow_id)`, `cluster_members(cluster_id)`) to `src/db/schema.sql` — NO foreign keys and NO `ON DELETE CASCADE` on any catalog table (FR-022a); node-bearing rows carry denormalized `name`/`kind` columns (FR-022a). Byte-equivalent shape to the migration.
- [x] T005 Add the lockstep **v10** migration (the five tables + indexes, idempotent `CREATE TABLE IF NOT EXISTS`) to `src/db/migrations.ts` following the `node_vectors` v9 precedent; confirm `CURRENT_SCHEMA_VERSION` derives to 10 and schema.sql/migrations.ts define identical table shapes.
- [x] T006 [P] Add a schema-ship assertion test in `__tests__/analysis/schema-ship.test.ts` proving `copy-assets` copies the updated `src/db/schema.sql` to `dist/db/schema.sql` (Constitution VII — new SQL must ship).
- [x] T007 [P] Add `graph_write_version` read + monotonic-advance helpers to `src/db/queries.ts` alongside the `vectors_write_version` accessors (project-metadata store); advance is +1 per successful index/sync, maintained ONLY when ≥1 catalog is enabled (FR-022 timing wired later in T047; dormancy gate in T055).
- [x] T008 [P] Define the shared TypeScript wire-shape types in `src/analysis/types.ts` — `FlowSummary`, `FlowDetail`, `FlowStep`, `ClusterSummary`, the list envelope `{items,total,limit,offset,sourceVersion,state}`, the **3-value** provenance wire enum `static|lsp|heuristic` (MUST NOT reuse the 2-value `Edge.provenance`), and the **6-value** state enum `available|stale|empty|unavailable|disabled|not_indexed`. This is the single source both MCP and REST render from (FR-028a).
- [x] T009 Implement the atomic single-transaction catalog-swap write primitive in `src/analysis/catalog-store.ts` — per-kind `BEGIN; DELETE child+parent rows; INSERT new rows; INSERT OR REPLACE catalog_meta; COMMIT`; NO generation-tagged rows, no multi-generation retention (FR-021).
- [x] T010 Implement the single-snapshot composite read primitives in `src/analysis/catalog-store.ts` — full-fetch-then-slice per the `src/mcp/read-ops.ts` precedent for (a) list envelope + `total`, (b) `get_flow` header + `flow_steps`, (c) the read-state probe (catalog_meta + content-row count). Every composite read derives from a single statement or a single full-fetch-then-slice — never two separately-issued statements — so a concurrent swap cannot yield a torn cross-generation read on EITHER connection topology (FR-021a).
- [x] T011 Implement read-time state resolution in `src/analysis/catalog-store.ts` returning the 6-value `state`: live per-catalog opt-in flag consulted FIRST (→`disabled`), then `unavailable` (first_run_failed), `available`, `empty` (available-but-empty), `stale` derived as `computed_from_version < graph_write_version` (never a stored flag) (FR-022/FR-023/FR-025/FR-030).
- [x] T012 Reviewability checkpoint: record the ratified Q21 one-PR exception in the PR packet and confirm planned scope stays under the 800-LOC / 8-production-file / 25-total-file block thresholds (plan G3 action); if a task would push scope over without the exception, STOP and split rather than add tasks.

**Checkpoint**: Persistence substrate ready — analysis engines can now be built and driven directly against a temp-DB catalog-store.

---

## Phase 3: User Story 1 - Discover and inspect execution flows (Priority: P1) 🎯 MVP

**Goal**: A consumer lists named execution flows and opens one to see its bounded, per-step-provenance, truncation-aware call graph.

**Independent Test**: Drive `runFlowAnalysis` against a temp DB seeded with a route + a commander CLI entry point, then read the MCP/REST flow surfaces — exactly one flow per entry point, route flow named `<METHOD> <path>`, every non-root step carries provenance, caps produce truncation markers. (Index-time automation of this analysis lands in US4/T049 per the ratified late-hook ordering; the engine is exercised directly in-story.)

### Tests for User Story 1 (write FIRST, confirm RED) ⚠️

- [x] T013 [P] [US1] Entry-point detection tests in `__tests__/analysis/flows/entry-points.test.ts` — route nodes; commander `.command('<name>').action(<handler>)`; event/queue handler via re-applied callback/observer registrars (registered handler marked root); externally-exposed export (`isExported` callable, zero inbound `calls`/`references` of any provenance); NO name-based heuristics; an entry qualifying two ways roots exactly one flow (FR-001/002/003).
- [x] T014 [P] [US1] Deterministic tracing-order test in `__tests__/analysis/flows/tracer-order.test.ts` — candidate out-edges visited in the stable total order (target file path → edge-kind rank → callee qualified name → stable edge key) BEFORE the 20-edge width cap and 200-step cap select survivors; a node reached via multiple parents records the parent of its first visit (FR-008a).
- [x] T015 [P] [US1] Truncation test in `__tests__/analysis/flows/tracer-truncation.test.ts` — depth(12)/width(20)/totalSteps(200) axis flags set independently; a flow hitting all three records all three; `truncated` = disjunction; a bounded flow is never presented as complete (FR-005/006/007, SC-002).
- [x] T016 [P] [US1] Provenance-enum test in `__tests__/analysis/flows/provenance.test.ts` — non-root `flow_steps` carry the 3-value `static|lsp|heuristic` wire enum, NOT the collapsed 2-value `Edge.provenance` (which would drop `lsp`); the root step (depth 0) carries `provenance=null` and `edge_kind=null`; 100% of non-root steps carry a provenance (FR-008/009, SC-001).
- [x] T017 [P] [US1] Flow-naming test in `__tests__/analysis/flows/naming.test.ts` — `<METHOD> <path>` when route-rooted, CLI command name when CLI-rooted, else qualified root symbol (FR-010).
- [x] T018 [P] [US1] MCP contract tests for `codegraph_list_flows` + `codegraph_get_flow` in `__tests__/analysis/flows/mcp-flows.test.ts` — offset/limit paging (default 20, clamp 1–100, over-cap clamps not errors), sort `name` asc then `id`, `get_flow` shape `{truncated, truncation:{depth,width,totalSteps}}`, success-shaped `unknown flow id` / disabled / not-indexed (never `isError`) (FR-027/030).
- [x] T019 [P] [US1] Flow-catalog determinism test in `__tests__/analysis/flows/determinism.test.ts` — analyzing an unchanged graph twice yields byte-identical `flows` + `flow_steps` rows (SC-004 flows portion).

### Implementation for User Story 1

- [x] T020 [P] [US1] Implement `src/analysis/flows/entry-points.ts` — the four static sources (route nodes; NEW minimal commander CLI recognizer reusing the existing inline-handler body-attribution technique; event/queue via re-applied callback/observer registrars; exposed exports) deduped to one root per entry point (FR-001/003, research R5).
- [x] T021 [US1] Implement `src/analysis/flows/tracer.ts` — bounded branching cycle-safe trace over BOTH `calls` and `references` out-edges of the root (route flows root at the `route` node) across all provenance classes; fixed caps 12/20/200 (code-versioned, never configurable); deterministic total order (FR-008a); per-step provenance + per-axis truncation (FR-004/005/006/007/008/009).
- [x] T022 [P] [US1] Implement `src/analysis/flows/naming.ts` (FR-010).
- [x] T023 [US1] Implement `runFlowAnalysis(graph, store)` in `src/analysis/index.ts` composing entry-points → tracer → naming → catalog-store swap; persist `flows` + `flow_steps` with denormalized `name`/`kind`, by-value `node_id`, nullable root provenance/edge_kind, and the three axis truncation flags (FR-009/021/022a). Depends on T009, T020, T021, T022.
- [x] T024 [US1] Implement `codegraph_list_flows` + `codegraph_get_flow` in `src/mcp/tools.ts` — thin handlers over the `catalog-store` single-fetch reads, `codegraph_` prefix, factual descriptions only, ZERO added steering in `server-instructions.ts` (FR-027/030/031). Depends on T010, T011, T023.
- [x] T025 [US1] Implement `GET /api/flows` + `GET /api/flows/{id}` in `src/server/routes.ts` — thin handlers that FORWARD to the per-project daemon via `src/server/daemon-client.ts` (mirroring the existing `readNode`/`readSearch` read-forwarding; the web `serve` process holds no DB connection of its own, SPEC-005 FR-002), so the SAME `catalog-store` single-fetch reads run in the daemon; SPEC-005 `Limit`(default 100/max 500)/`Offset`, unknown-id returns success-shaped 200 (intentional divergence from REST 404 to keep surfaces identical) (FR-028/030). Depends on T010, T011, T023.
- [x] T026 [P] [US1] Add `FlowSummary`, `FlowDetail`, `FlowStep`, `FlowTruncation`, `FlowListResult` schemas and the `/api/flows`, `/api/flows/{id}` paths to `src/server/openapi.yaml` — `FlowStep.provenance` is a standalone `{enum:[static,lsp,heuristic], nullable:true}` that MUST NOT `$ref` `Edge.provenance`; `FlowListResult` `allOf`-extends `ListResult` (FR-028/028a).

**Checkpoint**: Flows engine, persistence, and both surfaces are unit/contract-tested by driving analysis directly. This is the MVP increment.

---

## Phase 4: User Story 2 - Discover functional clusters (Priority: P2)

**Goal**: A consumer lists functional clusters with total file coverage, canonical labels, flagged singletons, and a `minSize` filter.

**Independent Test**: Drive `runClusterAnalysis` against a temp DB, read `codegraph_list_clusters` / `/api/clusters` — every indexed file appears in exactly one cluster, each has a canonical label, isolated files are flagged singletons, `minSize>=2` suppresses singletons. (Cross-re-index id stability is US3; index-time automation is US4.)

### Tests for User Story 2 (write FIRST, confirm RED) ⚠️

- [x] T027 [P] [US2] File-graph weighting test in `__tests__/analysis/clusters/file-graph.test.ts` — undirected file graph, each cross-file call/import = weight 1, parallel evidence between the same pair sums, self-loops dropped (FR-011/012).
- [x] T028 [P] [US2] Louvain determinism test in `__tests__/analysis/clusters/louvain.test.ts` — stable vertex order (files by path), deterministic tie-break (lowest-ordered target community then lowest-ordered neighbor), exactly ONE algorithm (no fallback), no random seed; membership byte-identical across repeat runs (FR-011/013, SC-004 clusters portion).
- [x] T029 [P] [US2] Total-coverage + singleton test in `__tests__/analysis/clusters/coverage.test.ts` — every indexed file in exactly one cluster; single-file communities persisted as explicit `is_singleton=1` clusters, never merged into a synthetic bucket (FR-014, SC-003).
- [x] T030 [P] [US2] Canonical-label test in `__tests__/analysis/clusters/labels.test.ts` — deterministic label from the cluster's dominant directory + name tokens (FR-018).
- [x] T031 [P] [US2] MCP contract test for `codegraph_list_clusters` in `__tests__/analysis/clusters/mcp-clusters.test.ts` — sort `member_count` desc then `canonicalLabel` asc then `id`; `minSize` default 1, `<1`→1, `>=2` suppresses singletons, `total` reflects the post-`minSize` count; success-shaped conditions (FR-027/029/030).

### Implementation for User Story 2

- [x] T032 [P] [US2] Implement `src/analysis/clusters/file-graph.ts` — count-aggregated undirected weighted file graph, self-loops dropped (FR-011/012).
- [x] T033 [US2] Implement `src/analysis/clusters/louvain.ts` — compact deterministic pure-TS Louvain (stable vertex order + deterministic tie-break, no seed), exposing pass-boundary points for the cooperative yielder wired in T050 (FR-011/013/033, research R1; Constitution VII — no new native runtime dependency).
- [x] T034 [P] [US2] Implement `src/analysis/clusters/labels.ts` — deterministic canonical label; a presentation-only display-label slot left null here (the LLM advisory path is T056) (FR-018/019).
- [x] T035 [US2] Implement `runClusterAnalysis(graph, store)` in `src/analysis/index.ts` composing file-graph → louvain → labels → catalog-store swap; persist `clusters` (with `is_singleton`, `member_count`, a deterministic content-hash id of sorted member paths as the initial id) + `cluster_members` (by-value `file_path`, no denormalization needed — path is position-independent) (FR-014/021). Identity TRANSFER across re-index is added in US3/T042. Depends on T009, T032, T033, T034.
- [x] T036 [US2] Implement `codegraph_list_clusters` in `src/mcp/tools.ts` with the `minSize` filter over the `catalog-store` single-fetch read (FR-027/029/030). Depends on T010, T011, T035.
- [x] T037 [US2] Implement `GET /api/clusters` in `src/server/routes.ts` — a thin handler that FORWARDS to the per-project daemon via `src/server/daemon-client.ts` (the web `serve` process holds no DB connection of its own, SPEC-005 FR-002), so the same `catalog-store` read runs in the daemon, with `minSize` (default 1, `<1`→1) (FR-028/029). Depends on T010, T011, T035.
- [x] T038 [P] [US2] Add `ClusterSummary` + `ClusterListResult` schemas and the `/api/clusters` path to `src/server/openapi.yaml`; field names (`id`,`canonicalLabel`,`displayLabel`,`memberCount`,`isSingleton`) identical to the MCP item (FR-028/028a).

**Checkpoint**: Clusters engine + both surfaces work; cluster ids are deterministic per-run (content-hash) but not yet transferred across a changed re-index.

---

## Phase 5: User Story 3 - Stable cluster identity across re-indexes (Priority: P2)

**Goal**: A cluster keeps its identifier when membership stays substantially the same, and only gets a new one when the grouping genuinely changes. Builds on US2.

**Independent Test**: Analyze, record ids; make a small change leaving a cluster ≥0.5-overlapping; re-analyze — the overlapping cluster keeps its id, a genuine split transfers the id to the single best descendant, a tie resolves identically every run, and overlap <0.5 mints a new id.

### Tests for User Story 3 (write FIRST, confirm RED) ⚠️

- [x] T039 [P] [US3] Identity fixture test in `__tests__/analysis/clusters/identity.test.ts` — across a re-index with membership churn: a cluster whose Jaccard overlap with a prior cluster is ≥0.5 retains that prior id; a prior cluster that splits transfers its id to only the single best-matching descendant (others get new ids); two candidates with equal overlap resolve to the same winner every run; overlap <0.5 mints a new id (FR-015/016/017, SC-005).
- [x] T040 [P] [US3] Content-hash mint test in `__tests__/analysis/clusters/identity-mint.test.ts` — a minted cluster id is an opaque deterministic content hash of the sorted member file paths (identical across runs/clones), NEVER a rowid or positional index (which would churn on the DELETE+INSERT swap) (FR-017a).

### Implementation for User Story 3

- [x] T041 [US3] Implement `src/analysis/clusters/identity.ts` — read prior membership from the last successfully-committed clusters catalog (a pre-swap read); greedy one-to-one match new↔prior transferring a prior id when Jaccard ≥ 0.5; best-descendant-only on split; deterministic tie-break on stable ordering; mint a content-hash id for any cluster with no ≥0.5 match; first successful run with no prior catalog mints all-new (FR-015/016/017/017a, research R6).
- [x] T042 [US3] Wire identity into `runClusterAnalysis` (`src/analysis/index.ts`) so persisted cluster ids come from the identity assignment (pre-swap prior read → transfer-or-mint) instead of the raw content hash from T035 (FR-017a). Depends on T035, T041.

**Checkpoint**: Cluster ids are stable across ordinary churn and refuse to drift on weak accidental matches.

---

## Phase 6: User Story 4 - Read catalogs safely across the index/sync lifecycle (Priority: P2)

**Goal**: Recompute both catalogs after every successful index/sync; a reader never sees a partial/torn catalog; a post-graph-update analysis failure keeps the index successful and the prior catalog readable-but-stale; a first-run failure surfaces `unavailable`; each catalog's outcome is independent. This is the ratified late "lifecycle wiring (recompute hook at indexAll/sync end, cooperative-yield)" step.

**Independent Test**: Index (catalog fresh); force a post-graph-update analysis failure on re-index → index still succeeds, prior catalog reads `stale` with its recorded `sourceVersion`; on a fresh project force a first-run failure → `unavailable` with no partial data; enable both and fail only one → the other is unaffected.

### Tests for User Story 4 (write FIRST, confirm RED) ⚠️

- [x] T043 [P] [US4] Atomic-swap / no-torn-read test in `__tests__/analysis/catalog-lifecycle/atomic-swap.test.ts` — a read concurrent with a swap observes the complete prior OR the complete new catalog; the composite reads (total+slice, `get_flow` header+steps, state probe) stay single-fetch so a concurrent swap can't tear them — on BOTH surfaces, which share ONE topology (MCP runs in the daemon; REST forwards to the same daemon via `src/server/daemon-client.ts`, so both read on the daemon's worker connections under WAL snapshot isolation) (FR-021/021a).
- [x] T044 [P] [US4] Stale-read test in `__tests__/analysis/catalog-lifecycle/stale.test.ts` — analysis failing AFTER a successful graph update → `indexAll`/`sync` reports success, prior catalog readable with `state="stale"` and recorded `sourceVersion` (recorded < live); the retained catalog survives the next index's per-file node delete/re-insert via by-value refs + renders name/kind from denormalized columns (unresolvable → explicit placeholder, never an error, never a live `nodes` join) (FR-022/022a/022b, SC-008).
- [x] T045 [P] [US4] First-run unavailable test in `__tests__/analysis/catalog-lifecycle/unavailable.test.ts` — first-run analysis failure with no prior catalog writes only `catalog_meta(kind, NULL, first_run_failed=1)` and reads `state="unavailable"`, never partial or empty-looking (FR-023, SC-008).
- [x] T046 [P] [US4] Independence + aborted-analysis test in `__tests__/analysis/catalog-lifecycle/independence.test.ts` — both enabled, one analysis succeeds while the other fails → the succeeding catalog swaps fresh (available), the failing one independently retains prior rows stale (or unavailable on first run), neither blocks or staleness-taints the other; an abort before the swap commit performs no partial write and leaves the prior catalog untouched (FR-020/022, edge cases).

### Implementation for User Story 4

- [x] T047 [US4] Implement `maybeRunCatalogAnalysis(codeGraph, ...)` in `src/analysis/index.ts` — per-catalog opt-in gating that dispatches to `runFlowAnalysis` / `runClusterAnalysis`, and advances `graph_write_version` as part of the successful graph-update commit BEFORE analysis runs so a post-update failure derives the retained catalog as stale (FR-020/022, research R2). A partial index (`index_state='partial'`) counts as successful. Depends on T007, T023, T042.
- [x] T048 [US4] Implement the bounded failure taxonomy / error-swallow in `src/analysis/index.ts` — catch every failure mode analysis can raise (compute/traversal exceptions, resource exhaustion, and a failed atomic-swap commit); none propagates to fail `indexAll`/`sync`; a failed swap-commit rolls back (prior retained) and, because `graph_write_version` already advanced, derives as stale (FR-022b).
- [x] T049 [US4] Wire `maybeRunCatalogAnalysis` into `src/index.ts` at the `maybeRunEmbeddingPass` site in BOTH `indexAll()` (~L1018) and `sync()` (~L1466) — additive call only, honoring the existing `AbortSignal`; existing index/sync behavior otherwise unchanged (FR-020, Constitution III surgical).
- [x] T050 [US4] Integrate the cooperative yielder (`createYielder`/`maybeYield` from `src/resolution/cooperative-yield.ts`) at the Louvain pass boundaries (T033 hook points) and flow-root boundaries in `src/analysis/index.ts` so the daemon query loop stays responsive during large-repo analysis (Constitution VI). Depends on T033, T047.

**Checkpoint**: Catalogs recompute automatically at index/sync end, can never fail the index, and every lifecycle state is correct and independent.

---

## Phase 7: User Story 5 - Opt in per catalog, zero cost when disabled (Priority: P3)

**Goal**: Each catalog is independently opt-in via `codegraph.json`; a not-opted-in project pays nothing and writes nothing (byte-identical to pre-feature); disabled/not-indexed queries return success-shaped guidance; the LLM display label is a dormant advisory.

**Independent Test**: On a default (not-opted-in) project verify zero catalog rows/metadata written, no measurable overhead, and success-shaped disabled guidance; then opt in and verify catalogs compute.

### Tests for User Story 5 (write FIRST, confirm RED) ⚠️

- [x] T051 [P] [US5] Catalog dormancy test in `__tests__/analysis/activation/dormancy.test.ts` — a project with neither catalog enabled runs NO catalog analysis, writes ZERO catalog rows and ZERO catalog metadata (asserted count = 0), leaves `graph_write_version` untouched, and is byte-identical to the pre-feature state w.r.t. catalog data (FR-025, SC-007).
- [x] T052 [P] [US5] LLM dormancy test in `__tests__/analysis/activation/llm-dormancy.test.ts` — with no `CODEGRAPH_LLM_*` endpoint configured, catalog analysis makes ZERO model calls, every `display_label` is null, and catalog output is byte-identical to the LLM-absent case (FR-019/032, SC-011).
- [x] T053 [P] [US5] Disabled-state resolution + success-shape test in `__tests__/analysis/activation/disabled-state.test.ts` — a catalog previously enabled+computed but now disabled reads `state="disabled"` (live flag consulted FIRST; retained rows inert), never available/stale; disabled / not-indexed / unknown-id queries on both surfaces are success-shaped (never `isError`) and carry the machine-readable `state` (FR-025/030, SC-009).

### Implementation for User Story 5

- [x] T054 [US5] Add per-catalog opt-in flags (`analysis.flows`, `analysis.clusters`, default false/omitted) to the `codegraph.json` loader in `src/project-config.ts`, following the SPEC-008 `lsp` flag precedent (FR-024).
- [x] T055 [US5] Gate `maybeRunCatalogAnalysis` and `graph_write_version` maintenance on ≥1 catalog enabled in `src/analysis/index.ts` — both flags off ⇒ full dormancy, zero writes (FR-025, SC-007). Depends on T047, T054.
- [x] T056 [US5] Implement the FR-019 optional LLM display-label advisory in `src/analysis/clusters/labels.ts` — when an endpoint IS configured, a failed/timed-out label call is swallowed (cluster keeps its canonical label, `display_label` null) and MUST NOT fail analysis, mark the catalog stale/unavailable, or alter membership/identity/canonical labels; any surfaced diagnostic carries ONLY the error class/name — never the endpoint URL or API key/credential (mirrors the embedding pass's redaction) (FR-019, Constitution V).
- [x] T057 [US5] Enable both catalogs in this repository's `codegraph.json` (`"analysis": { "flows": true, "clusters": true }`) to satisfy the binding Dogfooding Protocol (FR-026).

**Checkpoint**: Activation discipline holds — dormant by default, byte-identical off, dogfooded on here.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cross-surface guarantees, no-regression proofs, performance/UAT evidence, and PR-packet deliverables. One PR (Q21).

- [x] T058 [P] Cross-surface parity test in `__tests__/analysis/parity.test.ts` — assert the MCP item field names equal the openapi `FlowSummary`/`FlowDetail`/`FlowStep`/`ClusterSummary` schema fields field-for-field (both produced from `src/analysis/types.ts`), making SC-009 checkable not merely asserted (FR-028a, SC-009).
- [x] T059 [P] explore-unchanged golden test in `__tests__/analysis/explore-unchanged.test.ts` — `codegraph_explore` output is byte-identical for a fixed corpus of existing queries before vs after this feature, AND `src/mcp/server-instructions.ts` + the explore handler are untouched (no added steering, no budget change) (FR-031, SC-012, Constitution VI).
- [x] T060 [P] Determinism fixture (SC-004) in `__tests__/analysis/determinism-fixture.test.ts` — materialize the benchmark-monorepo (T003), index twice, assert BOTH the flow catalog and cluster membership are byte-identical row-for-row and `select count(*) from nodes` is stable (analysis is read-only over the graph) (SC-004, FR-013).
- [x] T061 Implement the paired full-index benchmark harness at `scripts/bench-catalog-analysis.mjs` — Arm A (`analysis.flows=false, clusters=false`) vs Arm B (both true), interleaved (A,B,A,B,…) with ≥5 timed iterations per arm (≥3 minimum) after ≥1 discarded warmup, embeddings/LSP held constant (assert identical `vectors_write_version` progression and identical LSP-provenance edge counts across arms), excluding fixture-gen/startup; reports per-arm median + spread (SC-006, Q19).
- [x] T062 Run the paired benchmark on the benchmark-monorepo and record `median(B) ≤ 1.20 × median(A)` evidence for the PR/UAT packet (SC-006).
- [ ] T063 Self-repo dogfood UAT (record in the spec's UAT runbook): enable both catalogs on THIS repo, confirm the `codegraph index` CLI entry-point flow reaches extraction → resolution → (LSP) → embedding with correct per-step provenance + truncation state, and that this repo's `src/` modules land in coherent clusters whose ids stay stable across two consecutive re-indexes; also record the median added wall-clock per single-file watch-driven sync (SC-010, Q20).
- [x] T064 [P] SC-007 zero-overhead timing evidence via the `scripts/bench-catalog-analysis.mjs` harness (T061): assert a both-disabled full-index median is within the ≤2% run-to-run variance band of a pre-feature build, recorded in the PR/UAT packet (SC-007).
- [x] T065 [P] Add the user-facing CHANGELOG entry under `## [Unreleased]` — browsable execution-flow and functional-cluster catalogs over MCP (`codegraph_list_flows`, `codegraph_get_flow`, `codegraph_list_clusters`) and REST (`/api/flows`, `/api/clusters`), opt-in via `codegraph.json` (no internal paths/symbols/benchmark numbers).
- [ ] T066 retrieval-guardian review of the `src/mcp/` diff before PR — confirm `codegraph_explore` untouched, the three new tools return success-shaped guidance for every expected condition, and `isError` is reserved for genuine malfunctions/security refusals (Constitution VI). Address findings before opening the PR.
- [ ] T067 Generate/update the PR review packet — what changed, why, non-goals, review order (analysis engine → persistence/swap → surfaces → config), scope budget, FR/SC → files → evidence traceability, verification evidence (unit tests, deterministic probes, ≥3-run paired benchmark, self-repo UAT), known gaps (deferred CLI listing subcommands + `codegraph_explore` enrichment), and rollback (the two `codegraph.json` opt-in flags).
- [ ] T068 Run `quickstart.md` scenarios 1–12 and record outcomes; re-measure actual reviewable LOC and re-confirm the one-PR decision if the measured diff exceeds ~700 reviewable LOC (plan G3 action).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: depends on Setup; BLOCKS every user story. T004→T005 (schema before migration); T009/T010/T011 share `catalog-store.ts` (sequential); T007/T008 are independent [P].
- **US1 (P3)**: depends on Foundational. MVP.
- **US2 (P4)**: depends on Foundational; independent of US1 (different engine + surface).
- **US3 (P5)**: depends on US2 (extends cluster persistence with identity transfer).
- **US4 (P6)**: depends on US1 + US2 + US3 (the hook dispatches to both analyzers, and cluster analysis must include identity before it is automated). This is the deliberately-late lifecycle wiring.
- **US5 (P7)**: depends on US4 (gates the orchestrator + version maintenance).
- **Polish (P8)**: depends on all stories.

### Story independence

- US1 and US2 are independently implementable and testable at the unit/contract level by driving `runFlowAnalysis` / `runClusterAnalysis` directly against a temp-DB catalog-store (the index-time hook is US4, per the ratified ordering).
- US3 builds on US2; US4 integrates US1–US3; US5 gates US4. This chaining is inherent to the one-PR shared lifecycle (Q21) and is called out honestly rather than faked as fully parallel.

### Parallel opportunities

- Setup: T001, T002, T003 all [P].
- Foundational: T006, T007, T008 [P] (distinct files); T004→T005 sequential; T009→T010→T011 sequential (same file).
- US1 tests T013–T019 all [P]; impl T020/T022/T026 [P], T021 then T023 then T024/T025.
- US2 tests T027–T031 all [P]; impl T032/T034/T038 [P], T033 then T035 then T036/T037.
- US3 tests T039/T040 [P]; impl T041 then T042.
- US4 tests T043–T046 all [P]; impl T047→T048→T049→T050.
- US5 tests T051–T053 all [P]; impl T054 then T055/T056, T057 [P].
- Polish: T058, T059, T060, T064, T065 [P]; T061→T062, T063, T066, T067, T068 gated on their inputs.

---

## Implementation strategy

### MVP first

1. Phase 1 Setup → Phase 2 Foundational (schema + catalog-store substrate).
2. Phase 3 US1 (flows) → STOP and VALIDATE: flow list/detail surfaces answer "how does this entry point execute?" with per-step provenance + truncation. This is the shippable MVP.

### Incremental delivery (all in one PR — Q21)

US1 flows → US2 clusters → US3 identity → US4 lifecycle automation → US5 activation/dormancy → Polish (parity, explore-golden, determinism, benchmark, UAT, CHANGELOG, guardian, PR packet). Each phase is a green-tests checkpoint; the PR opens only after T066 (guardian) and T067 (packet).

---

## Non-goal bounds (guard — every task was checked against these; none crosses)

No `codegraph_explore` change (guarded by T059); no CLI listing subcommands; no cap configurability (caps fixed in code, T021); no second clustering algorithm or label-prop fallback (T033); no incremental catalog maintenance (full recompute, T047); no LLM in structure/membership/identity/canonical-label paths (T052, T056); no generation-tagged rows (T009); no cascading FK (T004); cluster ids never a rowid/positional index (T040/T041). If any implementation task starts to cross one of these, STOP — it is out of scope for SPEC-011.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Every user-story task carries its `[US#]` label; setup/foundational/polish carry none.
- Tests are written and confirmed RED before the implementation task in the same story (Constitution IV).
- Commit after each task or logical group (the orchestrator handles commits; do not run `/speckit-git-commit` inside this phase).
- `npm run build && npm test` green is the floor before any review claim; retrieval-affecting `src/mcp/` changes additionally pass retrieval-guardian review (T066) before PR.
