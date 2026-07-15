# PRD: CodeGraph Intelligence Platform

**Status**: Active — not yet implemented
**Source**: racecraft platform-requirements interview, 2026-07-03
**Created**: 2026-07-03
**Last updated**: 2026-07-15
**Target window**: Phased delivery; Phases 0–2 (embeddings, web platform, LSP) are the priority track.

---

## 1. Problem

> "Our AI agents and engineers need code intelligence that is semantically searchable, compiler-accurate, visually explorable, and CI-integrated — across every racecraft repository, on a permissively licensed foundation we can self-host and build on commercially."

CodeGraph today gives agents a deterministic structural knowledge graph over MCP — symbols, call edges, impact radius — but retrieval is keyword-only (SQLite FTS5), reference resolution is heuristic (import-tracing + name-matching), and there is no human-facing surface at all: no web UI, no generated documentation, no CI change reports. It also ignores the growing body of repository-local markdown knowledge that agents need alongside code: specs, runbooks, concept catalogs, and emerging markdown+frontmatter knowledge-bundle formats. Deeper analysis capabilities that mature code-intelligence platforms provide — dataflow/taint analysis, execution-flow catalogs, graph query languages, cross-repository impact — are absent, and OCaml is not among the supported languages. racecraft is consolidating its code-intelligence stack onto this MIT-licensed fork (`racecraft-lab/codegraph`), tracking upstream; every capability below must be built as additive modules that survive routine upstream merges.

## 2. Goals & Non-goals

### 2.1 Goals

- Agents retrieve code and repository knowledge **by meaning**: hybrid vector + keyword search measurably outperforms keyword-only on the existing evaluation harness, with embeddings from a self-hosted endpoint or a bundled local model.
- Humans get a **self-hosted web application** — graph browsing, search, impact visualization, re-index control, and drag-a-repo in-browser indexing — deployable anywhere with minimal effort.
- References and definitions become **compiler-accurate** wherever a language server is available, and the graph powers a safe, verified symbol rename.
- **Change safety is automated**: diff→impact mapping in CLI/MCP, and a GitHub Action that posts blast-radius reports on every PR.
- **Research-grade dataflow analysis**: per-function CFG → def-use → PDG → taint findings (source→sink) exposed to agents.
- **Team-scale features**: an auto-updating generated wiki, markdown/OKF-compatible knowledge-bundle indexing, cross-repository groups with contract-based impact analysis, and OCaml language coverage.
- Everything ships **additive-first** (new modules, opt-in flags), keeping upstream tracking merges routine, with telemetry hard-disabled by default in this fork.

### 2.2 Non-goals (out of scope)

- **Rebranding or npm publishing** — the fork is consumed internally via git install / npm link; publishing is a future decision.
- **Any cloud/SaaS component or telemetry** — all features are local/self-hosted; the only network calls are user-configured endpoints (embedding/LLM) and locally spawned language servers.
- **Replacing editors' language servers** — the exposed LSP facade serves this project's web viewer; IDE adoption is not a v1 target.
- **Write-mode graph queries** — the query language is read-only by construction.
- **Binary/bytecode analysis** — source-level only.
- **A new file-watching/auto-reindex system** — the existing watch/sync subsystem already covers automatic index freshness; new features hook into it rather than replacing it.

## 3. Acceptance Criteria

### 3.1 Embedding Infrastructure & Endpoint Provider *(→ SPEC-001)*

- **AC-1.1**: With `CODEGRAPH_EMBEDDING_URL` + `CODEGRAPH_EMBEDDING_MODEL` set, indexing computes an embedding for every symbol (from a deterministic name + signature + doc + snippet template) and persists it in a vectors table keyed by node id; re-indexing re-embeds only nodes whose embedding input hash changed.
- **AC-1.2**: The endpoint client speaks OpenAI-compatible `POST /v1/embeddings` with request batching, bounded concurrency, per-request timeout, and retry-with-backoff on 5xx/429 — all tunable via `CODEGRAPH_EMBEDDING_{BATCH_SIZE,CONCURRENCY,TIMEOUT_MS}`; a mid-run failure leaves the vector store consistent and resumable.
- **AC-1.3**: Returned vector dimensions are validated against `CODEGRAPH_EMBEDDING_DIMS`; a mismatch fails fast with an actionable error naming the variable to fix.
- **AC-1.4**: With no embedding configuration present, indexing behavior and output are byte-identical to today — the feature is fully dormant.

