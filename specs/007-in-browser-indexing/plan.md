# Implementation Plan: In-Browser Indexing

**Branch**: `007-in-browser-indexing` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/007-in-browser-indexing/spec.md`

## Summary

Deliver local-first browser indexing in three reviewable slices: a browser-safe graph build pipeline, local repository read routing in the web UI, and explicit semantic opt-in with capability/performance hardening. The browser path uses a dedicated module worker, SQLite-Wasm with OPFS SAH-pool storage, canonical CodeGraph schema/migrations, web-tree-sitter grammars served from the package, and source selection through user-granted browser handles or drag/drop snapshot imports.

The plan preserves the accepted reviewability warning from the scaffold: 13 production ownership slots and approximately 1,055 reviewable production LOC. Implementation must stop for consensus if the slice plan expands beyond that boundary or adds a fourth user-facing slice.

## Technical Context

**Language/Version**: TypeScript across Node and browser surfaces. Root package supports Node `>=20.0.0 <25.0.0`; repository guidance notes `node:sqlite` source runs require Node 22.5+ and bundled runtime support. Web app uses React 19 and Vite 8.

**Primary Dependencies**: Existing `web-tree-sitter`, `tree-sitter-wasms`, React Router, Tailwind/shadcn UI, Vitest, and Playwright. Add exact browser runtime dependency `@sqlite.org/sqlite-wasm@3.53.0-build1` for the in-browser SQLite database.

**Storage**: Canonical graph data remains SQLite. Browser graph databases live in OPFS through SQLite-Wasm `opfs-sahpool` inside a dedicated worker. Source-cache additions go through shared schema/migration files so Node and browser databases do not fork.

**Testing**: Root Vitest for schema/extraction seams; web Vitest for client/worker protocol; Playwright for Chromium full-flow UAT and Firefox/WebKit degradation checks. Build packaging is validated with `npm run build` and packaged web asset checks.

**Target Platform**: Browser secure contexts. Chromium-class browsers provide the full folder-open/reconnect path. Firefox/WebKit must degrade to supported snapshot/import behavior with clear capability reporting.

**Project Type**: Existing single repository with TypeScript library/CLI/server plus React SPA. This feature adds a browser-local runtime path without changing default CLI/server behavior.

**Performance Goals**: Self-repo baseline target is the current SPEC-007 scale of 901 files, 16,127 nodes, and 68,846 edges. Keyword-only browser indexing should complete within 60 seconds on reference hardware; local search/graph/impact reads should keep p95 under 150 ms after warmup; main-thread heartbeat must remain responsive during scan, read, grammar-load, parse, store, publish, and embed phases. Implementation must declare file-batch, worker-payload, snapshot-transfer, progress-cadence, embedding-batch, and vector-write ceilings before code review; self-repo evidence must include local query plans, asset byte inventory/request order, and repeated-run resource cleanup.

**Constraints**: No default network calls, no implicit credentials, no writes to the user-selected source tree, 1 MiB per-file text cap, explicit user activation for permission prompts, one active local indexing writer per origin/repository, no COOP/COEP dependency, and no `node:*` imports in browser bundles.

**Scale/Scope**: Current spec has 63 functional requirements, 7 user stories, 3 implementation slices, and 21 measurable outcomes.

## Constitution Check

### Gate 1: Pre-Research

- **I. Static Truth Before Synthesis**: PASS. Browser indexing will parse selected local source with tree-sitter and store deterministic graph facts before any semantic/vector features.
- **II. Local-First Sovereignty**: PASS. The browser path performs no network calls by default and persists graph/source cache in same-origin browser storage only.
- **III. Agent-Consumable Graphs**: PASS. Local reads return existing graph/search/source/relationship shapes through a repository-client abstraction.
- **IV. Deterministic Engineering**: PASS. Shared schema migrations, deterministic source manifests, and explicit worker protocol states define reproducible behavior.
- **V. Retrieval Quality Is a Product Surface**: PASS. Query parity, benchmark checks, and retrieval-oriented UAT are in scope.
- **VI. Every Capability Earns Its Complexity**: PASS WITH WARNING. The feature crosses worker, storage, parser, UI, and embedding surfaces. The warning is accepted only because the work is split into three vertical slices and capped at 13 production ownership slots / about 1,055 reviewable production LOC.
- **VII. Privacy Is Dormant By Default**: PASS. Semantic endpoint configuration remains dormant until explicit user opt-in and stores no API key.

### Gate 2: Post-Design

- **I. Static Truth Before Synthesis**: PASS. Data model and contracts keep keyword/static graph indexing as the baseline; embeddings depend on completed graph data.
- **II. Local-First Sovereignty**: PASS. SQLite-Wasm OPFS SAH-pool, File System Access handles, and snapshot imports remain local to the origin.
- **III. Agent-Consumable Graphs**: PASS. `LocalRepositoryClient` is contract-compatible with current REST read shapes.
- **IV. Deterministic Engineering**: PASS. Worker messages, progress states, source-cache keys, and schema migration ownership are specified.
- **V. Retrieval Quality Is a Product Surface**: PASS. Tests cover search/graph/impact parity and self-repo performance.
- **VI. Every Capability Earns Its Complexity**: PASS WITH WARNING. Complexity tracking is explicit below; no fourth slice or hidden runtime class is permitted without consensus.
- **VII. Privacy Is Dormant By Default**: PASS. Direct semantic endpoint calls are rejected unless user-configured, HTTPS-safe, credential-free in storage, and capability-tested.

## Project Structure

### Documentation

```text
specs/007-in-browser-indexing/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   |-- browser-capabilities.md
|   |-- local-index-worker.md
|   `-- local-repository-client.md
`-- spec.md
```

### Source Ownership

```text
src/
|-- db/
|   |-- migrations.ts
|   `-- schema.sql
`-- extraction/
    |-- browser-kernel.ts
    `-- index.ts

web/
|-- vite.config.ts
`-- src/
    |-- components/layout/RepositorySwitcher.tsx
    |-- routes/RepositoryOverview.tsx
    |-- lib/
    |   |-- api/client.ts
    |   `-- repository-client.ts
    `-- local-indexing/
        |-- capabilities.ts
        |-- client.ts
        |-- embeddings.ts
        |-- source.ts
        |-- sqlite.ts
        `-- worker.ts
```

