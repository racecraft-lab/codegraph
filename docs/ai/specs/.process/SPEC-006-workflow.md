# SpecKit Workflow: SPEC-006 - Web UI: Graph Browser

**Template Version**: 1.0.0  
**Created**: 2026-07-15  
**Purpose**: Execute SPEC-006 from scaffold through implementation on branch
`006-web-ui-graph-browser`.

---

## Design Concept

This workflow was enriched from a Grill Me interview run during
`$speckit-pro:speckit-scaffold-spec SPEC-006`.

Full Q&A, goals, non-goals, reviewability estimate, shadcn/Tailwind grounding,
and GitNexus clean-room parity notes live at:

```text
docs/ai/specs/.process/SPEC-006-design-concept.md
```

Re-read that file before each phase. It is the source of truth for the scoping
decisions captured during scaffold.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|---|---|---|---|
| Specify | `/speckit-specify` | Complete | Created `specs/006-web-ui-graph-browser/spec.md`. |
| Clarify | `/speckit-clarify` | Complete | Resolved UX, API, chat, and clean-room ambiguity. |
| Plan | `/speckit-plan` | Complete | Selected renderer, shadcn style, API contracts, and slices. |
| Checklist | `/speckit-checklist` | Complete | UX, accessibility, API-contracts, llm-integration, and performance complete with 0 remaining gaps. |
| Tasks | `/speckit-tasks` | Complete | Generated 94 tasks across setup, foundation, seven user stories, and polish. |
| Analyze | `/speckit-analyze` | Pending | Fix consistency gaps before implementation. |
| Confidence Gate | G6.5 | Pending | Run advisory confidence gate before implementation. |
| Implement | `/speckit-implement` | Pending | Execute with tests and UAT evidence. |
| Post | Post | Pending | Complete canonical post-implementation gates before handoff. |

### Canonical Post Gates

Autopilot must keep these post steps visible in durable state and complete or
explicitly skip each one before final handoff:

- Post: Doctor Extension Check
- Post: Verify Implementation
- Post: Verify Tasks Phantom Check
- Post: Code Review
- Post: Integration Suite
- Post: Reviewability Diff Gate
- Post: Self-Review
- Post: UAT Runbook Generation
- Post: PR Body Generation
- Post: PR Creation
- Post: Review Remediation
- Post: Retrospective

## Prerequisites

### Worktree

Run this workflow from:

```text
/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/006-web-ui-graph-browser
```

Branch:

```text
006-web-ui-graph-browser
```

Do not run this workflow from the main checkout or an unrelated Codex worktree.
If autopilot stops with "workflow file is not in the current checkout", restart
from the worktree above.

### Bootstrap Evidence

Bootstrap was completed during scaffold:

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm ci
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run build
```

Both commands passed. Keep using the repo-pinned Node `24.11.1` through nvm.

### Preset Evidence

The active SpecKit templates resolve as:

- `spec-template`: `.specify/presets/speckit-pro-reviewability/templates/spec-template.md`
- `plan-template`: `.specify/presets/speckit-pro-reviewability/templates/plan-template.md`
- `tasks-template`: `.specify/presets/codegraph-project-overrides/templates/tasks-template.md`

### Constitution Validation

Apply `.specify/memory/constitution.md` throughout:

| Principle | SPEC-006 requirement | Verification |
|---|---|---|
| Think before coding | Capture renderer, chat, and GitNexus parity decisions before implementation. | `spec.md`, `plan.md`, `research.md` |
| Simplicity first | Use the minimum backend additions needed for the UI; do not implement browser indexing or Cypher backend here. | Plan review and diff review |
| Surgical changes | Keep changes in `web/`, SPEC-005 web-serving integration, package scripts, tests, and docs. | `git diff --stat` and reviewability gate |
| Goal-driven execution | Every user story needs tests/UAT evidence, not just component code. | Vitest, Playwright, offline/package checks |

## Specification Context

| Field | Value |
|---|---|
| Spec ID | SPEC-006 |
| Name | Web UI: Graph Browser |
| Branch | `006-web-ui-graph-browser` |
| Dependencies | SPEC-004, SPEC-005, SPEC-018 |
| Enables | SPEC-007 and the human-facing surface for later features |
| Priority | P0 |

### Roadmap Scope

Build a polished self-hosted web app for browsing repos, searching, symbol pages,
graph exploration, impact analysis, re-index progress, and package-shipped static
serving. Extend the original roadmap with full GitNexus-style AI chat parity, but
keep repo input backend-only and defer browser-side indexing to SPEC-007.

### Success Criteria Summary

- The app starts at the production tool surface, not a landing page.
- `web/` is Vite + React + TypeScript with Tailwind and shadcn/ui.
- Runtime assets are local/package-shipped; no CDN or hosted runtime dependency.
- The UI consumes SPEC-005 APIs for status, repo list, search, node, callers,
  callees, graph, impact, flows, and reindex jobs.
- Chat uses SPEC-018 through the local backend; browser never receives provider
  secrets.
- GitNexus parity is behavior-level and clean-room only.
- Build copies web output into `dist/web/` and fails loudly when package assets
  are missing.
- Playwright validates desktop/mobile layout, graph canvas nonblank rendering,
  keyboard accessibility, no text overlap, and offline/no-CDN behavior.

## Phase 1: Specify

**When to run:** Start of feature specification. Focus on what and why.

### Specify Prompt

```text
/speckit-specify

