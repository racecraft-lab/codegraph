# Completed Plans — Summary Records

## SPEC-001 — Embedding Infrastructure & Endpoint Provider (archived 2026-07-05)

Plan shape that shipped: new `src/embeddings/` module behind env-var opt-in
(Principle III fork discipline); `node_vectors` table with NO foreign key (vectors
survive node delete/re-insert; cleanup via anti-join reconciliation); dims/model as
project_metadata scalars; batch 16 / concurrency 4 / timeout 30s defaults; full
error replacement with endpoint redaction; advisory embedding pass in indexAll +
sync. Slice A (US1 full-index) then Slice B (US2+US3 freshness/healing) — the
stacked-PR route reconciled a size-block with the hard-atomic v8 schema pin.
Full plan recoverable: `git show c16d53f:specs/001-embedding-infrastructure/plan.md`.

## SPEC-004 - Web Framework Research Spike (archived 2026-07-05)

Plan shape that shipped: docs/process research spike only, no production web code.
The plan evaluated six framework candidates against local-first hard gates, scored
only passing candidates with UX leading, built one throwaway Vite + React +
Cytoscape.js prototype under `/tmp`, and committed only the decision document plus
small screenshot evidence. SPEC-005 now owns the explicit local server/static mount
activation path; SPEC-006 owns the production web app, asset copy/package wiring,
and large-graph UX/WebGL validation. Full plan recoverable:
`git show 0366d3c:specs/004-web-framework-research-spike/plan.md`.

## SPEC-002 - Bundled Local Embedding Fallback (archived 2026-07-07)

Plan shape that shipped: explicit opt-in local embeddings layered behind the
existing embedding provider seam, with lazy model acquisition, tokenizer/worker
separation, status reporting, and no endpoint-first behavior regression. The
provider remains dormant unless selected. Full plan recoverable:
`git show 7c11f27:specs/002-local-embedding-fallback/plan.md`.

## SPEC-008 - LSP Client Integration (archived 2026-07-07)

Plan shape that shipped: a default-off LSP precision layer split across a stacked
review route. The implementation added server discovery/config, prereq/status
reporting, JSON-RPC client lifecycle, precision-pass correction audit storage,
watch/sync integration, public retrieval filtering, and parity gates. SPEC-010 is
now ready because the compiler-backed correction substrate exists. SPEC-024 has no
current implementation work because the final parity gate closed with zero unowned
rows. Full plan recoverable:
`git show 8c53f53:specs/008-lsp-client-integration/plan.md`.

## SPEC-023 - OCaml Language Support (archived 2026-07-07)

Plan shape that shipped: standard add-language pipeline for OCaml, including
vendored implementation/interface grammar WASMs, extraction support, Dune-scoped
unique-only local resolution, fixture-backed tests, docs, and validation evidence.
PPX expansion and external package graphing stayed out of scope. Full plan
recoverable: `git show 100a675:specs/023-ocaml-language-support/plan.md`.

## SPEC-025 - Plugin Platform Mechanics Spike (archived 2026-07-10)

Plan shape that shipped: timeboxed spike producing a single decision document
(`docs/design/plugin-channel-decision.md`) with hands-on validation evidence
against pinned Claude Code 2.1.206 / Codex CLI 0.144.0, drafted plugin artifact,
and FR/SC compliance record. All implementation deferred to SPEC-026. Full plan
recoverable: `git show 62693fb:specs/025-plugin-platform-spike/plan.md`.

## SPEC-003 - Hybrid Semantic Search (archived 2026-07-10)

Plan shape that shipped: one new fusion module (`src/search/hybrid.ts`) with
plumbing-only edits elsewhere (types, library dispatch, DB reads +
write-version bump, MCP/CLI rendering); sync `searchNodes` bridged to async
embedding via `acquireQueryVectorForSearch` + a bounded query-vector LRU cache
(keyword-while-warming); TDD throughout (86+13+24 dedicated tests plus CI gates:
hybrid ≥ keyword hit-rate, keyword byte-stability, p95 fusion ≤150ms, SC-007
status truthfulness). Reviewability ran over the setup estimate (743 code-only
LOC vs ~195; WARN-proceed recorded in autopilot-state). Explore-side fusion
deliberately deferred to a future A/B-gated spec. Full plan recoverable:
`git show 2c6c643:specs/003-hybrid-semantic-search/plan.md`.

## SPEC-005 - Local HTTP Server & REST API (archived 2026-07-13)

Plan shape that shipped: a new `src/server/` module (framework-light `node:http`
+ hand-rolled router per the SPEC-004 decision, zero new dependencies) split into
two vertical slices — Slice 1 the read surface + security model (loopback bind,
token auth for non-loopback, Host allowlist, closed error vocabulary, redacted
logs), Slice 2 the re-index job subsystem (background jobs over the existing
indexing entrypoints, SSE progress, single-active-job gate, disconnect survival).
The server rides the existing daemon/query-pool rather than opening the DB
directly; a committed `openapi.yaml` is the contract (copied into `dist/` by
`copy-assets`). Static-asset mount and WebSocket upgrade are reserved seams for
SPEC-006/009. Full plan recoverable:
`git show 1857872:specs/005-local-http-server/plan.md`.

## SPEC-010 - Graph-Aware Rename (archived 2026-07-13)

Plan shape that shipped: a new `src/refactor/` module split into a read-only
Slice 1 (target resolver with teaching refusals, plan engine, LSP + graph rename
site resolution, confidence, plan formatting) and a write Slice 2 (span-verify
guard, atomic apply engine, snapshot rollback, post-check, path jail, targeted
re-sync) plus the `codegraph_rename` MCP tool. Dry-run is the default and the
whole of Slice 1; the write path only activates on explicit apply and is
guarded so a failure leaves the tree untouched. Rides the SPEC-008 LSP substrate
where a server is present, graph-derived otherwise. Full plan recoverable:
`git show f2e307d:specs/010-graph-aware-rename/plan.md`.

## SPEC-018 - LLM Access Layer (archived 2026-07-15)

Plan shape that shipped: a new `src/llm/` module split into two vertical PRs.
Slice 1 delivered endpoint config, client, prompt budgeting, `generate()`,
status, and dormancy; Slice 2 delivered task-bundle emission, redemption,
ingest, `codegraph tasks`, companion skill, and the LLM paths research note.
No schema change, no MCP surface change, and no runtime dependency were added.
Full plan recoverable:
`git show 4acfa1b:specs/018-llm-access-layer/plan.md`.

## SPEC-011 - Execution Flows & Clusters (archived 2026-07-15)

Plan shape that shipped: a new `src/analysis/` module with flow and cluster
catalogs, additive catalog tables in schema v10, opt-in `codegraph.json`
activation, atomic catalog recompute after index/sync, bounded MCP tools, and
REST mirrors through the existing serve daemon. `codegraph_explore` remained
unchanged; catalog analysis is dormant unless enabled. Full plan recoverable:
`git show ecb5d83:specs/011-execution-flows-clusters/plan.md`.
