---
spec_id: SPEC-006
spec_name: Web UI: Graph Browser
branch: 006-web-ui-graph-browser
created: 2026-07-15
status: scaffolded
---

# SPEC-006 Design Concept

## Summary

SPEC-006 should deliver the first production web app for CodeGraph: a local,
package-shipped Vite + React + Tailwind + shadcn/ui interface for browsing indexed
repos, searching symbols, reading symbol context, exploring graph neighborhoods,
running impact views, re-indexing with progress, and chatting with a repo through
the SPEC-018 LLM layer.

The app must feel like a working developer tool, not a marketing site. It should
open directly into the usable graph browser, expose dense but scannable navigation,
and stay fully offline except for user-configured LLM endpoint calls.

## Grounding

Repository roadmap:

- `docs/ai/specs/intelligence-platform-technical-roadmap.md` marks SPEC-006 as
  P0, dependent on SPEC-004 and SPEC-005, and enabled by the shipped local HTTP
  server, REST API, static mount, and re-index SSE workflow.
- SPEC-004 selected Vite + React SPA and recorded Cytoscape.js as the spike
  renderer, with Sigma.js as the production-scale WebGL runner-up to evaluate in
  SPEC-006.
- SPEC-018 is complete and provides the shared LLM layer that SPEC-006 can use
  for chat without inventing a separate provider path.

Live scaffold checks:

- Worktree: `.worktrees/006-web-ui-graph-browser`
- Branch: `006-web-ui-graph-browser`
- Node: repo-pinned `24.11.1` via nvm PATH
- Bootstrap: `npm ci` and `npm run build` passed on 2026-07-15
- Current UI state: no `web/`, no `components.json`, no Vite config, and no
  Tailwind entry CSS exist yet; implementation must initialize them.
- Preset stack: spec/plan templates resolve to `speckit-pro-reviewability`;
  tasks resolve to `codegraph-project-overrides`.

External feature-parity target:

- GitNexus public README describes a browser web UI with visual graph exploration,
  AI chat, local backend auto-connect, backend-routed search/code navigation/query
  tools, Docker/local serving, and browser-only indexing modes.
- GitNexus is licensed under PolyForm Noncommercial License 1.0.0. SPEC-006 may
  use public behavior as a feature inventory, but must not copy source code,
  assets, UI text, visual design, styles, or implementation structure.

shadcn/Tailwind grounding:

- Context7 selected `/shadcn-ui/ui` and `/tailwindlabs/tailwindcss.com`.
- shadcn CLI `init` creates `components.json`, installs dependencies, adds the
  `cn` utility, configures Tailwind, and sets CSS variables.
- Tailwind v4 with Vite uses `@tailwindcss/vite` in `vite.config.ts` and
  `@import "tailwindcss";` in CSS.
- shadcn MCP registry is available as `@shadcn`.

## Goals

- Create `web/` as the production Vite + React + TypeScript SPA selected by
  SPEC-004.
- Use Tailwind CSS and shadcn/ui as the default UI system, with shadcn skills/MCP
  as required implementation inputs.
- Provide a repo switcher backed by the SPEC-005 repo/status API.
- Provide global search with keyword/hybrid mode selection and degraded-state
  messaging from the backend.
- Provide symbol detail pages with snippet, callers, callees, flow membership,
  impact summary, and graph links.
- Provide an interactive graph canvas with pan, zoom, click-to-focus,
  click-to-expand, filters, legends, and bounded rendering for large graphs.
- Provide a depth-limited impact view with affected files and clear truncation
  state.
- Provide re-analyze controls using `POST /api/reindex/:repo`, latest job reads,
  and SSE progress.
- Provide GitNexus-style full chat parity for indexed repos: a web chat panel
  that grounds answers in CodeGraph context and SPEC-018 LLM output, with honest
  disabled/misconfigured states when LLM config is absent.
- Ship the app as package assets copied into `dist/web/`; static serving must fail
  loudly when assets are missing from package builds.
- Preserve local-first posture: no CDN assets, no hosted runtime dependencies,
  no browser-side secrets, and no telemetry.

## Non-Goals

- Browser-side repo upload, ZIP parsing, or in-browser indexing. Those remain
  SPEC-007 work.
- Wiki route rendering. That remains SPEC-019 work.
- Code viewer LSP features. SPEC-009 owns that facade.
- A Cypher backend if CodeGraph does not already expose one. SPEC-006 may provide
  an advanced query affordance for supported backend operations and record Cypher
  parity as blocked by the graph-query backend roadmap.
- Copying or adapting GitNexus source code, assets, CSS, screenshots, product
  copy, layout composition, or implementation structure.

## Design Decisions

