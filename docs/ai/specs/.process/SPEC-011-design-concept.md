---
topic: "Execution flows and functional clusters"
slug: "spec-011-execution-flows-clusters"
date: "2026-07-14"
mode: "setup"
spec_id: "SPEC-011"
source_input:
  type: "file"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md#spec-011-execution-flows--clusters"
question_count: 21
stop_reason: "natural"
---

# Design Concept: Execution Flows and Functional Clusters

> **Source:** `docs/ai/specs/intelligence-platform-technical-roadmap.md`, SPEC-011
> **Date:** 2026-07-14
> **Questions asked:** 21
> **Stop reason:** natural
>
> This is a fresh, human-ratified interview. A prior scaffold attempt (2026-07-13,
> run by Codex) auto-accepted all of its own recommendations and was discarded on
> 2026-07-14; its branch commits were reset. Do not treat that draft as ratified.
> Notably, this session's slice decision (Q21: one PR) differs from the discarded
> draft's assumption (two PRs).

## Goals

- Build a persisted catalog of named execution flows, rooted only at
  statically-registered entry points, each flow a single bounded branching call
  graph with per-step edge provenance (Q1, Q2, Q7).
- Build a persisted catalog of functional clusters via deterministic Louvain over
  a count-weighted undirected file graph, with cluster IDs stable across
  re-indexes through Jaccard ≥ 0.5 one-to-one overlap matching (Q8–Q11).
- Expose both catalogs as paged, bounded MCP tools (`list_flows`, `get_flow`,
  `list_clusters`) and REST mirrors (`/api/flows`, `/api/clusters`) sharing field
  semantics; `codegraph_explore` is untouched (Q16, Q17).
- Recompute both catalogs in full, atomically, after every successful index and
  sync; analysis failure never blocks core indexing — the prior catalog is
  retained and marked stale (Q13, Q14).
- Keep analysis opt-in via `codegraph.json`, enable it for this repository
  (Dogfooding Protocol), and prove ≤20% median full-index overhead with a
  ≥3-run paired benchmark recorded as evidence (Q15, Q19).
- Anchor the self-repo UAT on the CLI index pipeline flow (Q20).
- **Deliver as one PR**, accepting the recorded 525-reviewable-LOC warning
  (525 > 400 warn threshold; well under the 800 block threshold) as a deliberate,
  human-ratified decision (Q21).

## Non-goals

- Name-based entry-point heuristics (`handleX`, `*Controller`) — excluded in Q1.
- Root-to-leaf path enumeration and representative-path sampling — excluded in Q2.
- Project-configurable or repo-adaptive trace caps — excluded in Q3.
- A second community-detection algorithm (label-propagation fallback) — excluded
  in Q8; the roadmap's hedge is resolved to Louvain-only.
- Tuned edge-weight ratios (calls vs imports) — excluded in Q10.
- LLM output altering canonical labels, membership, or cluster identity — excluded
  in Q12. Live LLM-label validation in this repo's dogfood env is also out:
  `.envrc.local` configures embeddings only, no `CODEGRAPH_LLM_*` endpoint —
  dormancy tests carry that arm.
- Incremental flow/cluster maintenance during sync — excluded in Q13 in favor of
  deterministic full recomputation.
- Default-on activation and a separate `codegraph analyze` command — excluded in Q15.
- Any change to `codegraph_explore` output — excluded in Q16 (do-not-regress surface).
- CI-enforced wall-clock performance gates — excluded in Q19 (recorded benchmark
  evidence instead).
- UI panels and wiki prose — roadmap-level out-of-scope (SPEC-006/SPEC-019).

## Design Tree (Q&A log)

### Q1. What evidence should qualify a symbol as an execution-flow entry point in v1?

**Branch:** Entrypoint detection

**Recommended answer:** Static registration evidence only.
> Existing route nodes, AST-resolved CLI command registrations, event/queue handler
> registrations, and qualifying exports — all deterministic. Grounded in
> Constitution Principle V (deterministic, LLM-free; silent beats wrong) and
> CLAUDE.md's dynamic-dispatch rule that partial/wrong coverage is worse than none.

**Alternatives offered:**
- Add name-based heuristics: more entry points on weak-framework repos, at real
  false-positive cost — fabricated flows would poison SPEC-012 impact and SPEC-019
  chapters downstream.
