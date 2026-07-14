# Implementation Plan: Execution Flows & Clusters

**Branch**: `011-execution-flows-clusters` | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-execution-flows-clusters/spec.md`

**Design source of truth**: `docs/ai/specs/.process/SPEC-011-design-concept.md` (21 human-ratified decisions Q1–Q21). Each driving choice below cites its Q-number and the FR it satisfies.

## Summary

CodeGraph gains two deterministically-computed, persisted, atomically-swapped catalogs over the existing SQLite knowledge graph: **named execution flows** (one bounded branching call graph per statically-detected entry point, per-step edge provenance, fixed truncation caps) and **functional clusters** (deterministic Louvain over a count-weighted undirected file graph, total file coverage, stable identity across re-index). Both are exposed as paged, bounded, success-shaped **MCP tools** (`codegraph_list_flows`, `codegraph_get_flow`, `codegraph_list_clusters`) and **REST mirrors** (`/api/flows`, `/api/clusters`) that share field semantics. Analysis is opt-in per catalog via `codegraph.json`, runs at the very end of `indexAll`/`sync` (where `maybeRunEmbeddingPass` sits, post-resolution/post-LSP), and can never fail the index — a failed analysis retains the prior catalog marked stale. No LLM touches structure (Constitution V); `codegraph_explore` is untouched (Q16/FR-031); no new native dependency (Constitution VII). New code lives in a new `src/analysis/` module tree (sanctioned by Principle III); diffs to upstream-owned files stay minimal.

## Technical Context

**Language/Version**: TypeScript (strict), Node `>=20 <25` engines; effective from-source floor Node 22.5+ for `node:sqlite`.

**Primary Dependencies**: None new. Reuses `node:sqlite` (`DatabaseSync`, WAL + FTS5) via `src/db/sqlite-adapter.ts`, `QueryBuilder` prepared statements, `GraphTraverser` (BFS/DFS over edges), the SPEC-005 REST server (`src/server/`, committed `openapi.yaml`), and the `codegraph.json` config loader (SPEC-008 `lsp` flag is the opt-in precedent). Deterministic Louvain is implemented in-module in pure TypeScript (no graph-library dependency) — see research R1.

**Storage**: Existing per-project local SQLite store (`.codegraph/`). Five new tables (`flows`, `flow_steps`, `clusters`, `cluster_members`, `catalog_meta`) ship in `src/db/schema.sql` (copied to `dist/db/schema.sql` by `copy-assets`) PLUS a lockstep `src/db/migrations.ts` entry following the `node_vectors` v9 precedent so already-initialized projects gain the tables on open. One new project-metadata key, `graph_write_version` (the `vectors_write_version` precedent).

**Testing**: vitest; real files + real SQLite in `fs.mkdtempSync` temp dirs (no DB mocking); tests in `__tests__/` mirroring the `src/analysis/` module tree.

**Target Platform**: macOS/Linux/Windows (same matrix as the rest of CodeGraph; no platform-divergent behavior introduced — pure in-process SQLite + analysis).

**Project Type**: Local-first code-intelligence library + CLI + MCP/REST server (single project, layered pipeline).

**Performance Goals**: Enabling both catalogs increases full-index wall-clock by ≤20% at the median across ≥3 paired runs on the fixture monorepo, with embedding and LSP configuration held constant (Q19/SC-006). Disabled = zero measurable overhead and zero writes (Q15/FR-025/SC-007).

**Constraints**: Fully deterministic structure, zero LLM involvement in structure/membership/identity/canonical-labels (Q1/Q8/Q12/FR-032, Constitution V). No new native runtime dependency (FR-033, Constitution VII). Fixed, code-versioned trace caps 12 hops / 20 edges-per-step / 200 steps (Q3/Q4/FR-005/FR-006). Analysis failure never fails the index/sync (Q14/FR-022). Atomic single-transaction catalog swap under WAL; readers never see a partial or torn catalog (FR-021/FR-021a). `codegraph_explore` output unchanged (Q16/FR-031, Constitution VI).

**Scale/Scope**: This repo ~536 files / ~8,440 nodes (design-concept Q9). Flows bounded per-entry by the fixed caps; clusters cover 100% of indexed files with explicit singletons.

**Reviewability Budget**: Primary surface = scheduler/runtime (the index-time flow/cluster analysis engine, `src/analysis/`). Secondary surfaces = schema/migration, API (3 MCP tools + 2 REST endpoints), seed/config (per-catalog `codegraph.json` flags). Accepted PRD-time estimate ~525 reviewable LOC (warn accepted, one PR, ratified Q21). **Plan-time grounded re-estimate ≈ 620 reviewable LOC (range ~525–720)** — see Constitution Check → Reviewability for the per-surface breakdown and the 800-block comparison.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

Constitution v1.1.0, Principles I–VII.

- **I. Think Before Coding** — PASS. Spec carries zero unresolved clarification markers (Clarify complete); every scoping choice traces to a ratified Q-decision. Competing interpretations were resolved in the design concept, not silently picked.
- **II. Simplicity First** — PASS. The design is the minimum that satisfies the FRs: one community-detection algorithm (Q8, no fallback), fixed non-configurable caps (Q3), no incremental maintenance (Q13), no second naming heuristic (Q6). No speculative abstractions or unrequested configurability. **Complexity Tracking table is empty** (no Principle II violation to justify). The reviewability-budget warning (below) is a budget note with a ratified one-PR exception, not a Principle II complexity violation.
- **III. Surgical Changes** — PASS. New capability lives in a new `src/analysis/` module tree — explicitly one of Principle III's sanctioned new-module locations. Diffs to upstream-owned files are minimal and enumerated: `src/index.ts` (one hook call), `src/db/schema.sql` + `src/db/migrations.ts` (additive DDL), `src/mcp/tools.ts` (three new tools, no change to existing tools), `src/server/` + `openapi.yaml` (two additive routes), `codegraph.json` loader (two flags). No refactoring of existing code.
- **IV. Goal-Driven Execution** — PASS. Success criteria SC-001…SC-010 are measurable and testable; tests-first per the tasks phase. Verification evidence is enumerated (unit tests, deterministic probes, the ≥3-run paired benchmark, the self-repo dogfood UAT).
- **V. Deterministic, LLM-Free Extraction** — PASS. All catalog structure/membership/identity/canonical-labels derive from AST/static edges (FR-032). The optional LLM display label is presentation-only, never affects structure, and is dormant here (no `CODEGRAPH_LLM_*` endpoint) — validated by dormancy tests (Q12/FR-019). Determinism is a first-class requirement (SC-004): stable vertex ordering + deterministic tie-breaks; node/edge counts unchanged by analysis (analysis is read-only over the graph).
- **VI. Retrieval Performance Is a Regression Surface** — PASS. `codegraph_explore` behavior/output is untouched (FR-031). The three new tools are bounded/paged (FR-027) and return success-shaped guidance for every expected condition — not-indexed, disabled, stale, unknown id — never `isError` (FR-030). No steering is added to `server-instructions.ts` that could shift tool-choice or spend explore's budget (Q16). The `src/mcp/` diff will be reviewed by the retrieval-guardian agent before PR. The CPU-bound analysis pass MUST cooperatively yield (reuse `src/resolution/cooperative-yield.ts` `createYielder`/`maybeYield`) at Louvain-pass and flow-root boundaries so the daemon query loop stays responsive during large-repo analysis (Constitution VI — no `codegraph_explore` regression).
- **VII. Local-First, Private, Zero Native Dependencies** — PASS. `node:sqlite` remains the only store; Louvain is pure TS; no new runtime dependency (FR-033). New DDL is wired into `copy-assets` via `src/db/schema.sql` and mirrored in `src/db/migrations.ts`. No new network calls (the optional LLM label is dormant and, when configured, is a user-configured endpoint only).

**Reviewability (budget gate detail)**

- **Primary review surface**: scheduler/runtime — the `src/analysis/` index-time engine. **Exactly one** primary surface (satisfies the "≤1 primary surface" gate).
- **Secondary surfaces**: schema/migration; API (MCP tools + REST endpoints); seed/config (opt-in flags).
- **Budget thresholds** (constitution): warn above 400 reviewable LOC / 6 production files / 15 total files / >1 primary surface; **block** above 800 reviewable LOC / 8 production files / 25 total files / >1 primary surface *unless a ratified split exception exists*.
- **Plan-time grounded estimate** (per-surface, production LOC; DDL/openapi counted at a discount):

  | Surface | Files | ~LOC |
  |---|---|---|
  | Flows engine (`entry-points`, `tracer`, `naming`) | 3 | ~205 |
  | Clusters engine (`file-graph`, `louvain`, `identity`, `labels`) | 4 | ~285 |
  | Catalog store + orchestrator (`catalog-store`, `analysis/index`) | 2 | ~145 |
  | Wiring (schema.sql, migrations.ts, index.ts hook, config) | 4 | ~85 |
  | Surfaces (mcp/tools.ts, server routes, openapi.yaml) | ~3 | ~145 |
  | **Total** | **~16 prod files** | **≈ 865 upper / ≈ 620 central** |

  Central estimate ≈ **620** reviewable LOC after discounting declarative DDL/openapi and assuming reuse of `QueryBuilder`/`GraphTraverser`/read-ops helpers; the Louvain implementation (~150) and the flow tracer/entry-point detection are the dominant swing components. This is **above the accepted 525** (~18% higher) and **under the 800 block threshold**, but the upper-bound breakdown (~865) can cross 800 if the engines run large.
- **Production-file count**: projected ~10–12 new production files (spec projected 8–12). This is **at/over the 8-file warn→block line**, covered by the same ratified one-PR exception.
- **Split decision**: **One spec, one PR** — the maintainer explicitly declined the estimator's recommended two-slice (flows-then-clusters) split in Q21; the two catalogs share a single index-time lifecycle and atomic-swap persistence, so one integration point is the cleaner seam. This is the **ratified split exception** the block gate requires. Recorded here, in the spec's Reviewability Budget, and in the SPEC-011 workflow file.
- **Action at G3**: The upward revision from 525 to ≈620 (up to ~865 upper-bound) is surfaced to the maintainer/orchestrator. Recommendation: proceed as one PR (ratified), and **re-measure actual reviewable LOC at PR time**; if the measured diff exceeds ~700 reviewable LOC, re-confirm the one-PR decision (or reconsider the flows/clusters slice) before opening the PR. No unilateral re-split is taken here — Q21 ratified one PR.
- **PR Review Packet source**: what changed / why / non-goals / review order (analysis engine → persistence/swap → surfaces → config) / scope budget / traceability (each FR/SC → files → evidence) / verification (unit tests, deterministic probes, ≥3-run paired benchmark, self-repo UAT) / known gaps (CLI listing subcommands, explore enrichment — deferred follow-ups) / rollback (the two `codegraph.json` opt-in flags are the disable path).

**Result**: Constitution Check PASSES. Complexity Tracking empty. One primary surface; reviewability warning carried under the ratified Q21 one-PR exception, with the LOC upward-revision flagged for re-measurement at PR time.

## Project Structure

### Documentation (this feature)

```text
specs/011-execution-flows-clusters/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — ratified decisions + implementation research
├── data-model.md        # Phase 1 — the five tables + graph_write_version + state model
├── quickstart.md        # Phase 1 — runnable validation scenarios (SC-001..010 + dogfood UAT)
├── contracts/           # Phase 1 — MCP tool + REST endpoint contracts
│   ├── mcp-tools.md
│   └── rest-api.md
├── spec.md              # Feature spec (Clarify-enriched)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/analysis/                       # NEW module (Principle III sanctioned location)
├── index.ts                        # Orchestrator: maybeRunCatalogAnalysis(); per-catalog opt-in gating;
│                                   #   error-swallow (never fails index/sync, Q14/FR-022);
│                                   #   advances graph_write_version on successful graph update (FR-022)
├── catalog-store.ts                # Atomic single-transaction swap (FR-021); catalog_meta management;
│                                   #   single-snapshot list+detail reads shared by MCP + REST (FR-021a)
├── flows/
│   ├── entry-points.ts             # FR-001/FR-003 detection: route nodes; NEW commander CLI recognizer
│   │                               #   (.command().action(), reuses inline-handler body attribution);
│   │                               #   event/queue via existing callback/observer registrars;
│   │                               #   exposed exports (isExported callable, 0 inbound calls/references)
│   ├── tracer.ts                   # FR-004..009 bounded branching cycle-safe trace over calls+references,
│   │                               #   all provenance, caps 12/20/200, per-step provenance + truncation
│   └── naming.ts                   # FR-010 flow naming (route method+path | CLI name | qualified symbol)
└── clusters/
    ├── file-graph.ts               # FR-011/FR-012 undirected count-weighted file graph (self-loops dropped)
    ├── louvain.ts                  # FR-011/FR-013 deterministic Louvain, pure TS (research R1)
    ├── identity.ts                 # FR-015/016/017/017a Jaccard>=0.5 greedy one-to-one; opaque minted ids
    └── labels.ts                   # FR-018 canonical label (+ FR-019 optional display-label passthrough)