| Question | Decision | Rationale |
|---|---|---|
| UI foundation | Vite React + Tailwind + shadcn/ui | Matches SPEC-004 and the user's scaffold requirement. |
| shadcn style | Preset exploration | Implementation should compare shadcn presets/styles during plan before locking the final look. |
| Delivery slices | Three vertical slices | Keeps the expanded app reviewable: shell/search/symbol, graph canvas, impact/reindex/chat polish. |
| Renderer | Renderer bake-off first | Cytoscape.js has spike evidence; Sigma.js must be evaluated before production graph commitment. |
| GitNexus parity | Feature-parity target | Match user-facing capability classes while keeping a clean-room implementation. |
| AI chat | Full chat parity | User selected full chat parity; use SPEC-018 and keep disabled states explicit when unconfigured. |
| Repo input | Backend-only | Use already indexed repos through SPEC-005; defer browser ZIP/drop-in indexing to SPEC-007. |
| Clean room | Feature inventory only | Inspect public behavior/docs and optionally source for feature names only; never copy implementation. |

## GitNexus Feature-Parity Matrix

| GitNexus web capability | SPEC-006 target | Scope note |
|---|---|---|
| Visual graph explorer | Interactive graph canvas | Production renderer chosen after Cytoscape/Sigma bake-off. |
| AI chat in browser | Repo chat panel | Uses SPEC-018 endpoint/agent-bundle capability; no browser secrets. |
| Local backend mode | Same-origin `codegraph serve --web` | SPEC-005 static mount and APIs are the anchor. |
| All indexed repos visible | Repo switcher | Backed by `/api/repos` and status health. |
| Search and code navigation | Global search + symbol pages | Backed by `/api/search`, `/api/node`, callers/callees, flows. |
| Graph query tools | Advanced query affordance | Support current CodeGraph APIs; Cypher waits for backend support. |
| Re-index from UI | Re-analyze button + SSE toast | Backed by SPEC-005 job endpoints. |
| Docker/local serving | Container recipe or docs | Must use package-shipped assets and local data only. |
| Browser upload/ZIP/indexing | Deferred | SPEC-007 owns browser-side indexing. |

## shadcn Component Plan

The initial shadcn component set should cover the real tool surface:

- `button`, `input`, `card`, `sidebar`, `breadcrumb`, `tabs`, `table`,
  `dialog`, `sheet`, `sonner`, `resizable`, `scroll-area`, `tooltip`, `badge`,
  `skeleton`, `dropdown-menu`, and `separator`.
- shadcn MCP returned this add command for the set after project init:

```bash
npx shadcn@latest add @shadcn/button @shadcn/input @shadcn/card @shadcn/sidebar @shadcn/breadcrumb @shadcn/tabs @shadcn/table @shadcn/dialog @shadcn/sheet @shadcn/sonner @shadcn/resizable @shadcn/scroll-area @shadcn/tooltip @shadcn/badge @shadcn/skeleton @shadcn/dropdown-menu @shadcn/separator
```

Implementation must avoid raw custom controls when a shadcn component covers the
interaction. Use lucide icons inside icon buttons where available.

## Reviewability Budget

Advisory size signal:

- User stories: 7
- Production files: 16
- Functional requirements: 20
- New vs modify: new
- `estimate-spec-size`: `estimated_loc=1115`, `suggested_slices=3`,
  `status=warn`

Interpretation:

- The original roadmap estimated 835 reviewable LOC with three slices.
- Full chat parity expands scope, but the greenfield block line remains 1200 LOC.
- SPEC-006 should keep three vertical implementation slices and avoid unrelated
  backend expansion. If chat or graph renderer work exceeds the greenfield block,
  split before implementation rather than landing an oversized PR.

## Proposed Slices

Slice 1: App shell, shadcn/Tailwind foundation, repo/status/search, symbol pages,
and renderer bake-off decision.

Slice 2: Production graph canvas, graph filters, focused neighborhoods, selected
symbol details, and large-graph UAT.

Slice 3: Impact view, re-analyze/SSE progress, chat parity, offline/package checks,
Docker/local serving docs, and Playwright/accessibility validation.

## Open Risks

- Chat parity depends on exposing SPEC-018 safely through the web server without
  leaking API keys or making browser calls directly to providers.
- Cypher-style query parity depends on backend support outside the current SPEC-006
  roadmap; the UI must not imply a capability that does not exist.
- Renderer bake-off may choose Sigma.js over the SPEC-004 Cytoscape spike, adding
  migration work for graph interactions and tests.
- shadcn preset exploration can drift into visual churn; pick one preset during
  planning and lock it for implementation.
- Full GitNexus feature parity must remain clean-room and behavior-level only.

## Evidence Sources

- CodeGraph roadmap: `docs/ai/specs/intelligence-platform-technical-roadmap.md`
- SPEC-004 decision: `docs/design/web-framework-decision.md`
- SPEC-005 server surface: `src/server/`
- SPEC-018 LLM layer: `src/llm/`
- GitNexus README: https://github.com/abhigyanpatwari/GitNexus
- GitNexus license: https://raw.githubusercontent.com/abhigyanpatwari/GitNexus/main/LICENSE
- shadcn docs: Context7 `/shadcn-ui/ui`
- Tailwind docs: Context7 `/tailwindlabs/tailwindcss.com`