### 3.2 Bundled Local Embedding Fallback *(→ SPEC-002)*

- **AC-2.1**: With no endpoint configured and local embeddings enabled, indexing embeds via a bundled small code-embedding model running in-process (WASM/ONNX, CPU) with zero network calls.
- **AC-2.2**: Provider selection (endpoint → local → off) is deterministic, and `codegraph status` reports the active backend, model, and dimensions.
- **AC-2.3**: The model is fetched lazily on first use (checksum-verified) so the npm package stays lean; package-size impact is documented.
- **AC-2.4**: Switching provider or model triggers a full re-embed; vectors from different models are never mixed within one index.

### 3.3 Hybrid Semantic Search *(→ SPEC-003)*

- **AC-3.1**: `searchNodes` and the MCP search tool return hybrid results — FTS5 and vector KNN merged via reciprocal-rank fusion — with a per-query mode override (`keyword` | `semantic` | `hybrid`).
- **AC-3.2**: When no vectors exist for a project, search degrades to keyword-only with a hint in the response, never an error.
- **AC-3.3**: The evaluation harness gains semantic-retrieval cases; hybrid mode scores ≥ keyword-only across the suite with zero regressions on existing cases.
- **AC-3.4**: p95 hybrid query latency ≤ 150 ms on a 50k-node index on developer hardware (brute-force scan acceptable at this scale; quantization noted as follow-up).

### 3.4 Web Framework Research Spike *(→ SPEC-004)*

- **AC-4.1**: A decision document in `docs/design/` evaluates ≥ 5 modern frameworks against weighted criteria: self-hostable anywhere (single container / static assets / single binary), minimal-effort deploy, modern DX & UX, cost efficiency (no per-seat or hosted-service dependencies), runtime footprint, and MIT/Apache-compatible licensing.
- **AC-4.2**: The document includes a scored matrix, a recommendation, and the shipping strategy: UI static assets embedded in the CLI package (served by the local server) and a standalone container path.
- **AC-4.3**: A throwaway prototype proves the recommended stack renders a 1,000-node interactive force-graph at a 60 fps target.

### 3.5 Local HTTP Server & REST API *(→ SPEC-005)*

- **AC-5.1**: `codegraph serve` starts a local HTTP server (default bind 127.0.0.1, configurable port) exposing read endpoints: `/api/repos`, `/api/search`, `/api/nodes/:id` (detail incl. callers/callees), `/api/impact/:id`, `/api/graph` (neighborhood expansion), `/api/status`.
- **AC-5.2**: `POST /api/reindex/:repo` starts a background re-index job with progress streamed over SSE; a duplicate concurrent job is rejected with 409.
- **AC-5.3**: The server rides the existing daemon/query-pool (no second DB access layer); auth is loopback-only by default with an optional bearer token for LAN/self-hosted exposure.
- **AC-5.4**: An OpenAPI document is committed and all endpoints are covered by integration tests.

### 3.6 Web UI: Graph Browser *(→ SPEC-006)*

- **AC-6.1**: A web app (framework per SPEC-004) served by `codegraph serve` provides: repo switcher, global hybrid search, symbol pages (source snippet, callers/callees, impact summary), and an interactive graph canvas with pan/zoom/expand-neighborhood.
- **AC-6.2**: An impact view renders a depth-limited visual blast radius for any symbol plus an affected-files list.
- **AC-6.3**: A re-analyze button triggers `POST /api/reindex` and renders live SSE progress; an index-staleness indicator is always visible.
- **AC-6.4**: The UI ships as static assets embedded in the package — `codegraph serve` alone yields the full app, offline, with no external CDN requests.

