# Research: Execution Flows & Clusters

**Feature**: SPEC-011 | **Date**: 2026-07-14

The spec entered Plan with **zero unresolved clarification markers** (Clarify complete). Phase 0 therefore (A) records the 21 human-ratified decisions from `docs/ai/specs/.process/SPEC-011-design-concept.md` as the binding decision log, and (B) resolves the remaining **implementation-research** points that the plan depends on.

## A. Ratified decision log (Q1–Q21)

Each is a resolved design decision; the FR it drives is in brackets.

| Q | Decision | Drives |
|---|---|---|
| Q1 | Entry points from **static registration evidence only** (no name heuristics) | FR-001, FR-002 |
| Q2 | Each entry point = **one bounded branching call graph** (not path enumeration/sampling) | FR-004 |
| Q3 | **Fixed, code-versioned caps** + truncation metadata (not configurable) | FR-005, FR-006, FR-007 |
| Q4 | Cap bundle **12 hops / 20 out-edges per step / 200 unique steps** | FR-005 |
| Q5 | Exported roots = **externally-exposed exports only** (isExported, 0 inbound calls/references) | FR-001 |
| Q6 | Naming: **route method+path, else CLI name, else qualified symbol** | FR-010 |
| Q7 | Traverse **all resolved call-edge provenance** (static/LSP/heuristic); provenance on every step | FR-008, FR-009 |
| Q8 | **Deterministic Louvain only** (no second algorithm / label-prop fallback) | FR-011, FR-013 |
| Q9 | **Files as vertices**; symbols inherit their file's cluster | FR-011 |
| Q10 | **Count-aggregated equal weights**, undirected, self-loops dropped | FR-012 |
| Q11 | **Jaccard ≥ 0.5**, greedy one-to-one, deterministic tie-breaks | FR-015, FR-016, FR-017 |
| Q12 | LLM label = **separate optional display metadata**; never alters structure; dormant here | FR-019 |
| Q13 | **Full recompute after every successful index AND sync** (no incremental) | FR-020 |
| Q14 | Analysis failure ⇒ **index succeeds, keep prior catalog marked stale**; first-run ⇒ unavailable | FR-022, FR-023 |
| Q15 | **Opt-in per catalog via `codegraph.json`**; zero cost disabled; enabled here (dogfood) | FR-024, FR-025, FR-026 |
| Q16 | **Leave `codegraph_explore` untouched** in v1 | FR-031 |
| Q17 | **Paged summaries + detail, shared field semantics**, bounded | FR-027, FR-028, FR-029 |
| Q18 | **Persist explicit singleton clusters** (total coverage, flagged) | FR-014 |
| Q19 | **Median paired benchmark, recorded evidence** (≤20% overhead; not a CI timing gate) | SC-006 |
| Q20 | Self-repo flow UAT anchored on the **CLI index pipeline** | SC-010 |
| Q21 | **Deliver as one PR**, accepting the recorded ~525-LOC warning (maintainer declined the split) | Reviewability |

## B. Implementation-research decisions

### R1 — Deterministic Louvain: build in-module (pure TS), do not add a dependency

- **Decision**: Implement a compact deterministic Louvain in `src/analysis/clusters/louvain.ts` in pure TypeScript. Determinism is guaranteed by (a) a **stable vertex order** (files sorted by path), (b) **deterministic tie-breaking** when multiple moves yield equal modularity gain (prefer the lowest-ordered target community, then lowest-ordered neighbor), and (c) no random seed anywhere.
- **Rationale**: FR-013 requires "exactly one community-detection algorithm" and byte-identical repeat results (SC-004). Constitution VII forbids new native dependencies and requires new runtime deps to be pure-JS/WASM + permissively licensed. A from-scratch implementation gives full control over the ordering/tie-break determinism that FR-013 hinges on, avoids a new dependency's surface and license review, and keeps the reviewable diff self-contained. Louvain's core (local modularity-gain moves + community aggregation, iterated to convergence) is well-bounded (~150 LOC).
- **Alternatives considered**: `graphology-communities-louvain` (MIT, pure JS) — rejected: its determinism depends on a supplied RNG/seed and iteration order guarantees we'd still have to pin and test, so it buys little over a controlled in-module implementation while adding dependency + license surface. Label propagation (Q8 alternative) — excluded by ratified Q8. A Louvain+label-prop fallback (the roadmap's hedge) — excluded by Q8 (two algorithms, a switching rule, double the stability testing).

### R2 — `graph_write_version`: advance on successful graph update, before analysis; derive staleness

- **Decision**: A monotonic project-scoped `graph_write_version` integer in project metadata (the `vectors_write_version` precedent), advanced +1 on each successful index/sync **as part of the graph-update commit, before catalog analysis runs**. The catalog swap records `computed_from_version = ` the current live token. Staleness is **derived** at read time (`computed_from_version < live`), never stored.
- **Rationale**: FR-022 requires that a catalog whose analysis fails *after* a successful graph update is served as **stale**. If the token advanced only inside the (skipped-on-failure) swap transaction, a retained catalog would falsely read as fresh. Advancing on the graph-update commit guarantees the retained catalog's recorded token is strictly behind the live token after any post-update failure. Maintained only when ≥1 catalog is enabled, preserving disabled-project dormancy (FR-025/SC-007).
- **Alternatives considered**: advance inside the swap transaction — rejected (breaks FR-022 staleness on failure). Store a mutable `stale` boolean — rejected by FR-022 (must be derived).

