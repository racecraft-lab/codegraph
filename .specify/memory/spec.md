# Completed Specs — Summary Records

## SPEC-001 — Embedding Infrastructure & Endpoint Provider (archived 2026-07-05)

Every indexed declaration-kind symbol gets a persisted embedding vector through an
OpenAI-compatible endpoint (`CODEGRAPH_EMBEDDING_*` env config), incrementally
(`input_hash` change detection), resiliently (bounded retries, advisory pass never
fails index/sync), and fully dormant when unconfigured. 31 FRs, 11 SCs, delivered
as stacked PRs #16 + #17 (schema v7→v8). Canonical code: `src/embeddings/`,
`src/db/` v8 additions. Detailed provenance + recovery:
[archive-reports/2026-07-05-SPEC-001.md](archive-reports/2026-07-05-SPEC-001.md).
The active `specs/001-embedding-infrastructure/` folder was removed because all
artifacts are recoverable at merge commit `c16d53f` and the roadmap + workflow file
carry the durable status record.

## SPEC-004 - Web Framework Research Spike (archived 2026-07-05)

The self-hosted web stack decision shipped in PR #19. Vite + React SPA is the
recommended production app stack; Cytoscape.js proved the throwaway graph-rendering
path, with Sigma.js retained as the SPEC-006 WebGL runner-up. Canonical artifacts:
`docs/design/web-framework-decision.md` and PNG evidence under
`docs/design/assets/spec-004/`. Detailed provenance + recovery:
[archive-reports/2026-07-05-SPEC-004.md](archive-reports/2026-07-05-SPEC-004.md).
The active `specs/004-web-framework-research-spike/` folder was removed because
the decision doc, screenshots, roadmap entry, and preserved workflow/process files
carry the durable record.

## SPEC-002 - Bundled Local Embedding Fallback (archived 2026-07-07)

The local embedding fallback shipped in PR #22. It added explicit opt-in local
embedding support through `src/embeddings/local-provider.ts`,
`src/embeddings/local-tokenizer.ts`, `src/embeddings/local-embed-worker.ts`, and
`src/embeddings/model-fetch.ts`, with CLI/library status integration and local
provider regression coverage. Detailed provenance + recovery:
[archive-reports/2026-07-07-SPEC-002.md](archive-reports/2026-07-07-SPEC-002.md).
The active `specs/002-local-embedding-fallback/` folder was removed because the
runtime code, tests, preserved workflow files, and archive report carry the
durable record.

## SPEC-008 - LSP Client Integration (archived 2026-07-07)

The LSP client integration shipped as stacked PRs #23 through #27. It added
default-off LSP discovery/configuration, JSON-RPC client lifecycle, compiler-backed
edge correction/provenance, graceful degradation, retrieval filtering, and parity
gates with zero unowned language or capability rows. Canonical artifacts live in
`src/lsp/`, `src/db/queries.ts`, `src/db/schema.sql`, `src/sync/`, `src/bin/codegraph.ts`,
the LSP-focused test suites, and the `scripts/spec-008-*.mjs` validation gates.
Detailed provenance + recovery:
[archive-reports/2026-07-07-SPEC-008.md](archive-reports/2026-07-07-SPEC-008.md).
The active `specs/008-lsp-client-integration/` folder was removed because all
implementation and validation evidence is preserved in shipped code, process
ledgers, and the archive report.

## SPEC-023 - OCaml Language Support (archived 2026-07-07)

OCaml language support shipped in PR #21. It added OCaml/interface tree-sitter
WASMs, `src/extraction/languages/ocaml.ts`, Dune-aware local resolution helpers,
fixture coverage, grammar docs, status listing support, and validation evidence.
Detailed provenance + recovery:
[archive-reports/2026-07-07-SPEC-023.md](archive-reports/2026-07-07-SPEC-023.md).
The active `specs/023-ocaml-language-support/` folder was removed because the
grammar/extractor/resolver/test artifacts and preserved workflow files carry the
durable record.

## SPEC-025 - Plugin Platform Mechanics Spike (archived 2026-07-10)

Research spike; no runtime code. Shipped the plugin-channel decision record
`docs/design/plugin-channel-decision.md` in PR #35: Claude Code + Codex plugins
carry the MCP server, prompt hook, and skills; the npm installer keeps binary
distribution and the components the Codex format cannot carry;
PATH → `npx --offline` → success-shaped-stub launcher resolution;
skills-first v1. Detailed
provenance + recovery:
[archive-reports/2026-07-10-SPEC-025.md](archive-reports/2026-07-10-SPEC-025.md).
The active `specs/025-plugin-platform-spike/` folder was removed because the
decision document is the durable deliverable and process evidence is preserved
under `docs/ai/specs/.process/`.

## SPEC-003 - Hybrid Semantic Search (archived 2026-07-10)

Query-time hybrid semantic search shipped in PR #36: rank-only RRF (k=60) fusing
FTS5 keyword with brute-force cosine over SPEC-001/002 vectors; `mode` parameter
(`keyword|semantic|hybrid|auto`) on library/MCP/CLI surfaces; provenance tags +
embed/fusion timing footer; four success-shaped degradation hints (never
`isError`); write-version staleness token; 1 GiB matrix guard; status
availability line. Dormant by default — no embedding env means byte-identical
keyword behavior and zero new env vars. Detailed provenance + recovery:
[archive-reports/2026-07-10-SPEC-003.md](archive-reports/2026-07-10-SPEC-003.md).
The active `specs/003-hybrid-semantic-search/` folder was removed because the
shipped code, tests, CHANGELOG/BUNDLING docs, and preserved workflow/design
evidence carry the durable record.