### 3.7 In-Browser Indexing *(→ SPEC-007)*

- **AC-7.1**: "Open a folder" in the web app indexes a repository entirely client-side — File System Access API + the already-shipped tree-sitter WASM grammars — into an in-browser SQLite (WASM) store; no repository bytes leave the machine.
- **AC-7.2**: Browser-indexed repos get the same browse/search/impact UI (keyword search minimum; semantic when an embedding endpoint is configured).
- **AC-7.3**: Browser indexes persist in OPFS across reloads and are deletable from the UI.
- **AC-7.4**: Capability detection degrades gracefully with clear messaging on browsers lacking the required APIs.

### 3.8 LSP Client Integration *(→ SPEC-008)*

- **AC-8.1**: An LSP client manager auto-detects installed language servers per language (typescript-language-server, pyright/basedpyright, gopls, rust-analyzer, clangd, SourceKit-LSP, jdtls, …) via PATH probing with config overrides, and manages spawn/initialize/shutdown per workspace.
- **AC-8.2**: A precision pass verifies and upgrades graph edges using LSP definitions/references; every edge carries resolution provenance (`lsp` | `heuristic`), and conflicts resolve in favor of LSP.
- **AC-8.3**: The pass is opt-in (flag/config) and runs incrementally on watch events; a missing server degrades silently per-language and is reported in `codegraph status`.
- **AC-8.4**: On the TypeScript fixture repo, the percentage of LSP-verified edges is measured and reported by `codegraph status`.

### 3.9 LSP Server Facade *(→ SPEC-009)*

- **AC-9.1**: `codegraph lsp` (stdio) and a WebSocket endpoint on the serve daemon expose an LSP server implementing `initialize`, `textDocument/definition`, `textDocument/references`, `textDocument/hover`, `textDocument/documentSymbol`, and `workspace/symbol`, answered from the graph.
- **AC-9.2**: The web UI's code viewer connects over WebSocket LSP: go-to-definition, find-references, and hover work in-browser against the served project.
- **AC-9.3**: The facade is read-only — no edit-mutating LSP capabilities are advertised.
- **AC-9.4**: A conformance smoke test drives the facade with a generic LSP client fixture.

### 3.10 Graph-Aware Rename *(→ SPEC-010)*

- **AC-10.1**: An MCP tool and `codegraph rename <symbol> <new-name>` produce a dry-run edit plan (files, ranges, previews) before anything is written.
- **AC-10.2**: Rename uses LSP rename when a server is available; otherwise it derives edits from graph reference edges with collision detection (shadowing, import aliases) and refuses ambiguous renames with stated reasons.
- **AC-10.3**: Applying the plan updates all references and re-syncs the graph atomically; a post-check reports zero dangling references.
- **AC-10.4**: Writes never escape the workspace root and respect `.gitignore`.

### 3.11 Execution Flows & Clusters *(→ SPEC-011)*

- **AC-11.1**: A post-index pass detects entry points (exported entrypoints, route nodes, CLI handlers, event handlers) and materializes named execution flows — entry point plus a bounded call chain — persisted in the store.
- **AC-11.2**: Community detection (Louvain or label propagation) groups nodes into functional clusters with stable ids and heuristic labels (LLM labels when SPEC-018 is configured).
- **AC-11.3**: MCP tools `list_flows`, `get_flow` (step-by-step trace), and `list_clusters` expose both catalogs; the REST API mirrors them.
- **AC-11.4**: Flow + cluster extraction adds ≤ 20% to index time on the fixture monorepo.

### 3.12 Change Impact Detection *(→ SPEC-012)*

- **AC-12.1**: `codegraph detect-changes` (CLI + MCP) maps git diff hunks to symbols whose spans intersect them, then to affected flows/clusters and upstream callers (depth-limited).
- **AC-12.2**: Scopes: `unstaged` (default), `staged`, `all`, and `compare --base-ref <ref>`.
- **AC-12.3**: Output in JSON and markdown; stable exit codes support CI gating (e.g., `--fail-on` impact thresholds).
- **AC-12.4**: Git rename/move detection prevents phantom impacts from moved files.

