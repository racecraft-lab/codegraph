# SPEC-004 Web Framework Decision

Status: Framework decision made from current-source research. Prototype evidence and final UAT results are recorded later in this document.

## Executive Recommendation

Selected framework stack: Vite + React SPA.

Selected graph-rendering approach: Cytoscape.js for the SPEC-004 throwaway prototype, with Sigma.js kept as the production-scale WebGL runner-up for SPEC-006 evaluation.

Rationale: Vite + React passes every local-first hard gate, has the simplest package-shipped static asset path, reuses the broadest React graph-rendering ecosystem, and avoids full-stack server abstractions that SPEC-004 deliberately defers. Cytoscape.js passes the renderer gates, ships as pure JavaScript with no external runtime dependencies, and provides graph-specific pan/zoom, selection, layouts, labels, JSON serialization, and interaction primitives.

## Scope And Non-Goals

Scope:

- Evaluate the six roadmap candidates: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart.
- Use official documentation plus current package and repository metadata before scoring.
- Apply hard gates before weighted scoring.
- Build one throwaway graph-rendering prototype only after a stack is selected.
- Commit only docs/process artifacts and small PNG evidence assets.

Non-goals:

- No production code.
- No production web UI, production server, in-browser indexing, LSP facade, WebSocket endpoint, extraction change, retrieval change, MCP change, SQLite schema change, installer change, release-flow change, or build/copy wiring change.
- No long-lived prototype source, generated web build output, or `node_modules` in the durable repo tree.
- No hosted-service runtime dependency, CDN runtime dependency, source-available-only dependency, or non-permissive dependency.

Prototype boundary:

- The prototype source must stay outside the durable repo tree, under `/tmp/spec-004-web-framework-research/prototype/` or another temporary scratch path.
- Durable evidence from the prototype is limited to notes in this document and small PNG assets under `docs/design/assets/spec-004/`.

## Design Concept Decisions

| Question | User answer | Setup interpretation |
|----------|-------------|----------------------|
| Q2 | UX first | UX is the leading weighted score only after hard gates pass. |
| Q3 | Hard gates | Local-first, offline, hosted-service, license, footprint, and maintenance gates are pass/fail. |
| Q4 | Chosen stack only | Build a prototype only for the selected stack. |
| Q5 | Embedded plus container | Record both npm package-shipped static assets and a standalone container recipe. |
| Q6 | Offline permissive | Runtime dependencies must be offline-capable and permissively licensed. |
| Q7 | Record results, with browser-tool screenshots added to the report | Do not commit prototype source; record commands, observations, and screenshots. |
| Q8 | Official plus live | Candidate claims need official docs and live package/repository metadata. |
| Q9 | Screenshots plus notes | Screenshot evidence must be paired with counts, tooling, performance, and limitations. |
| Q10 | Commit PNGs | Store screenshot assets under `docs/design/assets/spec-004/`. |

## Reviewability Budget

| Item | Budget |
|------|--------|
| Primary surface | Docs/process |
| Secondary surface | Screenshot evidence assets |
| Projected reviewable LOC | 250-500 documentation lines, excluding PNG assets |
| Projected production files | 0 |
| Projected total files | 4-8 |
| Budget result | Tasks gate reported a size-only block because the task list references broad evidence paths; final durable scope remains docs/process plus PNGs. |
| Split decision | No split. Atomicity route is `one-navigable-PR`; the PR should use review markers for decision rules, current-source research, prototype evidence, downstream handoff, and polish/verification. |

## Candidate Matrix