### Test Ownership

```text
__tests__/
|-- db-browser-source-cache-migration.test.ts
`-- extraction-browser-kernel.test.ts

web/src/tests/
|-- local-indexing-capabilities.test.ts
|-- local-indexing-client.test.tsx
|-- local-indexing-degradation.spec.ts
|-- local-indexing-full.spec.ts
|-- local-indexing-network.spec.ts
|-- local-indexing-packaged.spec.ts
`-- local-indexing-worker.test.ts
```

## Phase 0: Research

Complete: [research.md](./research.md)

Research resolves SQLite-Wasm persistence, worker/WASM asset delivery, File System Access capability handling, source traversal parity, schema/migration ownership, embedding safety, CSP/network posture, and verification strategy.

## Phase 1: Design And Contracts

Complete:

- [data-model.md](./data-model.md)
- [quickstart.md](./quickstart.md)
- [contracts/local-repository-client.md](./contracts/local-repository-client.md)
- [contracts/local-index-worker.md](./contracts/local-index-worker.md)
- [contracts/browser-capabilities.md](./contracts/browser-capabilities.md)

No AGENTS/CLAUDE/GEMINI context file was modified. The loaded repo-local skill explicitly keeps generated workflow state in `specs/` and disables agent-context updates for this phase.

## Complexity Tracking

| Item | Why Required | Simpler Alternative Rejected |
|------|--------------|------------------------------|
| Dedicated browser worker | SQLite sync access, OPFS I/O, parsing, and embedding calls must not block React or the main thread. | Main-thread indexing would violate responsiveness and permission/worker storage constraints. |
| SQLite-Wasm OPFS SAH-pool | Provides durable browser-local SQLite without COOP/COEP and without source-tree writes. | IndexedDB object stores would fork query behavior and schema semantics from CodeGraph. |
| Runtime-neutral extraction kernel | Browser must reuse parsing semantics without importing `fs`, `path`, `child_process`, or `node:sqlite`. | Copying the Node extractor would create divergent parser behavior and browser bundling failures. |
| Local repository-client abstraction | UI routes need to read from either REST daemon or browser worker with the same data shapes. | Duplicating every route for browser mode would expand UI churn and review surface. |
| Direct semantic endpoint opt-in | FRs require optional semantic search without a local server; privacy requires dormant-by-default behavior. | Shipping semantic calls by default or adding a proxy would violate privacy and deployment constraints. |

**Reviewability verdict**: WARN accepted. The plan keeps three slices, caps reviewable production LOC at about 1,055, and forecasts 13 production ownership slots. Any implementation forecast above 1,200 production LOC, above 13 production ownership slots, or requiring a fourth slice must return for consensus before code changes continue.

## Slice Plan

**Slice 1: Browser Graph Bootstrap**

- Adds SQLite-Wasm OPFS SAH-pool adapter, browser source selection/import, runtime-neutral extraction kernel, source-cache schema migration, and worker keyword indexing.
- User value: open/import a project locally and build a searchable static graph with no network.
- Verification: root extraction/schema tests, worker unit tests, Chromium index/search smoke.

**Slice 2: Local Repository Shell**

- Adds repository-client routing, UI controls, progress/cancel/reconnect/refresh/delete flows, and query parity for search/source/graph/impact.
- User value: browse the local index through the existing CodeGraph web experience.
- Verification: web route/component tests, Playwright full-flow UAT, packaged asset test.