### 3.13 Cypher Query Access *(→ SPEC-013)*

- **AC-13.1**: `codegraph query` (CLI) and an MCP tool accept a documented openCypher subset: `MATCH` node/edge patterns with labels and properties, variable-length paths (`[*1..n]`), `WHERE`, `RETURN` with aliases, `ORDER BY`, `LIMIT`.
- **AC-13.2**: Queries compile to parameterized SQL (recursive CTEs) over the existing nodes/edges tables; the grammar admits no mutating clauses — read-only by construction.
- **AC-13.3**: Unsupported syntax produces a precise error pointing at the supported-grammar reference.
- **AC-13.4**: Query timeout and row-cap guardrails are enforced; a recipes doc ships with ≥ 10 useful queries.

### 3.14 Control-Flow Graphs *(→ SPEC-014)*

- **AC-14.1**: An opt-in analysis pass builds per-function CFGs (basic blocks; branch, loop, try/catch, early-exit edges) from tree-sitter ASTs through a language-neutral lowering IR — TypeScript/JavaScript and Python first, with the lowering interface designed for additional languages.
- **AC-14.2**: CFGs persist in block/edge tables keyed to function nodes and are queryable through the library API.
- **AC-14.3**: Golden-file tests cover each construct (if/else, loops, switch, try/finally, guard returns).
- **AC-14.4**: The pass is off by default; its index-time overhead when enabled is measured and documented.

### 3.15 Dataflow Substrate *(→ SPEC-015)*

- **AC-15.1**: On CFGs, per-function reaching definitions and def-use chains are computed for locals and parameters and stored as data-dependence edges.
- **AC-15.2**: Assignment, destructuring, parameter binding, and returns are handled; soundness limits (dynamic property access, eval-like constructs) are explicitly documented.
- **AC-15.3**: Outputs are deterministic and covered by golden-file fixtures.

### 3.16 Program Dependence Graphs *(→ SPEC-016)*

- **AC-16.1**: Control dependence is computed via post-dominator analysis and merged with data dependence into a per-function PDG, persisted and queryable.
- **AC-16.2**: A slicing API returns backward/forward slices from any statement/variable node.
- **AC-16.3**: Canonical slicing examples (e.g., the classic sum/product loop) pass as golden tests.

### 3.17 Taint Analysis Engine *(→ SPEC-017)*

- **AC-17.1**: A configurable catalog (JSON packs) defines taint sources (HTTP params, env, file reads, user input), sinks (SQL, exec, fs writes, responses/HTML), and sanitizers, with framework-specific packs.
- **AC-17.2**: The engine propagates taint intra-procedurally over PDGs and inter-procedurally along call edges (arguments → parameters → returns) with basic field sensitivity on property accesses.
- **AC-17.3**: An `explain` MCP tool and CLI list findings as source→sink paths with file:line steps and severity; flows through recognized sanitizers are suppressed.
- **AC-17.4**: A seeded-vulnerability fixture suite reports precision/recall; the clean fixture yields zero findings.

### 3.18 LLM Access Layer *(→ SPEC-018)*

- **AC-18.1**: A shared client supports any OpenAI-compatible chat endpoint via `CODEGRAPH_LLM_{URL,MODEL,API_KEY}` with retry, timeout, and streaming; wiki, PR narrative, and cluster labeling all consume it.
- **AC-18.2**: An agent-driven mode lets features emit a structured task bundle (outline + graph context) that a subscription coding agent (e.g., Claude Code, Codex, Gemini CLI, Copilot) completes instead of a server-side LLM call; the bundle format and companion skill are documented.
- **AC-18.3**: With nothing configured, LLM-consuming features degrade to heuristic/skeleton output — never an error.
- **AC-18.4**: A short research note compares the two paths (cost, quality, latency) on one wiki chapter and one PR narrative.

### 3.19 Auto-Updating Code Wiki *(→ SPEC-019)*

