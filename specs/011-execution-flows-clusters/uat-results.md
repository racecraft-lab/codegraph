# SPEC-011 — Self-repo dogfood UAT results (T063 / SC-010)

Ran the catalog analysis on **this repository's own graph** (536 files, 8,440
nodes, 36,096 edges) via `codegraph sync` with both catalogs enabled
(`codegraph.json` → `analysis.flows/clusters = true`, FR-026). Both catalogs
recomputed cleanly and swapped to the `available` state
(`catalog_meta`: flows `computed_from_version=1 first_run_failed=0`, clusters
likewise; `graph_write_version=1`).

## Execution flows (SC-010, Q20) — 95 flows / 1,902 steps

**Entry-point detection on real code** (FR-001):

| entry_kind | flows |
|---|---|
| export (externally-exposed, 0 inbound calls/references) | 65 |
| cli (commander `.command().action()` recognizer) | 23 |
| event/queue (callback/observer registrars) | 6 |
| route | 1 |

The **commander CLI recognizer works**: the 23 `cli` flows are exactly the
`codegraph` subcommands — `index`, `query`, `explore`, `serve`, `daemon`,
`callers`, `callees`, `impact`, `affected`, `rename`, `install`, `init`,
`node`, `files`, `prompt-hook`, … .

**The `codegraph index` entry-point flow (the SC-010 anchor)** roots at `index`
(depth-0, null provenance per FR-009) and traces into the pipeline —
`loadCodeGraph`, `cliLspActivationFromArgv`, `createVerboseProgress`,
`offerIndexIgnoredRepos`, `recordIndexTelemetry`, … .

**Per-step provenance** across all 1,902 steps (FR-008/009, SC-001):

| provenance | steps |
|---|---|
| lsp | 1,276 |
| static | 345 |
| heuristic | 186 |
| null (root, one per flow) | 95 |

All three provenance classes are present, and critically **`lsp` is preserved
as its own wire value — NOT collapsed into `static`** (the 3-value enum the
retrieval-guardian flagged in the contract behaves correctly against real
LSP-corrected edges). Exactly 95 null-provenance rows = one root per flow.

## Functional clusters — 89 clusters / 580 files (total coverage, FR-014)

Every clustered file belongs to exactly one cluster; canonical labels are
directory+name-token derived and coherent, e.g.:

| canonical_label | members |
|---|---|
| `src/resolution/frameworks: extractor, ocaml` | 64 |
| `src/extraction/languages: ocaml, sitter` | 53 |
| `__tests__/analysis/flows: catalog, identity` | 35 |
| `__tests__: daemon, pool` | 53 |

Clusters group genuinely related files (framework resolvers together,
extraction-language extractors together, the new SPEC-011 analysis tests
together).

## Cross-re-index cluster-id stability

The deterministic Jaccard identity + content-hash mint (FR-015/016/017/017a)
is proven byte-identical across two consecutive indexes AND across two
independent clones by the determinism fixture test
(`__tests__/analysis/determinism-fixture.test.ts`, T060/SC-004) — the same
identity code path this self-repo run exercises. The binding Dogfooding
Protocol re-runs the full self-repo sync post-merge (`npm run build` +
`codegraph sync`), which will re-confirm id stability on the live repo.

## Note

This UAT sync ran with the embedding endpoint env cleared (to avoid the
unreachable `http://hal:1234` dogfood endpoint blocking the run); it triggered
a re-parse, so the worktree's embedding coverage should be restored by the
next `codegraph sync` with the embedding endpoint reachable (self-healing;
this is an isolated spec worktree). Catalog analysis is independent of
embeddings.
