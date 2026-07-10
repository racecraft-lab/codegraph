# CodeGraph Intelligence Platform Implementation Roadmap

**Semantic retrieval, a self-hosted web platform, LSP precision, deep dataflow analysis, and team-scale capabilities for the racecraft CodeGraph fork.**

This document defines the **SPEC catalog** for the Intelligence Platform: an ordered set of specifications derived from the source PRD. Each SPEC corresponds 1:1 to a Feature / Acceptance-Criteria group in the PRD (`AC-N.*`), preserving traceability from PRD → roadmap → spec. Each specification is executed end-to-end through the SpecKit workflow (specify → clarify → plan → checklist → tasks → analyze → implement) before moving to the next, and is prepared for autopilot with `/speckit-pro:speckit-scaffold-spec SPEC-NNN`, which reads this roadmap as its input.

**Source PRD:** [docs/prd-intelligence-platform.md](../../prd-intelligence-platform.md)
**Home note:** [intelligence-platform-roadmap-MOC.md](intelligence-platform-roadmap-MOC.md)
**Branch:** `main`
**Tracker:** GitHub issues on `racecraft-lab/codegraph`

---

## Table of Contents

1. [Roadmap Overview](#roadmap-overview)
2. [Dependency Graph](#dependency-graph)
3. [Progress Tracking](#progress-tracking)
4. [Specification Sections](#specification-sections)
5. [Dogfooding Protocol](#dogfooding-protocol)

---

## Roadmap Overview

The platform is decomposed into **26 specifications** across **7 dependency tiers** (phases):

| Tier | Specs | Purpose | Parallelization |
|------|-------|---------|-----------------|
| **0** | SPEC-001, SPEC-002, SPEC-003 | Semantic retrieval (embeddings + hybrid search) | 002/003 after 001; 003 can mock vectors |
| **1** | SPEC-004, SPEC-005, SPEC-006, SPEC-007 | Self-hosted web platform | Spike gates all; 005→006→007 sequential |
| **2** | SPEC-008, SPEC-009, SPEC-010 | LSP precision & rename | 008 ∥ 009 (009 needs 005); 010 after 008 |
| **3** | SPEC-011, SPEC-012, SPEC-013 | Analysis breadth | All three parallelizable (012 prefers 011) |
| **4** | SPEC-014, SPEC-015, SPEC-016, SPEC-017 | Dataflow depth (CFG→PDG→taint) | Strict chain |
| **5** | SPEC-018 … SPEC-024 | Team, enterprise, and language parity closure | 018 first; 019/020 consume it; 021→022; 023 anytime; 024 after 008 baseline findings |
| **6** | SPEC-025, SPEC-026 | Plugin-channel distribution (Claude Code + Codex) | 025 gates 026; 025 is parallel-safe anytime |

**Execution Order:** SPEC-001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014 → 015 → 016 → 017 → 018 → 019 → 020 → 021 → 022 → 023 → 024 → 025 → 026

**Dependency Constraints:**
- SPEC-002/003 require SPEC-001 (provider interface + vector store).
- SPEC-005/006 require SPEC-004 (framework + shipping strategy decision); SPEC-006 requires SPEC-005 (API); SPEC-007 requires SPEC-006 (app shell).
- SPEC-009 requires SPEC-005 (WebSocket transport on the serve daemon); SPEC-010 requires SPEC-008 (LSP rename path).
- SPEC-012 prefers SPEC-011 (flow impact enrichment) but can ship with symbol/caller impact only.
- SPEC-015 → 014, SPEC-016 → 015, SPEC-017 → 016 (strict analysis chain).
- SPEC-019 requires SPEC-011 + SPEC-018; SPEC-020 requires SPEC-012 (SPEC-018 optional); SPEC-022 requires SPEC-021.
- SPEC-013, SPEC-023, SPEC-025 have no dependencies and can fill parallel capacity at any point.
- SPEC-024 is mandatory if SPEC-008 planning identifies any language, feature, or capability parity gap from the internal baseline that cannot be safely closed inside SPEC-008. It is not a backlog bucket; it is the no-waiver closure spec.
- SPEC-026 requires SPEC-025 (plugin platform mechanics decision — launcher contract, coexistence rules, artifact tier plan).

## Reviewability Contract

Every spec must fit a human review budget before setup and again before PR
creation. The size metric counts **production code only** — documentation,
tests, and config do not contribute to the reviewable-LOC count.

- Warn above 400 reviewable production LOC, 6 production files, or 15 total
  files. Touching more than one primary surface is also a warning, not a block.
- Block above 800 reviewable production LOC, 8 production files, or 25 total
  files, unless this roadmap records a typed exception pragma (below).
- A slice that adds only net-new files (no existing files modified) gets a 1.5x
  greenfield allowance on the production-LOC thresholds (warn 600, block 1200).
- Primary surfaces are schema/migration, API, UI, scheduler/runtime,
  harness/adapter, seed/config, and docs/process.
- A block-sized slice may be allowed only by a typed, auditable exception
  pragma on its own line, exactly: `Reviewability-Exception: <class>` where
  `<class>` is one of `refactor`, `infra`, or `upgrade`. The match is
  line-anchored and case-sensitive with no trailing content; an unknown class,
  a mis-cased class, or free-form prose is not honored (fail-closed).
- PR descriptions are review packets. They must include what changed, why,
  non-goals, review order, scope budget, traceability, verification evidence,
  known gaps, and rollback/flag notes.

> **Estimator advisories (2026-07-03):** most entries below are net-new modules and fall inside the 1.5× greenfield allowance. Entries whose forward estimate exceeded even the greenfield warn line carry an explicit "warning accepted" note with the estimator's suggested split count — advisory only, revisit at scaffold time.

---

## Dependency Graph

```text
Tier 0                Tier 1                    Tier 2                Tier 3
SPEC-001 (embed infra) SPEC-004 (web spike)     SPEC-008 (LSP client) SPEC-011 (flows/clusters)
  ├──► SPEC-002 (local)  └──► SPEC-005 (server)   ├──► SPEC-010        ├──► SPEC-012 (detect-changes)
  └──► SPEC-003 (hybrid)       ├──► SPEC-006 (UI)  │     (rename)      SPEC-013 (cypher) [independent]
                               │     └──► SPEC-007  │
                               └──► SPEC-009 (LSP facade)
Tier 4 (strict chain)                       Tier 5
SPEC-014 (CFG) ─► SPEC-015 (dataflow)       SPEC-018 (LLM layer) ─► SPEC-019 (wiki)
   ─► SPEC-016 (PDG) ─► SPEC-017 (taint)      └──────────────────► SPEC-020 (PR action) ◄─ SPEC-012
                                            SPEC-021 (contracts) ─► SPEC-022 (bridge/impact)
                                            SPEC-023 (OCaml) [independent]
                                            SPEC-024 (parity closure) ◄─ SPEC-008
Tier 6
SPEC-025 (plugin spike) ─► SPEC-026 (plugin distribution)
                                            ─── PLATFORM COMPLETE ───
```

---

## Progress Tracking

| Spec | Name | Status | Workflow File | Next Phase |
|------|------|--------|---------------|------------|
| SPEC-001 | Embedding Infrastructure & Endpoint Provider | ✅ Complete | [SPEC-001-workflow.md](.process/SPEC-001-workflow.md) | Merged (#16, #17) |
| SPEC-002 | Bundled Local Embedding Fallback | ✅ Complete | [SPEC-002-workflow.md](.process/SPEC-002-workflow.md) | Merged (#22); archived in `.specify/memory/archive-reports/2026-07-07-SPEC-002.md` |
| SPEC-003 | Hybrid Semantic Search | 🔄 In Progress | [SPEC-003-workflow.md](.process/SPEC-003-workflow.md) | Scaffolded 2026-07-09 on `003-hybrid-semantic-search`; autopilot pending |
| SPEC-004 | Web Framework Research Spike | ✅ Complete | [SPEC-004-workflow.md](.process/SPEC-004-workflow.md) | Merged (#19); archived in `.specify/memory/archive-reports/2026-07-05-SPEC-004.md` |
| SPEC-005 | Local HTTP Server & REST API | ⏳ Pending | [SPEC-005-workflow.md](SPEC-005-workflow.md) | Ready (SPEC-004 complete; see `docs/design/web-framework-decision.md`) |
| SPEC-006 | Web UI: Graph Browser | ⏳ Pending | [SPEC-006-workflow.md](SPEC-006-workflow.md) | Blocked by SPEC-005 |
| SPEC-007 | In-Browser Indexing | ⏳ Pending | [SPEC-007-workflow.md](SPEC-007-workflow.md) | Blocked by SPEC-006 |
| SPEC-008 | LSP Client Integration | ✅ Complete | [SPEC-008-workflow.md](.process/SPEC-008-workflow.md) | Merged (#23-#27); archived in `.specify/memory/archive-reports/2026-07-07-SPEC-008.md` |
| SPEC-009 | LSP Server Facade | ⏳ Pending | [SPEC-009-workflow.md](SPEC-009-workflow.md) | Blocked by SPEC-005 |
| SPEC-010 | Graph-Aware Rename | ⏳ Pending | [SPEC-010-workflow.md](SPEC-010-workflow.md) | Ready (SPEC-008 complete) |
| SPEC-011 | Execution Flows & Clusters | ⏳ Pending | [SPEC-011-workflow.md](SPEC-011-workflow.md) | Specify (parallel-safe) |
| SPEC-012 | Change Impact Detection | ⏳ Pending | [SPEC-012-workflow.md](SPEC-012-workflow.md) | Prefers SPEC-011 |
| SPEC-013 | Cypher Query Access | ⏳ Pending | [SPEC-013-workflow.md](SPEC-013-workflow.md) | Specify (parallel-safe) |
| SPEC-014 | Control-Flow Graphs | ⏳ Pending | [SPEC-014-workflow.md](SPEC-014-workflow.md) | Specify |
| SPEC-015 | Dataflow Substrate | ⏳ Pending | [SPEC-015-workflow.md](SPEC-015-workflow.md) | Blocked by SPEC-014 |
| SPEC-016 | Program Dependence Graphs | ⏳ Pending | [SPEC-016-workflow.md](SPEC-016-workflow.md) | Blocked by SPEC-015 |
| SPEC-017 | Taint Analysis Engine | ⏳ Pending | [SPEC-017-workflow.md](SPEC-017-workflow.md) | Blocked by SPEC-016 |
| SPEC-018 | LLM Access Layer | ⏳ Pending | [SPEC-018-workflow.md](SPEC-018-workflow.md) | Specify (parallel-safe) |
| SPEC-019 | Auto-Updating Code Wiki | ⏳ Pending | [SPEC-019-workflow.md](SPEC-019-workflow.md) | Blocked by SPEC-011, SPEC-018 |
| SPEC-020 | PR Blast-Radius Review Action | ⏳ Pending | [SPEC-020-workflow.md](SPEC-020-workflow.md) | Blocked by SPEC-012 |
| SPEC-021 | Repo Groups & Contract Extraction | ⏳ Pending | [SPEC-021-workflow.md](SPEC-021-workflow.md) | Specify (parallel-safe) |
| SPEC-022 | Cross-Repo Bridge & Impact | ⏳ Pending | [SPEC-022-workflow.md](SPEC-022-workflow.md) | Blocked by SPEC-021 |
| SPEC-023 | OCaml Language Support | ✅ Complete | [SPEC-023-workflow.md](.process/SPEC-023-workflow.md) | Merged (#21); archived in `.specify/memory/archive-reports/2026-07-07-SPEC-023.md` |
| SPEC-024 | Language and Feature Parity Closure | ⏳ Pending | [SPEC-024-workflow.md](SPEC-024-workflow.md) | Dormant; SPEC-008 parity gate closed with 0 unowned rows |
| SPEC-025 | Plugin Platform Mechanics Spike | 🔄 Under Review | [SPEC-025-workflow.md](.process/SPEC-025-workflow.md) | Implement complete 2026-07-10; decision doc landed at `docs/design/plugin-channel-decision.md`; PR #35 under review |
| SPEC-026 | Plugin-Channel Distribution | ⏳ Pending | [SPEC-026-workflow.md](SPEC-026-workflow.md) | Blocked by SPEC-025 |

**Status Legend:** ⏳ Pending | 🔄 In Progress/Under Review | ✅ Complete | ⚠️ Blocked

---

## Specification Sections

### SPEC-001: Embedding Infrastructure & Endpoint Provider

**Priority:** P0 | **Depends On:** None | **Enables:** SPEC-002, SPEC-003, SPEC-011 (labels), SPEC-019

**Goal:** Every indexed symbol gets a persisted embedding vector computed through an OpenAI-compatible endpoint, incrementally and resiliently, with the feature fully dormant when unconfigured.

**Reviewability Budget:** Primary surface: schema/migration + harness/adapter |
Projected reviewable LOC: 485 (estimator; net-new module → greenfield allowance applies) |
Production files: ~6 |
Total files: ~12 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- New `src/embeddings/` module: `provider.ts` (EmbeddingProvider interface: `embed(texts) → Float32Array[]`, `dims`, `id`), `endpoint-provider.ts` (OpenAI-compatible `POST /v1/embeddings` client with batching, bounded concurrency workers, `AbortSignal.timeout` per request, exponential backoff on 5xx/429), `config.ts` (env parsing: `CODEGRAPH_EMBEDDING_{URL,MODEL,DIMS,API_KEY,BATCH_SIZE,CONCURRENCY,TIMEOUT_MS}` with positive-int validation).
- Schema migration in `src/db/schema.sql`: `node_vectors(node_id, model, dims, vector BLOB, input_hash)` + schema_versions bump; vectors stored as little-endian f32 BLOBs.
- Indexing hook in the post-extraction pipeline: build deterministic embedding input per node (name + kind + signature + docstring + trimmed snippet), hash it, embed only changed/new nodes, delete vectors for removed nodes (wired to existing sync deletes).
- `codegraph status` reports embedding backend, model, dims, coverage %.
- Dimension validation on first batch; actionable error naming `CODEGRAPH_EMBEDDING_DIMS`.

**Out of Scope:**
- Bundled local model (SPEC-002); search-side consumption (SPEC-003).

**Key Decisions:**
**Vector storage (2026-07-03):** plain BLOB column + brute-force scan in v1 — keeps the zero-native-dep constraint (`node:sqlite` only); ANN/quantization deferred until scale demands it.

**Key Files:**
- `src/embeddings/provider.ts` — provider interface + registry
- `src/embeddings/endpoint-provider.ts` — HTTP client (batch/concurrency/timeout/retry)
- `src/embeddings/config.ts` — env config parsing/validation
- `src/embeddings/indexer-hook.ts` — incremental embed pass wired into index/sync
- `src/db/schema.sql` — `node_vectors` table (+ version bump)
- `src/index.ts` — expose embed pass on `CodeGraph` (opt-in)

---

### SPEC-002: Bundled Local Embedding Fallback

**Priority:** P0 | **Depends On:** SPEC-001 | **Enables:** endpoint-free semantic search

**Goal:** Semantic indexing works on any machine with zero setup via a small in-process (WASM/ONNX CPU) code-embedding model, selected automatically when no endpoint is configured.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 310 |
Production files: ~4 |
Total files: ~9 |
Budget result: within budget

**Scope:**
- `src/embeddings/local-provider.ts`: EmbeddingProvider backed by a small permissively-licensed code-embedding model (ONNX Runtime Web / transformers.js-class runtime, WASM CPU execution — pure-JS/WASM only, no native addons).
- Lazy model acquisition on first use: checksum-verified download to a cache dir (`~/.codegraph/models/`), offline-friendly error message, `--embeddings local` / config opt-in.
- Deterministic provider selection (endpoint → local → off) in `config.ts`; `codegraph status` shows active provider/model/dims; provider/model switch triggers full re-embed (model column mismatch).
- BUNDLING.md note documenting package-size impact (target: no meaningful npm payload growth).

**Out of Scope:**
- GPU execution paths; model fine-tuning; search behavior (SPEC-003).

**Key Decisions:**
**Delivery (OQ-1):** lazy checksum-verified download recommended over optionalDependencies — keeps `npm install` lean and avoids platform-conditional packages. Confirm at specify.

**Key Files:**
- `src/embeddings/local-provider.ts` — WASM/ONNX in-process provider
- `src/embeddings/model-fetch.ts` — lazy download + checksum + cache
- `src/embeddings/config.ts` — selection order (modify)
- `BUNDLING.md` — size-impact note

**Completion:** Merged in PR #22 (`7c11f27`) and archived on 2026-07-07. The active
spec folder was removed after the local embedding provider, tokenizer/worker,
model-fetch path, status/config integration, tests, workflow ledger, and archive
report became the durable record.

---

### SPEC-003: Hybrid Semantic Search

**Priority:** P0 | **Depends On:** SPEC-001 (vectors present; can develop against fixture vectors) | **Enables:** better retrieval everywhere (MCP search, web UI, wiki)

**Goal:** Search fuses FTS5 keyword hits and vector KNN via reciprocal-rank fusion, beating keyword-only on the eval harness with graceful degradation when vectors are absent.

**Reviewability Budget:** Primary surface: API (search path) |
Projected reviewable LOC: 195 |
Production files: ~4 |
Total files: ~10 |
Budget result: within budget

**Scope:**
- `src/search/hybrid.ts`: query embedding (via active provider), brute-force cosine over `node_vectors` (typed-array scan, top-k heap), RRF merge (`k=60` default) with FTS5 results; mode parameter `keyword|semantic|hybrid` (default hybrid when vectors exist).
- Wire into `searchNodes` (library), the MCP search tool schema (new optional `mode` param), and CLI search.
- Degradation: no vectors → keyword + response hint; no provider at query time → keyword.
- Eval harness: add semantic-retrieval cases (paraphrase queries) to `__tests__/evaluation/`; CI asserts hybrid ≥ keyword baseline and zero regressions; p95 latency check ≤150 ms @ 50k nodes.

**Out of Scope:**
- ANN indexes/quantization (follow-up if scale demands); re-ranking models.

**Key Files:**
- `src/search/hybrid.ts` — KNN + RRF fusion
- `src/index.ts` — `searchNodes` mode plumbing (modify)
- `src/mcp/tools.ts` — search tool `mode` param (modify)
- `__tests__/evaluation/` — semantic cases + latency guard

---

### SPEC-004: Web Framework Research Spike

**Priority:** P0 | **Depends On:** None | **Enables:** SPEC-005, SPEC-006, SPEC-007

**Goal:** A grounded, scored decision on the web stack that is modern, user-friendly, cost-efficient, and self-hostable anywhere with minimal effort — plus a proven graph-rendering approach.

**Reviewability Budget:** Primary surface: docs/process |
Projected reviewable LOC: 0 (spike — decision doc + throwaway prototype) |
Production files: 0 |
Total files: ~3 |
Budget result: within budget (spike)

**Scope:**
- `docs/design/web-framework-decision.md`: evaluate ≥5 candidates (recommended shortlist per OQ-2: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, SolidStart) against weighted criteria: self-host anywhere (embedded static / single container / no lock-in), deploy effort, DX/UX modernity, cost (no hosted-service deps), footprint, license.
- Graph-rendering bake-off within the chosen stack (canvas/WebGL force-graph options; 1k-node @ 60fps target) with a throwaway prototype (not shipped).
- Shipping strategy decision: embedded static assets in the npm package (served by SPEC-005) + standalone container recipe.

**Out of Scope:**
- Any production code (SPEC-005/006 implement the decision).

**Key Files:**
- `docs/design/web-framework-decision.md` — scored matrix + recommendation + shipping strategy

**Completion:** Merged in PR #19 (`0366d3c`) and archived on 2026-07-05. The active
spec folder was removed after the decision document, screenshots, workflow ledger,
and archive report became the durable record.

---

### SPEC-005: Local HTTP Server & REST API

**Priority:** P0 | **Depends On:** SPEC-004 | **Enables:** SPEC-006, SPEC-007, SPEC-009

**Goal:** `codegraph serve` exposes the full graph read surface plus re-index jobs over a documented local REST API riding the existing daemon/query-pool.

**Reviewability Budget:** Primary surface: API |
Projected reviewable LOC: 620 (estimator; net-new module) |
Production files: ~7 |
Total files: ~14 |
Budget result: warning accepted — slightly above the greenfield warn line (600); estimator suggests 2 slices (endpoints vs jobs/SSE) — decide at scaffold

**Scope:**
- `src/server/` module (framework-light: Node http/router per SPEC-004 outcome): GET `/api/repos`, `/api/search?q&mode`, `/api/nodes/:id` (detail + callers/callees pages), `/api/impact/:id?depth`, `/api/graph?root&depth&limit` (neighborhood for the canvas), `/api/status`; JSON error envelope; request logging (local only).
- Job subsystem: `POST /api/reindex/:repo` → background job via existing indexing entrypoints; `GET /api/jobs/:id/events` SSE progress stream (reusing indexer progress callbacks); 409 on duplicate active job.
- Bind 127.0.0.1 default, `--port/--host` flags; optional `CODEGRAPH_SERVER_TOKEN` bearer auth for non-loopback binds (OQ-6); static-asset mount point for SPEC-006; WebSocket upgrade hook reserved for SPEC-009.
- `openapi.yaml` committed; integration tests over a fixture index.

**Out of Scope:**
- The UI itself (SPEC-006); LSP-over-WebSocket handler (SPEC-009); TLS (reverse-proxy territory).

**Key Files:**
- `src/server/index.ts` — server bootstrap, `codegraph serve` wiring
- `src/server/routes.ts` — REST endpoints
- `src/server/jobs.ts` — reindex job manager + SSE
- `src/server/auth.ts` — loopback default + bearer token
- `src/server/openapi.yaml` — API contract
- `src/bin/codegraph.ts` — `serve` subcommand (modify)

---

### SPEC-006: Web UI: Graph Browser

**Priority:** P0 | **Depends On:** SPEC-004, SPEC-005 | **Enables:** SPEC-007; human-facing surface for every later feature

**Goal:** A polished self-hosted web app for browsing repos, searching, reading symbol pages, and visually exploring the graph and blast radii — embedded in the package and fully offline.

**Reviewability Budget:** Primary surface: UI |
Projected reviewable LOC: 835 (estimator; net-new app) |
Production files: ~12 |
Total files: ~20 |
Budget result: warning accepted — under the greenfield block line (1200); estimator suggests 3 slices (app shell + search/symbol pages | graph canvas | impact view) — split at scaffold if review pressure demands

**Scope:**
- `web/` app in the SPEC-004 stack: repo switcher, global search box (hybrid, mode toggle), symbol detail pages (snippet with syntax highlighting, callers/callees lists, impact summary), interactive force-graph canvas (pan/zoom/click-to-expand via `/api/graph`), depth-limited impact view with affected-files panel.
- Re-analyze button → `POST /api/reindex` + live SSE progress toast; staleness indicator from `/api/status`.
- Build integration: app builds to static assets copied into `dist/web/` via the `copy-assets` step (constraint: must ship or serve fails loud); served by SPEC-005 static mount; zero external CDN requests (fonts/icons vendored).
- Container recipe (`Dockerfile.serve` or docs) fulfilling the deploy-anywhere bar from SPEC-004.

**Out of Scope:**
- In-browser indexing (SPEC-007); wiki rendering route (SPEC-019); code-viewer LSP features (SPEC-009 wires them in).

**Key Files:**
- `web/` — the app (per spike stack)
- `src/server/static.ts` — embedded static serving
- `package.json` / build scripts — web build + copy-assets wiring (modify)

---

### SPEC-007: In-Browser Indexing

**Priority:** P1 | **Depends On:** SPEC-006 | **Enables:** zero-install demo/eval path

**Goal:** Open a local folder in the browser and get the same browse/search/impact experience with all parsing and storage happening client-side.

**Reviewability Budget:** Primary surface: UI (browser runtime) |
Projected reviewable LOC: 580 (net-new) |
Production files: ~7 |
Total files: ~14 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- Browser indexing pipeline: File System Access API directory walk (+ drag-drop fallback), reuse shipped tree-sitter WASM grammars in a Web Worker, SQLite-WASM (OPFS-backed) store implementing the same schema; ignore rules honored.
- The existing extraction orchestrator refactored only as far as needed to run in both runtimes (dependency-inject fs/db seams — keep upstream diffs minimal per the additive-first constraint).
- UI: "Open folder" flow, progress, per-repo OPFS persistence + delete; capability detection with graceful messaging (Safari/Firefox).
- Keyword search locally always; semantic path available when the user configures an embedding endpoint (browser → endpoint directly).

**Out of Scope:**
- Browser-side LSP/dataflow; syncing browser indexes to the daemon.

**Key Files:**
- `web/src/local-indexing/` — worker pipeline + OPFS store
- `src/extraction/` — runtime seams (minimal modify)
- `web/src/pages/open-folder` — UI flow

---

### SPEC-008: LSP Client Integration

**Priority:** P0 | **Depends On:** None | **Enables:** SPEC-010; compiler-accurate edges platform-wide

**Goal:** Where a language server is installed, graph definitions/references become compiler-accurate, with per-edge provenance, graceful per-language degradation, and no-waiver parity against the reproduced language/feature baseline.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 565 (net-new) |
Production files: ~7 |
Total files: ~14 |
Budget result: warning accepted after parity expansion; use vertical slices or hand concrete leftovers to SPEC-024, never backlog-only ownership

**Scope:**
- `src/lsp/` module: `servers.ts` registry (typescript-language-server, pyright/basedpyright, gopls, rust-analyzer, clangd, SourceKit-LSP, jdtls, plus concrete entries or dispositions for C#, Kotlin, PHP, Ruby, Dart, Vue, and COBOL from the SPEC-008 plan; PATH probe + user config override), `client.ts` JSON-RPC over stdio (initialize/shutdown lifecycle, per-workspace instances, request timeout + crash restart), `precision-pass.ts` (for each heuristic edge in LSP-covered files: textDocument/definition + references verification; upgrade/correct/annotate).
- Schema: `resolution` provenance column on edges (`heuristic` default, `lsp` when verified); status reporting of per-language coverage % and detected servers.
- Opt-in via `codegraph index --lsp` / config; incremental verification on watch events for changed files.
- Parity gate using `docs/ai/specs/.process/language-feature-parity-baseline.md`: every language, matrix cell, and capability row must have implementation evidence or concrete numbered spec ownership.
- Required language baseline: JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL.

**Out of Scope:**
- Exposing an LSP server (SPEC-009); rename (SPEC-010); auto-installing language servers.

**Key Files:**
- `src/lsp/servers.ts` — detection registry + config
- `src/lsp/client.ts` — JSON-RPC lifecycle
- `src/lsp/precision-pass.ts` — edge verification/upgrade
- `src/db/schema.sql` — edge provenance column (modify)

**Completion:** Merged as stacked PRs #23-#27 (`77c282b`, `53a9adf`, `096fef1`,
`052f8b0`, `8c53f53`) and archived on 2026-07-07. The active spec folder was
removed after `src/lsp/`, schema/query changes, sync integration, validation gates,
public retrieval filtering, zero-unowned-row parity evidence, workflow ledger, and
archive report became the durable record. SPEC-010 is now ready; SPEC-024 is dormant
unless future parity drift creates a concrete unowned row.

---

### SPEC-009: LSP Server Facade

**Priority:** P0 | **Depends On:** SPEC-005 | **Enables:** in-browser code intelligence (web viewer)

**Goal:** The graph answers LSP — stdio for tooling, WebSocket for the web app's code viewer — read-only by construction.

**Reviewability Budget:** Primary surface: API (protocol) |
Projected reviewable LOC: 445 (net-new) |
Production files: ~6 |
Total files: ~12 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/lsp/facade/server.ts`: LSP server implementing initialize, textDocument/{definition,references,hover,documentSymbol}, workspace/symbol from graph queries (definitions via node spans, references via edges, hover via signature+doc); capabilities advertise read-only surface only.
- Transports: `codegraph lsp` stdio subcommand; `src/lsp/facade/ws-bridge.ts` WebSocket endpoint mounted on the SPEC-005 server (`/lsp`).
- Web UI code viewer integration: editor component speaks LSP over the WebSocket (go-to-def navigates the app; references panel; hover cards).
- Conformance smoke test with a scripted generic LSP client fixture.

**Out of Scope:**
- Mutating LSP methods; IDE marketing/packaging; diagnostics publishing.

**Key Files:**
- `src/lsp/facade/server.ts` — graph-backed LSP handlers
- `src/lsp/facade/ws-bridge.ts` — WebSocket transport on serve
- `src/bin/codegraph.ts` — `lsp` subcommand (modify)
- `web/` — viewer wiring (modify)

---

### SPEC-010: Graph-Aware Rename

**Priority:** P1 | **Depends On:** SPEC-008 | **Enables:** safe automated refactors for agents

**Goal:** Rename any symbol with a dry-run plan first, LSP-powered where possible, graph-verified always, atomic on apply.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 405 (net-new) |
Production files: ~5 |
Total files: ~11 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/refactor/rename.ts`: plan builder — LSP `textDocument/rename` workspace-edit when a server covers the language; otherwise graph-reference-driven edit derivation with collision detection (shadowing, import aliases, string-similar false positives excluded by span verification); ambiguous → refusal with reasons.
- Plan format: files, ranges, before/after previews, confidence per edit; `--dry-run` default, `--apply` executes with workspace-root jail + .gitignore respect, then targeted re-sync of touched files; post-check asserts zero dangling references.
- Surfaces: `codegraph rename` CLI + MCP tool with the same plan/apply contract.

**Out of Scope:**
- Non-rename refactors (extract/move); cross-repo rename (after SPEC-022, future).

**Key Files:**
- `src/refactor/rename.ts` — plan/apply engine
- `src/mcp/tools.ts` — rename tool (modify)
- `src/bin/codegraph.ts` — `rename` subcommand (modify)

---

### SPEC-011: Execution Flows & Clusters

**Priority:** P1 | **Depends On:** None (LLM labels via SPEC-018 optional) | **Enables:** SPEC-012 enrichment, SPEC-019 chapters

**Goal:** The graph gains two navigable catalogs — named execution flows from detected entry points, and functional clusters from community detection — exposed over MCP and REST.

**Reviewability Budget:** Primary surface: schema/migration + API |
Projected reviewable LOC: 525 (net-new) |
Production files: ~6 |
Total files: ~13 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/analysis/flows/`: entry-point detection (exported entrypoints, existing route nodes, CLI handlers, event/queue handlers), bounded call-chain tracing (depth/width caps, cycle-safe), flow naming heuristic (route method+path else qualified symbol name — OQ-7), persistence (`flows`, `flow_steps` tables).
- `src/analysis/clusters/`: Louvain (or label-propagation fallback) over the call/import graph; stable cluster ids across re-index via membership-overlap matching; heuristic labels (dominant directory/name tokens), LLM labels when SPEC-018 configured.
- MCP tools `list_flows`/`get_flow`/`list_clusters`; REST mirrors (`/api/flows`, `/api/clusters`); ≤20% index-time overhead measured on the fixture monorepo.

**Out of Scope:**
- UI panels (web app consumes the API when SPEC-006 lands/iterates); wiki prose (SPEC-019).

**Key Files:**
- `src/analysis/flows/entrypoints.ts`, `tracer.ts` — detection + tracing
- `src/analysis/clusters/louvain.ts` — community detection
- `src/db/schema.sql` — flows/clusters tables (modify)
- `src/mcp/tools.ts` — three new tools (modify)

---

### SPEC-012: Change Impact Detection

**Priority:** P1 | **Depends On:** SPEC-011 (preferred, for flow impact) | **Enables:** SPEC-020

**Goal:** Any git diff maps to the symbols it touches and the flows/callers it endangers — in CLI, MCP, JSON, and markdown, with CI-stable exit codes.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 405 (net-new) |
Production files: ~5 |
Total files: ~11 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/analysis/detect-changes/`: diff acquisition (`git diff` unstaged/staged/all and `--base-ref` merge-base compare, rename/move detection via `-M`), hunk→symbol span intersection against the index, upstream caller expansion (depth-limited BFS), affected-flow lookup (flow_steps join), risk annotations (caller count, hub flags).
- Outputs: JSON schema (stable), markdown table renderer; exit codes: 0 clean, 1 impacts, 2 threshold breach (`--fail-on callers>N|hub`); MCP tool + `codegraph detect-changes` CLI.
- Correctness: staleness guard (index vs HEAD warning), phantom-impact prevention on renames.

**Out of Scope:**
- PR comment/GitHub wiring (SPEC-020); cross-repo impact (SPEC-022).

**Key Files:**
- `src/analysis/detect-changes/diff.ts` — git integration
- `src/analysis/detect-changes/mapper.ts` — hunk→symbol→flow mapping
- `src/mcp/tools.ts`, `src/bin/codegraph.ts` — surfaces (modify)

---

### SPEC-013: Cypher Query Access

**Priority:** P1 | **Depends On:** None | **Enables:** power-user/agent ad-hoc graph queries

**Goal:** A read-only openCypher subset compiles to SQL over the existing store, giving agents expressive path queries without new dependencies.

**Reviewability Budget:** Primary surface: API (query engine) |
Projected reviewable LOC: 445 (net-new) |
Production files: ~6 |
Total files: ~12 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/query/cypher/`: lexer + recursive-descent parser for the documented subset (MATCH node/edge patterns with labels/props, variable-length paths `[*1..n]`, WHERE comparisons/boolean ops, RETURN with aliases, ORDER BY, LIMIT); AST → SQL planner emitting parameterized recursive CTEs over `nodes`/`edges`; grammar contains no mutating clauses (read-only by construction).
- Guardrails: statement timeout, row cap, path-length cap; precise unsupported-syntax errors pointing at the grammar doc.
- Surfaces: `codegraph query` CLI (table/JSON output) + MCP tool; `docs/` recipes page with ≥10 queries (callers-of, path-between, hub-ranking, dead-exports…).

**Out of Scope:**
- Write clauses; full openCypher (aggregations beyond count, OPTIONAL MATCH — documented as unsupported v1).

**Key Files:**
- `src/query/cypher/{lexer,parser,planner,sql-emitter}.ts` — the engine
- `src/mcp/tools.ts`, `src/bin/codegraph.ts` — surfaces (modify)
- `docs/cypher-recipes.md` — recipes + grammar reference

---

### SPEC-014: Control-Flow Graphs

**Priority:** P2 | **Depends On:** None | **Enables:** SPEC-015 → 016 → 017

**Goal:** Opt-in per-function CFGs (basic blocks + typed edges) built from tree-sitter ASTs through a language-neutral lowering IR, persisted and queryable — TS/JS + Python first.

**Reviewability Budget:** Primary surface: schema/migration + harness/adapter |
Projected reviewable LOC: 485 (net-new) |
Production files: ~6 |
Total files: ~13 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/analysis/cfg/ir.ts`: lowering IR (statements, expressions, branch/loop/try constructs) with a per-language lowering interface; `languages/typescript.ts`, `languages/python.ts` lowerings from tree-sitter ASTs.
- `builder.ts`: basic-block construction, edge kinds (seq, true/false branch, loop-back, exception, early-exit), function-level entry/exit nodes.
- Persistence: `cfg_blocks`, `cfg_edges` tables keyed to function node ids; library query API (`getCfg(functionId)`); `--analysis cfg` opt-in flag; overhead measurement documented.
- Golden-file tests per construct (if/else, for/while, switch, try/finally, guard returns, break/continue).

**Out of Scope:**
- Dataflow (SPEC-015); languages beyond TS/JS+Py (OQ-4 order: Go next).

**Key Files:**
- `src/analysis/cfg/ir.ts`, `builder.ts`, `languages/{typescript,python}.ts`
- `src/db/schema.sql` — CFG tables (modify)

---

### SPEC-015: Dataflow Substrate

**Priority:** P2 | **Depends On:** SPEC-014 | **Enables:** SPEC-016

**Goal:** Reaching definitions and def-use chains over CFGs, stored as data-dependence edges with documented soundness limits.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 390 |
Production files: ~5 |
Total files: ~10 |
Budget result: within budget

**Scope:**
- `src/analysis/dataflow/reaching-defs.ts`: worklist algorithm over CFG blocks for locals/params (gen/kill sets from the IR); `def-use.ts`: def-use chain materialization → `data_dep_edges` table.
- Handles assignment, compound assignment, destructuring, parameter binding, returns; explicit documented limits (dynamic property writes, eval-like constructs, closures captured-by-reference treated conservatively).
- Deterministic ordering; golden-file fixtures per pattern.

**Out of Scope:**
- Control dependence/PDG (SPEC-016); heap/alias analysis.

**Key Files:**
- `src/analysis/dataflow/reaching-defs.ts`, `def-use.ts`
- `src/db/schema.sql` — data-dependence edges (modify)

---

### SPEC-016: Program Dependence Graphs

**Priority:** P2 | **Depends On:** SPEC-015 | **Enables:** SPEC-017

**Goal:** Control dependence (post-dominator analysis) merges with data dependence into per-function PDGs with a slicing API.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 325 |
Production files: ~4 |
Total files: ~9 |
Budget result: within budget

**Scope:**
- `src/analysis/pdg/postdom.ts`: post-dominator tree (reverse CFG, iterative dominance) → control-dependence edges; `builder.ts`: PDG assembly (control + data dependence unified node/edge model, persisted).
- `slice.ts`: backward/forward slice from a statement/variable node (transitive dependence closure), returned as ordered statement sets with spans.
- Canonical golden tests (classic sum/product loop slice, guard-dependent statements).

**Out of Scope:**
- Inter-procedural system dependence graph (SPEC-017 handles call-edge propagation at the taint layer).

**Key Files:**
- `src/analysis/pdg/{postdom,builder,slice}.ts`
- `src/db/schema.sql` — PDG persistence (modify)

---

### SPEC-017: Taint Analysis Engine

**Priority:** P2 | **Depends On:** SPEC-016 | **Enables:** security findings for agents/CI

**Goal:** Source→sink taint findings with sanitizer awareness, propagated over PDGs intra-procedurally and along call edges inter-procedurally, exposed via an `explain` tool with measured precision/recall.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 525 (net-new) |
Production files: ~6 |
Total files: ~13 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/analysis/taint/catalog/`: JSON packs — sources (HTTP params/body, env, fs reads, user input), sinks (SQL exec, process exec, fs writes, response/HTML emission), sanitizers (escaping/validation/parameterization), per-framework packs aligned with the existing `src/resolution/frameworks/` coverage.
- `engine.ts`: intra-procedural propagation over PDG slices; `interproc.ts`: argument→parameter→return propagation along call edges with per-function summaries, basic field sensitivity on property accesses, sanitizer suppression.
- Findings model: source→sink path with file:line steps, severity, confidence; surfaces: `explain` MCP tool + `codegraph explain` CLI (per-file or per-symbol scoping).
- Seeded-vulnerability fixture suite reporting precision/recall; clean-fixture zero-findings gate in CI.

**Out of Scope:**
- Full context sensitivity / alias analysis (documented next-step); auto-fix suggestions.

**Key Files:**
- `src/analysis/taint/{engine,interproc}.ts`, `catalog/*.json`
- `src/mcp/tools.ts`, `src/bin/codegraph.ts` — `explain` surfaces (modify)

---

### SPEC-018: LLM Access Layer

**Priority:** P1 | **Depends On:** None | **Enables:** SPEC-019, SPEC-020 narrative, SPEC-011 labels

**Goal:** One shared LLM capability with two first-class paths — a BYO OpenAI-compatible endpoint client and an agent-driven task-bundle mode — degrading to heuristics when unconfigured.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 405 (net-new) |
Production files: ~5 |
Total files: ~11 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/llm/client.ts`: OpenAI-compatible chat completions (streaming + non-streaming, retry/timeout, `CODEGRAPH_LLM_{URL,MODEL,API_KEY}`); prompt-template helpers; token-budget guard.
- `src/llm/agent-bundle.ts`: task-bundle emitter — a structured directory/file (`.codegraph/tasks/<id>/`) carrying instructions, graph context (JSON), and expected output contract, completable by any subscription coding agent (companion skill documented in-repo); bundle ingestion validates/installs the agent's output.
- Feature integration contract: consumers ask the layer for `generate(prose-task)` and receive endpoint output, a pending-bundle handle, or a heuristic fallback — never an error path for absence of config.
- Research note (AC-18.4): endpoint vs agent-driven comparison on one wiki chapter + one PR narrative (cost/quality/latency), committed to `docs/design/`.

**Out of Scope:**
- Vendor-specific SDKs; fine-tuning; long-term memory.

**Key Files:**
- `src/llm/{client,agent-bundle,config}.ts`
- `docs/design/llm-paths-note.md` — the comparison note

---

### SPEC-019: Auto-Updating Code Wiki

**Priority:** P1 | **Depends On:** SPEC-011, SPEC-018 | **Enables:** living docs in the web app + repo

**Goal:** A generated markdown wiki — overview, cluster chapters, flow walkthroughs, hub pages — that regenerates incrementally and updates itself from watch events.

**Reviewability Budget:** Primary surface: harness/adapter + UI route |
Projected reviewable LOC: 525 (net-new) |
Production files: ~6 |
Total files: ~13 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/wiki/generator.ts`: deterministic structure from the graph (overview from repo stats/clusters; per-cluster chapters from SPEC-011 membership; per-flow walkthroughs from flow steps; hub-symbol pages by centrality) with prose filled via SPEC-018 (endpoint, agent bundle, or heuristic skeleton).
- `incremental.ts`: chapter-level content hashing over underlying node sets; only changed chapters re-render; `--watch` subscribes to sync events for automatic updates.
- Outputs: `.codegraph/wiki/**.md` (committable) + `/wiki` route in the web app (rendered from the same files); build-time budget gates (fixture: <5 min local-LLM, <30 s skeleton).

**Out of Scope:**
- Hand-authored doc merging; publishing pipelines (static export is enough).

**Key Files:**
- `src/wiki/{generator,chapters,incremental}.ts`
- `src/server/routes.ts` — `/wiki` (modify)
- `src/bin/codegraph.ts` — `wiki` subcommand (modify)

---

### SPEC-020: PR Blast-Radius Review Action

**Priority:** P1 | **Depends On:** SPEC-012 (SPEC-018 optional) | **Enables:** CI change-safety on every PR

**Goal:** A reusable GitHub Action posts a sticky blast-radius report on PRs — impacted symbols, flows, risk table — with configurable failure thresholds and optional LLM narrative.

**Reviewability Budget:** Primary surface: seed/config + harness/adapter |
Projected reviewable LOC: 405 (net-new) |
Production files: ~4 |
Total files: ~11 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `actions/pr-impact/`: composite action — checkout, Node setup, index restore (`actions/cache` on `.codegraph/` keyed per OQ-5: lockfile + merge-base; rebuild on miss), `detect-changes --base-ref` JSON, markdown report render, sticky comment upsert (marker-comment strategy) via `GITHUB_TOKEN`.
- Threshold config (inputs: `fail-on-callers`, `fail-on-hubs`) mapping to detect-changes exit codes for required-check gating; optional narrative via SPEC-018 endpoint secrets, off by default.
- Dogfood workflow `.github/workflows/pr-impact.yml` on this fork's own PRs; median ≤3 min warm-cache budget at fixture scale.

**Out of Scope:**
- Other CI vendors (the CLI's JSON output is the portability layer); inline per-line review comments (future).

**Key Files:**
- `actions/pr-impact/action.yml`, `run.ts` — the composite action
- `.github/workflows/pr-impact.yml` — dogfood wiring

---

### SPEC-021: Repo Groups & Contract Extraction

**Priority:** P2 | **Depends On:** None | **Enables:** SPEC-022

**Goal:** Declared repo groups get per-member contract inventories — routes, HTTP clients, gRPC, topics, manifests — with provenance, staleness, and JSON export.

**Reviewability Budget:** Primary surface: schema/migration + harness/adapter |
Projected reviewable LOC: 485 (net-new) |
Production files: ~6 |
Total files: ~13 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `src/group/config.ts`: `group.yaml` schema (members: path/name/service metadata) + validation; `store.ts`: group-level store (SQLite alongside member indexes).
- `extractors/`: HTTP routes (reuse existing framework route nodes), HTTP client calls (fetch/axios/requests-style call-site detection with URL literals/templates), gRPC services/stubs (proto + generated-stub heuristics), message topics (pub/sub call patterns), package manifests (dependency declarations) — each with file:line provenance and a graph-assisted-first, source-scan-fallback strategy.
- CLI: `codegraph group create|add|remove|list|status|sync`; JSON export of contract inventories.

**Out of Scope:**
- Cross-member matching/impact (SPEC-022).

**Key Files:**
- `src/group/{config,store}.ts`, `extractors/{http,client,grpc,topics,manifest}.ts`
- `src/bin/codegraph.ts` — `group` subcommands (modify)

---

### SPEC-022: Cross-Repo Bridge & Impact

**Priority:** P2 | **Depends On:** SPEC-021 | **Enables:** fleet-wide blast radius

**Goal:** Producer/consumer contracts match across group members into a bridge of cross-repo edges powering `group impact` and `group query`, with a drift report for dangling contracts.

**Reviewability Budget:** Primary surface: harness/adapter + API |
Projected reviewable LOC: 445 (net-new) |
Production files: ~5 |
Total files: ~12 |
Budget result: within greenfield allowance (estimator suggested 2 slices — advisory)

**Scope:**
- `matcher.ts`: exact + wildcard path matching for routes↔clients, topic-name matching for pub/sub, package-dependency matching for manifests; confidence scoring; `bridge.ts`: cross-edge persistence in the group store (member, node id, contract id per side).
- `impact.ts`: `group impact <symbol>` — member-local blast radius, escalate through bridge edges into consuming members, results grouped per repo; `group query` federated node/flow search across members.
- Drift report: unmatched producers/consumers listed with provenance (the contract-rot detector); MCP tools mirroring the CLI.

**Out of Scope:**
- Runtime tracing/verification of contracts; auto-sync scheduling (manual/CI-invoked `group sync`).

**Key Files:**
- `src/group/{matcher,bridge,impact}.ts`
- `src/mcp/tools.ts` — group tools (modify)

---

### SPEC-023: OCaml Language Support

**Priority:** P2 | **Depends On:** None | **Enables:** OCaml repos across the platform

**Goal:** OCaml joins the supported-language matrix through the standard grammar pipeline with extraction, resolution, fixtures, and docs at the same bar as existing languages.

**Reviewability Budget:** Primary surface: harness/adapter |
Projected reviewable LOC: 325 |
Production files: ~4 |
Total files: ~10 |
Budget result: within budget

**Scope:**
- Grammar: tree-sitter OCaml WASM built/vendored per `docs/grammars` pipeline; wired into `copy-assets`.
- `src/extraction/languages/ocaml.ts`: functions, modules/functors, types (variants/records), let-bindings, module opens/includes; interface files (`.mli`) handled.
- Resolution: module-path references, open/include scoping heuristics in the name matcher; dune project awareness (multi-package workspace roots) in the import resolver.
- Fixture repo + extraction/resolution tests meeting the existing per-language coverage conventions; docs + `codegraph status` language listing.

**Out of Scope:**
- OCaml LSP precision (arrives free via SPEC-008 if `ocamllsp` is installed — registry entry included there); PPX expansion.

**Key Files:**
- `src/extraction/wasm/tree-sitter-ocaml.wasm` — grammar (shipped via copy-assets)
- `src/extraction/languages/ocaml.ts` — extractor
- `src/resolution/` — module-path handling (minimal modify)
- `__tests__/fixtures/ocaml/` — fixture + tests

**Completion:** Merged in PR #21 (`100a675`) and archived on 2026-07-07. The active
spec folder was removed after the OCaml/interface grammar WASMs, extractor,
Dune-aware resolver, fixtures, tests, grammar docs, workflow ledger, and archive
report became the durable record.

---

### SPEC-024: Language and Feature Parity Closure

**Priority:** P0 | **Depends On:** SPEC-008 parity matrix | **Enables:** no-waiver parity claims

**Goal:** Close every remaining language, feature, and capability gap between CodeGraph and the reproduced parity baseline, with implementation and validation evidence for each row.

**Reviewability Budget:** Primary surface: docs/process + whichever implementation surface is required by the remaining gaps |
Projected reviewable LOC: TBD after SPEC-008 plan |
Production files: TBD |
Total files: TBD |
Budget result: must decompose into numbered child specs before implementation if the gap list exceeds review budget

**Scope:**
- Use `docs/ai/specs/.process/language-feature-parity-baseline.md` as the no-waiver source of truth.
- Close the 13-language x 9-feature matrix: imports, named bindings, exports, heritage, type annotations, constructor inference, config, frameworks, and entry points.
- Close the additional language baseline for Dart, Vue, and COBOL.
- Close the reproduced capability list: MCP tools/resources/prompts, CLI surfaces, hybrid search, flows, clusters, impact, detect-changes, rename, Cypher, wiki generation, multi-repo registry, repo groups, remote embeddings, agent support, and operational analyzer flags.
- Implement missing rows directly or create concrete numbered child specs before SPEC-024 can complete.
- Add regression checks that fail when the parity baseline drifts without an owner or validation update.

**Out of Scope:**
- Claiming parity from intent, partial implementation, or backlog language.
- Adding external project names or outbound source links to spec artifacts; reproduce required baseline rows instead.
- Non-baseline language expansion except already tracked SPEC-023.

**Key Files:**
- `docs/ai/specs/.process/language-feature-parity-baseline.md` — no-waiver baseline
- `src/mcp/`, `src/bin/codegraph.ts`, `src/graph/`, `src/search/`, `src/resolution/`, `src/extraction/` — surfaces audited or extended as needed
- `__tests__/` — parity regression fixtures and surface tests

---

### SPEC-025: Plugin Platform Mechanics Spike (Claude Code + Codex)

**Priority:** P1 | **Depends On:** None | **Enables:** SPEC-026

**Goal:** A grounded, citation-backed decision document on packaging CodeGraph as first-class Claude Code and Codex plugins carrying the MCP server, the prompt front-load hook, user-invocable skills, and explicitly-dispatched agents — per the official Anthropic and OpenAI plugin documentation, before any shipped behavior changes.

**Reviewability Budget:** Primary surface: docs/process |
Projected reviewable LOC: 0 (spike — decision doc only) |
Production files: 0 |
Total files: ~2 |
Budget result: within budget (spike)

**Scope:**
- Platform audit with citations: Claude Code plugin format (manifest and component pointers, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`/`commands`, `${CLAUDE_PLUGIN_ROOT}`, marketplace + trust model, plugin-agent tool inheritance and `disallowedTools`) and Codex plugin format (`.codex-plugin/plugin.json`, bundled skills, `codex-agents/*.toml`, `codex-hooks.json`, MCP registration, project- and hook-hash trust gating).
- Skill-authoring grounding — both vendors implement the same agent-skills open standard (`SKILL.md` + optional `scripts/`/`references/`/`assets/`), so one skill source tree serves both hosts. Anthropic's official skill-building guide ("The Complete Guide to Building Skills for Claude" + the skills best-practices docs and `anthropics/skills` examples): progressive disclosure (frontmatter → body → linked references), the MCP-enhancement skill category (skills as the workflow layer over an MCP server — "MCP provides the kitchen, skills provide the recipes"), what/when trigger-phrase description discipline, kebab-case + exact-`SKILL.md` structural rules, no-XML/reserved-name security restrictions, optional `allowed-tools` and `metadata.mcp-server` fields, and published success criteria (trigger rate on relevant queries, workflow tool-call count, zero failed tool calls, with/without-skill comparison). OpenAI's Codex skills documentation (`developers.openai.com/codex/skills` + `openai/skills` examples): `.agents/skills` scan order, explicit (`$skill-name`) vs implicit description-match invocation, the `agents/openai.yaml` sidecar (`allow_implicit_invocation`, display metadata, MCP tool dependencies), and its authoring best practices (one focused job per skill, imperative steps with explicit inputs/outputs, front-loaded use cases, trigger testing, instructions-over-scripts unless determinism is needed).
- MCP launcher contract (OQ-8): how the plugin-registered server resolves the user-installed CodeGraph binary — the plugin cannot bundle the per-platform runtime — and the absent-binary path (success-shaped setup guidance, never a hard error, per the errors-teach-abandonment doctrine).
- npm-installer coexistence rules: detection and dedupe of MCP registration and the Claude `UserPromptSubmit` hook in both directions; uninstall interplay; who wins when both channels are present.
- Shipped-artifact plan: enumerate the candidate skill and agent set with a per-artifact tier decision (fully open vs focus-constrained via built-in-only denials — the operator-owned tool-surface doctrine) and the validation bar each must pass (retrieval A/B per the CLAUDE.md agent-eval methodology on the Sonnet floor; no regression vs the MCP-only baseline; `server-instructions.ts` stays the single source of agent-facing tool guidance — plugin artifacts reference, never restate, per issue #529).

**Out of Scope:**
- Shipping anything (SPEC-026 implements the decisions); replacing or deprecating the npm installer; upstream marketplace listing decisions beyond the racecraft channel.

**Key Files:**
- `docs/design/plugin-channel-decision.md` — citations, launcher contract, coexistence rules, artifact tier plan + validation gates

---

### SPEC-026: Plugin-Channel Distribution (Claude Code + Codex Plugins)

**Priority:** P1 | **Depends On:** SPEC-025 | **Enables:** marketplace install of the full agent-facing surface

**Goal:** CodeGraph installs as a first-class plugin on both hosts — one plugin source tree building Claude Code and Codex payloads that carry the MCP server registration, the prompt front-load hook, user-invocable skills, and explicitly-dispatched agents — alongside (never replacing) the npm installer.

**Reviewability Budget:** Primary surface: seed/config + harness/adapter |
Projected reviewable LOC: ~380 (launcher + installer-coexistence code + payload build script; plugin manifests/skills/agents are md/json and don't count) |
Production files: ~7 |
Total files: ~22 |
Budget result: within budget (mostly net-new; greenfield allowance applies)

**Scope:**
- Plugin source tree building both payloads per SPEC-025 decisions: Claude (`.claude-plugin/plugin.json`, `mcpServers` launcher entry, `hooks/hooks.json` carrying the `UserPromptSubmit` prompt-hook, `skills/`, `agents/`) and Codex (`.codex-plugin/plugin.json`, `codex-agents/*.toml`, skill mirrors, `codex-hooks.json`).
- Launcher per the SPEC-025 contract: resolve the installed CodeGraph binary; absent-binary path returns success-shaped setup guidance.
- Shipped agents follow the operator-owned tool-surface doctrine: no `tools:` allowlists (inherit the operator's full surface), built-in-only `disallowedTools` per each agent's tier decision; skills are workflow recipes over the MCP tools authored to both vendors' skill-authoring guidance (what/when trigger descriptions, progressive disclosure via `references/`, error-handling sections, should/should-NOT trigger test lists — one source tree per the shared agent-skills standard, with the Codex `agents/openai.yaml` sidecar where warranted); no artifact restates the MCP `initialize` guidance (issue #529).
- Installer coexistence: plugin-managed state detected and deduped in both directions (no double MCP registration, no double hook injection); uninstall of either channel leaves the other functional; contract tests at the installer-targets bar.
- Release workflow builds and publishes versioned plugin payloads; distribution via the racecraft plugin marketplace; Dogfooding Protocol rung: this repo installs its own plugin build.
- Validation gates (binding, from SPEC-025): per-artifact retrieval A/B evidence before first release, recording the vendors' published skill success criteria (trigger rate on relevant queries, workflow tool-call count, zero failed tool calls, with/without comparison) alongside the repo's agent-eval methodology; retrieval-guardian review for any retrieval-affecting steering surface.

**Out of Scope:**
- Removing or deprecating the npm installer or any of its existing agent targets; steering artifacts whose value depends on the model spontaneously picking them (anything shipped must earn its place through the A/B gate); upstream marketplace decisions.

**Key Files:**
- `plugin/` — single source tree for both host payloads (final layout decided at scaffold per SPEC-025)
- `.github/workflows/release.yml` — plugin payload publish step (modify)
- `src/installer/` — coexistence detection/dedupe (minimal modify; contract tests in `__tests__/installer-targets.test.ts` conventions)
- `docs/design/plugin-channel-decision.md` — the SPEC-025 contract this spec implements

---

## Decomposition Principles

When breaking a feature into specs:

1. **Each spec is independently executable** through the full SpecKit workflow (specify → implement)
2. **Minimize cross-spec dependencies** — prefer sequential over deeply nested
3. **Backend foundations first** — establish APIs before frontend integration
4. **Mock data for blocked specs** — UI specs can use static data while backend specs complete
5. **Integration spec last** — wire everything together as the final spec
6. **Parity gaps need concrete owners** — no language, feature, or capability row may be assigned to an unnamed backlog
7. **Each spec gets its own directory**: `specs/<number>-<name>/`

## Dogfooding Protocol

**Binding for every spec in this roadmap** (adopted 2026-07-05 during SPEC-001 delivery):
the codegraph repository is itself the first consumer of every capability this roadmap
ships. Each spec is validated on this repo's own index before it merges, and the repo's
index is kept current with each merge — so by the time a downstream spec starts, it
builds on top of live, real-scale instances of everything before it.

1. **The loop:** after each spec's PR(s) merge to `main` — rebuild (`npm run build`),
   then run a plain `codegraph sync` on this repository. The heal path picks up whatever
   the new spec added (schema migrations apply additively; derived layers backfill);
   the file watcher keeps everything fresh between merges.
2. **Local endpoint configuration** lives in the untracked `.envrc.local` (loaded by the
   committed `.envrc` direnv shim). Committed artifacts stay
   host- and vendor-neutral; private infrastructure details never land in the repo.
3. **Every spec's UAT runbook MUST include a self-repo step**: exercise the new
   capability against this repository's own index, at its real scale, not only against
   synthetic fixtures. (SPEC-001 set the baseline: the full repo — ~5.8k nodes / ~23.7k
   edges — fully embedded, 100% declaration-symbol coverage, on both a feature worktree
   and the main checkout's live index, with the live MCP daemon serving the migrated DB
   concurrently.)
4. **Ladder by spec:** SPEC-001 produce+observe (vectors, coverage, freshness on our own
   edits) · SPEC-002 switch this repo's embedding model to the bundled one and watch
   single-model convergence at scale · SPEC-003 point this repo's MCP config at the dev
   build so agents developing later specs semantically search codegraph's own code ·
   SPEC-011/019 run labels/wiki on this repo and review our own output as first users ·
   web/LSP specs (SPEC-004+) browse and serve this repo first.
5. **Dormancy discipline:** dogfood config must never be required — every capability
   stays opt-in/dormant-by-default so an unconfigured clone behaves identically. A
   dogfooding outage (endpoint down, feature unconfigured) must degrade advisorily,
   never break indexing or retrieval.
6. **Spec-session preflight:** a spec's worktree is bootstrapped BEFORE agent work
   begins — `npm install && npm run build`, then `codegraph init` with the main
   checkout's `.envrc.local` sourced
   (`( . ../../.envrc.local 2>/dev/null; node dist/bin/codegraph.js init . )`), and
   `codegraph status` confirming 100% embedding coverage with the LSP pass enabled
   (the committed root `codegraph.json` turns it on for every index/sync). Both
   hosts' MCP configs start the server through `scripts/mcp-dogfood.mjs` — a
   cross-platform Node launcher that anchors to the checkout root and applies
   `.envrc.local` to the daemon environment whether or not values are
   `export`ed (worktrees fall back to the main checkout's copy) — so every
   agent session serves the HEAD build with live embeddings, and query-time
   semantic search activates automatically when SPEC-003 merges. Sessions in this repo treat `codegraph_explore` as the primary
   retrieval tool (steering lives in CLAUDE.md § Dogfooding). Out-of-repo
   enablement is owned in racecraft-plugins-public (PR #298): speckit-pro's
   subagents inherit the operator's full tool surface — no per-vendor
   allowlists to maintain — and speckit-scaffold-spec runs this bootstrap
   step when scaffolding a spec worktree.

## Environment & Deployment Context

### Existing Infrastructure (No Changes Needed)

| Resource | Detail |
|----------|--------|
| Runtime | Node `>=20 <25` npm engines range (hard check in `src/bin/node-version-check.ts`); effective from-source floor is Node 22.5+ for `node:sqlite` — self-contained releases bundle a ≥22.5 runtime; `node:sqlite` DatabaseSync (WAL + FTS5), zero native deps |
| Parsing | tree-sitter WASM grammars shipped in `src/extraction/wasm/`, copied by `copy-assets` |
| MCP daemon | `src/mcp/` daemon + query-pool/workers — the substrate the HTTP server and LSP facade ride |
| Watch/sync | `src/sync/` FileWatcher (FSEvents/inotify/RDCW) — hooks for auto re-embed, wiki auto-update, LSP incremental passes |
| Tests | vitest; evaluation harness under `__tests__/evaluation/` (extended by SPEC-003) |

### Changes Required

| Change | Where | Detail |
|--------|-------|--------|
| New env vars | shell / CI secrets | `CODEGRAPH_EMBEDDING_*` (SPEC-001/002), `CODEGRAPH_LLM_*` (SPEC-018), `CODEGRAPH_SERVER_TOKEN` (SPEC-005) |
| Schema migrations | `src/db/schema.sql` | vectors (001), edge provenance (008), flows/clusters (011), CFG/dataflow/PDG (014–016), group store (021) |
| Build wiring | `package.json` copy-assets | web static assets (006), OCaml wasm (023), model cache path docs (002) |
| CI | `.github/workflows/` | PR impact dogfood workflow (020); eval-harness gates (003, 017) |

### Local Development Setup

| Requirement | How |
|-------------|-----|
| Embedding endpoint (optional) | Any OpenAI-compatible `/v1/embeddings` server (self-hosted or cloud); set `CODEGRAPH_EMBEDDING_{URL,MODEL,DIMS}` |
| LLM endpoint (optional) | Any OpenAI-compatible chat server; set `CODEGRAPH_LLM_{URL,MODEL}` |
| Language servers (optional) | Install per language on PATH (typescript-language-server, pyright, gopls, rust-analyzer, …) — SPEC-008 auto-detects |
| Web dev | `cd web && npm install` after SPEC-004 fixes the stack |

---

## References

- **Source PRD:** [docs/prd-intelligence-platform.md](../../prd-intelligence-platform.md) — the SPEC catalog above is derived from its Features / Acceptance Criteria
- **Home note (roadmap MOC):** [intelligence-platform-roadmap-MOC.md](intelligence-platform-roadmap-MOC.md)
- **Project Standards:** [CLAUDE.md](../../../CLAUDE.md) — architecture, build rules (`copy-assets`), engines, module layout
- **Design docs:** `docs/design/` — SPEC-004 framework decision and SPEC-018 LLM-paths note land here