- **AC-19.1**: `codegraph wiki` generates a markdown site — overview, per-cluster chapters, per-flow walkthroughs, hub-symbol pages — with deterministic structure from the graph and prose from the LLM layer (or agent bundle / heuristic skeleton).
- **AC-19.2**: Regeneration is incremental: only chapters whose underlying nodes changed re-render (content-hash), and watch/sync events drive automatic updates in `--watch` mode.
- **AC-19.3**: Output is served in the web app at `/wiki` and written as plain files under `.codegraph/wiki/` (committable).
- **AC-19.4**: Full wiki build on the fixture monorepo completes < 5 min with a local LLM endpoint; skeleton mode < 30 s.

### 3.20 PR Blast-Radius Review Action *(→ SPEC-020)*

- **AC-20.1**: A composite GitHub Action (in-repo) restores/builds the index (cacheable), runs change detection against the PR base, and posts one sticky PR comment with impacted symbols, flows, and a risk table.
- **AC-20.2**: An optional LLM narrative (via SPEC-018 secrets) is off by default; the report is fully useful without it.
- **AC-20.3**: Configurable failure thresholds (e.g., impact touching more than N callers or flagged hubs) drive the Action's exit code for use as a required check.
- **AC-20.4**: The Action runs on this fork's own PRs as dogfood; median runtime ≤ 3 min with a warm cache at fixture scale.

### 3.21 Repo Groups & Contract Extraction *(→ SPEC-021)*

- **AC-21.1**: A schema-validated `group.yaml` declares member repositories and service metadata; `codegraph group sync` extracts contracts per member: HTTP routes (reusing existing route nodes), HTTP client calls, gRPC services/stubs, message topics, and package manifests.
- **AC-21.2**: Contracts persist per repo with file:line provenance and export as JSON.
- **AC-21.3**: `codegraph group list|status` show members, contract counts, and per-member index staleness.

### 3.22 Cross-Repo Bridge & Impact *(→ SPEC-022)*

- **AC-22.1**: A matching engine links producer/consumer contracts across members (exact + wildcard path matching, topic names, package dependencies) into a bridge store of cross-repo edges.
- **AC-22.2**: `codegraph group impact <symbol>` (CLI + MCP) computes blast radius across repo boundaries via bridge edges, grouped per repo; `group query` searches nodes/flows across all members.
- **AC-22.3**: Unmatched contracts (dangling producers/consumers) are reported as a drift report.

### 3.23 OCaml Language Support *(→ SPEC-023)*

- **AC-23.1**: The tree-sitter OCaml grammar (WASM) is integrated through the fork's grammar pipeline; the extractor emits functions, modules/functors, types, let-bindings, and module opens/includes.
- **AC-23.2**: Reference resolution handles module paths and open/include scoping heuristics, with dune project awareness for multi-package repos.
- **AC-23.3**: A fixture repo and extraction tests meet the same coverage bar as existing language suites, and OCaml appears in docs and `codegraph status`.

### 3.24 Markdown / OKF Knowledge Bundle Indexing *(→ SPEC-027)*

- **AC-27.1**: `codegraph index` recognizes `.md` and `.markdown` files as first-class knowledge inputs while preserving existing ignore/include behavior; non-OKF markdown is tracked with file-level metadata, headings/sections, and bounded snippets without dumping whole files into agent responses by default.
- **AC-27.2**: OKF-compatible bundles are parsed deterministically: YAML frontmatter fields (`type`, `title`, `description`, `resource`, `tags`, `timestamp`, and unknown extension fields) are stored, `index.md` and `log.md` reserved-file semantics are represented, and malformed or partial bundles degrade with diagnostics rather than blocking the rest of the index.
- **AC-27.3**: Markdown links between local documents become directed knowledge edges with file:line provenance; links from knowledge documents to indexed code files or symbols are recorded when resolvable, and external citations remain metadata-only with no network fetch.
- **AC-27.4**: Embedding support routes by corpus kind: code symbols continue to use the configured code-oriented embedding model, markdown/OKF chunks can use a prose-oriented text embedding model, and vectors from different models or dimensions are stored in separate namespaces; mixed search merges per-namespace rankings rather than comparing incompatible vectors directly unless a shared embedding space is explicitly validated.
- **AC-27.5**: CLI, MCP, and REST search expose type filters and mixed code/knowledge results with source snippets; the evaluation harness gains a markdown/OKF fixture plus dual-model retrieval cases proving that code-only behavior remains unchanged when no knowledge corpus or text model is configured.

