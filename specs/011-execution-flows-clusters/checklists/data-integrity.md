# Data-Integrity Checklist: Execution Flows & Clusters

**Purpose**: Validate the *requirements quality* (completeness, clarity, consistency, measurability, coverage) of SPEC-011's persisted-catalog data-integrity properties — the five catalog tables, the atomic swap, single-snapshot reads under concurrent daemon readers, retention/staleness lifecycle, deterministic recomputation, and by-value/denormalized references.
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md) · [data-model.md](../data-model.md) · [contracts/](../contracts/)

**Note**: These items test whether the *requirements are written correctly*, not whether code works. `[x]` = the artifacts satisfy the check; an unchecked item carrying a gap marker = an unmet requirement-quality finding remediated in the executor return. Codebase evidence (file:line) was gathered to ground each finding.

## Requirement Completeness — Table Constraints & Schema

- [x] CHK001 Are NOT NULL / PRIMARY KEY / DEFAULT constraints specified for every column of all five catalog tables (`flows`, `flow_steps`, `clusters`, `cluster_members`, `catalog_meta`)? [Completeness, data-model §tables]
- [x] CHK002 Is nullability specified for the edge-dependent / optional columns (`flow_steps.parent_node_id`, `flow_steps.edge_kind`, `clusters.display_label`, `catalog_meta.computed_from_version`)? [Completeness, data-model §flow_steps/§clusters/§catalog_meta]
- [x] CHK003 Are the allowed-value sets for the enum-like TEXT columns (`entry_kind`, `provenance`, `edge_kind`, `catalog_meta.kind`) and the 0/1 integer booleans (`truncated_*`, `is_singleton`, `first_run_failed`) documented? [Consistency, data-model §tables] — *documented in prose; enforcement left to the analysis layer, consistent with the existing NodeKind/EdgeKind no-CHECK precedent.*
- [ ] CHK004 Is the `provenance` value for the ROOT flow step specified? `flow_steps.provenance` is `NOT NULL` and FR-009/SC-001 require *every* persisted step to carry a provenance, but the root step (`depth 0`, `edge_kind`/`parent_node_id` = NULL) has **no incoming call edge**, and the allowed set `{static, lsp, heuristic}` has no root/none member. [Conflict — FR-009 / SC-001 vs data-model §flow_steps] [Gap]

## Atomic Swap & Concurrent-Reader Integrity *(primary focus)*

- [x] CHK005 Is the atomic swap specified as a single write transaction (DELETE child+parent, INSERT new rows, upsert `catalog_meta`) with **no** generation-tagged rows / multi-generation retention? [Completeness, FR-021, data-model §Atomic swap]
- [x] CHK006 Is the all-or-nothing guarantee stated — a concurrent reader observes either the complete prior or the complete new catalog? [Completeness, FR-021]
- [ ] CHK007 Is the atomic-read guarantee's *mechanism* specified for **both** mandated read surfaces? FR-021/FR-021a frame it as "a concurrent daemon query connection under WAL snapshot isolation" — true for the MCP path (separate per-worker connection) but **not** for the REST surface (FR-028), whose reads run on the indexer/writer's own connection, where cross-connection WAL snapshot isolation does not apply and all-or-nothing rests on a different mechanism (single-thread serialization / single-statement fetch). [Ambiguity — FR-021 / FR-021a vs FR-028] [Gap]
- [x] CHK008 Is the WAL-unavailable degradation (writer-blocks-reader, preserving all-or-nothing) specified? [Coverage, FR-021a]
- [ ] CHK009 Are single-writer / serialization requirements specified so the pre-swap prior-membership read (FR-017a) cannot interleave with another concurrent index/sync swap? Two overlapping analyses could each read prior membership before the other commits, skipping an identity generation. [Coverage — FR-017a / FR-020] [Gap]

## Composite / Single-Snapshot Reads *(primary focus)*

- [x] CHK010 Is the count + paged-slice list read required to derive from a single consistent snapshot? [Completeness, FR-021a]
- [x] CHK013 Is a precedent-grounded single-snapshot mechanism (full-fetch-then-slice) identified? [Traceability, FR-021a / research R3] — *`src/mcp/read-ops.ts` full-fetch-then-slice confirmed; note there is NO existing read-transaction precedent, so the "read transaction" alternative is un-grounded.*
- [ ] CHK011 Does the single-snapshot requirement cover the composite catalog reads **beyond** list count+slice — namely `codegraph_get_flow` (the `flows` header row **plus** its `flow_steps` rows, two tables/statements) and the read-state probe (`catalog_meta` row **plus** a content-row COUNT that distinguishes *available* from *available-but-empty*)? FR-021a enumerates only "a `total` count alongside a paged slice." [Coverage — FR-021a vs contract §get_flow / data-model §read-time state] [Gap]
- [ ] CHK012 Is it specified whether a catalog read consults the **live `nodes` table** to decide "node id no longer resolves" (placeholder), or always displays the denormalized `name`/`kind`? A live `nodes` join adds a catalog×graph cross-generation read (nodes are deleted/re-inserted per file during index) and partly defeats the denormalization rationale. [Ambiguity — FR-022a vs contract §get_flow] [Gap]

## Staleness, Retention & Lifecycle States

