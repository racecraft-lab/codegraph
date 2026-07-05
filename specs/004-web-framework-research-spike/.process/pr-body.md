<!-- speckit-pro-review-packet-source: specs/004-web-framework-research-spike/.process/pr-packets/single.json -->

## Summary

<!-- speckit-pro-editable:summary:start -->
This PR implements: Add web framework research spike.
<!-- speckit-pro-editable:summary:end -->

Source: feature specification and changed-file scope.

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Added or updated the source spec, task, UAT, and review packet evidence for reviewer traceability.
- Updated roadmap, workflow, or repository guidance that tracks the feature state.
<!-- speckit-pro-editable:what_changed:end -->

Source: generated PR packet changed-file evidence.

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
Reviewers can evaluate the actual implementation, its verification evidence, and its scope limits without reverse-engineering the packet metadata.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

1. Start with the implementation files changed for this feature.
2. Review the focused tests and fixtures that prove the expected behavior and rejected-input paths.
3. Check the scope notes and UAT runbook to confirm deferred work is not being claimed here.

## How To UAT

Use the UAT runbook below for reviewer-facing acceptance checks. Treat installed-plugin, native-platform, and public-support claims as out of scope unless the runbook explicitly includes them.

## UAT Runbook

# SPEC-004 UAT Runbook

Status: Completed SPEC-004 UAT runbook with prototype, screenshot, verification, and final result evidence. Manual UAT was rerun on 2026-07-05.

## Purpose

Use this runbook to verify that SPEC-004 remains a docs/process research spike, chooses one local-first web stack from current evidence, proves graph rendering with representative CodeGraph data, and records the final UAT outcome as pass, pass with limitation, or fail.

## Required Paths

- Decision document: `docs/design/web-framework-decision.md`
- Temporary research and prototype workspace: `/tmp/spec-004-web-framework-research/`
- Temporary prototype source: `/tmp/spec-004-web-framework-research/prototype/`
- Temporary prototype data: `/tmp/spec-004-web-framework-research/data/`
- Screenshot assets: `docs/design/assets/spec-004/`
- Expected screenshots: `docs/design/assets/spec-004/self-repo-graph.png` and `docs/design/assets/spec-004/one-k-node-target.png`

Reproduction scope: the committed repo preserves the UAT result, data shape,
commands, and PNG evidence. It does not preserve the temporary export script,
screenshot script, prototype source, or generated data files. Reruns from a
clean checkout must recreate equivalent scratch files from the documented data
shape in `docs/design/web-framework-decision.md`, or treat this runbook as the
recorded UAT result.

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

Then review the documented local prototype commands from `docs/design/web-framework-decision.md`. Rerun them only when the temporary scratch files are still available or have been recreated from the documented data shape. Record exact commands and outcomes below when those tasks are reached.

## No Hosted Runtime Service Check

Record whether the selected framework stack and graph renderer require any runtime CDN, hosted asset, hosted auth, hosted database, cloud function, remote telemetry, SaaS endpoint, remote worker, or remote WASM fetch.

Expected result: No hosted runtime service is required. If any hosted runtime dependency is required, mark the UAT result as fail or pass with limitation and record the blocking risk in the decision document.

## Result Log

Completed during SPEC-004 tasks and rerun on 2026-07-05.

| Check | Command or method | Outcome | Evidence path or note |
|-------|-------------------|---------|------------------------|
| Build | `npm run build` | Pass | Build exited 0. |
| Test | `npm test` | Pass | 132 test files, 2,223 tests passed, 4 skipped. |
| Self-repo data export | `node dist/bin/codegraph.js index` under Node 22.22.2, then `/tmp/spec-004-web-framework-research/export-codegraph-data.mjs` | Pass | Worktree-local index: 404 files, 5,830 nodes, 23,848 edges in 2.4s. Self dataset: 220 nodes, 223 edges. |
| Prototype local run | `/tmp/spec-004-web-framework-research/prototype`, `npm install`, `npm install -D playwright`, `npx playwright install chromium`, `npm run build`, `npm run dev -- --port 4174` | Pass | Vite + React + Cytoscape.js prototype built and served locally. |
| Self-repo screenshot or fallback | `node capture-screenshots.mjs` with local Playwright Chromium | Pass | `docs/design/assets/spec-004/self-repo-graph.png`; 1440x960; first render 353 ms; 117 rAF ticks/sec. |
| 1k-node screenshot or fallback | `node capture-screenshots.mjs` with local Playwright Chromium | Pass | `docs/design/assets/spec-004/one-k-node-target.png`; 1440x960; first render 145 ms; 102 rAF ticks/sec. |
| No hosted runtime service | Playwright request audit against local Vite server and `/data/*.json` files | Pass | 12 browser requests, 0 non-local requests. Implementation-time package/doc access used network; selected runtime path did not require hosted services or CDN assets. |
| Final UAT result | Review decision doc, screenshots, and verification floor | Pass with limitation | Limitation: production large-graph UX, accessibility, search/filter/details polish, and WebGL runner-up validation remain SPEC-006 work. |
## Verification

- Run the focused and repository-level verification commands listed in the UAT runbook.
- Confirm generated packet validation passes before using this body for PR creation.

Source: generated PR packet.

## Scope

- Source feature: specs/004-web-framework-research-spike.
- Changed files recorded in packet metadata: 34.
- Scope: this PR implements Add web framework research spike.
- Traceability: source feature, rendered body, validation, and changed-file scope are recorded in the packet metadata.
- Non-goals: split PR emission, unrelated install/update behavior, and claims not covered by the UAT runbook.

## Known Gaps

Known accepted limitation: SPEC-004 proves framework and renderer feasibility with recorded local evidence, but production large-graph UX, accessibility, search/filter/details polish, and WebGL runner-up validation remain SPEC-006 work.