### 3.25 Plugin Platform Mechanics Spike *(→ SPEC-025)*

- **AC-25.1**: A spike report, grounded with citations in the official Claude Code plugin documentation (plugin manifest and component pointers, plugin-scoped `mcpServers`, `hooks`, `skills`, `agents`, `${CLAUDE_PLUGIN_ROOT}`, marketplace and trust model), the official Codex plugin documentation (`.codex-plugin/plugin.json`, bundled skills/agents/hooks, MCP registration, project- and hook-level trust gating), and each vendor's official skill-authoring guidance (Anthropic's skill-building guide and skills best-practices documentation; OpenAI's Codex skills documentation and examples — both implementing the shared agent-skills open standard), records how each host loads every component the plugin will carry.
- **AC-25.2**: The report decides the MCP launcher contract — how the plugin-registered server resolves the user-installed CodeGraph binary, and what happens when it is absent (success-shaped setup guidance, never a hard error) — and the coexistence rules with the npm installer: no double MCP registration, no double prompt-hook injection, and safe uninstall interplay in both directions.
- **AC-25.3**: The report enumerates the shipped skill and agent set with a per-artifact tier decision (fully open vs focus-constrained via built-in-only denials) and the validation bar each artifact must pass before merge — retrieval A/B on the standard evaluation floor showing no regression against the MCP-only baseline, plus the vendors' published skill success criteria (trigger rate on relevant queries including should/should-NOT trigger tests, workflow tool-call count, zero failed tool calls, with/without-skill comparison) — while agent-facing tool guidance remains single-sourced in the MCP `initialize` instructions.
- **AC-25.4**: The report states what the plugin channel does not change: the npm installer remains the primary path for all existing agent targets, and no plugin artifact restates or forks the MCP-served guidance.

### 3.26 Plugin-Channel Distribution *(→ SPEC-026)*

- **AC-26.1**: One plugin source tree builds installable Claude Code and Codex plugin payloads carrying the MCP server registration (per the SPEC-025 launcher contract), the prompt front-load hook, user-invocable skills, and explicitly-dispatched agents.
- **AC-26.2**: Shipped agents inherit the operator's tool surface (no `tools:` allowlists) with built-in-only role denials per their tier decision; shipped skills and agents reference tool guidance rather than restating it.
- **AC-26.3**: Installing the plugin alongside an existing npm install produces no duplicate MCP server and no duplicate hook injection, and uninstalling either channel leaves the other fully functional — covered by contract tests at the same bar as the installer target suite.
- **AC-26.4**: Plugin payloads are versioned and published by the release workflow and installable from the racecraft plugin marketplace; this repository dogfoods its own plugin build per the Dogfooding Protocol.
- **AC-26.5**: Every shipped skill and agent carries recorded validation evidence per AC-25.3 before its first release.

## 4. Migration Path (phased — one phase per tier)

- **Phase 0 (SPEC-001…003) — Semantic retrieval**: embedding infra → local fallback → hybrid search. First because agents feel it immediately and later phases (wiki, flows) reuse vectors.
- **Phase 1 (SPEC-004…007) — Web platform**: framework spike → server API → graph-browser UI → in-browser indexing. Spike gates the stack choice; server precedes UI.
- **Phase 2 (SPEC-008…010) — LSP precision**: consume language servers → expose the LSP facade (web viewer consumer) → graph-aware rename (builds on both).
- **Phase 3 (SPEC-011…013) — Analysis breadth**: flows/clusters, change detection, Cypher access. Independent of each other; all P1.
- **Phase 4 (SPEC-014…017) — Dataflow depth**: CFG → dataflow → PDG → taint, a strict chain.
- **Phase 5 (SPEC-018…023, SPEC-027) — Team & enterprise capabilities**: LLM layer first (wiki/PR consume it), then wiki, markdown/OKF knowledge ingestion, PR Action, groups (contracts → bridge), OCaml (anytime).
- **Phase 6 (SPEC-025…026) — Plugin-channel distribution**: platform-mechanics spike → dual-host plugins (Claude Code + Codex) carrying the MCP server, prompt hook, skills, and agents — alongside, never replacing, the npm installer. Spike gates shipping; parallel-safe with every other phase.

