# Feature Specification: Execution Flows & Clusters

**Feature Branch**: `011-execution-flows-clusters`

**Created**: 2026-07-14

**Status**: Draft

**Input**: User description: "Execution Flows & Clusters (SPEC-011): the CodeGraph knowledge graph gains two navigable, persisted catalogs — named execution flows and functional clusters — exposed over MCP and REST, computed deterministically from the existing graph (no LLM involvement in structure)."

**Source of truth**: The 21-question, human-ratified design concept at `docs/ai/specs/.process/SPEC-011-design-concept.md` (decisions Q1–Q21). Every scoping choice below traces to a resolved decision there.

## User Scenarios & Testing *(mandatory)*

The "users" of this feature are the catalogs' consumers: downstream CodeGraph capabilities (change-impact enrichment, wiki generation), AI agents and web/REST clients browsing a repository's structure, and maintainers dogfooding on this repository. Each story is an independently testable slice of consumer value.

### User Story 1 - Discover and inspect a repository's execution flows (Priority: P1)

A consumer lists the named execution flows detected in an opted-in repository and opens any one of them to see its bounded call graph, with each step tagged by how its call edge was resolved and with an explicit marker whenever the trace was cut off by a limit. This lets the consumer answer "how does this repository execute a given entry point?" without re-deriving the path from raw nodes and edges.

**Why this priority**: The execution-flow catalog is the feature's primary deliverable and the minimum viable product. Shipping only this story already delivers a queryable answer to "what are this repository's execution paths?" — the question every downstream consumer re-derives today. The self-repo dogfood UAT (the CLI index pipeline flow) validates exactly this story.

**Independent Test**: Enable flows on a repository that has a known route or CLI entry point, index it, call the flow-list surface (the named flow appears), then request that flow's detail (a bounded call graph is returned with per-step provenance and truncation state). Fully testable with no cluster functionality present.

**Acceptance Scenarios**:

1. **Given** an opted-in repository with a registered CLI command entry point, **When** the consumer lists flows, **Then** exactly one flow appears for that entry point, named by its CLI command name.
2. **Given** an opted-in repository with a registered route entry point, **When** the consumer lists flows, **Then** a flow appears named by the route's method and path.
3. **Given** a flow whose call graph crosses a dynamic-dispatch boundary (callback, synthesized edge), **When** the consumer opens the flow, **Then** the graph continues across that boundary and the crossing step carries heuristic/synthesized provenance.
4. **Given** a flow whose traversal reaches a depth, width, or total-step limit, **When** the consumer opens the flow, **Then** the flow is returned with an explicit truncation marker so the bounded result is never mistaken for a complete one.
5. **Given** the same repository indexed twice without changes, **When** flows are listed both times, **Then** the flow catalog is identical.

---

### User Story 2 - Discover a repository's functional clusters (Priority: P2)

A consumer lists the functional clusters of a repository — groups of files that form functional units — where every indexed file belongs to exactly one cluster, each cluster carries a human-readable canonical label, and the consumer can filter out small clusters by a minimum-size parameter. This lets the consumer answer "which files form a functional unit?" and anchor per-cluster content to a stable grouping.

**Why this priority**: The cluster catalog is the feature's second deliverable, shipped in the same release. It is independent of flows (different detection, different surface) and delivers standalone value for structure browsing and downstream per-cluster chaptering.

**Independent Test**: Enable clusters on a repository, index it, list clusters, and verify that every indexed file appears in exactly one cluster, each cluster has a canonical label, single-file communities appear as flagged singletons, and the minimum-size filter removes clusters below the requested size. Fully testable with no flow functionality present.

**Acceptance Scenarios**:

1. **Given** an opted-in repository, **When** the consumer lists clusters, **Then** every indexed file belongs to exactly one cluster (total coverage) and each cluster has a canonical label derived from its dominant directory and name tokens.
2. **Given** a repository containing files with no cross-file relationships, **When** the consumer lists clusters, **Then** each such file appears as an explicit singleton cluster flagged as a singleton.
3. **Given** a repository with many small clusters, **When** the consumer lists clusters with a minimum-size filter, **Then** only clusters meeting that size are returned.
4. **Given** the same repository indexed twice without changes, **When** clusters are listed both times, **Then** cluster membership is identical.

