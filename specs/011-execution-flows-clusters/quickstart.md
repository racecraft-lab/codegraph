# Quickstart & Validation: Execution Flows & Clusters

**Feature**: SPEC-011 | **Date**: 2026-07-14

Runnable validation scenarios proving the feature end-to-end. Details of shapes live in [data-model.md](./data-model.md) and [contracts/](./contracts/); this is the run/verify guide.

## Prerequisites

- Node 22.5+ (from source), repo built.
- Project commands: build `npm run build`; typecheck `npm run typecheck`; unit tests `npm test`; full verify `npm run build && npm test`.
- Opt-in flags in `codegraph.json` (SPEC-008 `lsp` flag is the precedent):

```jsonc
{
  "analysis": { "flows": true, "clusters": true }   // per-catalog opt-in (FR-024); omit/false = disabled
}
```

## Enable, index, inspect (User Stories 1 & 2)

```bash
npm run build
node dist/bin/codegraph.js init .
node dist/bin/codegraph.js index .
# MCP surface (via the built server / probe): codegraph_list_flows, codegraph_get_flow, codegraph_list_clusters
# REST surface (with the web server): codegraph serve --web  → GET /api/flows, /api/flows/{id}, /api/clusters
```

## Validation scenarios → Success Criteria

| # | Scenario | Verifies |
|---|---|---|
| 1 | Index an opted-in repo with a route and a commander CLI command; `list_flows` shows exactly one flow per entry point; a route flow is named `"<METHOD> <path>"`, a CLI flow by its command name; every `get_flow` step has a `provenance`. | SC-001, FR-001/003/009/010 |
| 2 | Open a flow that crosses a callback/synthesized boundary → the graph continues across it and the crossing step carries `heuristic` provenance. | FR-008, SC-001 |
| 3 | Trace a flow that hits a cap → it is returned with `truncation.{depth,width,totalSteps}` set on the axes reached and `truncated=true`; a flow hitting all three records all three. | SC-002, FR-005/007 |
| 4 | `list_clusters` → every indexed file appears in exactly one cluster (total coverage); each cluster has a `canonicalLabel`; isolated files appear as `isSingleton` clusters. | SC-003, FR-014/018 |
| 5 | `list_clusters` with `minSize=2` → singletons suppressed; default `minSize=1` → full catalog incl. singletons. | FR-029 |
| 6 | Re-analyze an **unchanged** graph → flow catalog and cluster membership are byte-identical (probe: compare rows across two indexes; node/edge count stable). | SC-004, FR-013 |
| 7 | Make a small change leaving a cluster ≥50% overlapping → its `id` is retained; a genuine split transfers the id to the best-matching descendant only, others get new ids; a tie resolves identically every run; overlap <0.5 mints a new id. | SC-005, FR-015/016/017/017a |
| 8 | Force a catalog-analysis failure **after** a successful graph update → the index/sync still reports success; the prior catalog is still readable, `state="stale"`, tagged with its `sourceVersion` (recorded < live). | SC-008, FR-021/022/022a |
| 9 | Force a **first-run** analysis failure (no prior catalog) → reads return an explicit `unavailable` state, never partial/empty-looking data. | SC-008, FR-023 |
| 10 | On a **not-opted-in** project → no catalog rows/metadata written, no measurable overhead, and catalog queries return success-shaped **disabled** guidance (never `isError`). | SC-007, SC-009, FR-025/030 |
| 11 | MCP and REST return the **same field semantics** for the same catalog data; every expected condition (not indexed, disabled, stale, unknown id) is success-shaped on both. | SC-009, FR-027/028/030 |
| 12 | Confirm `codegraph_explore` output is unchanged (byte-identical probe vs baseline build). | FR-031, Constitution VI |

## Performance benchmark (SC-006, Q19)

**Fixture**: a committed, deterministically-generated multi-language fixture at `__tests__/analysis/fixtures/benchmark-monorepo/` (≥3 languages/frameworks, including a god-function fan-out plus a route and a CLI entry point), materialized by the test harness. The identical fixture is used for both arms.

Run the **paired** full-index benchmark, embeddings/LSP held constant:

- Arm A: `analysis.flows=false, analysis.clusters=false`.
- Arm B: `analysis.flows=true, analysis.clusters=true`.
- **Identical env across arms**: same `codegraph.json` `lsp` setting, same embedding env (or both off), and same warm daemon state; assert the two arms received **identical embedding/LSP inputs** — identical `vectors_write_version` progression and identical LSP-provenance edge counts.
- **Method**: ≥5 timed iterations per arm after ≥1 discarded warmup; **interleave** the arms (A,B,A,B,…); exclude fixture-generation and process startup from the timed window; run on a quiescent machine.
- Record wall-clock per run; report **per-arm median + spread**; assert **median(B) ≤ 1.20 × median(A)**. Recorded as PR/UAT evidence (not a CI timing gate).

## Self-repo dogfood UAT (SC-010, Q20 — binding Dogfooding Protocol)

Run against **this repository** (both catalogs enabled):

1. **Flow**: detect the `codegraph index` CLI entry point; its flow reaches the extraction → resolution → (LSP) → embedding stages with correct per-step provenance and truncation state.
2. **Clusters**: this repo's `src/` modules land in coherent clusters; capture cluster ids, make a small edit, re-index, and confirm ids stay stable across the two consecutive re-indexes.

Record the outcome in the spec's UAT runbook + retrospective.

## Determinism & no-regression probes

- `select count(*) from nodes` stable before/after re-index (analysis is read-only over the graph — no node explosion, Constitution V).
- Catalog rows identical across two unchanged re-indexes (SC-004).
- Synthesized-edge provenance spot-check on flow steps (`provenance='heuristic'` rows correspond to real synthesized edges).

## Verification gate

`npm run build && npm test` green is the floor (Constitution IV). Retrieval-affecting `src/mcp/` changes additionally pass retrieval-guardian review before PR.
