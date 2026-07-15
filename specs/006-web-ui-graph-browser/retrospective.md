---
feature: SPEC-006 Web UI: Graph Browser
branch: 006-web-ui-graph-browser
date: 2026-07-15
completion_rate: 100
spec_adherence: 100
requirements_total: 79
implemented: 79
partial: 0
not_implemented: 0
critical_findings: 0
significant_findings: 0
minor_findings: 2
positive_findings: 3
---

# SPEC-006 Retrospective

## Executive Summary

SPEC-006 completed 96/96 tasks and implements the planned self-hosted web graph
browser: repository status, search, symbol relationships, graph canvas, impact,
re-analysis progress, chat adapter/UI, package serving, offline/no-CDN behavior,
accessibility, mobile layout, and clean-room GitNexus parity evidence.

No critical or significant spec drift was found. The main process caveat is
reviewability: the greenfield web app is larger than the original warning
estimate, but it remains a cohesive one-navigable-PR feature with explicit review
order and full verification.

## Proposed Spec Changes

None. No `spec.md` changes are proposed.

## Requirement Coverage Matrix

| Requirement group | Status | Evidence |
|---|---|---|
| FR-001-FR-004, FR-031-FR-038 repo shell, status, state taxonomy, mobile, accessibility | Implemented | T014-T029, T085-T088; `web/src/tests/repository-status.spec.ts`, `accessibility.spec.ts`, `mobile-layout.spec.ts` |
| FR-005-FR-010 search, symbol detail, relationships, flows, degraded states | Implemented | T030-T048; `search-api.test.ts`, `search-symbol.test.tsx`, `relationships-panel.test.tsx`, `catalog-api.test.ts` |
| FR-011-FR-014 graph explorer, controls, summaries, truncation | Implemented | T049-T058; `graph-view.test.tsx`, `graph-uat.spec.ts`, Playwright MCP canvas evidence |
| FR-015-FR-016 impact radius and limitation disclosure | Implemented | T059-T065; `impact-api.test.ts`, `impact-route.test.tsx`, Playwright MCP impact evidence |
| FR-017-FR-019, FR-045-FR-046 re-analysis, SSE, duplicate prevention, errors | Implemented | T066-T073, T095; `server-reindex-jobs.test.ts`, `reindex-panel.test.tsx` |
| FR-020-FR-023, FR-041-FR-044 chat and provider-secret boundary | Implemented | T074-T084; `server-chat-adapter.test.ts`, `chat-panel.test.tsx`, `chat-network.spec.ts` |
| FR-024, FR-047, FR-052 package/static local serving | Implemented | T006, T019-T020, T085, T090, T094; `package-web-assets.test.ts`, `package-offline.spec.ts` |
| FR-025-FR-026, FR-049-FR-053 clean-room GitNexus parity | Implemented | `research.md`, `review-packet.md`, clean-room ledger |
| FR-027-FR-030 Vite, Tailwind, shadcn/ui, renderer bake-off | Implemented | T001-T004, T052; `web/components.json`, Tailwind config, Cytoscape selection in `research.md` |
| FR-054-FR-060 accessibility/reflow/reduced-motion/performance | Implemented | T086-T088; `accessibility.spec.ts`, `performance.spec.ts`, `mobile-layout.spec.ts` |
| NFR-001-NFR-006 and SC-001-SC-013 | Implemented | `performance.spec.ts`, Playwright e2e, package/offline tests, MCP UAT |

Spec adherence calculation: `(79 implemented / 79 total) * 100 = 100%`.

## Success Criteria Assessment

- App starts on the product surface: passed through Playwright CLI and MCP.
- Vite + React + Tailwind + shadcn app under `web/`: passed.
- Runtime assets are package-shipped and local: passed through build, package
  asset tests, and no-CDN Playwright coverage.
- UI consumes local API contracts for repository, search, symbol, relationship,
  graph, impact, flow, cluster, and re-analysis workflows: passed.
- Chat stays same-origin and backend-routed through SPEC-018 boundary: passed.
- GitNexus parity is clean-room behavior-level only: passed.
- Build copies `web/dist` into `dist/web`: passed.
- Desktop/mobile, graph canvas nonblank, accessibility, and offline checks:
  passed.

## Architecture Drift

| Area | Planned | Actual | Drift |
|---|---|---|---|
| Frontend stack | Vite React TypeScript, Tailwind, shadcn/ui | Implemented under `web/` | None |
| Graph renderer | Select after Cytoscape/Sigma bake-off | Cytoscape selected and implemented | None |
| Backend scope | Static package integration plus minimal chat adapter | Implemented `src/server/chat.ts`, route wiring, OpenAPI docs, package copy | None |
| Re-analysis | Existing SPEC-005 REST/SSE contracts | Implemented client/UI over existing contracts and extended server tests | None |
| Chat secrets | Backend-only provider config | Browser sends same-origin requests only; no provider keys rendered | None |
| Browser indexing/Cypher | Out of scope/deferred | Not implemented | None |