---

### User Story 3 - Rely on stable cluster identity across re-indexes (Priority: P2)

A downstream consumer that anchors content (chapters, impact notes) to clusters relies on a cluster keeping its identifier across re-indexes when its membership stays substantially the same, and on getting a new identifier only when the grouping genuinely changes. This keeps downstream anchors from churning on every ordinary edit.

**Why this priority**: Stable identity is what makes the cluster catalog usable by downstream features rather than merely informational; without it, every re-index would invalidate anchors. It builds on Story 2 and is validated by the self-repo cluster-stability UAT across two consecutive re-indexes.

**Independent Test**: Index a repository and record cluster identifiers; make a small change that leaves a cluster substantially intact; re-index; verify that a cluster whose membership overlaps the prior one by at least half keeps its identifier, that a genuine split assigns the identifier to only the best-matching descendant, and that tie situations resolve the same way every run.

**Acceptance Scenarios**:

1. **Given** a cluster that overlaps its prior-catalog counterpart by at least half of the combined membership, **When** the repository is re-indexed, **Then** the cluster retains its prior identifier.
2. **Given** a cluster that splits into two across a re-index, **When** identities are assigned, **Then** the descendant with the greatest overlap keeps the prior identifier and the other descendant receives a new identifier.
3. **Given** two candidate clusters with equal overlap against the same prior cluster, **When** identities are assigned, **Then** a deterministic tie-break selects the same winner on every run.
4. **Given** a cluster whose overlap with any prior cluster is below half, **When** identities are assigned, **Then** it receives a new identifier rather than inheriting a weakly-matched one.

---

### User Story 4 - Read catalogs safely across the index and sync lifecycle (Priority: P2)

A consumer always reads a complete catalog, never a half-written one. Both catalogs are recomputed after every successful index and every successful sync. If catalog analysis fails after the graph itself updated, the index or sync still succeeds and the consumer can still read the previous catalog — clearly marked stale and tagged with the graph version it was computed from. A failure on the very first run surfaces an explicit "unavailable" state instead of partial or empty data.

**Why this priority**: Correctness and resilience of the read surface. Core indexing must never become hostage to catalog analysis, and consumers must be able to distinguish fresh, stale, and unavailable catalogs. This spans both catalogs and is required before downstream features can trust the surface.

**Independent Test**: Index a repository (catalog present and fresh); force a catalog-analysis failure on a subsequent re-index; verify the index still succeeds, the prior catalog is still readable and marked stale with its graph version; then on a fresh project force a first-run analysis failure and verify an explicit "unavailable" state with no partial data.

**Acceptance Scenarios**:

1. **Given** a successful index, **When** analysis completes, **Then** the new catalog replaces the old one atomically and no consumer ever observes a partially-written catalog.
2. **Given** a successful sync, **When** the sync completes, **Then** both catalogs are recomputed in full.
3. **Given** catalog analysis that fails after the graph updated successfully, **When** the operation finishes, **Then** the index/sync is reported successful and the prior catalog remains readable, marked stale and tagged with the graph version it was computed from.
4. **Given** a first-run analysis failure with no prior catalog, **When** a consumer reads the catalog, **Then** an explicit "unavailable" state is returned, never partial or empty-looking data.

---

### User Story 5 - Opt in per catalog, with zero cost when disabled (Priority: P3)

A maintainer turns each catalog on independently in the project configuration. A repository that has not opted in pays no analysis cost and stores no catalog data, and its behavior is byte-identical to the pre-feature state. Consumers that query a disabled or not-yet-indexed project receive plain guidance describing the condition rather than an error.