## Feature: Web UI: Graph Browser

### Problem Statement
CodeGraph has local APIs and MCP/CLI graph intelligence, but no production web
surface for developers to inspect indexed repos visually. Users need a self-hosted
browser app to search, browse, navigate, visualize graph neighborhoods, inspect
impact, re-index with progress, and ask graph-grounded chat questions from one
local UI.

### Users
- Developers exploring unfamiliar codebases locally.
- Maintainers checking impact or blast radius before edits.
- Demo/evaluation users who want a visual graph without connecting an IDE agent.

### User Stories
1. As a developer, I can select an indexed repo and see its health/staleness.
2. As a developer, I can search symbols and open a symbol detail page.
3. As a developer, I can inspect callers, callees, flows, and snippets for a symbol.
4. As a developer, I can explore graph neighborhoods with pan, zoom, filters, and click-to-expand.
5. As a maintainer, I can view impact radius and affected files for a selected symbol.
6. As a maintainer, I can trigger re-analysis and watch SSE progress.
7. As a developer, I can chat with the indexed repo using graph-grounded context through the SPEC-018 LLM layer.

### Constraints
- Use the SPEC-004 stack: Vite + React SPA.
- Use Tailwind CSS and shadcn/ui; use shadcn skills/MCP during planning and implementation.
- Initialize `web/` with `components.json`, CSS variables, `cn`, and Vite Tailwind integration.
- Compare shadcn presets/styles during planning before locking the final style.
- Run a Cytoscape.js vs Sigma.js renderer bake-off before committing the production graph canvas.
- Match GitNexus web-app feature classes at behavior level without copying code, assets, UI text, visual design, or implementation.
- Keep repo input backend-only; browser ZIP/drop-in indexing is out of scope for SPEC-006.
- Chat must go through the local backend and SPEC-018; no LLM provider key may be sent to the browser.
- No external CDN requests in runtime app.

### Out of Scope
- Browser-side indexing and ZIP upload.
- Wiki route rendering.
- Code viewer LSP features.
- Cypher backend implementation if not already present.
- GitNexus source, asset, text, CSS, or design copying.
```

### Specify Results

| Metric | Value |
|---|---|
| Functional Requirements | 30 |
| User Stories | 7 |
| Acceptance Criteria | 15 |

### Files Generated

- `specs/006-web-ui-graph-browser/spec.md`

## Phase 2: Clarify

**When to run:** After Specify. Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: UX and Navigation

```text
/speckit-clarify Focus on UX: repo switcher, primary navigation, symbol details, graph canvas interactions, loading states, empty states, error states, and mobile behavior.
```

#### Session 2: API and Chat

```text
/speckit-clarify Focus on API: status/repo/search/node/graph/impact/reindex contracts, chat endpoint shape, SPEC-018 disabled states, provider-secret boundaries, and SSE/error behavior.
```

#### Session 3: Clean-Room Parity

```text
/speckit-clarify Focus on GitNexus parity: behavior-level parity matrix, unsupported backend capabilities, Cypher-style query affordance, Docker/local serving expectations, and clean-room guardrails.
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---|---|---|---|
| 1 | UX and navigation | 5 | Persistent repo-aware shell; safe repo switching; symbol-detail anchor; bounded keyboard-accessible graph interactions with non-canvas mirror; explicit state taxonomy and mobile/WCAG expectations. |
| 2 | API and chat | 5 | Live OpenAPI is authoritative; repo-scoped read and reindex contracts preserved; chat is same-origin backend adapter over SPEC-018; backend owns graph context/truncation; provider secrets stay backend-only; reanalysis uses existing SSE/ErrorEnvelope behavior. |
| 3 | Clean-room parity | 5 | Clean-room parity matrix required in `research.md`; unsupported capabilities labeled deferred/backend-blocked/out of scope; Cypher-style UI limited to existing-API presets until SPEC-013; local/package serve plus container docs selected by 3-of-3 security consensus; README/LICENSE-only source ledger required. |

