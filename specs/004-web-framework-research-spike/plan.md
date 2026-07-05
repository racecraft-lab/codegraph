# Implementation Plan: Web Framework Research Spike

**Branch**: `004-web-framework-research-spike` | **Date**: 2026-07-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-web-framework-research-spike/spec.md`

## Summary

SPEC-004 is a docs/process research spike that chooses CodeGraph's future self-hosted web stack and proves the graph-rendering path before production web work starts. The implementation will evaluate the six roadmap candidates, apply local-first hard gates, score only gate-passing candidates with UX as the leading weighted criterion, build one throwaway prototype in the chosen stack, and commit only the decision document plus small screenshot evidence.

No production web code is in scope. Any prototype source must live in a temporary workspace and be represented in the repository only through reproduction notes and PNG screenshots.

## Technical Context

**Language/Version**: TypeScript/Node project with npm scripts. Repository runtime supports Node `>=20 <25`; from-source SQLite use depends on Node 22.5+ through `node:sqlite`.

**Primary Dependencies**: Existing npm toolchain. Research candidates: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart. Graph-rendering library candidates must be evaluated under the same offline/permissive policy before the throwaway prototype is built.

**Storage**: Existing local `.codegraph/` SQLite store only. SPEC-004 may read or export representative graph data for prototype evidence but must not change the SQLite schema or extraction/retrieval behavior.

**Testing**: `npm run build` and `npm test` are the build/test floor. UAT additionally requires local browser screenshot capture for representative self-repo data and the 1k-node target or closest documented fallback.

**Target Platform**: Local-first, package-shipped web assets served by CodeGraph in later specs, plus a standalone container recipe for deploy-anywhere users. SPEC-004 must record the asset classes that later specs need to ship, including JS, CSS, images, fonts, workers, WASM, and graph-renderer assets; the expected package destination such as `dist/web/`; later `copy-assets` and npm-package implications; and the same local-only asset/data path for the standalone container.

**Dormant-by-default handoff**: SPEC-004 does not enable web runtime behavior. Later web behavior must not start automatically, must not be default-on through config or feature flags, and must not introduce runtime network dependencies in unconfigured clones. SPEC-005 must choose or explicitly defer the activation path, such as `codegraph serve`, a config option, or another serve mode.

**Project Type**: Docs/process research spike with a throwaway local browser prototype.

**Performance Goals**: Demonstrate graph rendering with representative CodeGraph data from this repository and a 1k-node target. Record node/edge count, first visible render timing, interaction observations, machine/browser context, and any fallback if the target is missed.

**Constraints**: No production code. No non-permissive or source-available-only dependencies. No CDN or runtime hosted services. The runtime dependency ban covers framework runtime, graph renderer, fonts, icons, images, workers, WASM, telemetry, auth, data loading, and optional integrations. Implementation-time research may use official docs, package registries, and repositories, but the selected shipped runtime path must start and operate offline from package-shipped or locally generated assets. No changes to extraction, retrieval, MCP, SQLite schema, installer behavior, release flow, or build/copy wiring.

**Scale/Scope**: Six framework candidates, one selected-stack prototype, one decision document, small PNG evidence assets, and planning artifacts for later web specs.

**Reviewability Budget**: Primary surface is docs/process. Secondary surface is screenshot evidence assets. Projected reviewable LOC is 250-500 documentation lines excluding PNG assets. Projected production files: 0. Projected total files: 4-8. Budget result: within budget. Split decision: no split; production implementation remains deferred to SPEC-005, SPEC-006, and SPEC-007.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / Gate | Status | Evidence in this plan |
|------------------|--------|-----------------------|
| I. Think Before Coding | PASS | Unknown current facts are routed to official-doc and live-metadata research steps instead of guessed values. |
| II. Simplicity First | PASS | One chosen-stack prototype only; no reusable prototype framework or production app shell. |
| III. Surgical Changes | PASS | Durable changes are limited to spec planning artifacts, `CLAUDE.md` context, and later docs/assets under `docs/design/`. |
| IV. Goal-Driven Execution | PASS | Success is defined by candidate coverage, hard-gate evidence, weighted scoring, screenshots, reproduction notes, and self-repo UAT. |
| V. Deterministic, LLM-Free Extraction | PASS | No extraction or graph-structure changes; representative data is exported from existing CodeGraph output. |
| VI. Retrieval Performance | PASS | Retrieval/MCP behavior is explicitly out of scope. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | Web capabilities remain dormant and opt-in: zero production behavior change, no automatic server startup, no default-on config/feature flag, and no runtime network dependency in unconfigured clones. Candidates and graph libraries must run offline with permissive pure JS/WASM dependencies. |
| Reviewability budget | PASS | 0 production files, 4-8 total durable files, docs/process primary surface. |

No complexity-tracking exception is needed.

## Design Concept Decisions Used

The implementation must quote and carry forward these setup decisions in `docs/design/web-framework-decision.md`:

- Q2 user answer: "UX first."
- Q3 user answer: "Hard gates."
- Q4 user answer: "Chosen stack only."
- Q5 user answer: "Embedded plus container."
- Q6 user answer: "Offline permissive."
- Q7 user answer: "Record results, with browser-tool screenshots added to the report."
- Q8 user answer: "Official plus live."
- Q9 user answer: "Screenshots plus notes."
- Q10 user answer: "Commit PNGs."

Operational interpretation: UX leads the weighted score only after local-first, self-hosting, offline/package-shipping, hosted-service avoidance, permissive-license, package-footprint, and maintenance-health gates pass.

## Candidate Matrix Plan

The implementation will build the final matrix in `docs/design/web-framework-decision.md` with one row per roadmap option:

| Candidate | Serving mode to verify | Required official evidence | Required live metadata | Gate result | Weighted score |
|-----------|------------------------|----------------------------|------------------------|-------------|----------------|
| Vite+React SPA | Static assets served locally by CodeGraph; container serves same build | Vite production build/static serving docs; React docs | npm version/license/footprint; repo activity/release health | Fill during implementation | Score only if gates pass |
| SvelteKit static/adapter-node | Static adapter and/or local Node adapter | SvelteKit adapter docs | npm version/license/footprint; repo activity/release health | Fill during implementation | Score only if gates pass |
| Next.js standalone | Standalone output served in local/container mode | Next.js standalone/deployment docs | npm version/license/footprint; repo activity/release health | Fill during implementation | Score only if gates pass |
| Astro islands | Static build with local interactive islands | Astro build/islands docs | npm version/license/footprint; repo activity/release health | Fill during implementation | Score only if gates pass |
| TanStack Start | Local self-hosted build path | TanStack Start deployment/build docs | npm version/license/footprint; repo activity/release health | Fill during implementation | Score only if gates pass |
| SolidStart | Local self-hosted build path | SolidStart deployment/build docs | npm version/license/footprint; repo activity/release health | Fill during implementation | Score only if gates pass |

## Hard Gates

Each gate is pass/fail. A candidate that fails any gate is excluded from final weighted ranking and documented with evidence.

| Gate | Pass threshold |
|------|----------------|
| Self-host anywhere | Official docs show a local static or Node/container serving path that does not require a proprietary platform and can be reconciled with the future SPEC-005 `codegraph serve` local HTTP server/static mount. |
| Offline/package-shipped assets | Production UI can run with npm package-shipped JS, CSS, images, fonts, workers, WASM, graph-renderer assets, and locally generated CodeGraph data; no required CDN or externally hosted asset fetches at runtime. |
| No hosted-service runtime dependency | Startup, routing, graph rendering, auth posture, telemetry posture, optional integrations, and data loading work without hosted SaaS, cloud functions, hosted databases, hosted auth, remote telemetry, or remote asset services. |
| Permissive license | Framework, selected graph renderer, and required runtime dependencies are MIT/Apache-2/BSD/ISC or similarly permissive; no GPL/AGPL, source-available-only, or unclear runtime dependency. |
| Package footprint | Minimal candidate build plus selected graph renderer is plausibly package-shippable; implementation must measure compressed and uncompressed production asset size for JS, CSS, images, fonts, workers, WASM, and graph-renderer assets, then record any candidate whose required shipped footprint exceeds the SPEC-004 threshold chosen in the decision doc. |
| Maintenance health | Package/repository is not archived or deprecated, has a release or meaningful commit activity within the last 12 months, and has no current maintainer warning that would make it unsafe as CodeGraph's base stack. |

## Weighted Scoring Model

Only gate-passing candidates are scored. Use a 0-5 score per criterion, multiply by weight, and report the total out of 100.

| Criterion | Weight | Measurement guidance |
|-----------|--------|----------------------|
| UX and graph-interaction fit | 35 | Evidence-backed fit for CodeGraph graph browsing, decomposed into graph browsing ergonomics, discoverability, visual clarity, and interaction fit. |
| Deployment effort | 20 | Simplicity of embedded static assets and standalone container recipe. |
| Developer experience | 15 | TypeScript ergonomics, build/debug simplicity, documentation quality, and fit with CodeGraph's npm workflow. |
| Cost/self-host operations | 10 | Ability to run without paid services and with minimal runtime process complexity. |
| Footprint | 10 | Production asset size, runtime dependency size, and package-shipping impact after gates pass. |
| License and maintenance risk | 10 | Residual risk among permissive, maintained options: dependency clarity, release cadence, and ecosystem stability. |

UX is intentionally the largest weighted score, but it cannot override a failed hard gate.

UX scoring must be recorded as a sub-score table in `docs/design/web-framework-decision.md` so the result is measurable instead of impressionistic:

| UX subcriterion | Required evidence |
|-----------------|-------------------|
| Graph browsing ergonomics | Prototype or official-doc evidence for pan/zoom, selecting or focusing a node, inspecting details on demand, and expanding or navigating a neighborhood. Record observed responsiveness or limitation notes for representative self-repo data and the 1k-node target or fallback. |
| Discoverability | Evidence that primary graph actions, current view/status, selected node, and available navigation or search affordances are visible or described without relying on a long tutorial. |
| Visual clarity | Screenshot or prototype notes showing readable labels or summaries, distinguishable node/edge states, visible graph structure, and sufficient contrast for text and graph elements used to understand the screenshot. |
| Interaction fit | Evidence that the stack can support the future SPEC-006 graph-browser tasks: overview, zoom/filter, details on demand, relationship tracing, and carrying UI state through local routes or equivalent state handling. |

Each UX sub-score must cite at least one evidence source or measurement. Terms such as "modern", "polished", "user-friendly", "readable", or "clean" must be backed by the cited evidence or omitted.

## Research Steps

1. Gather official documentation for each framework candidate covering production build, self-hosting, static/standalone output, routing, asset loading, and deployment model.
2. Gather live metadata for each candidate and any graph-rendering library under consideration: current npm version, license, dependency posture, unpacked/package footprint, repository URL, latest release or commit activity, archive/deprecation status, maintainer warnings, captured observed value, lookup method/tool/path, source URL, access date, and the gate, score, or claim supported.
3. Record every source with captured value, access date, source URL, lookup method, and supported decision claim in `docs/design/web-framework-decision.md`; bare links are not sufficient evidence.
4. Apply hard gates before scoring. If official docs and live metadata conflict, record both and prefer the more restrictive interpretation unless the project can reproduce the safer path locally.
5. Score only the candidates that pass every hard gate.
6. Select exactly one stack and document runner-up tradeoffs, downstream implications for SPEC-005/SPEC-006/SPEC-007, and rejected alternatives.

## Shipping and SPEC-005 Handoff Requirements

The decision document must make the later implementation boundary explicit without implementing it in SPEC-004.

### Embedded package-shipped static assets

The embedded asset strategy must record:

- Required shipped asset classes: framework JS, CSS, images, fonts/icons, graph-renderer assets, web workers, WASM, and any generated asset manifest.
- Expected later build source and package destination, such as SPEC-006 `web/` output copied into `dist/web/` or an equivalent package-shipped directory.
- Later build/copy implications for `copy-assets`, npm package contents, and fail-loud behavior when static assets are absent. SPEC-004 must not change these scripts.
- How SPEC-005 should serve the assets from the installed package, including cache policy assumptions, static file lookup, and SPA or route fallback behavior.
- How the browser app should reach local graph data through the SPEC-005 local API rather than bundled remote data or hosted services.

### SPEC-005 local HTTP server boundary

The handoff must distinguish these modes:

- Primary embedded mode: SPEC-005 `codegraph serve` serves package-shipped static assets and local `/api/*` endpoints from one local process.
- Activation boundary: SPEC-005 must define the explicit opt-in path before any web behavior can run, such as a command, config setting, or serve mode. If SPEC-004 cannot choose that path, the decision document must map the unresolved activation decision to SPEC-005 or a named follow-up.
- API boundary: SPEC-005 owns REST/SSE endpoints for repos, search, nodes, impact, graph neighborhoods, status, and reindex jobs; SPEC-004 only records assumptions needed by the web stack decision.
- Route fallback: non-API browser routes should fall back to the app shell when the selected stack needs client-side routing; `/api/*` and static-asset misses must not be swallowed by the app fallback.
- Data source: graph data comes from the local CodeGraph index and locally generated exports for the prototype, not from hosted databases or remote APIs.
- Optional framework server mode: if a candidate requires its own Node/server middleware in production, the decision document must explain how it coexists with or conflicts with SPEC-005's Node HTTP/router plan. Unresolved conflict is a hard-gate risk or rejection rationale.
- Container-only serving mode: if the container path differs from embedded serving, the decision document must name the difference and explain why the embedded npm path still remains acceptable.

### Standalone container recipe

The standalone container recipe must include:

- Runtime entrypoint, such as a future `codegraph serve` command, and whether it runs the same static assets/API path as embedded mode.
- Served asset source inside the image.
- Local data/index assumptions, including expected `.codegraph/` mount or generated-index workflow.
- Host, port, environment variable, and token assumptions, including default loopback/local behavior and non-loopback auth expectations inherited by SPEC-005.
- Offline startup behavior and explicit no hosted-service/CDN runtime dependency.
- Any container-specific limitation or deferred work mapped to SPEC-005, SPEC-006, SPEC-007, or a named follow-up.

## Prototype Method

Build one throwaway prototype in the selected stack only. The prototype workspace must live outside the durable source tree, for example under `/tmp/spec-004-web-prototype` or an ignored scratch path. Do not commit prototype source.

The prototype data shape must be documented and should use this minimum structure:

```json
{
  "metadata": {
    "source": "codegraph repository",
    "generatedAt": "ISO-8601 timestamp",
    "nodeCount": 1000,
    "edgeCount": 0,
    "selection": "representative self-repo subset or 1k-node target"
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

Prototype evidence must include:

- A representative self-repo graph view generated from this repository.
- A 1k-node target view, or the closest achieved fallback with blocker and downstream implication.
- Browser screenshot capture using the required fallback ladder: preferred browser automation first; local Playwright or equivalent local browser capture second; documented no-screenshot failure third. A no-screenshot failure must record commands attempted, tool or environment limitation, dataset identity, node/edge counts if available, target viewport or dimensions attempted, prototype render/output notes, reviewer-readable substitute evidence, and downstream impact. Missing screenshots must not silently weaken SC-004.
- Interaction notes for graph browsing ergonomics: pan/zoom, node selection or focus, details on demand, expand-neighborhood or relationship traversal, visible status/legend/search affordances, and any control that is missing or deferred.
- Performance and reproduction notes: commands, browser, machine context, node/edge counts, first visible render timing, interaction notes, asset size, screenshot readability notes, and limitations.

## Artifact Layout

Durable implementation artifacts:

```text
docs/design/web-framework-decision.md
docs/design/assets/spec-004/
├── self-repo-graph.png
└── one-k-node-target.png
```

Optional additional PNGs may be committed only if they clarify a concrete gate or prototype result. Prototype source, generated `node_modules`, build output, and temporary JSON exports must not be committed.

The decision document must include: executive recommendation, design-concept quotes, candidate matrix, hard-gate results, weighted scoring with UX sub-scores, selected stack, selected graph-rendering library, shipping strategy, embedded asset inventory and later copy/build implications, standalone container recipe, SPEC-005 static-serving/API/route-fallback handoff, prototype method, screenshot references and captions, self-repo UAT result, reproduction steps, known risks, and deferred work mapped to SPEC-005/SPEC-006/SPEC-007.

## Self-Repo UAT

The implementation UAT must exercise representative CodeGraph data from this repository:

1. Build the project with `npm run build`.
2. Run the existing test floor with `npm test`.
3. Ensure this repository has a healthy local CodeGraph index or generate one with the documented local workflow.
4. Export or transform representative graph nodes/edges from this repository into the prototype data shape without schema changes.
5. Run the selected-stack prototype locally with no CDN or hosted-service runtime dependency.
6. Capture and commit PNG screenshots for representative self-repo data and the 1k-node target or fallback.
7. Record outcome, commands, counts, timing, browser/tooling path, screenshot dimensions/readability, graph interaction observations, and limitations in `docs/design/web-framework-decision.md`.

## Project Structure

### Documentation (this feature)

```text
specs/004-web-framework-research-spike/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── decision-artifacts.md
└── tasks.md                 # Created later by /speckit-tasks
```

### Durable repository artifacts from implementation

```text
docs/design/
├── web-framework-decision.md
└── assets/
    └── spec-004/
        ├── self-repo-graph.png
        └── one-k-node-target.png
```

**Structure Decision**: SPEC-004 stays in the documentation/process layer. No production files under `src/`, `web/`, `tests/`, `src/mcp/`, `src/db/`, `src/extraction/`, `src/resolution/`, or `src/installer/` are planned.

## Complexity Tracking

No constitution violations require justification.
