# feat(SPEC-007): Add private in-browser indexing

## Summary

<!-- speckit-pro-editable:summary:start -->
Adds fully private browser-local indexing, graph exploration, impact analysis, persistence, degradation handling, and explicit semantic opt-in to the CodeGraph web UI.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Runs keyword indexing and graph queries in a Web Worker backed by browser-local SQLite WASM storage.
- Adds local graph lifecycle, persistence, deletion, corruption recovery, and capability-aware degradation states.
- Adds explicit HTTPS semantic search opt-in plus unit, integration, browser, performance, and package-boundary coverage.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
Users can inspect repositories in the browser without uploading source code, while preserving responsive interaction and making every network-capable semantic path explicit.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Start with specs/007-in-browser-indexing/spec.md, plan.md, and tasks.md for the requirement map.
- Review web/src/local-indexing for the worker, storage, lifecycle, and provider boundaries.
- Review web/src/app/state.tsx and the browser views for state integration and user-visible failure handling.
- Use the focused unit and Playwright suites to validate the critical lifecycle and privacy paths.

## How To UAT

1. Run npm --prefix web run test:e2e -- --project=chromium.
2. Confirm the suite reports 29 passed, 1 intentionally skipped, and 0 failed.
3. Inspect the self-repository performance result and confirm indexing stays below 60 seconds and p95 interactions stay below 150ms.
4. In the browser UI, delete the local graph and confirm the repository can be selected and indexed again without a network upload.

## UAT Runbook

1. Run npm --prefix web run test:e2e -- --project=chromium.
2. Confirm the suite reports 29 passed, 1 intentionally skipped, and 0 failed.
3. Inspect the self-repository performance result and confirm indexing stays below 60 seconds and p95 interactions stay below 150ms.
4. In the browser UI, delete the local graph and confirm the repository can be selected and indexed again without a network upload.

## Verification

- npm test: 262 files and 4670 tests passed; 15 files and 181 tests skipped.
- npm run build passed, including TypeScript and shipped web assets.
- npm --prefix web run test: 27 files and 210 tests passed.
- npm --prefix web run test:e2e -- --project=chromium: 29 passed, 1 intentionally skipped, 0 failed.
- Self-repository browser indexing completed twice in 7.64s and 5.99s with interaction latency below the 150ms budget.
- Specialized error-handling and type-design re-reviews returned NO FINDINGS.

## Scope

- Browser-local indexing, persistence, graph exploration, impact analysis, failure recovery, and semantic opt-in.
- Focused web integration plus generated browser artifacts listed in the packet scope evidence.

## Known Gaps

- The full directory-picker flow is Chromium-only; other supported browsers use archive selection.
- Semantic search requires an operator-configured HTTPS endpoint and is dormant by default.
- The implementation is intentionally large and routed as one navigable PR after a non-blocking reviewability warning.