## 5. Constraints

- **Additive-first tracking fork**: new capabilities live in new modules (`src/embeddings`, `src/server`, `web/`, `src/lsp`, `src/analysis`, `src/query`, `src/llm`, `src/wiki`, `src/group`, `src/knowledge`) behind opt-in flags; diffs to upstream-owned files stay minimal so upstream merges remain routine.
- **Zero native dependencies** in the core package: `node:sqlite` is the only store; new runtime deps must be pure-JS/WASM; the npm engines range `>=20 <25` must be preserved (it gates the thin-installer shim — the effective from-source floor is Node 22.5+ for `node:sqlite`, which the bundled runtime satisfies); any new SQL/WASM/static asset must be wired into the `copy-assets` build step or it will not ship.
- **Local-first & private**: telemetry **must be** hard-disabled by default in this fork — upstream currently defaults it to enabled (`src/telemetry/index.ts`), so flipping that default is fork work, not current state; no network calls except user-configured endpoints (embedding/LLM) and locally spawned language servers; the web app makes no external requests.
- **Deterministic extraction stays LLM-free**: LLM output is confined to prose layers (wiki text, labels, narratives) — never to graph structure.
- **Self-host bar for the web platform**: deployable as embedded static assets via the CLI or a single container; no external services required.
- **License hygiene**: all new code MIT; dependencies must be MIT/Apache/BSD-compatible; no code or text imported from non-permissively-licensed codebases. Implementations are original work against public standards (LSP spec, openCypher, OpenAI-compatible API shapes, tree-sitter grammars).
- **Vendor-neutral documentation**: PRDs, specs, and code describe capabilities in self-contained terms — no comparisons to, endorsements of, or dependencies on third-party commercial or source-available products. Referencing public standards and API schemas (LSP, openCypher, OpenAI-compatible shapes) and permissively-licensed OSS frameworks is allowed.

## 6. Open Questions

- **OQ-1 (SPEC-002)**: Bundled model choice and delivery (lazy checksum-verified download vs optional dependency) — recommendation: lazy download to keep install lean.
- **OQ-2 (SPEC-004)**: Framework shortlist — recommendation: evaluate Vite+React SPA, SvelteKit (static/adapter-node), Next.js (standalone), Astro (islands), TanStack Start, SolidStart against the AC-4.1 criteria.
- **OQ-3 (SPEC-018)**: Agent-driven protocol shape (task-bundle file + companion skill vs MCP prompt) — recommendation: task bundle + skill; validate in the AC-18.4 research note.
- **OQ-4 (SPEC-014/017)**: Language order after TS/JS + Python — recommendation: Go, then Swift/Kotlin, driven by racecraft repo composition.
- **OQ-5 (SPEC-020)**: CI index cache strategy — recommendation: cache `.codegraph/` keyed on lockfile + merge-base; rebuild on miss.
- **OQ-6 (SPEC-005)**: LAN self-host auth — recommendation: bearer token via env; TLS terminates at a reverse proxy (out of scope).
- **OQ-7 (SPEC-011)**: Flow naming heuristics — recommendation: route method+path where available, else entry symbol qualified name.
- **OQ-8 (SPEC-025)**: MCP launcher resolution for the plugin channel (PATH-resolved installed binary vs npx thin-installer vs install-on-first-use prompt) and npm-installer coexistence mechanics — recommendation: PATH-resolved binary with an npx fallback and success-shaped guidance when absent; decide in the spike.
- **OQ-9 (SPEC-027)**: Dual embedding model strategy for code plus prose knowledge — recommendation: route code and markdown/OKF chunks through separately configured model profiles, persist corpus/model/dimension namespaces, and merge result rankings at query time; validate any same-space comparison before allowing direct vector mixing.