**Slice 3: Semantic Opt-In And Hardening**

- Adds explicit direct endpoint configuration, secret-free profile persistence, vector build/query path, network/privacy audits, capability matrix, and performance checks.
- User value: optional semantic search without changing the local-first default.
- Verification: network-denial tests, embedding opt-in tests, self-repo benchmark, Firefox/WebKit degradation checks.

## Planned Files And LOC

| Ownership Slot | Planned Files | Slice | Est. Production LOC |
|----------------|---------------|-------|---------------------|
| Schema migration | `src/db/schema.sql`, `src/db/migrations.ts` | 1 | 105 |
| Extraction kernel | `src/extraction/browser-kernel.ts` | 1 | 140 |
| Node extraction adapter | `src/extraction/index.ts` | 1 | 35 |
| Build and asset wiring | `package.json`, `web/vite.config.ts` | 1 | 25 |
| Repository client contract | `web/src/lib/repository-client.ts` | 2 | 90 |
| REST client bridge | `web/src/lib/api/client.ts` | 2 | 20 |
| Capability detection | `web/src/local-indexing/capabilities.ts` | 2 | 45 |
| Source selection/import | `web/src/local-indexing/source.ts` | 1 | 115 |
| SQLite adapter | `web/src/local-indexing/sqlite.ts` | 1 | 120 |
| Worker protocol/runtime | `web/src/local-indexing/worker.ts` | 1 | 170 |
| Main-thread worker client | `web/src/local-indexing/client.ts` | 2 | 85 |
| Semantic opt-in | `web/src/local-indexing/embeddings.ts` | 3 | 55 |
| UI integration | `web/src/components/layout/RepositorySwitcher.tsx`, `web/src/routes/RepositoryOverview.tsx` | 2 | 50 |

## Declared File Operations

- MODIFIED src/db/schema.sql
- MODIFIED src/db/migrations.ts
- NEW src/extraction/browser-kernel.ts
- MODIFIED src/extraction/index.ts
- MODIFIED package.json
- MODIFIED web/vite.config.ts
- NEW web/src/lib/repository-client.ts
- MODIFIED web/src/lib/api/client.ts
- NEW web/src/local-indexing/capabilities.ts
- NEW web/src/local-indexing/source.ts
- NEW web/src/local-indexing/sqlite.ts
- NEW web/src/local-indexing/worker.ts
- NEW web/src/local-indexing/client.ts
- NEW web/src/local-indexing/embeddings.ts
- MODIFIED web/src/components/layout/RepositorySwitcher.tsx
- MODIFIED web/src/routes/RepositoryOverview.tsx

**Estimated reviewable production LOC**: 1,055

**Planned test files**: 9 focused files covering schema migration, extraction parity, worker protocol, client integration, browser capability degradation, network/privacy policy, packaged assets, and Chromium full-flow UAT.

## Verification Plan

- Run `npm run build` to validate TypeScript and shipped asset copying.
- Run `npm test` for root tests including schema and extraction changes.
- Run `npm --prefix web run test` for web unit/component tests.
- Run Playwright Chromium full-flow UAT against a local fixture and the self-repo scale target.
- Run Playwright Firefox/WebKit degradation checks for unsupported picker/reconnect paths.
- Run accessibility and responsive UX checks for keyboard-only local workspace flows, focus restoration after picker/dialog/terminal states, status/alert announcements for progress and failures, 320 CSS px mobile layout, and reduced-motion progress/status behavior.
- Confirm no network request is made before semantic opt-in and no persisted storage contains API keys.
- Confirm packaged `dist/web` can load worker, SQLite WASM, tree-sitter core WASM, grammar WASM, and browser routes without a dev-server-only path.
- Record package/static-host local-indexing asset byte sizes, initial route bundle impact, and request order proving SQLite, tree-sitter core, and grammar WASM assets are lazy until local indexing and accepted-language demand.
- Capture SQLite query plans for the deterministic self-repo search, graph, and impact suite; document index/FTS usage, row limits, candidate caps, and any intentional bounded scan.
- Capture enforced read/message/progress and embedding/vector ceilings, including negative tests where budget overruns become bounded warnings or recoverable failures before unbounded work begins.
- Capture repeated self-repo index/delete/reindex and embed cancel/resume resource evidence, including parser/tree/worker/SQLite/VFS/vector cleanup high-water and post-cleanup state.
- While semantic embedding is active, paused, failed, and cancelled, rerun local keyword search, graph, and impact reads and verify the 150 ms p95 local-read target still holds.
- Confirm data-integrity recovery covers worker close/release, Web Lock ownership release, stale ownership metadata on next open, crash boundaries across source-cache staging/graph write/registry publish/status update/delete cleanup, incremental add/change/delete source-cache synchronization, and semantic vector model/dimension/generation convergence and resume.

## Unresolved For Consensus

None.