**Why this priority**: Activation discipline and dormancy. It protects every existing project from new cost on upgrade and preserves the fork's opt-in-module discipline. It is lower priority because it gates the others rather than delivering new browsing value, but it must hold for the feature to be shippable.

**Independent Test**: On a default (not-opted-in) project, verify no catalog data is written, no measurable analysis overhead is added, and catalog queries return success-shaped disabled guidance; then opt in and verify catalogs are computed.

**Acceptance Scenarios**:

1. **Given** a project that has not enabled either catalog, **When** it is indexed, **Then** no catalog analysis runs, no catalog data is written, and indexing behavior is unchanged from before the feature.
2. **Given** a project with only one catalog enabled, **When** it is indexed, **Then** only that catalog is computed and stored.
3. **Given** a consumer querying a project where the catalog is disabled, not indexed, or referenced by an unknown flow/cluster identifier, **When** the query runs, **Then** the surface returns success-shaped guidance describing the condition and never an error-shaped response.
4. **Given** this repository, **When** it is indexed, **Then** both catalogs are enabled and computed (dogfooding).

---

### Edge Cases

- **No detectable entry points**: A repository with no static registrations and no externally-exposed exports yields an empty (but available) flow catalog; the list surface returns an empty, success-shaped page — distinct from the "unavailable" failure state.
- **Cyclic call graph**: A flow whose calls form a cycle is traced as a cycle-safe graph that visits each symbol once; there is no infinite loop and no duplicated step.
- **Multiple simultaneous truncations**: A flow that hits depth, width, and total-step limits at once records each applicable truncation so no boundary is silently dropped.
- **Entry point that is both a handler and an exposed export**: The entry point roots exactly one flow (no duplicate root from being detected two ways).
- **Isolated file**: A file with no cross-file call or import evidence is persisted as an explicit, flagged singleton cluster (never silently omitted, never merged into a synthetic "unclustered" bucket).
- **Even split with tied overlap**: When two descendants tie on overlap against the same prior cluster, a deterministic tie-break assigns the inherited identifier to exactly one of them.
- **Unknown identifier**: Requesting a flow or cluster identifier that does not exist returns success-shaped "unknown id" guidance, not an error.
- **Stale read**: Reading a catalog after an analysis failure returns the prior data together with its staleness marker and the graph version it was computed from.
- **LLM display label unconfigured**: With no LLM endpoint configured, no model call is made and the catalog is byte-identical to the LLM-absent case; only the deterministic canonical label is present.

## Requirements *(mandatory)*

### Functional Requirements

**Entry-point detection**

- **FR-001**: System MUST detect execution-flow entry points using static registration evidence only: existing `route` nodes; AST-resolved CLI command registrations (e.g. commander `.command('<name>').action(<handler>)`, detected by a new minimal AST recognizer that reuses the existing inline-handler body-attribution technique) and event/queue handler registrations (recognized by re-applying the existing callback/observer registration recognizers to mark the *registered* handler node as a root, not inferred from unlabeled synthesized edges); and externally-exposed exports — `isExported` callable nodes (`function`/`method`) with zero inbound `calls` or `references` edges of any provenance. There is no `export` node kind or `exports` edge emitted today; `isExported` is the live signal.
- **FR-002**: System MUST NOT use name-based heuristics (for example, symbol-name patterns) to identify entry points.
- **FR-003**: System MUST root exactly one flow per detected entry point, deduplicating an entry point that qualifies through more than one form of evidence.

**Flow model and tracing**