src/db/
├── schema.sql                      # + flows, flow_steps, clusters, cluster_members, catalog_meta
│                                   #   (copied to dist by copy-assets — Constitution VII)
└── migrations.ts                   # + lockstep migration adding the five tables (node_vectors v9 precedent)

src/index.ts                        # + one hook call at end of indexAll()/sync() (maybeRunEmbeddingPass site)
src/mcp/tools.ts                    # + codegraph_list_flows / codegraph_get_flow / codegraph_list_clusters
                                    #   (thin handlers → catalog-store; existing tools + explore untouched)
src/server/                         # + GET /api/flows, GET /api/clusters (thin handlers → daemon-client → daemon's catalog-store read; web serve holds no DB connection, SPEC-005 FR-002)
src/server/openapi.yaml             # + the two paths + Flow/Cluster schemas (mirrors MCP field names)
codegraph.json + config loader      # + per-catalog opt-in flags (SPEC-008 lsp precedent)

__tests__/analysis/                 # mirrors src/analysis/: flows, clusters, catalog-lifecycle, surfaces
__tests__/analysis/fixtures/        # commander-CLI + event/queue registrar fixtures (dormant-in-repo)
scripts/                            # ≥3-run paired full-index benchmark harness (SC-006 evidence)
```

**Structure Decision**: Single-project layered pipeline. All new logic is isolated in the new `src/analysis/` tree (flows + clusters + shared catalog store), keeping the primary review surface in one place and holding upstream-owned-file diffs to additive hooks/wiring. The catalog **read** helpers live in `src/analysis/catalog-store.ts` and run inside the per-project daemon: `src/mcp/tools.ts` calls them directly, and the REST endpoints reach the SAME helpers by forwarding to that daemon via `src/server/daemon-client.ts` (the web `serve` process is a daemon *client* with no DB connection of its own — SPEC-005 FR-002), so the two surfaces share one read path and cannot drift (FR-028) and the `src/mcp/` diff stays thin for retrieval-guardian review.

## Complexity Tracking

> No Constitution Principle I–VII violations require justification. Table intentionally empty. (The reviewability-budget warning is recorded in Constitution Check → Reviewability under the ratified Q21 one-PR exception; it is a budget note, not a Principle II complexity violation.)

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                    |

## Phase 0 — Outline & Research

See [research.md](./research.md). No unresolved clarification markers remained after Clarify; Phase 0 consolidates the 21 ratified decisions (Q1–Q21) as the decision log and resolves the remaining **implementation-research** points: R1 deterministic-Louvain build-vs-borrow (decision: build pure-TS), R2 `graph_write_version` advance timing + derived staleness, R3 atomic-swap + single-snapshot read mechanics, R4 by-value-refs/denormalization/no-cascade rationale, R5 entry-point detection sources, R6 cluster-identity minting + Jaccard matching.

## Phase 1 — Design & Contracts

- **Data model** → [data-model.md](./data-model.md): the five tables, `graph_write_version` metadata key, and the available/stale/unavailable/available-but-empty/disabled state model (derived staleness, explicit unavailable).
- **Contracts** → [contracts/mcp-tools.md](./contracts/mcp-tools.md) and [contracts/rest-api.md](./contracts/rest-api.md): the three MCP tools and two REST endpoints, shared field names, offset/limit paging (MCP limit 20/max 100; REST Limit 100/max 500; Offset 0; `ListResult{items,total,limit,offset}`), deterministic sorts, `minSize` filter, `get_flow` truncation shape, and success-shaped conditions.
- **Quickstart** → [quickstart.md](./quickstart.md): runnable validation scenarios mapped to SC-001…SC-010, including the self-repo dogfood UAT (CLI index-pipeline flow + cluster-ID stability across two re-indexes) and the ≥3-run paired benchmark.
- **Agent context update**: SKIPPED for this run. This repo's `CLAUDE.md` is hand-curated and carries no `<!-- SPECKIT START -->`/`<!-- SPECKIT END -->` markers; the orchestrator's execution constraints direct that `/speckit-agent-context-update` not run here (it would pollute the curated file).

### Post-Design Constitution Re-Check

Re-evaluated after Phase 1 design — **still PASSES**. The data model introduces no LLM structure dependency (V), no native dependency (VII), one primary surface (reviewability), and no new Principle II complexity. By-value refs + no-cascade + denormalized name/kind (FR-022a) and the single-transaction swap (FR-021) are the minimum needed to keep a retained-stale catalog correct — not speculative complexity. Complexity Tracking remains empty.

## Phase 2 — Task Planning Approach (NOT executed here)

`/speckit-tasks` will decompose this plan into dependency-ordered, tests-first tasks. Expected ordering: (1) schema + migration + `graph_write_version` metadata; (2) catalog-store swap + state model + single-snapshot reads; (3) flows engine (entry-points → tracer → naming); (4) clusters engine (file-graph → louvain → identity → labels); (5) orchestrator hook in `indexAll`/`sync` with error-swallow + opt-in gating; (6) MCP tools; (7) REST endpoints + openapi; (8) config flags; (9) dormancy/lifecycle tests; (10) paired benchmark + self-repo UAT evidence. Review order in the PR packet mirrors this.