## 7. SPEC Catalog Crosswalk

| Feature (§3) | Acceptance Criteria | SPEC | Depends on | Priority |
|---|---|---|---|---|
| Embedding Infrastructure & Endpoint Provider | AC-1.* | SPEC-001 | — | P0 |
| Bundled Local Embedding Fallback | AC-2.* | SPEC-002 | SPEC-001 | P0 |
| Hybrid Semantic Search | AC-3.* | SPEC-003 | SPEC-001 | P0 |
| Web Framework Research Spike | AC-4.* | SPEC-004 | — | P0 |
| Local HTTP Server & REST API | AC-5.* | SPEC-005 | SPEC-004 | P0 |
| Web UI: Graph Browser | AC-6.* | SPEC-006 | SPEC-004, SPEC-005 | P0 |
| In-Browser Indexing | AC-7.* | SPEC-007 | SPEC-006 | P1 |
| LSP Client Integration | AC-8.* | SPEC-008 | — | P0 |
| LSP Server Facade | AC-9.* | SPEC-009 | SPEC-005 | P0 |
| Graph-Aware Rename | AC-10.* | SPEC-010 | SPEC-008 | P1 |
| Execution Flows & Clusters | AC-11.* | SPEC-011 | — | P1 |
| Change Impact Detection | AC-12.* | SPEC-012 | SPEC-011 | P1 |
| Cypher Query Access | AC-13.* | SPEC-013 | — | P1 |
| Control-Flow Graphs | AC-14.* | SPEC-014 | — | P2 |
| Dataflow Substrate | AC-15.* | SPEC-015 | SPEC-014 | P2 |
| Program Dependence Graphs | AC-16.* | SPEC-016 | SPEC-015 | P2 |
| Taint Analysis Engine | AC-17.* | SPEC-017 | SPEC-016 | P2 |
| LLM Access Layer | AC-18.* | SPEC-018 | — | P1 |
| Auto-Updating Code Wiki | AC-19.* | SPEC-019 | SPEC-011, SPEC-018 | P1 |
| PR Blast-Radius Review Action | AC-20.* | SPEC-020 | SPEC-012, SPEC-018 (optional) | P1 |
| Repo Groups & Contract Extraction | AC-21.* | SPEC-021 | — | P2 |
| Cross-Repo Bridge & Impact | AC-22.* | SPEC-022 | SPEC-021 | P2 |
| OCaml Language Support | AC-23.* | SPEC-023 | — | P2 |
| Markdown / OKF Knowledge Bundle Indexing | AC-27.* | SPEC-027 | SPEC-001, SPEC-003 | P1 |
| Plugin Platform Mechanics Spike | AC-25.* | SPEC-025 | — | P1 |
| Plugin-Channel Distribution | AC-26.* | SPEC-026 | SPEC-025 | P1 |

## 8. Success Criteria

1. All acceptance criteria (AC-1.1 … AC-27.5) pass with tests or documented evidence.
2. Every SPEC merges within its reviewability budget or with a recorded advisory/exception.
3. racecraft agents use hybrid search daily; the web app is self-hosted and in use; the PR Action runs green on this fork's own PRs.
4. An upstream merge performed after Phase 2 completes without structural conflicts in the new modules — proof the additive-first constraint held.

## 9. References

- **Technical roadmap:** `docs/ai/specs/intelligence-platform-technical-roadmap.md`
- **Project standards:** `AGENTS.md` (architecture, build rules, `copy-assets`, engines)
- **Discovery / source:** racecraft platform-requirements interview, 2026-07-03; framework spike output will land in `docs/design/`
- **Knowledge-bundle reference:** [Open Knowledge Format v0.1 draft](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), a markdown + YAML frontmatter convention for portable agent-readable knowledge bundles