## Phase 3: Plan

**When to run:** After spec is finalized. Output: `specs/006-web-ui-graph-browser/plan.md`.

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Frontend: Vite + React + TypeScript SPA under `web/`
- Styling: Tailwind CSS v4 with `@tailwindcss/vite`, CSS variables, and shadcn/ui
- UI components: shadcn/ui from `@shadcn` registry
- Icons: lucide-react through shadcn patterns
- Graph renderer: select after Cytoscape.js vs Sigma.js bake-off
- Backend: existing CodeGraph local HTTP server under `src/server/`
- Chat: SPEC-018 `src/llm/` layer, exposed through safe local server contracts
- Testing: Vitest for units/contracts, Playwright for UI/UAT/offline/canvas checks

## Required shadcn/Tailwind Setup
1. Initialize the web app in `web/` using the selected Vite React path.
2. Run shadcn init for the Vite app and commit `components.json`.
3. Configure Tailwind v4 using `@tailwindcss/vite` in Vite config.
4. Use CSS `@import "tailwindcss";`, shadcn CSS variables, and the generated `cn` utility.
5. Compare shadcn style/preset options in `research.md`; lock one before component implementation.
6. Add the first component set after init:
   `npx shadcn@latest add @shadcn/button @shadcn/input @shadcn/card @shadcn/sidebar @shadcn/breadcrumb @shadcn/tabs @shadcn/table @shadcn/dialog @shadcn/sheet @shadcn/sonner @shadcn/resizable @shadcn/scroll-area @shadcn/tooltip @shadcn/badge @shadcn/skeleton @shadcn/dropdown-menu @shadcn/separator`

## Required Research
- Renderer bake-off: Cytoscape.js vs Sigma.js against representative CodeGraph graph data.
- shadcn preset/style comparison for a dense developer tool.
- GitNexus clean-room parity matrix based on public behavior inventory.
- Chat path: SPEC-018 endpoint mode and agent-bundle mode as seen from the web UI.
- Package/offline path: web build copied to `dist/web/`, served by `codegraph serve --web`, no CDN requests.

## Constraints
- Keep changes reviewable in three vertical slices:
  1. App shell, shadcn/Tailwind foundation, search, symbol pages, renderer decision.
  2. Production graph canvas and graph interactions.
  3. Impact, reindex/SSE, chat parity, package/offline/Docker validation.
- Do not implement browser-side indexing.
- Do not implement a Cypher backend as part of SPEC-006 unless an existing supported backend contract is already present.
- Browser chat must never receive provider secrets.
- No external CDN, hosted auth, hosted database, remote telemetry, or remote asset fetch.

## Architecture Notes
- Prefer typed fetch clients generated or hand-written from `src/server/openapi.yaml`.
- Keep web state local and simple unless the plan proves a small helper is required.
- Use shadcn layout primitives for shell/sidebar/dialog/sheet/toasts.
- Graph canvas must have stable dimensions and responsive constraints to avoid text/control overlap.
- Use route fallback through the SPEC-005 static mount; `/api/*` must never be swallowed by SPA fallback.
```

### Plan Results

| Artifact | Status | Notes |
|---|---|---|
| `plan.md` | Complete | Technical context, constitution check, structure decision, complexity justification, and three vertical slices. |
| `research.md` | Complete | Cytoscape.js selected after Cytoscape/Sigma bake-off; `base-nova` shadcn style locked; SPEC-018 chat and clean-room parity recorded. |
| `data-model.md` | Complete | Repository, symbol, graph view, impact, re-analysis, chat, context boundary, and clean-room inventory entities. |
| `contracts/` | Complete | Existing OpenAPI consumption, SPEC-018 chat adapter, and static package/fallback contracts. |
| `quickstart.md` | Complete | Local dev, package-shipped serve, offline/no-CDN, chat-secret, renderer, re-analysis, and clean-room validation flows. |

Phase 3 completed on 2026-07-15. No checklist or tasks phase was executed in this step.

Plan-phase reviewability estimator:

- Helper: `estimate-reviewable-loc`
- Mode: read-only advisory
- Status: `not_estimated`
- Reason: `plan.md` does not use the runner's declared-file table format, so the helper reported 0 declared production entries.
- Fallback evidence: `spec.md` reviewability budget remains the governing size signal (`1115` projected reviewable LOC, warning accepted, three vertical slices).

## Phase 4: Domain Checklists

Run these after `/speckit-plan`. Address every `[Gap]` in `spec.md` or `plan.md`
and re-run until clean.

### UX Checklist

```text
/speckit-checklist ux