| Candidate | Serving mode verified | Official evidence | Live metadata captured 2026-07-05 | Gate result | Weighted score | Outcome |
|-----------|-----------------------|-------------------|---------------------------------|-------------|----------------|---------|
| Vite+React SPA | Static assets from `vite build`; local preview for build validation; later SPEC-005 static mount serves same assets | [Vite static deploy](https://vite.dev/guide/static-deploy), [React reference](https://react.dev/reference/react), [React app creation notes](https://react.dev/learn/creating-a-react-app) | `vite` 8.1.3 MIT 2,243,951 B; `react` 19.2.7 MIT 171,604 B; `react-dom` 19.2.7 MIT 7,319,413 B; `@vitejs/plugin-react` 6.0.3 MIT 39,937 B; `vitejs/vite` pushed 2026-07-04; `facebook/react` pushed 2026-07-02; no npm deprecation text observed | Pass | 94 | Selected |
| SvelteKit static/adapter-node | Static adapter output and Node adapter server path | [SvelteKit adapter-static](https://svelte.dev/docs/kit/adapter-static), [SvelteKit adapter-node](https://svelte.dev/docs/kit/adapter-node) | `@sveltejs/kit` 2.69.1 MIT 1,293,068 B; adapters MIT and small; repo pushed 2026-07-05; no npm deprecation text observed | Pass | 82 | Runner-up; good but less direct React renderer reuse |
| Next.js standalone | Standalone output and static export paths | [Next output standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [React framework notes](https://react.dev/learn/creating-a-react-app) | `next` 16.2.10 MIT 155,058,895 B; repo pushed 2026-07-05; no npm deprecation text observed | Fail: package footprint | Not scored | Rejected for local-first package footprint and unnecessary full-stack surface |
| Astro islands | Static pages with explicit interactive islands | [Astro islands](https://docs.astro.build/en/concepts/islands/), [Astro deploy](https://docs.astro.build/en/guides/deploy/) | `astro` 7.0.6 MIT 2,817,464 B; `@astrojs/react` 6.0.1 MIT 34,744 B; repo pushed 2026-07-04; GitHub API license `NOASSERTION`; no npm deprecation text observed | Pass with license metadata note | 84 | Strong runner-up; extra framework layer for a graph SPA |
| TanStack Start | Universal/full-stack React build path | [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview) | `@tanstack/react-start` 1.168.27 MIT 104,557 B; repo pushed 2026-07-04; official docs mark Release Candidate; no npm deprecation text observed | Fail: maintenance/stability gate | Not scored | Rejected until post-RC stability is proven |
| SolidStart | CSR/SSR/SSG build modes | [SolidStart overview](https://docs.solidjs.com/solid-start) | `@solidjs/start` 1.3.2 MIT 155,413 B; repo pushed 2026-07-04; no npm deprecation text observed | Pass | 76 | Rejected because ecosystem and renderer reuse are weaker for this product surface |

## Durable Evidence Records

| ID | Subject | Type | Observed value | Source or path | Method | Supported claim |
|----|---------|------|----------------|----------------|--------|-----------------|
| FW-VITE-DOC-001 | Vite static build | Official docs | Default output is `dist`; `npm run build` builds static output; `vite preview` serves built files locally for checking | https://vite.dev/guide/static-deploy | Browser docs review | Static/package-shipped serving gate |
| FW-REACT-DOC-001 | React browser app | Official docs | React DOM has browser-client APIs, and React docs list Vite as a build-tool path for custom React apps | https://react.dev/reference/react and https://react.dev/learn/creating-a-react-app | Browser docs review | DX and React renderer ecosystem claim |
| FW-SVELTE-DOC-001 | SvelteKit static/Node | Official docs | `adapter-static` creates static files; `adapter-node` creates a Node server build | https://svelte.dev/docs/kit/adapter-static and https://svelte.dev/docs/kit/adapter-node | Browser docs review | Self-host and deployment gates |
| FW-NEXT-DOC-001 | Next standalone | Official docs | Standalone output exists for self-hosting | https://nextjs.org/docs/app/api-reference/config/next-config-js/output | Browser docs review | Self-host gate |
| FW-ASTRO-DOC-001 | Astro islands/static | Official docs | Static HTML with hydrated client islands; deploy docs list static targets | https://docs.astro.build/en/concepts/islands/ and https://docs.astro.build/en/guides/deploy/ | Browser docs review | UX/footprint and static serving claims |
| FW-TANSTACK-DOC-001 | TanStack Start | Official docs | Release Candidate; full-stack React framework with SSR, streaming, server routes, server functions, and full-stack builds | https://tanstack.com/start/latest/docs/framework/react/overview | Browser docs review | Maintenance/stability and scope gate |
| FW-SOLID-DOC-001 | SolidStart | Official docs | Meta-framework with CSR, SSR, SSG; docs include API routes, middleware, sessions, WebSocket endpoint | https://docs.solidjs.com/solid-start | Browser docs review | Scope and ecosystem scoring |
| PKG-FW-001 | Framework npm metadata | Package metadata | Versions, licenses, unpacked sizes, repository URLs, and no deprecation text observed for all candidate framework packages listed in the matrix | `/tmp/spec-004-web-framework-research/*.md` | `npm view ... --json` on 2026-07-05 | License, footprint, maintenance gates |
| REPO-FW-001 | Framework repository metadata | Repository metadata | Recent pushes and license values captured for candidate repos; Astro GitHub license returned `NOASSERTION` while npm package license is MIT | `/tmp/spec-004-web-framework-research/*.md` | `gh api repos/...` on 2026-07-05 | Maintenance and residual risk scoring |
| REND-CY-DOC-001 | Cytoscape.js renderer | Official docs and metadata | Pure JS graph visualization/analysis library, MIT, no external dependencies, JSON serialization, layouts, selectors, gestures; `cytoscape` 3.34.0 MIT 5,696,647 B | https://js.cytoscape.org/ and `/tmp/spec-004-web-framework-research/graph-renderers.md` | Browser docs review, `npm view`, `gh api` | Renderer selection |
| REND-RUNNERS-UP-001 | Renderer alternatives | Official docs and metadata | React Flow, Sigma.js/Graphology, React Force Graph, and Force Graph all MIT; Sigma is WebGL-oriented runner-up; React Force Graph is much larger at 23,903,027 B | `/tmp/spec-004-web-framework-research/graph-renderers.md` | Browser docs review, `npm view`, `gh api` | Renderer bake-off rationale |

## Current-Source Evidence Schema

Every evidence record used for a gate, score, recommendation, prototype claim, or UAT result must include:

| Field | Required content |
|-------|------------------|
| Evidence ID | Stable local identifier, such as `FW-VITE-DOC-001` or `PROTO-SELF-001`. |
| Subject | Candidate, package, repository, renderer, prototype dataset, screenshot, or UAT result. |
| Source type | Official docs, package metadata, repository metadata, observed local value, prototype result, screenshot result, or UAT result. |
| Observed value | Captured fact, measured value, command result, or explicit missing/conflicting value. |
| Source URL or local path | URL for external source, or durable local path for prototype/UAT evidence. |
| Access date | Date checked in `YYYY-MM-DD` format. |
| Lookup method/tool/path | Browser, package manager, registry command, repository API, local command, or manual docs review path. |
| Supported claim | Specific gate, score, decision, screenshot claim, package-footprint claim, or UAT claim supported. |
| Conservative impact | Required when metadata is unavailable, stale, conflicting, or insufficient. Absence is not pass evidence. |

Bare links and uncaptured package-page observations are not evidence. Official documentation conflicts with live metadata must be recorded on both sides, and the stricter interpretation wins unless the safer path is reproduced locally.

## Hard Gates

Any failed gate excludes the candidate from final weighted ranking.

| Gate | Pass threshold | Applied result |
|------|----------------|----------------|
| Self-host anywhere | Official docs show a local static, Node, or container serving path that does not require a proprietary platform and can fit a future SPEC-005 local HTTP server/static mount. | Vite+React, SvelteKit, Next, Astro, SolidStart pass. TanStack Start is self-hostable but fails stability below. |
| Offline/package-shipped assets | Production UI can run from package-shipped JS, CSS, images, fonts/icons, workers, WASM, graph-renderer assets, and locally generated CodeGraph data with no required CDN or remote asset fetch. | Official docs and package metadata for the evaluated base packages did not identify a required CDN, remote asset fetch, hosted worker, or remote WASM dependency in the selected local/static serving paths. |
| No hosted-service runtime dependency | Startup, routing, graph rendering, auth posture, telemetry posture, optional integrations, and data loading work without hosted SaaS, cloud functions, hosted databases, hosted auth, remote telemetry, or remote assets. | The base framework paths and selected renderer do not require hosted SaaS, hosted auth, hosted database, cloud function, or remote telemetry at runtime. Optional hosted integrations are deferred risks for later specs, not part of the SPEC-004 pass decision. |
| Permissive license | Framework, selected graph renderer, and required runtime dependencies are MIT, Apache-2.0, BSD, ISC, or similarly permissive. GPL, AGPL, source-available-only, unclear, or incompatible runtime dependencies fail. | npm package licenses are MIT for all evaluated packages. Astro has a GitHub API `NOASSERTION` note but package-level license is MIT. |
| Package footprint | Base framework package path must stay plausibly package-shippable for a local CLI distribution. SPEC-004 used 30 MB unpacked as the hard-gate threshold for the primary framework package before app output and graph renderer. | Next fails at 155,058,895 B unpacked. Other primary packages pass. |
| Maintenance health | Package/repository is not archived or deprecated, has activity within the last 12 months, and has no current maintainer warning that makes it unsafe as the base stack. Release-candidate status fails for SPEC-004 base-stack adoption. | TanStack Start fails because official docs mark it Release Candidate. Others pass; npm deprecation fields returned no text. |

## Weighted Scoring Model

Only gate-passing candidates are scored. Use a 0-5 score per criterion, compute `score / 5 * weight`, and report the total out of 100.

| Candidate | UX/graph fit (35) | Deployment effort (20) | DX (15) | Cost/self-host ops (10) | Footprint (10) | License/maintenance risk (10) | Total |
|-----------|--------------------|------------------------|---------|--------------------------|----------------|-------------------------------|-------|
| Vite+React SPA | 32 | 20 | 15 | 10 | 8 | 9 | 94 |
| Astro islands | 29 | 17 | 13 | 10 | 8 | 7 | 84 |
| SvelteKit static/adapter-node | 27 | 17 | 12 | 10 | 8 | 8 | 82 |
| SolidStart | 24 | 15 | 11 | 10 | 8 | 8 | 76 |

Failed-gate candidates are not scored: Next.js standalone failed package footprint; TanStack Start failed the maintenance/stability gate.

Scoring interpretation:

- Vite+React wins because it is the smallest conceptual surface for a dormant local graph SPA, uses the strongest React graph-renderer ecosystem, and maps directly to package-shipped static assets without introducing a framework server.
- Astro is the strongest runner-up when content-heavy documentation pages and selective hydration dominate. For CodeGraph's first web surface, the graph view is the application rather than a content page with islands, so Astro adds a layer without improving the critical graph path.
- SvelteKit is viable but would require either Svelte-native renderer integration or wrappers around React/general JS graph libraries. That is acceptable, but it is not better than the direct React path for SPEC-006.
- SolidStart is technically capable and light, but the smaller ecosystem and meta-framework surface make it a weaker base for CodeGraph's first graph-heavy UI.

## UX Sub-Score Notes

| Candidate | Graph browsing ergonomics | Discoverability | Visual clarity | Interaction fit |
|-----------|---------------------------|-----------------|----------------|-----------------|
| Vite+React SPA | Strong: direct use of Cytoscape.js, Sigma.js, React Flow, or force-graph libraries | Strong: React ecosystem supports mature component/tooling patterns | Strong: renderer choice owns graph clarity rather than framework constraints | Strong: local routes/state can remain simple and explicit |
| Astro islands | Strong for content shell plus interactive graph island; weaker if the graph is the whole app | Strong for docs/content pages | Strong for mostly static pages | Good, but graph island is effectively a React/Solid/Svelte app inside Astro |
| SvelteKit | Good with Svelte-native or vanilla JS renderer integration | Good | Good | Good, but fewer off-the-shelf React graph components |
| SolidStart | Good with Solid/vanilla renderer integration | Good | Good | Medium: smaller ecosystem for graph tooling |

UX sub-scores:

| UX subcriterion | Evidence required |
|-----------------|-------------------|
| Graph browsing ergonomics | Prototype or official-doc evidence for pan/zoom, select/focus, details on demand, and expand or navigate neighborhood behavior. |
| Discoverability | Evidence that primary graph actions, selected state, view/status, and navigation/search affordances are visible or clearly available. |
| Visual clarity | Screenshot or prototype notes showing readable labels or summaries, distinguishable node/edge states, graph structure, and sufficient contrast. |
| Interaction fit | Evidence that the stack can support future SPEC-006 graph-browser tasks: overview, zoom/filter, details on demand, relationship tracing, and local route or state handling. |

Subjective terms such as "modern", "polished", "user-friendly", "readable", or "clean" must be backed by evidence or omitted.

## Graph Renderer Bake-Off

| Renderer | Evidence | Gate result | Fit | Outcome |
|----------|----------|-------------|-----|---------|
| Cytoscape.js | Official docs describe a graph visualization/analysis library, pure JS, MIT, no external dependencies, JSON serialization, layouts, selectors, gestures, and graph algorithms. npm 3.34.0, MIT, 5,696,647 B. Repo pushed 2026-06-30. | Pass | Best all-around match for graph browsing, labels, selection, pan/zoom, local JSON data, and low dependency risk. | Selected for prototype |
| Sigma.js + Graphology | Sigma docs describe graph drawing; npm packages MIT and combined unpacked size about 3.7 MB. Repo pushed 2026-06-09. | Pass | Strong WebGL runner-up for large graphs; requires more production UX work around data model and controls. | Runner-up for SPEC-006 |
| React Flow / XYFlow | React diagram library, MIT, 1,203,174 B. Repo pushed 2026-06-30. | Pass | Excellent for node-edge editors and workflow diagrams, less natural for dense force-directed code graphs. | Rejected for graph-density fit |
| Force Graph | MIT, 6,462,516 B. Repo pushed 2026-04-16. | Pass | Good vanilla force graph path, but less broad graph-analysis/control surface than Cytoscape.js. | Rejected |
| React Force Graph | MIT, 23,903,027 B. Repo pushed 2026-02-04. | Pass with footprint caution | Convenient React wrapper but too large for the initial package-shipped prototype path. | Rejected for footprint |

## Shipping Strategy

Embedded package-shipped static assets:

- Selected build path: Vite + React should produce static output with `vite build`, whose default output directory is `dist/`.
- Required asset classes: framework JS, CSS, images, fonts/icons, graph-renderer assets, web workers, WASM, and generated asset manifest if present.
- Later build source and package destination: SPEC-006 should own the durable `web/` source tree and copy the built static output into `dist/web/` or a selected package-shipped directory.
- Later `copy-assets` and npm-package implications: SPEC-004 records requirements only; SPEC-006 owns wiring and fail-loud packaging checks so npm packages cannot ship without the web assets.
- SPEC-005 serving expectation: a local opt-in command serves package assets and local `/api/*` graph endpoints from one local process; no web server starts by default.
- Route fallback: non-API browser routes may fall back to the app shell; `/api/*` and missing static assets must not be swallowed by app fallback.
- Data source: graph data comes from the local CodeGraph index or locally generated exports, not hosted databases or remote APIs.

Standalone container recipe to complete later:

- Runtime entrypoint: future explicit activation path, expected to be a SPEC-005 command such as `codegraph serve --web` unless SPEC-005 chooses another path.
- Served asset source: same package-shipped static assets used by embedded mode.
- Local data/index assumptions: mounted or generated `.codegraph/` data, with no remote database requirement.
- Host/port/configuration: default loopback binding for local use, explicit non-loopback opt-in for containers, configurable port, and auth expectations owned by SPEC-005.
- Offline behavior: startup and graph browsing must work without hosted runtime services or CDN assets.

## Prototype Method

- Build one throwaway prototype in the selected stack only.
- Keep source under `/tmp/spec-004-web-framework-research/prototype/` or another scratch path outside durable source.
- Use representative CodeGraph data from this repository and a separate 1k-node/60fps target or closest documented fallback.
- Run locally with package-shipped or locally generated assets only.
- Record commands, browser/tooling path, machine context, node/edge counts, first visible render timing, frame-rate or interaction-smoothness signal, interaction observations, asset size notes, screenshot readability notes, and limitations.

## Prototype Run Evidence

Prototype source stayed outside durable source at `/tmp/spec-004-web-framework-research/prototype/`. It used Vite + React + Cytoscape.js and local JSON data copied into the prototype's `public/data/` directory.

Commands run:

```bash
node dist/bin/codegraph.js init -i .
node /tmp/spec-004-web-framework-research/export-codegraph-data.mjs .codegraph/codegraph.db /tmp/spec-004-web-framework-research/data
cd /tmp/spec-004-web-framework-research/prototype
npm install
npm install -D playwright
npx playwright install chromium
npm run build
npm run dev -- --port 4174
node capture-screenshots.mjs
```

The local run used Node 22.22.2 from `nvm`; any Node runtime supported by CodeGraph's built CLI path and `node:sqlite` requirements should work for reproduction.

Observed local results:

| Evidence | Result |
|----------|--------|
| Worktree-local CodeGraph index | `codegraph init -i .` under Node 22.22.2 indexed 404 files, 5,830 nodes, and 23,848 edges in 2.3s. |
| Self-repo dataset | `/tmp/spec-004-web-framework-research/data/self-repo-graph.json`, 220 nodes and 223 edges, selected from `src/` file/class/interface/function/method/route/component nodes. |
| 1k target dataset | `/tmp/spec-004-web-framework-research/data/one-k-node-target.json`, 1,000 nodes and 2,500 edges from the worktree-local CodeGraph index. |
| Prototype install | `npm install` added 20 packages with 0 vulnerabilities; Playwright was installed as a temporary dev dependency for browser capture only. |
| Prototype build | `npm run build` passed; Vite reported `dist/index.html` 0.41 kB, CSS 1.39 kB gzip 0.64 kB, JS 630.81 kB gzip 199.44 kB, with the expected 500 kB chunk-size advisory. |
| Screenshot capture | Local Playwright Chromium capture at 1440x960. The bundled REPL Playwright package existed but had no cached Chromium binary, so the run used temporary prototype-local Playwright after `npx playwright install chromium`. |
| Self-repo render | First visible render 353 ms; frame signal 118 `requestAnimationFrame` ticks/sec. |
| 1k target render | First visible render 139 ms; frame signal 102 `requestAnimationFrame` ticks/sec. |

Prototype interaction observations:

- Pan and zoom worked in the Cytoscape canvas.
- Node selection highlighted the selected node and neighborhood.
- The side panel exposed selected node label, kind, file, and line when a node was clicked.
- The 1k-node view reached the roadmap target with a frame signal above 60 rAF ticks/sec in the capture window.
- The 1k-node grid layout is readable as a scale proof, not as final production visual design. SPEC-006 should evaluate Sigma.js/WebGL and production-specific layout/search/filter controls before large-graph UX is finalized.

## Prototype Data Shape

Minimum JSON shape:

```json
{
  "metadata": {
    "source": "codegraph repository",
    "generatedAt": "ISO-8601 timestamp",
    "nodeCount": 1000,
    "edgeCount": 0,
    "selection": "representative self-repo subset or 1k-node/60fps target"
  },
  "nodes": [
    {
      "id": "stable node id",
      "label": "display name",
      "kind": "function",
      "file": "src/example.ts",
      "line": 1
    }
  ],
  "edges": [
    {
      "source": "source node id",
      "target": "target node id",
      "kind": "calls",
      "provenance": "static"
    }
  ]
}
```

## Screenshot Evidence And Fallback Ladder

Expected assets:

- `docs/design/assets/spec-004/self-repo-graph.png`
- `docs/design/assets/spec-004/one-k-node-target.png`

Each screenshot reference must state dataset name, node and edge counts, capture tool, viewport or image dimensions, visible labels, graph structure, primary controls, focused or selected state if present, and frame-rate or interaction-smoothness signal.

Fallback ladder:

1. Preferred browser automation.
2. Local Playwright or equivalent local browser capture.
3. Documented no-screenshot failure.

A documented no-screenshot failure must record commands attempted, tool or environment limitation, dataset identity, node/edge counts if available, target viewport or dimensions attempted, prototype render/output notes, reviewer-readable substitute evidence, and downstream impact. Missing PNGs must not be silently treated as successful screenshot evidence.

Captured assets:

| Asset | Caption |
|-------|---------|
| `docs/design/assets/spec-004/self-repo-graph.png` | Self-repo CodeGraph subset, 220 nodes and 223 edges, captured by local Playwright Chromium at 1440x960. Visible labels include parser/extractor, CLI, and target-related source nodes. Primary controls show dataset switcher, pan/zoom graph canvas, selected-node panel, and metrics. Frame signal: 118 rAF ticks/sec. |
| `docs/design/assets/spec-004/one-k-node-target.png` | 1k-node/60fps target, 1,000 nodes and 2,500 edges, captured by local Playwright Chromium at 1440x960. The graph shows a dense 1k-node canvas with labels and colored node-kind groups. Primary controls show dataset switcher, graph canvas, metrics, and selected-node panel. Frame signal: 102 rAF ticks/sec. |

## Self-Repo UAT Criteria

Self-repo UAT must use representative CodeGraph data from this repository and record the final outcome as pass, pass with limitation, or fail in this document and `specs/004-web-framework-research-spike/.process/uat-runbook.md`.

Required checks:

1. `npm run build` succeeds from the repository root.
2. `npm test` succeeds from the repository root.
3. A healthy local CodeGraph index exists or is generated by the documented local workflow.
4. Representative nodes/edges from this repository are exported or transformed into the prototype data shape without schema changes.
5. The selected-stack prototype runs locally with no CDN or hosted-service runtime dependency.
6. Self-repo and 1k-node/60fps screenshots are captured or fallback evidence is recorded.
7. Outcome, commands, counts, timing, browser/tooling path, dimensions/readability, graph interaction observations, and limitations are recorded.

Final self-repo UAT result: pass with limitation. The prototype rendered representative CodeGraph data from the worktree-local index and met the 1k-node/60fps proof target. The limitation is that Cytoscape.js grid/CoSE layout and minimal controls are proof-only; production large-graph layout, search, filtering, accessibility, and WebGL runner-up validation remain SPEC-006 work.

Verification floor:

| Check | Result |
|-------|--------|
| `npm run build` | Passed. |
| `npm test` | Passed: 132 test files, 2,223 tests passed, 4 skipped. |

## No-Hosted-Runtime Check

For the framework runtime, graph renderer, fonts/icons, images, workers, WASM, telemetry, auth, data loading, and optional integrations, record:

- Whether any runtime network request is required.
- Whether any CDN, hosted asset, hosted auth, hosted database, cloud function, remote telemetry, or SaaS endpoint is required.
- Whether implementation-time research used network access separately from the selected shipped runtime path.
- Whether the runtime path can start and operate offline from package-shipped or locally generated assets.

Any required hosted runtime service or CDN fetch is a hard-gate failure or a blocking risk.

Result: pass. Runtime graph rendering used package-installed Vite, React, React DOM, Cytoscape.js, and local JSON assets. Implementation-time research and package installation used network access, but the selected runtime path loaded only local app files and `/data/*.json` from the local Vite server.

## Deferred Concerns

| Concern | Owner | Reason deferred |
|---------|-------|-----------------|
| Explicit web activation path and dormant-by-default serve mode | SPEC-005 | SPEC-004 records constraints but must not add runtime behavior. |
| Local HTTP server, static mount, `/api/*` endpoints, and route fallback | SPEC-005 | Server implementation is out of scope for this research spike. |
| Production web app, build output, asset manifest, and `copy-assets` wiring | SPEC-006 | SPEC-004 does not commit production web UI or build wiring. |
| Production graph-browser UX, search/filter/detail flows, and renderer limits | SPEC-006 | SPEC-004 only proves the selected rendering path with throwaway evidence. |
| Browser-side indexing constraints and offline execution implications | SPEC-007 | SPEC-004 records stack constraints only. |
| LSP facade or WebSocket endpoint | Named follow-up | Explicitly outside SPEC-004 and not required for the web-stack decision. |

## Durable Diff Boundary Check

Result: pass. The durable implementation artifacts are documentation/process files and PNG evidence assets only. No production server code, production web UI source, in-browser indexing, LSP facade, WebSocket endpoint, maintained prototype source, generated web build output, CDN runtime dependency, non-permissive dependency, source code under `src/`, or build/copy wiring change was introduced.

Durable evidence assets:

| File | Type | Size |
|------|------|------|
| `docs/design/assets/spec-004/self-repo-graph.png` | PNG, 1440x960 RGB | 321,231 bytes |
| `docs/design/assets/spec-004/one-k-node-target.png` | PNG, 1440x960 RGB | 1,368,663 bytes |

Temporary, non-durable prototype assets:

- `/tmp/spec-004-web-framework-research/*.md`
- `/tmp/spec-004-web-framework-research/data/*.json`
- `/tmp/spec-004-web-framework-research/prototype/`
- `.codegraph/` worktree-local index, ignored by git and used only for self-repo data export.

## Traceability Coverage

| Requirement or success criterion | Evidence | Status |
|----------------------------------|----------|--------|
| FR-001 to FR-007, SC-001 to SC-003 | Candidate matrix, durable evidence records, hard gates, weighted scoring, and executive recommendation. | Pass |
| FR-008 to FR-012, FR-014, SC-004 to SC-005 | Prototype run evidence, dataset export, screenshot captions, UAT result, and reproduction commands. | Pass with limitation: production UX is deferred. |
| FR-013, SC-007 to SC-008 | Shipping strategy, SPEC-005 handoff, standalone container recipe, and deferred concern mapping. | Pass |
| FR-015 to FR-018, SC-006 | Durable diff boundary check and no-hosted-runtime result. | Pass |

Known limitation: SPEC-004 proves stack and graph-rendering feasibility, not production graph-browser design quality. SPEC-006 must still design and validate large-graph layout, search/filter/detail flows, accessibility, and whether Sigma.js/WebGL should replace or complement Cytoscape.js for production-scale rendering.

## Review Packet Source

What changed:

- Added SPEC-004 SpecKit artifacts, checklists, tasks, and workflow state.
- Added `docs/design/web-framework-decision.md` with current-source framework research, hard gates, scoring, selected stack, renderer bake-off, shipping strategy, prototype evidence, screenshots, UAT result, traceability, and review notes.
- Added screenshot assets under `docs/design/assets/spec-004/`.
- Added `specs/004-web-framework-research-spike/.process/uat-runbook.md`.

Why it changed:

- SPEC-004 needed a grounded web-stack decision to unblock SPEC-005, SPEC-006, and SPEC-007 without prematurely adding production web behavior.

Review order:

1. Decision rules and non-goals.
2. Current-source research, hard gates, and weighted scoring.
3. Prototype evidence and screenshot assets.
4. Shipping/container/SPEC-005 handoff.
5. Traceability, verification, and known limitations.

Verification evidence:

- SpecKit gates G1-G6.5 passed.
- `npm run build` passed.
- `npm test` passed: 132 test files, 2,223 tests passed, 4 skipped.
- Worktree-local CodeGraph index succeeded under Node 22.22.2.
- Prototype screenshots were captured with local Playwright Chromium and inspected for nonblank output.

Rollback or feature-flag notes:

- No runtime feature flag is required because SPEC-004 adds no production behavior.
- Reverting the decision doc, screenshots, UAT runbook, and SpecKit artifacts removes the change. Future specs must not enable web serving by default without their own explicit activation path.