- Routes + CLI only: smallest v1 surface, but a deliberate cut against the
  roadmap's explicit event/queue scope.

**User's answer:** Static registration evidence only (Recommended)

---

### Q2. When calls branch (one function calls several others), what should one execution-flow catalog entry represent?

**Branch:** Flow model

**Recommended answer:** One bounded graph per entrypoint.
> Each entry point owns a single flow: a bounded call-graph (DAG with cycle guards)
> preserving branches as-is. No combinatorial path expansion; matches how
> GraphTraverser already does BFS/DFS over call edges. SPEC-019 walkthroughs can
> linearize later.

**Alternatives offered:**
- One entry per root-to-leaf path: linear and readable, but path count explodes on
  any real fan-out.
- Top-N representative paths: compact but deliberately omits valid branches, and
  deterministic "representativeness" is its own unsolved heuristic.

**User's answer:** One bounded graph per entrypoint (Recommended)

---

### Q3. Should v1 flow tracing use fixed index-time caps, or expose cap configuration?

**Branch:** Trace bounds

**Recommended answer:** Fixed versioned caps + truncation metadata.
> Hard-coded limits (bumped only via code change), with per-flow truncation flags
> persisted so a bounded result never implies completeness. Constitution II (no
> configurability nobody asked for) and deterministic cross-repo behavior.

**Alternatives offered:**
- `codegraph.json` overrides: adds a validation surface and makes catalogs
  non-comparable across repos.
- Repo-adaptive caps: predictable per-repo but harder to reason about; explore
  budgets scale *output*, these caps shape *persisted* data.

**User's answer:** Fixed versioned caps + truncation metadata (Recommended)

---

### Q4. Which cap bundle should v1 flow tracing ship with?

**Branch:** Trace bounds

**Recommended answer:** 12 hops / 20 edges per step / 200 steps.
> Depth 12 doubles the deepest validated dogfood flow (excalidraw's 6-hop
> dynamic-dispatch trace in CLAUDE.md), width 20 covers dispatchers before
> truncating, 200 unique symbols per flow aligns with explore-scale output budgets.
> Recommended with moderate confidence — engineering judgment, validated later by
> the perf gate.

**Alternatives offered:**
- 8 / 10 / 100: cheaper, truncates cross-layer flows earlier.
- 20 / 50 / 500: broader coverage, pressure on the ≤20% overhead gate without
  evidence of need.

**User's answer:** 12 hops / 20 edges per step / 200 steps (Recommended)

---

### Q5. Which exported callables should become flow roots, given every registered route/CLI/event handler already roots a flow?

**Branch:** Entrypoint detection

**Recommended answer:** Externally-exposed exports only.
> Exports with zero project-internal callers (true public API surface), plus all
> registered handlers. Deterministic from existing edges, and avoids duplicating an
> internal helper's subtree as its own flow.

**Alternatives offered:**
- Every exported callable: maximal coverage but many overlapping flows on
  library-style repos (like CodeGraph itself).
- Registered handlers only: cleanest precision, but library repos with no
  routes/CLI would get an empty catalog.

**User's answer:** Externally-exposed exports only (Recommended)

---

### Q6. How should a persisted flow be named in the catalog?

**Branch:** Flow naming (roadmap OQ-7)

**Recommended answer:** Route method+path, else qualified symbol.
> Routes name themselves ("GET /api/flows"); CLI flows use the command name
> ("codegraph index"); everything else falls back to the qualified root symbol
> ("CodeGraph.indexAll"). Deterministic, matches the roadmap's OQ-7 suggestion.

**Alternatives offered:**
- Add path-derived context: slightly more scannable, second heuristic to keep
  stable.
- Synthesized descriptive names: reads nicest in wiki chapters, but a new
  deterministic-NLG surface with drift/testing cost; SPEC-018 display labels can
  add prose later.

**User's answer:** Route method+path, else qualified symbol (Recommended)

---

### Q7. Which call-edge provenance classes may flow tracing traverse?

**Branch:** Retrieval and dynamic dispatch

**Recommended answer:** All resolved calls, provenance on every step.
> Static, LSP-corrected, and heuristic synthesized edges (callback, EventEmitter,
> react-render, jsx-child…), with each persisted step carrying its edge's
> provenance. CLAUDE.md's coverage principle: flows must connect end-to-end —
> excluding synthesized edges would break every flow at its first dynamic-dispatch
> boundary.

