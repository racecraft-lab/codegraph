# Phase 0 Research: Web UI Graph Browser

## Source Ledger

Allowed external clean-room sources:

- GitNexus public README: https://github.com/abhigyanpatwari/GitNexus
- GitNexus public license: https://raw.githubusercontent.com/abhigyanpatwari/GitNexus/main/LICENSE
- shadcn/ui official docs through Context7 library `/shadcn-ui/ui`
- Tailwind CSS official docs through Context7 library `/tailwindlabs/tailwindcss.com`

Explicitly excluded sources:

- GitNexus source files, assets, screenshots, CSS, UI text, visual design, product copy, implementation structure, or generated artifacts.
- Any hosted GitNexus web UI inspection.

Local CodeGraph evidence:

- `src/server/openapi.yaml` is authoritative for shipped status, repo, search, node, callers, callees, graph, impact, flows, clusters, and re-analysis routes.
- `src/server/static.ts` and `src/server/index.ts` define static fallback behavior and `/api/*` separation.
- `src/llm/config.ts`, `src/llm/generate.ts`, and `src/llm/agent-bundle.ts` define SPEC-018 endpoint, dormant/misconfigured, fallback, and agent-bundle modes.

## Decision R1: Use Cytoscape.js For The Production Graph Canvas

**Decision**: Use Cytoscape.js for SPEC-006 production graph neighborhoods.

**Rationale**: SPEC-006 needs bounded interactive graph neighborhoods, synchronized selected-node details, filters, keyboard-operable controls, click-to-expand behavior, visible truncation, and deterministic Playwright nonblank-canvas checks. Cytoscape.js is the smaller fit for this bounded graph product shape because it provides mature graph interaction, layouts, event handling, and direct data-shape adaptation without adding a separate graph data runtime.

**Renderer bake-off record**:

| Criterion | Cytoscape.js | Sigma.js | Result |
|---|---|---|---|
| Bounded neighborhood fit | Strong fit for graph operations, layouts, selection, expansion, and filtered subgraphs. | Strong visual renderer, but usually paired with Graphology and more custom interaction state. | Cytoscape.js |
| Large graph behavior | Acceptable when paired with backend caps, truncation disclosure, and summary-first fallbacks. | Better WebGL fit for very large visual graphs. | Sigma.js for future large-scale spike |
| Accessibility mirror | Easier to keep selected-node and neighbor summaries synchronized with graph events. | Requires more custom bridge code to keep graph data, renderer state, and summaries aligned. | Cytoscape.js |
| Testability | Good fit for deterministic mounted-canvas checks, event simulation, and data transform tests. | WebGL path may need more pixel checks and timing controls. | Cytoscape.js |
| Implementation size | One primary renderer dependency and direct data adaptation. | Renderer plus graphology-style model and custom UI glue. | Cytoscape.js |

**Alternatives considered**:

- Sigma.js: better candidate for future whole-repo or very-large WebGL rendering, but over-adds moving parts for SPEC-006's capped neighborhood UI.
- Custom SVG/canvas: rejected because it increases graph interaction, layout, and accessibility risk without product benefit.

## Decision R2: Use shadcn/ui `base-nova` With Tailwind v4 CSS Variables

**Decision**: Initialize `web/` as a Vite React TypeScript app with Tailwind CSS v4, `@tailwindcss/vite`, shadcn/ui `base-nova`, neutral base color, CSS variables, `rsc:false`, `tsx:true`, lucide icons, and `@/` aliases.

**Rationale**: The official shadcn Vite/Tailwind setup expects `components.json` with schema, style, Tailwind CSS path, `baseColor`, `cssVariables:true`, aliases for components/lib/hooks/utils, and `iconLibrary:"lucide"`. Tailwind v4 official Vite integration uses `@tailwindcss/vite` in `vite.config.ts` and a standard CSS `@import "tailwindcss";`. This matches the workflow requirement for `components.json`, CSS variables, generated `cn`, and Vite integration.

**Style/preset comparison**:

| Option | Fit For Dense Developer Tool | Tradeoff | Outcome |
|---|---|---|---|
| `base-nova` + neutral | Current shadcn v4-style baseline with CSS variables and neutral semantic tokens. | Requires locking the theme early to avoid visual churn. | Selected |
| `new-york` + neutral | Compact established style and Vite fixture precedent. | Older style naming may be less aligned with current v4 preset flow. | Not selected |
| Highly expressive preset | Could make graph/chat surface visually distinct. | Risks decorative or marketing-like UI, contrary to dense tool requirements. | Rejected |

**Required setup details**:

- `components.json` belongs under `web/` and includes `$schema`, `style`, `rsc:false`, `tsx:true`, `tailwind.css`, `baseColor:"neutral"`, `cssVariables:true`, aliases for `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`, and `iconLibrary:"lucide"`.
- Global CSS uses `@import "tailwindcss";`, shadcn CSS variables, dark variant support, and `@theme inline` mappings.
- Components import from `@/components/ui/<component>`.
- Initial component add command:

```bash
npx shadcn@latest add @shadcn/button @shadcn/input @shadcn/card @shadcn/sidebar @shadcn/breadcrumb @shadcn/tabs @shadcn/table @shadcn/dialog @shadcn/sheet @shadcn/sonner @shadcn/resizable @shadcn/scroll-area @shadcn/tooltip @shadcn/badge @shadcn/skeleton @shadcn/dropdown-menu @shadcn/separator
```

