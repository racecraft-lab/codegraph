# SPEC-004 UAT Runbook

Status: Setup runbook for SPEC-004. Fill results during later research, prototype, and validation tasks.

## Purpose

Use this runbook to verify that SPEC-004 remains a docs/process research spike, chooses one local-first web stack from current evidence, proves graph rendering with representative CodeGraph data, and records the final UAT outcome as pass, pass with limitation, or fail.

## Required Paths

- Decision document: `docs/design/web-framework-decision.md`
- Temporary research and prototype workspace: `/tmp/spec-004-web-framework-research/`
- Temporary prototype source: `/tmp/spec-004-web-framework-research/prototype/`
- Temporary prototype data: `/tmp/spec-004-web-framework-research/data/`
- Screenshot assets: `docs/design/assets/spec-004/`
- Expected screenshots: `docs/design/assets/spec-004/self-repo-graph.png` and `docs/design/assets/spec-004/one-k-node-target.png`

## Pre-Flight

Run from the repository root.

1. Confirm the durable diff contains no production server code, production web UI code, in-browser indexing code, LSP facade, WebSocket endpoint, maintained prototype source, generated web build output, or build/copy wiring change.
2. Confirm `/tmp/spec-004-web-framework-research/` exists for temporary notes, data, and prototype source.
3. Confirm `docs/design/assets/spec-004/` exists for committed PNG evidence.
4. Confirm any network use is limited to implementation-time research. The selected runtime path must work from package-shipped or locally generated assets.

## Framework Decision Check

For each candidate:

1. Record official documentation evidence.
2. Record live package metadata: version, license, dependency posture, repository URL, package size or footprint signal, and package warnings.
3. Record repository metadata: archive/deprecation status, latest release or meaningful activity, license file, and maintainer warnings.
4. Apply every hard gate before assigning any weighted score.
5. Exclude failed-gate candidates from final weighted ranking.

Required candidates: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart.

## Prototype And Screenshot Check

1. Build the throwaway prototype only in the selected stack.
2. Keep prototype source under `/tmp/spec-004-web-framework-research/prototype/` or another temporary scratch path outside durable source.
3. Use representative CodeGraph data from this repository.
4. Include the 1k-node/60fps target or record the closest achieved fallback.
5. Capture screenshots with this ladder:
   - Preferred browser automation.
   - Local Playwright or equivalent local browser capture.
   - Documented no-screenshot failure.
6. For every screenshot or fallback, record dataset name, node count, edge count, capture tool, dimensions attempted or captured, visible graph details, interaction notes, timing or smoothness signal, and downstream impact.

## Local Verification Commands

Run the project floor before final UAT:

```bash
npm run build
npm test
```

Then run the documented local prototype commands from `docs/design/web-framework-decision.md`. Record exact commands and outcomes below when those tasks are reached.

## No Hosted Runtime Service Check

Record whether the selected framework stack and graph renderer require any runtime CDN, hosted asset, hosted auth, hosted database, cloud function, remote telemetry, SaaS endpoint, remote worker, or remote WASM fetch.

Expected result: No hosted runtime service is required. If any hosted runtime dependency is required, mark the UAT result as fail or pass with limitation and record the blocking risk in the decision document.

## Result Log

Fill during later SPEC-004 tasks.

| Check | Command or method | Outcome | Evidence path or note |
|-------|-------------------|---------|------------------------|
| Build | `npm run build` | Pass | Build exited 0. |
| Test | `npm test` | Pass | 132 test files, 2,223 tests passed, 4 skipped. |
| Self-repo data export | `codegraph init -i .` under Node 22.22.2, then `/tmp/spec-004-web-framework-research/export-codegraph-data.mjs` | Pass | Worktree-local index: 404 files, 5,830 nodes, 23,848 edges. Self dataset: 220 nodes, 223 edges. |
| Prototype local run | `/tmp/spec-004-web-framework-research/prototype`, `npm install`, `npm run build`, `npm run dev -- --port 4174` | Pass | Vite + React + Cytoscape.js prototype built and served locally. |
| Self-repo screenshot or fallback | `node capture-screenshots.mjs` with local Playwright Chromium | Pass | `docs/design/assets/spec-004/self-repo-graph.png`; 1440x960; first render 353 ms; 118 rAF ticks/sec. |
| 1k-node screenshot or fallback | `node capture-screenshots.mjs` with local Playwright Chromium | Pass | `docs/design/assets/spec-004/one-k-node-target.png`; 1440x960; first render 139 ms; 102 rAF ticks/sec. |
| No hosted runtime service | Prototype network path inspected by construction: local Vite server + local `/data/*.json` only | Pass | Implementation-time package/doc access used network; selected runtime path did not require hosted services or CDN assets. |
| Final UAT result | Review decision doc, screenshots, and verification floor | Pass with limitation | Limitation: production large-graph UX, accessibility, search/filter/details polish, and WebGL runner-up validation remain SPEC-006 work. |