**Alternatives offered:**
- Static + LSP only: flows stop dead at callbacks — the documented "partial
  coverage is worse than none" failure mode.
- Traverse all + flow-level heuristic flag: derivable by consumers from per-step
  provenance; redundant storage.

**User's answer:** All resolved calls, provenance on every step (Recommended)

---

### Q8. Which community-detection strategy should define v1 cluster membership?

**Branch:** Clustering algorithm

**Recommended answer:** Deterministic Louvain only.
> One algorithm, stable node ordering, deterministic tie-breaking so repeat indexes
> of an unchanged repo yield identical clusters. Constitution II: a second
> algorithm is speculative until a real repo shows Louvain failing.

**Alternatives offered:**
- Label propagation only: simpler but generally weaker/noisier communities.
- Louvain + label-propagation fallback: the roadmap's hedge taken literally — two
  algorithms, a switching rule, double the stability testing.

**User's answer:** Deterministic Louvain only (Recommended)

---

### Q9. At what granularity should Louvain assign functional clusters?

**Branch:** Cluster data model

**Recommended answer:** Files as vertices.
> Cross-file call edges aggregate to file-to-file weights, imports connect files,
> symbols inherit their file's cluster. Stable across small edits, scales, and maps
> onto SPEC-019's per-cluster chapters. Industry norm for architecture-recovery
> tooling. (This repo: 8,440 nodes vs 536 files.)

**Alternatives offered:**
- Callable symbols as vertices: finer-grained but bigger, noisier, less stable
  communities and a harder identity problem.
- Directories as vertices: coarsest, mostly rediscovers the folder tree.

**User's answer:** Files as vertices (Recommended)

---

### Q10. How should cross-file call and import edges be weighted in the Louvain file graph?

**Branch:** Cluster edge weights

**Recommended answer:** Count-aggregated, equal per-edge weight.
> Each cross-file call or import counts 1; parallel evidence sums into the
> undirected file-pair weight; self-loops dropped. No tuning constants to calibrate
> or defend — Constitution II.

**Alternatives offered:**
- Calls weighted above imports: any ratio is an unvalidated constant to justify
  and re-tune per ecosystem.
- Unweighted adjacency: discards multiplicity — 40 calls cluster no tighter than
  one type-only import.

**User's answer:** Count-aggregated, equal per-edge weight (Recommended)

---

### Q11. What minimum membership overlap should let a new cluster inherit a prior cluster's ID across re-indexes?

**Branch:** Stable identity

**Recommended answer:** Jaccard ≥ 0.5, deterministic one-to-one.
> Majority-of-union overlap: identity survives ordinary churn but never transfers
> on a weak accidental match. Greedy best-match, one-to-one; a split's best
> descendant keeps the ID, others get new IDs; ties break on stable ordering.
> Moderate confidence — 0.5 is the defensible midpoint, not a measured optimum.

**Alternatives offered:**
- Jaccard ≥ 0.3: fewer "new cluster" events, at the risk of ID drift to mostly
  different content.
- Jaccard ≥ 0.7: ordinary refactors mint new IDs often, churning SPEC-019 anchors.

**User's answer:** Jaccard ≥ 0.5, deterministic one-to-one (Recommended)

---

### Q12. How should optional SPEC-018 LLM labels interact with the deterministic heuristic cluster labels?

**Branch:** LLM integration and dormancy

**Recommended answer:** Separate optional display label.
> Heuristic label (dominant directory/name tokens) stays canonical; an LLM label,
> when SPEC-018 is configured, is separate presentation metadata that can never
> alter membership, identity, or canonical naming (Constitution V). Note: this
> repo's dogfood env has embeddings but no `CODEGRAPH_LLM_*` endpoint, so the LLM
> arm can't be validated live here — dormancy tests must carry it.

**Alternatives offered:**
- Defer LLM labels entirely to SPEC-018+: thinnest slice, zero SPEC-018 coupling —
  legitimate cut.
- LLM label replaces heuristic: model-dependent catalog content — violates
  Principle V's determinism boundary.

**User's answer:** Separate optional display label (Recommended)

---

### Q13. When should persisted flows and clusters be recomputed?

**Branch:** Analysis lifecycle