Focus on SPEC-006 requirements:
- Repo switcher, global search, symbol details, graph canvas, impact panel, chat panel.
- Loading, empty, degraded, unindexed, stale, unauthorized, and offline states.
- Dense developer-tool layout using shadcn components without card nesting or marketing composition.
- Pay special attention to graph/chat navigation so users can move from search to symbol to graph to chat context.
```

### Accessibility Checklist

```text
/speckit-checklist accessibility

Focus on SPEC-006 requirements:
- Keyboard navigation for sidebar, search, tabs, graph controls, dialogs, sheets, and chat.
- Screen-reader labels and non-canvas alternatives for selected graph data and impact summaries.
- Focus management, contrast, target sizes, reduced motion, and no text overlap on mobile/desktop.
- Pay special attention to graph canvas affordances that need accessible mirrors.
```

### API Contracts Checklist

```text
/speckit-checklist api-contracts

Focus on SPEC-006 requirements:
- Existing SPEC-005 endpoints consumed by the web app.
- Any new chat endpoint and its disabled/misconfigured states.
- Reindex POST/latest/SSE semantics and same-origin/auth behavior.
- Package static fallback behavior for browser routes vs `/api/*`.
- Pay special attention to provider-secret boundaries and consistent error envelopes.
```

### LLM Integration Checklist

```text
/speckit-checklist llm-integration

Focus on SPEC-006 requirements:
- SPEC-018 endpoint and agent-bundle modes as user-visible chat states.
- Graph-grounded context selection and truncation transparency.
- No browser-side provider secrets or direct provider calls.
- Honest dormant/misconfigured/pending-bundle behavior.
- Pay special attention to not expanding the LLM layer beyond chat parity needs.
```

### Performance Checklist

```text
/speckit-checklist performance

Focus on SPEC-006 requirements:
- Renderer behavior at representative and large graph sizes.
- Search and symbol-page responsiveness.
- Reindex progress behavior under long jobs.
- Bundle size and package asset checks.
- Pay special attention to canvas nonblank render, frame responsiveness, and graph truncation messaging.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|---|---:|---:|---|
| ux | 31 | 0 | FR-001, FR-031-FR-038, SC-001-SC-009 |
| accessibility | 29 | 0 | FR-034-FR-038, FR-054-FR-060, SC-009, SC-012 |
| api-contracts | 35 | 0 | FR-039-FR-047, FR-052, SC-007, SC-008, SC-011 |
| llm-integration | 33 | 0 | FR-020-FR-023, FR-041-FR-044, FR-047, SC-007, SC-008 |
| performance | 37 | 0 | NFR-001-NFR-006, SC-013, FR-014, FR-045 |

**G4 Gate:** PASS - runner `validate-gate` reported `0 [Gap] markers`.

## Phase 5: Tasks

**When to run:** After checklists complete and all gaps are resolved.

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, testable chunks.
- Organize by user story and vertical slice, not by technical layer.
- Mark parallel-safe tasks with [P].
- Every user story must be independently demonstrable.
- Include tests before or alongside implementation tasks.

## Implementation Phases
1. Foundation and Slice 1: `web/`, Vite React, Tailwind, shadcn init, API client, repo/status/search/symbol pages, renderer bake-off.
2. Slice 2: graph canvas, graph filters, click-to-expand, selected symbol context, large-graph UAT.
3. Slice 3: impact view, reindex/SSE progress, chat parity, offline/package/Docker validation, accessibility polish.