- **FR-004**: System MUST represent each flow as a single bounded branching call graph that is cycle-safe (each symbol appears once), not as enumerated root-to-leaf paths and not as sampled representative paths.
- **FR-005**: System MUST bound every flow trace with fixed caps of 12 hops of depth, 20 outgoing edges per step, and 200 unique steps per flow.
- **FR-006**: The caps in FR-005 MUST be fixed in the delivered code and versioned with it — changeable only by a code change, never configurable per project.
- **FR-007**: System MUST persist truncation state for a flow whenever any cap is reached, distinguishing depth, width, and total-step truncation, so a bounded flow is never presented as complete.
- **FR-008**: Flow tracing MUST traverse all resolved call-edge provenance classes — static, LSP-corrected, and heuristic/synthesized (callback, EventEmitter, react-render, jsx-child, and equivalents). Tracing MUST follow both `calls` and `references` edges out of a flow root and its steps, because a route/handler root connects to its handler via a `references` edge in some frameworks (C#, NestJS) and a `calls` edge in others (Express); for a route entry point the flow root is the `route` node itself.
- **FR-009**: Every persisted flow step MUST carry the provenance of the call edge that produced it.

**Flow naming**

- **FR-010**: System MUST name a flow by its route method and path when it is rooted at a route, by the CLI command name when it is rooted at a CLI entry point, and otherwise by the qualified root symbol.

**Cluster membership**

- **FR-011**: System MUST assign functional clusters using deterministic Louvain community detection over an undirected file graph in which files are vertices and each symbol inherits its file's cluster.
- **FR-012**: System MUST weight each file-pair edge by count-aggregated cross-file evidence: every cross-file call or import counts as 1, parallel evidence between the same file pair sums into that pair's weight, and self-loops are dropped.
- **FR-013**: Cluster assignment MUST be deterministic — repeat analysis of an unchanged graph produces identical membership via stable vertex ordering and deterministic tie-breaking — and MUST use exactly one community-detection algorithm (no second algorithm or fallback).
- **FR-014**: Every indexed file MUST belong to exactly one cluster; single-file communities MUST be persisted as explicit singleton clusters, each flagged as a singleton.

**Cluster identity**

- **FR-015**: Across re-indexes, System MUST assign cluster identifiers by greedy one-to-one overlap matching against the prior catalog, transferring a prior identifier to a new cluster only when their membership overlap (Jaccard) is at least 0.5.
- **FR-016**: When a prior cluster splits, System MUST transfer its identifier to only the single best-matching descendant; all other descendants MUST receive new identifiers.
- **FR-017**: Identity matching ties MUST be broken deterministically so the same assignment is produced on every run.
- **FR-017a**: A cluster's stable identifier MUST be an opaque token minted on first appearance and transferred per FR-015/FR-016; it MUST NOT be a positional index or storage rowid (which churn on the swap). Identity matching reads prior membership from the last successfully-committed clusters catalog (a pre-swap read); a first successful analysis with no prior catalog mints all-new identifiers. Flow identity needs no analogous mechanism — a flow's natural key is its deterministic root entry point (FR-001/FR-003).

**Labels**

- **FR-018**: System MUST compute a deterministic canonical label for each cluster from its dominant directory and name tokens.
- **FR-019**: System MAY store an optional LLM-generated display label as separate, presentation-only metadata that MUST NOT affect cluster membership, identity, or canonical labels; when no LLM is configured, System MUST make no model call and MUST behave identically to the LLM-absent case.

**Lifecycle**

- **FR-020**: System MUST fully recompute both catalogs after every successful index and after every successful sync (no incremental catalog maintenance).
- **FR-021**: System MUST update catalogs atomically so that a reader never observes a partially-written catalog. The full recomputed catalog MUST replace the prior one inside a single SQLite write transaction over the existing WAL-mode store, so a reader — including a concurrent daemon query connection under WAL snapshot isolation — observes either the complete prior catalog or the complete new one. No generation-tagged rows or multi-generation retention are used; the only versioning state is the computed-from token (FR-022).
- **FR-021a**: Any catalog read that composes more than one SQL statement — notably a `total` count alongside a paged slice (FR-027/FR-028) — MUST derive both from a single consistent snapshot (a single query or full-fetch-then-slice per the existing read-ops precedent, or a read transaction wrapping the statements), so a concurrent atomic swap cannot yield a torn cross-generation response. Reads run in autocommit by default (each *statement* gets its own snapshot), so multi-statement composition is where torn reads can arise; where WAL is unavailable (some virtualized/network mounts silently retain the prior journal mode) the store degrades to writer-blocks-reader, preserving the same all-or-nothing guarantee.
- **FR-022**: If catalog analysis fails after the graph updated successfully, System MUST still report the index or sync as successful and MUST retain the prior catalog as readable, marked stale and tagged with the graph version it was computed from. The "graph version" MUST be a monotonic, project-scoped write-version token advanced on each successful index and sync (analogous to the existing vectors write-version), persisted in project metadata; each catalog records the token it was computed from, and staleness MUST be *derived* by comparing a catalog's recorded token against the live token (recorded < live ⇒ stale), not stored as a mutable flag.
- **FR-022a**: Persisted catalog rows (flow steps, cluster members) MUST reference graph nodes and files *by value* (node id, file path) WITHOUT an `ON DELETE CASCADE` foreign key to `nodes`/`files`, so a prior catalog retained as stale (FR-022) survives the per-file node deletion and re-insertion of a subsequent index or sync until a new catalog atomically replaces it. A cascading FK would silently shred the retained-stale catalog before its replacement is even computed. Because node IDs are position-dependent (they change when a symbol's line shifts, so by-value references dangle after ordinary edits), persisted catalog rows MUST also denormalize enough identity — symbol name and kind alongside the node id and file path — to stay meaningfully displayable when a node id no longer resolves; unresolvable fields render as an explicit placeholder rather than an error.
- **FR-023**: If catalog analysis fails on the first run with no prior catalog, System MUST expose an explicit "unavailable" state and MUST NOT expose partial or empty-looking data.

**Activation**

- **FR-024**: System MUST make flow analysis and cluster analysis each independently opt-in via a per-catalog flag in the project configuration (`codegraph.json`).
- **FR-025**: A project that has not opted in MUST run no catalog analysis and write no catalog rows and no catalog metadata; behavior is byte-identical to the pre-feature state with respect to catalog *data*. Empty catalog table definitions MAY exist in the shared schema (as `node_vectors` does today) and are not considered added cost.
- **FR-026**: This repository MUST enable both catalogs to satisfy the binding Dogfooding Protocol.

**Surfaces and contracts**

- **FR-027**: System MUST expose MCP tools `codegraph_list_flows`, `codegraph_get_flow`, and `codegraph_list_clusters` (the `codegraph_` prefix every existing MCP tool carries). The list tools MUST return bounded summaries paged by `limit` (default 20, clamped 1–100; over-cap clamps, not errors) and a zero-based `offset` (default 0), reporting the total match count and the effective `limit`/`offset`; results MUST use a totally-ordered deterministic sort ending in the stable identifier — `codegraph_list_flows` by flow name ascending then flow id, `codegraph_list_clusters` by member-file count descending then canonical label ascending then cluster id. `codegraph_get_flow` MUST return a single flow's bounded graph plus truncation metadata shaped `{ truncated, truncation: { depth, width, totalSteps } }`, where `truncated` is the disjunction of the three axis flags and each axis flag is set independently.
- **FR-028**: System MUST expose REST endpoints `/api/flows` and `/api/clusters` (unprefixed, like existing `/api/*` routes) that mirror the MCP tools' field names and offset/limit pagination semantics so the two surfaces cannot drift. The REST mirrors reuse SPEC-005's existing `Limit` (default 100, max 500) and `Offset` parameters and the `ListResult` envelope (`items`, `total`, `limit`, `offset`); both surfaces share field names and offset-pagination semantics while each keeps its own page-size ceiling.
- **FR-029**: `codegraph_list_clusters` (and its REST mirror `/api/clusters`) MUST accept a minimum-size filter named `minSize` (integer, default 1; values < 1 clamp to 1). A cluster is returned when its member-file count is ≥ `minSize`; default 1 returns the full total-coverage catalog including singletons, and `minSize` ≥ 2 suppresses singletons.
- **FR-030**: For expected conditions — project not indexed, analysis disabled, catalog stale, or unknown flow/cluster identifier — every surface MUST return success-shaped guidance and MUST NOT return an error-shaped (`isError`) response.
- **FR-031**: System MUST NOT modify `codegraph_explore`'s behavior or output.

**Cross-cutting constraints**

- **FR-032**: All catalog structure, membership, identity, and canonical labels MUST be deterministic and free of any LLM involvement (Constitution Principle V).
- **FR-033**: The feature MUST introduce no new native runtime dependencies; any new persistence or asset MUST use the existing local-first store and build wiring (Constitution Principle VII).

### Reviewability Budget *(mandatory)*

- **Primary surface**: scheduler/runtime (the index-time flow/cluster analysis engine).
- **Secondary surfaces, if any**: schema/migration (new persisted catalog tables), API (three MCP tools plus two REST endpoints), seed/config (per-catalog `codegraph.json` opt-in flags).
- **Projected reviewable LOC**: ~525 (recorded PRD-time estimate; excludes generated/lock/vendor artifacts).
- **Projected production files**: ~8–12 (new analysis module, schema additions, MCP tool wiring, REST route wiring, config plumbing).
- **Projected total files**: ~15–25 including tests, fixtures, and benchmark/UAT evidence.
- **Budget result**: warning accepted — 525 reviewable LOC exceeds the 400 warn threshold (~31% over) but is well under the 800 block threshold.
- **Split decision**: Remains one spec and one PR. The maintainer explicitly declined the estimator's recommended two-slice split (flows, then clusters) in design-concept Q21; the two catalogs share a single index-time analysis lifecycle and atomic-swap persistence, making one integration point the cleaner seam. The accepted warning is recorded here and in the SPEC-011 workflow file.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes (here, the per-catalog `codegraph.json` opt-in flags are the disable path).
- Traceability MUST map each major requirement or success criterion to the changed files and to its verification evidence (unit tests, deterministic probes, the paired performance benchmark, and the self-repo UAT).
- Verification evidence MUST include the ≥3-run paired full-index benchmark demonstrating ≤20% median overhead, and the self-repo dogfood UAT outcome (CLI index pipeline flow plus cluster ID stability across two re-indexes).
- Deferred work MUST name the follow-up spec or issue (CLI listing subcommands and `codegraph_explore` enrichment are recorded out-of-scope follow-ups).

### Key Entities *(include if feature involves data)*

- **Catalog**: The versioned, atomically-swapped collection of flows or clusters for one project. Attributes: catalog kind (flows or clusters); the monotonic graph write-version token it was computed from; state ∈ {available, stale, unavailable}, where **stale** is derived (recorded token < live token), **unavailable** is an explicit first-run-failure marker, and an **available-but-empty** catalog (tokens equal, zero entries — e.g. no detectable entry points) is distinct from both and from a disabled/never-computed catalog.
- **Execution Flow**: A named, bounded call graph rooted at one entry point. Attributes: identifier (derived from its deterministic root entry point), name (per FR-010), root entry point (for a route-rooted flow the root is the `route` node, named `<METHOD> <path>`), ordered/branching steps, truncation state shaped `{ truncated, truncation: { depth, width, totalSteps } }`, and source graph version.
- **Flow Step**: One node within a flow's graph. Attributes: the referenced symbol, the provenance of the incoming call edge (static, LSP, or heuristic/synthesized), and its depth from the root.
- **Entry Point**: A statically detected flow root. Attributes: kind (route, CLI command, event/queue handler, or externally-exposed export) and the evidence that qualified it.
- **Functional Cluster**: A group of files forming a functional unit. Attributes: stable identifier, canonical label, optional LLM display label (presentation-only), member files, size, singleton flag, and source graph version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In an opted-in repository, every detected entry point yields exactly one flow, and 100% of persisted flow steps carry a provenance value.
- **SC-002**: 100% of flows that reached a traversal limit are marked truncated — no bounded flow is presented as complete.
- **SC-003**: In an opted-in repository, 100% of indexed files appear in exactly one cluster (total coverage, singletons included).
- **SC-004**: Re-analyzing an unchanged graph produces identical flow and cluster catalogs on every run (full determinism).
- **SC-005**: A change that leaves a cluster at least half-overlapping preserves that cluster's identifier across the re-index; a genuine split transfers the identifier to only the best-matching descendant.
- **SC-006**: Enabling both catalogs increases full-index wall-clock time by no more than 20% at the median across at least three paired runs on the fixture monorepo, with embedding and LSP configuration held constant.
- **SC-007**: A project that has not opted in adds zero measurable analysis overhead and writes no catalog rows or metadata — behavior is byte-identical to the pre-feature state with respect to catalog data (empty table definitions in the shared schema, as with `node_vectors`, are not counted).
- **SC-008**: When analysis fails after a successful graph update, the index still completes successfully and the prior catalog remains readable and marked stale; a first-run analysis failure surfaces an explicit "unavailable" state 100% of the time.
- **SC-009**: The MCP and REST surfaces return the same field semantics for the same catalog data, and expected conditions (not indexed, disabled, stale, unknown identifier) return success-shaped guidance in 100% of cases — never an error-shaped response.
- **SC-010**: The self-repo dogfood UAT confirms the `codegraph index` CLI entry point's flow reaches the extraction → resolution → (LSP) → embedding stages with correct per-step provenance and truncation state, and that this repository's source modules land in coherent clusters whose identifiers stay stable across two consecutive re-indexes.

## Assumptions

- Route and event/queue registrations qualifying as entry points are bounded by CodeGraph's existing route/handler extraction and callback/observer registration recognizers. CLI-command detection is delivered as a new minimal AST recognizer (commander `.command().action()` in v1, reusing the existing inline-handler body-attribution technique); adding *further* framework or CLI coverage is out of scope for this feature.
- Paged list surfaces reuse SPEC-005's existing **offset/limit** pagination (a `limit` page size and a zero-based `offset`, returning `{ items, total, limit, offset }`); there is no cursor model. No new paging model is introduced.
- The "fixture monorepo" used for the performance benchmark is the repository's existing benchmark fixture used for prior performance validation; embedding and LSP configuration are held constant across the paired runs.
- Cluster canonical labels derive only from directory and symbol-name tokens already present in the graph; no external taxonomy or naming service is used.
- Catalogs persist in the existing per-project local SQLite store; new catalog DDL ships in the existing `src/db/schema.sql` (copied to `dist/db/schema.sql` by `copy-assets`) PLUS a lockstep `src/db/migrations.ts` entry (the `node_vectors` v9 pattern) so already-initialized projects gain the tables on open; no new native store or dependency is added. Catalog rows follow the `node_vectors` precedent of derived data held without a cascading FK to graph rows (FR-022a).
- The optional LLM display label (from the separate LLM-access capability) is dormant in this repository's environment (embeddings configured, no LLM endpoint), so its non-interference is validated by dormancy tests rather than a live model call.
- "Externally-exposed export" means an `isExported` callable node with zero inbound `calls`/`references` edges (all provenance), computed from the existing resolved edges — there is no `export` node kind or `exports` edge to key off.

## Out of Scope

- User-interface panels (a later Web UI capability consumes these catalogs' API) and generated wiki prose (a later wiki capability).
- Name-based entry-point heuristics; root-to-leaf path enumeration; representative-path sampling; project-configurable or repo-adaptive trace caps; a second community-detection algorithm or label-propagation fallback; tuned per-ecosystem edge-weight ratios; incremental catalog maintenance during sync; default-on activation; a separate analyze command; any change to `codegraph_explore`; and CI-enforced wall-clock performance gates.
- CLI listing subcommands (`codegraph flows` / `codegraph clusters`) — recorded as an out-of-scope follow-up for v1 (design-concept Open Question); revisit if dogfood use shows a need.
- Enriching `codegraph_explore` output with flow/cluster context — recorded as an out-of-scope follow-up requiring the full A/B validation methodology before any merge.