## SPEC-005 - Local HTTP Server & REST API (archived 2026-07-13)

`codegraph serve --web` shipped as two stacked slices: PR #41 (read API) + PR #42
(re-index jobs & SSE). A zero-dependency `node:http` local REST API rides the
existing daemon/query-pool — server/index health, machine repo list, symbol
search, node detail with callers/callees, impact radius, and graph neighborhood;
plus `POST /api/reindex/:repo` background jobs with `GET .../events` SSE progress
(one active job per repo, 409 on duplicate, survives client disconnect). Safe by
default: loopback bind (`127.0.0.1:11235`), fail-closed on non-loopback unless
`CODEGRAPH_SERVER_TOKEN` is set (then a required `Bearer` token), Host-header
allowlist, closed six-code JSON error vocabulary, and token-redacting request
logs (FR-014a). Static-asset mount reserved for SPEC-006, WebSocket hook for
SPEC-009. Dormant without `--web`. Canonical code: `src/server/`,
`src/bin/codegraph.ts serve --web`. Detailed provenance + recovery:
[archive-reports/2026-07-13-SPEC-005.md](archive-reports/2026-07-13-SPEC-005.md).
The active `specs/005-local-http-server/` folder was removed because the shipped
code, tests, committed OpenAPI contract, and preserved workflow/design evidence
carry the durable record; SPEC-006 and SPEC-009 are unblocked.

## SPEC-010 - Graph-Aware Rename (archived 2026-07-13)

Graph-aware symbol rename shipped as two vertical slices: PR #43 (plan engine +
CLI dry-run) + PR #44 (atomic apply + MCP tool). `codegraph rename <target>
<new-name>` produces a dry-run plan first — every file touched, a before/after
preview and confidence rating per edit, LSP-powered where a language server
exists and graph-derived everywhere else, `--json` for machine consumption, zero
writes. The apply path is guarded end-to-end: span re-verification, atomic write,
snapshot rollback, post-check, targeted re-sync. The `codegraph_rename` MCP tool
brings the same contract into the agent loop without regressing retrieval.
Canonical code: `src/refactor/`, `src/bin/codegraph.ts rename`, `src/mcp/tools.ts`
(`codegraph_rename`). Detailed provenance + recovery:
[archive-reports/2026-07-13-SPEC-010.md](archive-reports/2026-07-13-SPEC-010.md).
The active `specs/010-graph-aware-rename/` folder was removed because the shipped
code, tests, and preserved workflow/design evidence carry the durable record;
SPEC-010 is a dependency-graph leaf with no downstream unblock.

## SPEC-018 - LLM Access Layer (archived 2026-07-15)

The shared LLM access layer shipped as two slices: PR #48 (OpenAI-compatible
endpoint path) + PR #49 (agent-bundle path). It added dormant-by-default
`CODEGRAPH_LLM_*` config resolution, a redaction-safe chat-completions client,
prompt/context budgeting, `generate()` with consumer fallback semantics, the
`LLM:` status block, self-describing `.codegraph/tasks/` bundles,
`codegraph tasks list|ingest`, hardened ingest, a companion skill, and the
`docs/design/llm-paths-note.md` comparison note. Canonical code: `src/llm/`,
`src/bin/codegraph.ts tasks`, and `src/index.ts getLlmStatus()`. Detailed
provenance + recovery:
[archive-reports/2026-07-15-SPEC-018.md](archive-reports/2026-07-15-SPEC-018.md).
The active `specs/018-llm-access-layer/` folder was removed because the shipped
code, tests, research note, and preserved workflow/design evidence carry the
durable record; SPEC-019's LLM dependency is now satisfied.

## SPEC-011 - Execution Flows & Clusters (archived 2026-07-15)

Execution Flows & Clusters shipped in PR #50. It added opt-in, deterministic
catalogs for bounded execution flows and functional clusters, persisted in the
project database, recomputed after successful index/sync, and exposed over MCP
and REST with success-shaped states. Canonical code: `src/analysis/`,
catalog schema/query additions under `src/db/`, lifecycle wiring in
`src/index.ts`, MCP catalog tools in `src/mcp/`, REST mirrors in `src/server/`,
and self-repo dogfood/benchmark coverage. Detailed provenance + recovery:
[archive-reports/2026-07-15-SPEC-011.md](archive-reports/2026-07-15-SPEC-011.md).
The active `specs/011-execution-flows-clusters/` folder was removed because the
shipped code, tests, UAT evidence, benchmark evidence, and preserved
workflow/design evidence carry the durable record; SPEC-012 can now enrich
impact results with flows and SPEC-019 can consume clusters and flow walkthroughs.

## SPEC-012 - Change Impact Detection (archived 2026-07-15)

Change Impact Detection shipped in PR #55. It added local-first diff-to-impact
analysis over indexed symbols, explicit unmapped-hunk diagnostics, bounded caller
expansion, SPEC-011 flow enrichment, deterministic JSON/markdown reports, the
`codegraph detect-changes` CLI, and the `codegraph_detect_changes` MCP tool.
Canonical code: `src/analysis/detect-changes/`, CLI wiring in
`src/bin/codegraph.ts`, MCP wiring in `src/mcp/tools.ts`, and focused unit, CLI,
and MCP coverage in `__tests__/detect-changes*.test.ts`. Detailed provenance +
recovery:
[archive-reports/2026-07-15-SPEC-012.md](archive-reports/2026-07-15-SPEC-012.md).
The active `specs/012-change-impact-detection/` folder was removed because the
shipped code, tests, merged PR evidence, and preserved workflow/design evidence
carry the durable record; SPEC-020 is now ready because the review-action
substrate, stable report contract, and CI exit behavior are merged.