## Deviations

### Minor

1. **Reviewability size warning**
   - Evidence: `specs/006-web-ui-graph-browser/.process/emission/reviewability-diff-gate.md`
   - Cause: greenfield web app plus lockfile dependency churn.
   - Recommendation: keep the PR review order and consider code-splitting in a
     future performance slice if bundle growth continues.

2. **Configured real-provider chat not exercised with live credentials**
   - Evidence: `specs/006-web-ui-graph-browser/.process/emission/self-review.md`
   - Cause: local-first secret boundary and no provider credentials used in this
     run.
   - Recommendation: validate configured-provider chat in a secure operator
     environment when provider credentials are intentionally available.

### Positive

1. **Playwright MCP caught a real re-analysis terminal recovery bug**
   - Fix: `web/src/routes/ReindexRoute.tsx` now polls latest job state after
     EventSource disconnect and renders terminal `done`.
   - Reuse: keep MCP browser UAT in future UI autopilot plans.

2. **Full root suite was made part of final evidence**
   - Result: `npm test` passed with 233 files, 3,922 passed, 7 skipped.
   - Reuse: run listener/socket-heavy tests outside the sandbox when EPERM
     blocks them inside the managed sandbox.

3. **Clean-room parity stayed explicit**
   - Result: `research.md` and `review-packet.md` keep GitNexus parity at
     behavior-level README/LICENSE inventory only.
   - Reuse: use the same ledger pattern for future parity-inspired UI work.

## Constitution Compliance

- Think before coding: pass. Renderer, shadcn style, chat, package, and
  clean-room parity decisions are documented in plan/research/workflow artifacts.
- Simplicity first: pass. Backend additions are limited to static package seams
  and the minimal chat adapter.
- Surgical changes: pass with warning. The change is large but contained to the
  planned web workspace, server/package seams, tests, and docs.
- Goal-driven execution: pass. Each user story has focused tests plus Playwright
  CLI and MCP UAT evidence.
- Local-first privacy/dormancy: pass. Chat dormant/provider-secret boundaries
  and no external runtime requests were tested.

Constitution violations: none.

## Unspecified Implementations

None requiring spec change. Minor implementation details such as package-local
favicon metadata, generated web `.gitignore`, and terminal snapshot polling are
within the planned package/offline and re-analysis state requirements.

## Task Execution Analysis

- Total tasks: 96
- Completed tasks: 96
- Completion rate: 100%
- Phantom task verification: passed, 96 verified, 0 flagged.
- Implementation commit: `4df3b13`
- Post-implementation process: integration, reviewability, self-review, UAT
  deferred record, and PR packet boundary evidence were recorded.

## Lessons Learned And Recommendations

1. Keep Playwright MCP browser UAT as a mandatory UI autopilot gate after code
   review fixes, not only before review.
2. Record reviewability stats with both tracked and untracked worktree files
   before committing a greenfield app.
3. Add an upstream packet-emission capability before expecting autopilot to open
   PRs automatically; current installed workflow correctly fails closed without
   a feature-local packet.
4. For full CodeGraph verification, run listener/socket-heavy root tests outside
   the managed sandbox when sandbox EPERM appears.

## File Traceability Appendix

- Server/package: `src/server/index.ts`, `src/server/chat.ts`,
  `src/server/openapi.yaml`, `scripts/copy-web-assets.mjs`, `package.json`.
- Web app: `web/src/app/`, `web/src/routes/`, `web/src/components/`,
  `web/src/lib/api/`, `web/src/lib/graph/`, `web/src/styles/globals.css`.
- Tests: `__tests__/server-chat-adapter.test.ts`,
  `__tests__/server-reindex-jobs.test.ts`,
  `__tests__/package-web-assets.test.ts`, `web/src/tests/`.
- Docs/evidence: `docs/web-server.md`, `README.md`, `CHANGELOG.md`,
  `specs/006-web-ui-graph-browser/review-packet.md`,
  `specs/006-web-ui-graph-browser/.process/emission/`.

## Self-Assessment Checklist

- Evidence completeness: PASS
- Coverage integrity: PASS
- Metrics sanity: PASS
- Severity consistency: PASS
- Constitution review: PASS
- Human Gate readiness: PASS, no spec changes proposed
- Actionability: PASS