- [x] CHK014 Is the monotonic, project-scoped `graph_write_version` token — advanced on each successful index/sync, before analysis, only when ≥1 catalog is enabled — specified? [Completeness, FR-022, data-model §Project metadata]
- [x] CHK015 Is staleness required to be DERIVED (`recorded < live`) rather than stored as a mutable flag? [Clarity, FR-022, data-model invariant 3]
- [x] CHK016 Are the read-time states (available / stale / unavailable / available-but-empty / disabled) each defined with a distinct resolution rule, per catalog kind? [Completeness, data-model §read-time state]
- [x] CHK017 Is prior-catalog retention on post-graph-update failure (readable, stale, tagged with recorded version) specified, and first-run failure → explicit *unavailable* (never partial/empty)? [Coverage, FR-022 / FR-023]
- [x] CHK019 Is clearing of `first_run_failed` on a later successful analysis specified? [Consistency, data-model §Atomic swap] — *the `INSERT OR REPLACE ... first_run_failed=0` in the swap.*
- [ ] CHK018 Are requirements defined for the enabled→**DISABLED** transition of a previously-computed catalog? The *disabled* state is resolved by ABSENCE of a `catalog_meta` row, but a catalog that was enabled, computed, then disabled retains its meta row + content rows; with `graph_write_version` frozen while disabled, that catalog would read as **available/fresh** despite arbitrary graph drift. [Coverage — FR-024 / FR-025 vs data-model §read-time state] [Gap]

## Identity & Deterministic Recomputation

- [x] CHK020 Is cluster identity (greedy one-to-one Jaccard ≥ 0.5, deterministic tie-break, opaque token — not rowid/positional) specified? [Completeness, FR-015/016/017/017a]
- [x] CHK022 Is flow identity (deterministic root-derived natural key; one flow per entry point, deduplicated) specified? [Completeness, FR-001/003/017a, data-model §flows]
- [x] CHK024 Is "identical catalogs on re-analysis of an unchanged graph" defined as a measurable outcome (rows identical; node/edge count stable)? [Measurability, SC-004, quickstart §6]
- [ ] CHK021 Is the cluster identifier's MINTING on first appearance (no prior catalog) specified as DETERMINISTIC (content-derived)? FR-017a defines transfer-on-re-index but leaves first-appearance minting unspecified; a nondeterministic mint (e.g., random token) makes a fresh first-run catalog non-reproducible across environments, contradicting SC-004/FR-013 "identical … on every run (full determinism)" and breaking cross-clone portability of downstream anchors. [Ambiguity — FR-017a vs SC-004 / FR-013] [Gap]
- [ ] CHK023 Is a deterministic stable-ordering requirement specified for FLOW tracing — which out-edges survive the 20/step width cap, which steps survive the 200 cap, and which parent a multiply-reached node records ("first deterministic visit") — analogous to FR-013's explicit stable-vertex-order + tie-break for clusters? FR-032/SC-004 assert the deterministic OUTCOME, but no requirement specifies the traversal-ordering MECHANISM for flows. [Coverage — FR-004 / FR-005 / FR-008 vs FR-013] [Gap]

## By-Value References & Denormalization

- [x] CHK025 Is the deliberate ABSENCE of any FK (no `ON DELETE CASCADE`) to `nodes`/`files` on catalog rows specified, with the retained-stale-survives-per-file-delete rationale? [Completeness, FR-022a, data-model invariant 1]
- [x] CHK026 Is by-value referencing (`node_id`, `file_path`) plus denormalized `name`/`kind` on node-bearing rows (and placeholder-not-error display when a node id no longer resolves) specified, with the file-path-is-position-independent distinction? [Clarity, FR-022a, data-model invariant 2]
- [x] CHK027 Is within-catalog child→parent linkage integrity (`flow_steps.flow_id`→`flows.id`, `cluster_members.cluster_id`→`clusters.id`) handled given no FK — parent+child written together inside the one swap transaction? [Consistency, FR-021, data-model §flow_steps/§cluster_members]
- [x] CHK028 Is the total-coverage invariant (every indexed file in exactly one cluster) enforcement specified as computed-and-tested rather than a DB constraint? [Measurability, SC-003, data-model §cluster_members]

## Provenance & Truncation Persistence

- [x] CHK029 Is per-step provenance persistence (`static|lsp|heuristic`, 100% of steps) specified and measurable? [Completeness, FR-009 / SC-001] — *holds for non-root steps; see CHK004 for the root.*
- [x] CHK030 Is per-flow truncation persisted as three independent axis flags (depth/width/steps) with `truncated` DERIVED, matching the `{truncated, truncation:{depth,width,totalSteps}}` contract shape? [Consistency, FR-007 / FR-027, data-model §flows]
- [x] CHK031 Is the traversed-edge scope (both `calls` and `references`, all provenance classes) specified so provenance tagging is complete? [Completeness, FR-008]

## Dependencies & Assumptions

- [x] CHK032 Is migration versioning (next sequential after the `node_vectors` head; `schema.sql` + `migrations.ts` lockstep byte-equivalent) specified? [Traceability, data-model preamble] — *grounded: `node_vectors`=v9=head, next=v10.*
- [x] CHK033 Is `graph_write_version` storage grounded in an existing precedent (`project_metadata` KV / `vectors_write_version`)? [Assumption, FR-022] — *grounded; note the precedent bumps on vector-write, whereas `graph_write_version`'s advance semantics are independently and explicitly defined, so the analogy is storage-only.*

## Notes

- Total items: 33. Unmet gap items: 8 — CHK004, CHK007, CHK009, CHK011, CHK012, CHK018, CHK021, CHK023 → see the executor return for exact remediations.
- Codebase grounding: `src/db/queries.ts` (project_metadata KV, `bumpVectorsWriteVersion`, `deleteNodesByFile`), `src/db/migrations.ts` (v9 head), `src/db/index.ts` / `src/db/sqlite-adapter.ts` (WAL, `.transaction()`), `src/mcp/query-worker.ts` / `src/mcp/engine.ts` (separate worker read connections vs main-connection `codegraph/read`), `src/mcp/read-ops.ts` (full-fetch-then-slice), `src/extraction/tree-sitter-helpers.ts` (line-position sha256 node ids).