**Recommended answer:** Full recompute after every successful index AND sync.
> Deterministic full recomputation after each graph update, swapped in atomically
> (readers never see a partial catalog). The file watcher keeps sync frequent, so
> catalogs stay fresh without incremental-maintenance complexity; cost bounded by
> the ≤20% overhead gate.

**Alternatives offered:**
- Full index only, stale after sync: cheapest syncs, but this repo's dogfood loop
  runs on sync — catalogs would sit stale, SPEC-012 would read stale flows.
- Incremental maintenance on sync: genuinely hard (membership is global); a
  Constitution II violation without evidence full recompute is too slow.

**User's answer:** Full recompute after every successful index AND sync (Recommended)

---

### Q14. If flow/cluster analysis fails after the graph itself updated successfully, what should happen?

**Branch:** Error handling

**Recommended answer:** Index succeeds; keep prior catalog marked stale.
> Core indexing never becomes hostage to analysis. The previous atomic catalog
> stays readable, tagged with the graph version it was computed from plus explicit
> staleness guidance (success-shaped, per the MCP error-shaping rules). First-run
> failure exposes an "unavailable" state, never partial data.

**Alternatives offered:**
- Fail the index/sync: a Louvain bug would take down core indexing for every
  opted-in project — wrong coupling direction.
- Replace with empty catalog: discards a usable prior catalog; zero flows becomes
  indistinguishable from "repo has no entry points".

**User's answer:** Index succeeds; keep prior catalog marked stale (Recommended)

---

### Q15. How should projects activate flow and cluster analysis in v1?

**Branch:** Activation and dormancy

**Recommended answer:** Opt-in via codegraph.json; enable here.
> Explicit per-catalog flags, following the fork's opt-in-module discipline (like
> the SPEC-008 LSP flag already in this repo's `codegraph.json`). Disabled projects
> pay zero analysis cost and get no catalog writes. This repo opts in for
> dogfooding — satisfying the binding Dogfooding Protocol.

**Alternatives offered:**
- Default-on: changes baseline index cost and `.codegraph` size for every existing
  user on upgrade.
- Separate `codegraph analyze` command: isolates cost but adds a second lifecycle
  and guarantees staleness between runs.

**User's answer:** Opt-in via codegraph.json; enable here (Recommended)

---

### Q16. Should SPEC-011 touch codegraph_explore's output to surface flows/clusters, or leave explore untouched and ship the catalogs only via the three new tools + REST?

**Branch:** MCP surface strategy

**Recommended answer:** Leave explore untouched in v1.
> SPEC-011's consumers are SPEC-012 enrichment, SPEC-019 chapters, and the
> web/REST surface — not agent tool-choice. Explore is the validated
> do-not-regress surface; any change there needs the full A/B methodology, which
> would balloon this spec. (CLAUDE.md documents that agents under-pick brand-new
> MCP tools; that's acceptable here because the catalogs' primary consumers are
> programmatic.)

**Alternatives offered:**
- Also enrich explore output: meets the agent where it is, but spends explore's
  output budget and requires with-vs-without A/B evidence before merge.
- New tools now + recorded explore-enrichment follow-up: same v1, explicit
  follow-up marker.

**User's answer:** Leave explore untouched in v1 (Recommended)

---

### Q17. What contract shape should the MCP tools and REST endpoints share?

**Branch:** API contracts

**Recommended answer:** Paged summaries + detail, shared field semantics.
> `list_flows`/`list_clusters` return stable-sorted, paged summaries (bounded —
> Constitution VI); `get_flow` returns one flow's bounded graph + truncation
> metadata. `/api/flows` and `/api/clusters` mirror the same field names and
> semantics (extending the SPEC-005 `openapi.yaml`) so the surfaces can't drift.

**Alternatives offered:**
- Unpaged full catalogs: blows MCP output budgets on large repos — the exact
  Constitution VI failure mode.
- Surface-specific contracts: two schemas to test/document; SPEC-012/019 would
  code against both.

**User's answer:** Paged summaries + detail, shared field semantics (Recommended)

---

### Q18. How should isolated files or one-file Louvain communities appear in the cluster catalog?

**Branch:** Cluster edge cases

**Recommended answer:** Persist explicit singleton clusters.
> Lossless membership: every indexed file belongs to exactly one cluster,
> singletons included and flagged. Consumers filter with a min-size parameter on
> the paged list. SPEC-019 needs total coverage to place every file in a chapter.

