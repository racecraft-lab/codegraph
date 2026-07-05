# Retrospective: SPEC-004 Web Framework Research Spike

Date: 2026-07-05

## Outcome

SPEC-004 completed as a docs/process research spike. The durable review artifact is `docs/design/web-framework-decision.md`, supported by two committed screenshot assets, a UAT runbook, generated SpecKit artifacts, task verification, marker-plan evidence, and a validated PR packet.

Recommended stack: Vite + React SPA.

Prototype renderer: Cytoscape.js, with Sigma.js carried forward as the SPEC-006 WebGL runner-up.

Final UAT result: pass with limitation. The limitation is intentionally downstream: production large-graph UX, accessibility, search/filter/details polish, and WebGL runner-up validation remain SPEC-006 work.

## Spec Adherence

| Area | Result | Evidence |
|------|--------|----------|
| Six framework candidates | Pass | Decision matrix covers Vite+React, SvelteKit, Next.js, Astro, TanStack Start, and SolidStart. |
| Current-source evidence | Pass | Candidate package/repository metadata and official documentation evidence are recorded with 2026-07-05 access context. |
| Hard gates before scoring | Pass | Next.js and TanStack Start are excluded before final ranking due hard-gate failures. |
| Selected stack proof | Pass | Throwaway Vite + React + Cytoscape prototype rendered self-repo and 1k-node datasets. |
| Screenshot evidence | Pass | `self-repo-graph.png` and `one-k-node-target.png` are committed under `docs/design/assets/spec-004/`. |
| Docs/process boundary | Pass | No production server code, production web UI source, in-browser indexing, LSP facade, WebSocket endpoint, build/copy wiring, or long-lived prototype source was added. |
| Downstream handoff | Pass | SPEC-005, SPEC-006, and SPEC-007 responsibilities are named in the decision document. |

## Verification

| Gate | Result |
|------|--------|
| Prerequisites and phase coverage | Pass |
| Verify tasks phantom check | Pass: 39 verified, 0 flagged |
| Diff hygiene and placeholder scan | Pass after removing workflow header trailing whitespace |
| Integration suite | Pass: `npm run build`, `npm run typecheck`, and `npm test` |
| Full tests | Pass: 132 files, 2,223 tests passed, 4 skipped |
| UAT runbook validation | Pass |
| PR packet validation | Pass |

## Reviewability

The tasks reviewability gate and final diff gate both exceeded raw size thresholds, but the block is size-only. The final backstop proceeded because the marker plan is contract-shaped, emission-ready, and fingerprint-matched.

Review order:

1. `foundation`: decision rules, UAT setup, reviewability setup.
2. `us1`: framework and renderer current-source research.
3. `us2`: prototype datasets, screenshots, and local verification evidence.
4. `us3`: downstream serving, packaging, container, and deferred-work handoff.

## Lessons

- The marker plan should be generated through `plan-layers.sh marker-plan` once the tasks reviewability gate and atomicity route are known; lightweight marker notes are not enough for the final backstop contract.
- Machine-readable gate evidence needs to match the written workflow interpretation. In this run, `tasks-gate.json` needed `is_size_only: true` because the workflow already treated the block as size-only marker-planning input.
- For completed runbooks, validation is safer than regeneration. Regenerating the UAT skeleton after implementation would have risked replacing completed evidence with placeholders.

## Follow-Up

- SPEC-005 should choose the explicit local activation path and static/API serving boundary.
- SPEC-006 should validate production graph-browser UX, accessibility, search/filter/details interactions, and the Sigma.js/WebGL runner-up.
- SPEC-007 should own browser-side indexing constraints and offline runtime behavior.