**Alternatives considered**:

- Tailwind v3 directives: rejected because Tailwind v4 uses `@import "tailwindcss"` and the Vite plugin.
- Custom component system: rejected because the workflow requires shadcn/ui and because shadcn primitives reduce bespoke control code.

## Decision R3: Keep GitNexus Parity Behavior-Level And Clean-Room

**Decision**: Implement behavior-level parity only where CodeGraph backend contracts already exist or where SPEC-006 explicitly allows a static/chat delta. Do not copy, inspect, derive from, or reproduce GitNexus source, assets, screenshots, CSS, UI text, visual design, product copy, or implementation structure.

**Rationale**: The GitNexus public README describes a web UI with visual graph exploration and browser AI chat, bridge/local-server behavior, and limits for browser mode. The license is PolyForm Noncommercial License 1.0.0, so SPEC-006 must use public README/license behavior inventory only and produce original MIT-compatible CodeGraph work.

**Clean-room behavior parity matrix**:

| Public behavior | SPEC-006 target | Status | Owning backend or follow-up spec | Evidence URL | Clean-room notes |
|---|---|---|---|---|---|
| Web UI for visual graph exploration and AI chat | Local CodeGraph SPA with graph explorer and graph-grounded chat panel | Implement in SPEC-006 | Existing OpenAPI graph routes plus SPEC-018 chat adapter | https://github.com/abhigyanpatwari/GitNexus | Behavior class only; no visual/text/source copying. |
| Bridge/local-server browsing of indexed repos | `codegraph serve --web` serves packaged web assets and same-origin `/api/*` routes for indexed repos | Implement in SPEC-006 | Existing `src/server/` static and read API with package copy update | https://github.com/abhigyanpatwari/GitNexus | CodeGraph local server behavior only. |
| Browser-only repo ingestion or ZIP upload | Not supported; repo input and indexing remain backend/CLI-owned | Out of scope | Follow existing CodeGraph indexing workflows | https://github.com/abhigyanpatwari/GitNexus | SPEC-006 forbids browser-side indexing. |
| Query, context, impact, trace-style workflows | Search, node details, callers/callees, graph, impact, flows, and clusters through existing OpenAPI | Implement in SPEC-006 where existing routes exist | `src/server/openapi.yaml` | https://github.com/abhigyanpatwari/GitNexus | Raw Cypher remains disabled/non-executing unless SPEC-013 adds a supported backend route. |
| Raw Cypher graph queries | Disabled or non-executing affordance; existing-API presets only | Backend-blocked | SPEC-013 | https://github.com/abhigyanpatwari/GitNexus | No executable flow without CodeGraph backend support. |
| Large repo/browser limits | Backend/browser caps, truncation disclosure, and summary-first fallback | Implement in SPEC-006 | Existing graph caps plus UI disclosure | https://github.com/abhigyanpatwari/GitNexus | Do not mimic GitNexus memory model or UI. |
| License posture | No derivative source/assets/design/text | Guardrail | Planning, implementation, and PR evidence | https://raw.githubusercontent.com/abhigyanpatwari/GitNexus/main/LICENSE | PolyForm Noncommercial source is not an implementation source. |

**Alternatives considered**:

- Inspecting GitNexus source or UI to improve fidelity: rejected by FR-026 and FR-053.
- Omitting parity matrix: rejected by FR-049.

## Decision R4: Add A Same-Origin Chat Adapter Over SPEC-018

**Decision**: Add `/api/chat/*` same-origin server routes as a thin adapter over SPEC-018. The browser sends repo id, user prompt, and selected symbol/view hints only. The backend assembles bounded graph context, invokes SPEC-018 `generate()` where configured, exposes fallback or pending-bundle states honestly, and returns context-boundary metadata.

**Rationale**: SPEC-018 already owns endpoint, agent-bundle, dormant, misconfigured, fallback, and provider-secret behavior. Reusing it keeps provider URL/model/key material backend-only through `CODEGRAPH_LLM_*` and prevents browser-side provider SDKs or direct provider calls.

**Alternatives considered**:

- Browser-side provider SDK: rejected because it exposes provider configuration/secrets and violates FR-020, FR-043, and FR-047.
- Separate LLM implementation in `src/server/`: rejected because SPEC-018 is the existing LLM layer.
- Persisted chat transcript storage: rejected as out of scope; browser can keep transient UI state only.

## Decision R5: Package `web/dist` Into `dist/web` And Preserve `/api/*`

**Decision**: Build the SPA into `web/dist`, copy it to `dist/web` during root asset copying, and let `codegraph serve --web` serve packaged assets through the existing static mount. `/api/*` remains API-only; extensionless browser routes fall back to the SPA shell; missing asset-extension routes 404.

**Rationale**: `src/server/static.ts` already defines safe path containment, placeholder behavior when assets are absent, exact missing-asset 404s, and SPA fallback for extensionless routes. SPEC-006 should replace the placeholder with packaged assets while preserving that contract.

**Alternatives considered**:

- CDN-hosted assets: rejected by local-first and offline/no-CDN requirements.
- Separate dev server in production: rejected because users need `codegraph serve --web`.
- Swallowing unknown `/api/*` through the SPA fallback: rejected because API errors must remain API error envelopes.