**Alternatives offered:**
- One synthetic "unclustered" bucket: implies a relationship among files whose
  only shared property is having none.
- Omit isolated files: partial membership — "not in any cluster" becomes ambiguous.

**User's answer:** Persist explicit singleton clusters (Recommended)

---

### Q19. How should the ≤20% index-time overhead requirement be measured and enforced?

**Branch:** Performance

**Recommended answer:** Median paired benchmark, recorded evidence.
> ≥3 paired full-index runs on the fixture monorepo (analysis off vs both catalogs
> on), embeddings/LSP config held constant, gate on median wall time. Recorded as
> UAT/PR evidence rather than a CI timing assertion — wall-clock gates in CI flake
> on shared runners.

**Alternatives offered:**
- CI-enforced timing gate: SPEC-003's hybrid gates assert behavior, not wall time;
  a wall-clock threshold trains people to ignore red CI.
- Internal analysis-phase timer only: stable but proves the wrong thing — the
  requirement is user-visible end-to-end overhead.

**User's answer:** Median paired benchmark, recorded evidence (Recommended)

---

### Q20. Which CodeGraph execution path should anchor SPEC-011's self-repo flow UAT?

**Branch:** Dogfood UAT

**Recommended answer:** CLI index pipeline.
> Verify the detected `codegraph index` CLI entrypoint's flow reaches extraction →
> resolution → (LSP) → embedding stages with correct step provenance and
> truncation state. Richest known multi-stage path in this repo; exercises
> entrypoint detection + deep tracing at once. Cluster UAT: `src/` modules land in
> coherent clusters with stable IDs across two re-indexes.

**Alternatives offered:**
- MCP explore request path: daemon/socket indirection makes the static path
  shorter and less representative.
- REST /api request path: dormant without `--web` and shallower than the index
  pipeline.

**User's answer:** CLI index pipeline (Recommended)

---

### Q21. The recorded estimate (525 reviewable LOC) is over the ~400 ceiling and the estimator suggested 2 slices. How should SPEC-011 be delivered?

**Branch:** Slice sizing

**Recommended answer:** Two thin vertical slices: flows, then clusters.
> PR 1 flows end-to-end, PR 2 clusters end-to-end; each INVEST-clean and under the
> ceiling.

**Alternatives offered:**
- One PR, accept the 525-LOC warning: single integration point; 31% over the warn
  threshold, well under the 800 block.
- Different seam (MCP first, REST later): interface split, weaker INVEST fit.

**User's answer:** One PR, accept the 525-LOC warning — **the maintainer declined
the recommended split.** This is the session's sole divergence from a
recommendation and reverses the discarded 2026-07-13 draft's two-PR assumption.

**Notes:** The `estimate-spec-size` runner operation is not registered in the
installed runner build (`unknown_helper`), so the advisory numbers come from the
roadmap's recorded PRD-time estimate (525 LOC, 2 suggested slices) and the
2026-07-14 setup-gate re-run (WARN, pass=true, sole warning "reviewable LOC 525
exceeds warn threshold 400"). Advisory only; the maintainer's one-PR decision is
recorded here and in the workflow file as the split decision the setup gate
requires.

## Open Questions

- **What:** CLI listing surface (`codegraph flows` / `codegraph clusters`
  subcommands) — the roadmap scopes MCP + REST only; a CLI surface was not
  interviewed.
  **Why deferred:** Out of the roadmap's stated scope; adding it would be scope
  expansion, so the default is not-in-v1.
  **Suggested next step:** Let `/speckit-specify` record it as out-of-scope for
  v1; revisit if dogfood use shows a need.
- **What:** Enriching `codegraph_explore` output with flow/cluster context as a
  follow-up (Q16 kept v1 untouched).
  **Why deferred:** Requires the full with-vs-without A/B methodology on the
  do-not-regress surface; wrong scope for this spec.
  **Suggested next step:** Reconsider after SPEC-012/019 consume the catalogs and
  there is evidence agents would benefit; run the CLAUDE.md validation
  methodology before any merge.

## Recommended Next Step

Continue `/speckit-pro:speckit-scaffold-spec SPEC-011` (in progress): populate
`docs/ai/specs/.process/SPEC-011-workflow.md` from this record — including the
one-PR split decision the setup gate requires — and refresh the contract marker.
After the scaffold artifacts are reviewed and pushed, run
`/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-011-workflow.md`.
