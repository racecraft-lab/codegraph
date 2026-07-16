# Implementation Plan: Web UI: Graph Browser

**Branch**: `006-web-ui-graph-browser` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-web-ui-graph-browser/spec.md`

## Summary

Build a package-shipped Vite + React + TypeScript SPA under `web/` for local CodeGraph repository selection, search, symbol details, graph exploration, impact review, re-analysis progress, and graph-grounded chat. The browser consumes the existing same-origin `src/server/openapi.yaml` read/reindex API, adds only a thin same-origin SPEC-018 chat adapter plus static asset packaging, and keeps provider secrets, graph-context assembly, and indexing on the backend.

## Technical Context

**Language/Version**: TypeScript 5.x; Node engine `>=20.0.0 <25.0.0`; browser app generated as Vite React TypeScript.

**Primary Dependencies**: Existing CodeGraph server and LLM layers; Vite; React; Tailwind CSS v4; `@tailwindcss/vite`; shadcn/ui from `@shadcn`; lucide-react; Cytoscape.js for the production graph canvas.

**Storage**: Existing `node:sqlite` CodeGraph store remains backend-owned. Browser state is local in-memory UI state plus URL/deep-link state. SPEC-018 agent bundles remain backend filesystem state under `.codegraph/tasks/` when agent mode is active.

**Testing**: `npm run build`, `npm run typecheck`, `npm test`; focused Vitest suites for API clients, chat adapter, static serving, packaging, and renderer data transforms; Playwright for primary UI/UAT, keyboard paths, focus containment/return, accessible names and status announcements, nonblank canvas checks, synchronized graph/impact text mirrors, reduced-motion behavior, contrast and target-size checks, text-resize/reflow/no-overlap checks, performance thresholds from NFR-001 through NFR-006, offline/no-CDN behavior, mobile layout, and packaged `codegraph serve --web`.

**Target Platform**: Self-hosted local browser UI served by `codegraph serve --web`; loopback default with no credentials; non-loopback browser serving refused until browser-compatible API/SSE session auth exists; package-shipped npm CLI/runtime.

**Project Type**: Local-first CLI/library with an added SPA and minimal local HTTP server integration.

**Performance Goals**: Primary UI actions show feedback within 100 ms; search and symbol content render within 500 ms after local API response on representative indexed repos; representative graph payloads up to 500 nodes and 1,000 edges render nonblank or summary-first fallback within 2,000 ms after receipt while controls avoid validation-visible main-thread stalls over 100 ms; large graph payloads disclose truncation and avoid unbounded expansion; re-analysis progress reflects accepted starts and received SSE events within the NFR thresholds; package validation records JS/CSS asset sizes and justifies any single runtime asset above 1.5 MB uncompressed.

**Constraints**: No browser-side indexing, provider SDK, provider secret, remote telemetry, external CDN, hosted auth, hosted database, or remote runtime asset fetch. `/api/*` routes must never be swallowed by SPA fallback. Backend scope is limited to static package integration and a minimal SPEC-018 chat adapter.

**Scale/Scope**: 7 user stories, 60 functional requirements, 3 vertical implementation slices: foundation/search/symbol, graph canvas, and impact/reindex/chat/package validation.

**Reviewability Budget**: Primary surface UI; secondary surfaces API, package/static serving, docs/process. Projected reviewable LOC 1115; projected production files 35; projected total files 55; budget result warning accepted in `spec.md` with a one-spec split exception and three vertical slices.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Plan Evidence |
|---|---|---|
| I. Think Before Coding | PASS | Renderer, shadcn style, chat boundary, static serving, and clean-room parity decisions are resolved in `research.md` before implementation. |
| II. Simplicity First | PASS WITH JUSTIFICATION | Backend work is constrained to static asset/package integration and a thin SPEC-018 chat adapter; no new graph query backend, Cypher execution, browser indexing, or provider-specific browser SDK. Reviewability overage is tracked in Complexity Tracking. |
| III. Surgical Changes | PASS | New frontend lives under `web/`; server changes are limited to `src/server/` static/chat seams and build asset copying. Existing OpenAPI read/reindex contracts remain authoritative. |
| IV. Goal-Driven Execution | PASS | `quickstart.md` defines UAT and validation checks for local dev, packaged serve, offline/no-CDN, renderer, accessibility, and chat secret boundaries. |
| V. Deterministic, LLM-Free Extraction | PASS | The web app only reads existing graph data. Chat context is assembled from backend graph data, but LLM output never becomes graph structure. |
| VI. Retrieval Performance Is a Regression Surface | PASS | Browser graph/search consumes existing server contracts and must disclose stale/truncated/degraded data rather than fabricating completeness. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | Runtime assets are local/package-shipped; browser makes only same-origin local backend calls; provider calls, if configured, happen backend-side through SPEC-018. |

**Post-design re-check**: PASS WITH SAME JUSTIFIED REVIEWABILITY EXCEPTION. The selected design keeps the scope in three reviewable slices and does not add unapproved storage, network, or backend surfaces.

## Project Structure

### Documentation (this feature)

```text
specs/006-web-ui-graph-browser/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── web-api-contract.md
│   ├── chat-adapter-contract.md
│   └── static-package-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
web/
├── components.json
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── app/
    ├── components/
    │   ├── graph/
    │   ├── layout/
    │   └── ui/
    ├── hooks/
    ├── lib/
    │   ├── api/
    │   ├── graph/
    │   └── utils.ts
    ├── routes/
    ├── styles/
    │   └── globals.css
    └── tests/

src/server/
├── index.ts
├── routes.ts
├── static.ts
└── openapi.yaml

src/llm/
├── agent-bundle.ts
├── config.ts
├── generate.ts
└── prompt.ts

__tests__/
├── server-*.test.ts
├── web-*.test.ts
└── package-*.test.ts

scripts/
└── package or build helpers as needed for copying web/dist to dist/web
```

**Structure Decision**: Use a nested `web/` Vite React TypeScript app with its own shadcn `components.json`, Tailwind v4 entry CSS, generated `cn` utility, and local API client modules. Root build/package integration invokes the web build and copies `web/dist/` into `dist/web/` so the existing server static mount can serve the SPA shell and assets.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Reviewability budget exceeds block thresholds | SPEC-006 is a coherent self-hosted web surface whose repo picker, search, symbol details, graph canvas, impact, reindex progress, chat, and packaged serve flows must be validated together. | Splitting into separate specs would create temporary incomplete flows where the app shell exists without the graph/chat/package paths users need for acceptance. The mitigation is three vertical implementation slices and explicit review order. |
| New `web/` application plus minimal server/package changes | The selected stack is required by SPEC-004 and FR-027 through FR-030; packaged static serving is required by FR-024 and SC-011. | Serving a static placeholder or CLI-only UI would not satisfy graph browser acceptance scenarios. Backend work is restricted to static asset integration and chat adapter only. |
| Browser graph renderer dependency | A production graph canvas is central to US4 and cannot be replaced by a table-only view. | A custom canvas/SVG renderer would increase implementation risk and accessibility/test burden. Cytoscape.js provides the smallest fit for bounded interactive neighborhoods; non-canvas summaries preserve accessibility. |

## Phase 0 Research Summary

See [research.md](./research.md) for full decisions. Locked choices:

- Production graph renderer: Cytoscape.js for SPEC-006 bounded neighborhoods; Sigma.js deferred for future very-large graph rendering work.
- shadcn style/preset: `base-nova` with neutral base color, CSS variables enabled, `rsc:false`, `tsx:true`, lucide icons, and Vite Tailwind v4 integration.
- GitNexus parity: behavior-level matrix only, derived from public README/license inventory; no source, assets, screenshots, UI text, CSS, visual design, or implementation copying.
- Chat path: same-origin `/api/chat/*` adapter over SPEC-018; browser never receives provider configuration or secrets.
- Package/offline path: `web/dist` copied to `dist/web`; `codegraph serve --web` serves static assets locally; `/api/*` remains API-only.

## Phase 1 Design Summary

See [data-model.md](./data-model.md) and [contracts/](./contracts/) for details.

- The SPA models repositories, repository status, symbols, graph views, impact summaries, re-analysis jobs, chat status, chat requests/responses, and clean-room parity evidence.
- The web API contract consumes the existing OpenAPI read/reindex routes before adding any backend route.
- The chat adapter contract adds only status, message generation, and agent-bundle redemption over SPEC-018.
- The static package contract defines asset copy, route fallback, `/api/*` separation, and offline/no-CDN validation.
- Accessibility and performance validation are part of the three existing vertical slices, not new slices: shadcn sidebar/search/tabs/dialog/sheet/chat controls must keep keyboard and focus semantics, Cytoscape graph state must stay synchronized with non-canvas summaries, impact summaries must be available as programmatic text/list/table content, Playwright/UAT must cover WCAG 2.2 AA contrast, target size, reduced motion, focus order, text resize, reflow, and no-overlap checks, and performance evidence must cover NFR-001 through NFR-006.