### R3 — Atomic swap + single-snapshot composite reads

- **Decision**: Replace a catalog kind in **one SQLite write transaction** (DELETE child + parent rows, INSERT new rows, upsert `catalog_meta`) over the WAL store — no generation-tagged rows (FR-021). Composite reads (`total` + paged slice) run from a **single consistent snapshot** (a read transaction, or full-fetch-then-slice per `src/mcp/read-ops.ts`) so a concurrent swap cannot yield a torn cross-generation response (FR-021a).
- **Rationale**: WAL gives a writer + concurrent readers snapshot isolation per statement; a multi-statement read is the only place a torn read can occur, so the composite read must be wrapped. Where WAL is unavailable (some virtualized/network mounts silently retain the prior journal mode), the store degrades to writer-blocks-reader, preserving all-or-nothing.
- **Alternatives considered**: generation-tagged rows + GC — rejected (Q13/FR-021 explicitly no multi-generation retention; more state, more failure modes). Per-statement autocommit reads — rejected for composite reads (torn-read window).

### R4 — By-value refs, denormalized name/kind, no cascade

- **Decision**: Catalog rows reference graph rows **by value** (`node_id`, `file_path`) with **no foreign key** to `nodes`/`files`; node-bearing rows additionally denormalize `name` + `kind`.
- **Rationale**: FR-022a. A cascading FK plus the per-file `deleteNodesByFile` of the next index/sync would delete a retained-stale catalog before its replacement exists. And node ids are line-position-dependent sha256, so a by-value node id dangles after ordinary edits — the denormalized name/kind keep a stale flow step displayable (unresolvable fields → explicit placeholder). File paths are position-independent, so `cluster_members` needs no denormalization. This mirrors the `node_vectors` precedent (derived data held without a cascading FK to graph rows).
- **Alternatives considered**: cascading FKs — rejected (shreds retained-stale catalog). Store only node id (no name/kind) — rejected (unresolvable after ordinary edits).

### R5 — Entry-point detection sources

- **Decision**: Four static sources (FR-001), deduplicated to one flow each (FR-003): (1) existing `route` nodes; (2) a **new minimal commander CLI recognizer** for `.command('<name>').action(<handler>)`, reusing the existing inline-handler body-attribution technique; (3) event/queue handlers via **re-applying the existing callback/observer registration recognizers** to mark the *registered* handler node as a root (not inferred from unlabeled synthesized edges); (4) **externally-exposed exports** — `isExported` callable (`function`/`method`) nodes with zero inbound `calls`/`references` edges of any provenance. There is no `export` node kind / `exports` edge today; `isExported` is the live signal.
- **Rationale**: All deterministic and grounded in existing extraction/resolution (Constitution V; "partial/wrong coverage worse than none"). Tracing follows **both** `calls` and `references` out of a root because route→handler is a `references` edge in some frameworks (C#, NestJS) and a `calls` edge in others (Express); a route-rooted flow roots at the `route` node itself (FR-008).
- **Alternatives considered**: name-based heuristics (Q1), every exported callable (Q5), registered-handlers-only (Q5) — all excluded by ratified decisions.

### R6 — Cluster identity: opaque minted token + greedy one-to-one Jaccard

- **Decision**: A cluster's `id` is an **opaque token minted on first appearance** (not a rowid/positional index). Across re-index, prior membership is read from the **last successfully-committed clusters catalog (pre-swap read)**; new clusters greedily inherit a prior id when membership **Jaccard ≥ 0.5**, one-to-one; a prior cluster that splits transfers its id to only the **single best-matching descendant**, others mint new ids; ties break deterministically on stable ordering. First successful run with no prior catalog mints all-new ids.
- **Rationale**: FR-015/016/017/017a. Rowids/positional indices churn on the DELETE+INSERT swap, so downstream anchors (SPEC-012/019) would break every re-index — an opaque minted token that transfers on strong overlap is what keeps anchors stable through ordinary churn while refusing to drift on weak accidental matches (0.5 = majority-of-union midpoint, Q11).
- **Alternatives considered**: rowid/positional id — rejected (FR-017a, churns). Jaccard 0.3 (id drift) / 0.7 (excess churn) — excluded by Q11.

## Open follow-ups (out of scope, recorded)

- CLI listing subcommands (`codegraph flows` / `codegraph clusters`) — deferred; revisit if dogfood use shows need (design-concept Open Questions).
- Enriching `codegraph_explore` output with flow/cluster context — deferred; requires the full A/B validation methodology on the do-not-regress surface before any merge (Q16, Constitution VI).