## Constraints
- Add web tests under a clear web test location selected in plan.
- Add server contract tests for any new chat/static/package behavior.
- Add Playwright tests for desktop, mobile, graph canvas nonblank pixels, keyboard navigation, no CDN requests, and no layout overlap.
- Keep GitNexus parity clean-room notes in docs/research only; do not copy source or assets.
```

### Tasks Results

| Metric | Value |
|---|---|
| Total Tasks | 94 |
| Phases | 10 |
| Parallel Opportunities | Setup T003-T005/T007; foundation T011-T013/T016-T017; story test groups; US1-US4 after foundation; US5-US7 after foundation; polish T085-T088 |
| User Stories Covered | 7/7 |

**G5 Gate:** PASS - runner `validate-gate` reported `94 tasks found`.

## Atomicity Route

Filled after Tasks phase by the autopilot classifier.

| Field | Value | Meaning |
|---|---|---|
| Route | one-navigable-PR | One of the classifier route values. |
| Releasable | true | True unless classifier identifies release risk. |
| Signals | change-shape:modify-heavy | Decisive detector findings. |
| Warnings | none | Release-safety warnings. |

To produce the decision:

```text
runner helper atomicity-route specs/006-web-ui-graph-browser
```

## Phase 5.1: Verify Tasks

**Result:** Skipped cleanly - `tasks.md` has no completed `[X]` task entries yet, so there are no phantom completions to verify before implementation.

## Phase 5.2: Tasks to Issues

**Status:** Pending.

## Phase 6: Analyze

**When to run:** Always after generating tasks.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment and reviewability of the three-slice plan.
2. Coverage of all user stories, especially chat parity and offline/package serving.
3. Consistency between task paths and actual project structure.
4. shadcn/Tailwind setup tasks before shadcn component tasks.
5. Renderer bake-off decision captured before graph canvas implementation.
6. Clean-room GitNexus parity documented without source or asset copying.
7. Tests and UAT evidence for graph canvas, accessibility, no CDN, and package assets.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|---|---|---|---|
| Pending | Pending | Pending | Pending |

## Phase 6.5: Confidence Gate

**When to run:** After Analyze is clean and before implementation starts.

Run the runner confidence gate in advisory mode for SPEC-006 and record the
composite score, recommendation, and any non-blocking warnings in
`autopilot-state.json`.

## Phase 7: Implement

**When to run:** After tasks are generated and analysis has no blocking gaps.

### Implement Prompt

```text
/speckit-implement

## Approach
For each task:
1. RED: Add or update tests that define expected behavior.
2. GREEN: Implement the minimum code to pass.
3. REFACTOR: Simplify while tests stay green.
4. VERIFY: Record command output or Playwright evidence for the acceptance criterion.

## Pre-Implementation Setup
1. Confirm branch: `git branch --show-current` must print `006-web-ui-graph-browser`.
2. Use Node 24.11.1 through nvm PATH.
3. Run `npm run build` before starting and after each slice.
4. Re-read `docs/ai/specs/.process/SPEC-006-design-concept.md`.
5. Confirm no browser-side indexing or GitNexus source copying has entered scope.

## Implementation Notes
- Use shadcn components and Tailwind semantic variables; avoid ad hoc custom controls when shadcn has a component.
- Use lucide icons for icon buttons.
- Keep graph canvas dimensions stable across loading/empty/data states.
- Do not put cards inside cards or use a marketing-style landing page.
- Chat requests must go to the local CodeGraph server, not directly to LLM providers.
- Keep package asset copy and offline/no-CDN checks in the implementation, not as a follow-up.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|---|---|---|---|
| Slice 1 - Foundation/search/symbol | Pending | Pending | Pending |
| Slice 2 - Graph canvas | Pending | Pending | Pending |
| Slice 3 - Impact/reindex/chat/package | Pending | Pending | Pending |

## Post-Implementation Checklist

- `npm run build` passes.
- `npm test` passes or documented scoped failures are explained.
- Web unit tests pass.
- Playwright web tests pass for desktop and mobile.
- Canvas pixel check proves graph is nonblank and correctly framed.
- Accessibility checks pass or any residual issue is explicitly documented.
- Offline/no-CDN network audit passes.
- Package build includes `dist/web/` and static serving works through `codegraph serve --web`.
- GitNexus parity matrix is updated with implemented, deferred, or backend-blocked statuses.
- Clean-room guardrails are still satisfied.

## Reviewability Notes

Advisory estimator result from scaffold:

```text
estimated_loc=1115
suggested_slices=3
status=warn
```

This is under the greenfield block line only if implementation stays narrowly
scoped. If any slice grows beyond reviewability, split before implementation
rather than broadening the PR.

## Lessons Learned

Capture after implementation.
