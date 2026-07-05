# SpecKit Workflow: SPEC-004 - Web Framework Research Spike

**Template Version**: 1.0.0  
**Created**: 2026-07-05  
**Purpose**: Execute SPEC-004 through the SpecKit workflow and produce the framework decision evidence that unblocks SPEC-005, SPEC-006, and SPEC-007.

---

## How to Use This Workflow

Run this workflow from branch `004-web-framework-research-spike`.

The design concept is the scoping source of truth:

```text
docs/ai/specs/.process/SPEC-004-design-concept.md
```

Re-read it before each phase. It records the human-approved decisions from Grill Me: UX-first scoring after hard local-first gates, one chosen-stack throwaway prototype, browser screenshot evidence, committed PNG report assets, and a single research-spike slice.

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `$speckit-specify` | Complete | Produced `specs/004-web-framework-research-spike/spec.md` with 17 FRs, 3 stories, and 9 acceptance scenarios |
| Clarify | `$speckit-clarify` | Complete | Skipped after G1/G2: 0 active `[NEEDS CLARIFICATION]` markers |
| Plan | `$speckit-plan` | Complete | Created plan, research, data model, contract, quickstart, and updated managed SpecKit context |
| Checklist | `$speckit-checklist` | In Progress | Recommended domains: ux, performance, integration, reliability |
| Tasks | `$speckit-tasks` | Pending | Keep tasks docs/process-first; no production web code |
| Analyze | `$speckit-analyze` | Pending | Check drift against the design concept and roadmap |
| Implement | `$speckit-implement` | Pending | Produce the decision doc, screenshot assets, and UAT evidence |

## Prerequisites

### Constitution Validation

Before each phase, verify alignment with `.specify/memory/constitution.md`:

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| Think Before Coding | State assumptions and stop on ambiguity. | Clarify unresolved framework/version/evidence questions before implementation. |
| Simplicity First | Keep SPEC-004 a research spike, not a production web implementation. | No production code under `src/server/` or `web/`; those belong to later specs. |
| Surgical Changes | Touch only the decision artifacts and evidence assets needed for the spike. | Review `git diff --stat` before commit; no adjacent cleanup. |
| Goal-Driven Execution | Success claims must carry evidence. | Decision matrix, prototype notes, screenshots, and self-repo dogfood notes are present. |
| Deterministic, LLM-Free Extraction | Do not alter graph extraction or runtime behavior in this spike. | No graph schema/extractor/resolver changes. |
| Retrieval Performance | Do not change MCP retrieval behavior. | No edits to `src/mcp/`, `src/graph/`, or retrieval budget logic. |
| Local-First, Private, Zero Native Dependencies | Candidate stack must be self-hostable, offline-capable, permissively licensed, and package-shippable. | Decision matrix includes hard gates for these constraints. |

### Reviewability Setup Gate

The setup gate was run on 2026-07-05:

```text
bash speckit-autopilot/scripts/reviewability-gate.sh setup docs/ai/specs/intelligence-platform-technical-roadmap.md
```

Result: pass with warning. The gate reported `primary surfaces 6 exceeds warn threshold 1` from the broader roadmap scan. SPEC-004 itself remains a docs/process research spike with projected reviewable LOC 0, production files 0, and one slice. The split decision is: keep SPEC-004 as one research spike.

### Autopilot Preflight Results

| Check | Result | Evidence |
|-------|--------|----------|
| Parent model and effort | Verified | `/Users/fredrickgabelmann/.codex/config.toml` declares `model = "gpt-5.5"` and `model_reasoning_effort = "xhigh"`. |
| SpecKit prerequisites | Passed | `check-prerequisites.sh docs/ai/specs/.process/SPEC-004-workflow.md` returned `all_pass: true`, branch `004-web-framework-research-spike`, worktree `true`, feature branch `true`, and SpecKit CLI `0.11.8`. |
| Codex subagents | Passed | `validate-agent-install.sh --surface codex --autoheal` returned `ok: codex: 10 bundled agents installed`. |
| Confidence gate mode | Advisory | `resolve-confidence-mode.sh -- docs/ai/specs/.process/SPEC-004-workflow.md` returned `advisory`. |
| Archive sweep | Skipped | Archive extension is not installed; cleanup was not applied. |
| Project commands | Verified | `package.json` scripts define `npm run build`, `npm run typecheck`, and `npm test`; these override detector shorthand. |
| G0 build | Passed | `npm run build` exited 0. |
| G0 typecheck | Passed | `npm run typecheck` exited 0. |
| G0 tests | Passed | `npm test` exited 0 with 132 test files passed, 2223 tests passed, and 4 skipped. |
| Reviewability setup gate | Warn/pass | `reviewability-gate.sh setup docs/ai/specs/intelligence-platform-technical-roadmap.md` returned `status: warn`, `pass: true`; warning: `primary surfaces 6 exceeds warn threshold 1`. |

## Specification Context

| Field | Value |
|-------|-------|
| Spec ID | SPEC-004 |
| Name | Web Framework Research Spike |
| Branch | `004-web-framework-research-spike` |
| Priority | P0 |
| Dependencies | None |
| Enables | SPEC-005, SPEC-006, SPEC-007 |
| Primary surface | docs/process |
| Projected production files | 0 |
| Reviewability result | within budget; spike |

### Roadmap Goal

Produce a grounded, scored decision on the web stack that is modern, user-friendly, cost-efficient, and self-hostable anywhere with minimal effort, plus a proven graph-rendering approach.

### Human-Validated Design Decisions

- Evaluate all six roadmap candidates: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart.
- Use UX as the leading weighted score only after each candidate passes hard local-first, self-host, offline, permissive-license, and package-shipping gates.
- Build one throwaway graph-rendering prototype in the chosen stack after the matrix selects it.
- Record prototype method and results; do not commit maintained prototype source code.
- Use browser automation screenshots as report evidence. If `@browser` is unavailable in the implementation session, use an equivalent local browser or Playwright screenshot flow and record the fallback.
- Commit small screenshot PNGs under a SPEC-004 design-assets folder and reference them from `docs/design/web-framework-decision.md`.
- Dogfood against representative CodeGraph data from this repository and record screenshots, performance notes, and reproduction steps.

### Expected Deliverables

- `docs/design/web-framework-decision.md` with the scored matrix, recommendation, shipping strategy, graph-rendering bake-off, screenshot references, and reproduction notes.
- Small committed screenshot assets under `docs/design/assets/spec-004/`.
- `specs/004-web-framework-research-spike/spec.md`, `plan.md`, `tasks.md`, and generated supporting SpecKit artifacts.
- A UAT runbook under `specs/004-web-framework-research-spike/.process/` once `spec.md` exists and the UAT skeleton can be generated from it.

## Phase 1: Specify

### Specify Prompt

```text
$speckit-specify

Feature: SPEC-004 - Web Framework Research Spike

Create the specification for a docs/process research spike that chooses CodeGraph's future self-hosted web stack and proves the graph-rendering path.

Roadmap context:
- Priority P0.
- No dependencies.
- Enables SPEC-005 Local HTTP Server & REST API, SPEC-006 Web UI: Graph Browser, and SPEC-007 In-Browser Indexing.
- Output is a decision document, screenshot evidence, and reproducible prototype notes, not production web code.

User-visible outcome:
- Maintainers can review a grounded decision matrix and understand why the selected stack is the best fit for CodeGraph's local-first, self-hosted, package-shipped web platform.
- Later web specs can implement against a clear framework choice, graph-rendering approach, and shipping strategy.

Functional scope:
- Evaluate the six roadmap candidates: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart.
- Use hard gates for self-host anywhere, offline/package-shipped assets, no runtime hosted services, permissive licensing, and package footprint.
- After hard gates pass, weight UX first, then deploy effort, DX, cost, footprint, and license/maintenance risk.
- Gather official documentation plus live package/repository metadata for every candidate before scoring.
- Select one stack and build a throwaway graph-rendering prototype only in that chosen stack.
- Validate graph-rendering with representative CodeGraph data from this repository and a 1k-node target.
- Capture browser screenshots from the prototype and commit small PNG evidence assets under `docs/design/assets/spec-004/`.
- Write `docs/design/web-framework-decision.md` with matrix, recommendation, shipping strategy, graph-rendering notes, screenshots, and reproduction steps.

Constraints:
- Do not add production web code in SPEC-004.
- Do not add hosted-service, CDN runtime, source-available-only, or non-permissive dependencies.
- Keep committed artifacts reviewable and docs/process-focused.
- Include a self-repo UAT step per the roadmap Dogfooding Protocol.

Out of scope:
- Local HTTP server implementation.
- Production web UI shell.
- In-browser indexing.
- LSP facade or WebSocket endpoints.
- Any long-lived prototype code unless a later phase explicitly promotes it.

Reference the design concept at `docs/ai/specs/.process/SPEC-004-design-concept.md`.
```

### Specify Results

Record after running:

| Metric | Value |
|--------|-------|
| Functional Requirements | 17 |
| User Stories | 3 |
| Acceptance Criteria | 9 acceptance scenarios |

### Files Generated

- [x] `specs/004-web-framework-research-spike/spec.md`
- [x] `specs/004-web-framework-research-spike/checklists/requirements.md`
- [x] `.specify/feature.json`

## Phase 2: Clarify

Run one Clarify session if the generated spec leaves ambiguity. Maximum five questions.

### Clarify Prompt

```text
$speckit-clarify

Focus on SPEC-004 ambiguities that could change the decision artifact:
- Whether each hard gate is measurable enough to apply consistently across all six candidates.
- How UX-first scoring is bounded after local-first/self-host/package/license gates pass.
- Which live sources are authoritative for framework/package health, license, and release facts.
- What representative CodeGraph data should feed the throwaway graph-rendering prototype.
- How browser screenshots should be captured, stored, referenced, and validated in the report.

Do not revisit decisions already settled in the design concept unless the spec conflicts with them.
```

### Clarify Results

| Focus Area | Questions | Key Outcomes |
|------------|-----------|--------------|
| Decision matrix and evidence | 0 | Skipped: G1/G2 found no active clarification markers after Specify. |

## Phase 3: Plan

### Plan Prompt

```text
$speckit-plan

Technical context:
- Project runtime: TypeScript/Node, npm scripts, pure JS/WASM dependency posture, `node:sqlite` store.
- Build/test floor: `npm run build` and `npm test`.
- Static assets must be wired into `copy-assets` in later specs if they ship; SPEC-004 should only decide the path.
- The repo is local-first and private by default; web capabilities must remain dormant and opt-in until configured.
- Roadmap Dogfooding Protocol requires web/LSP specs to browse and serve this repo first.

Plan SPEC-004 as a research spike:
- Build a candidate matrix for the six roadmap options.
- Define measurable hard gates for self-host anywhere, offline/package-shipped assets, no hosted-service runtime dependency, permissive license, package footprint, and maintenance health.
- Define the weighted scoring model with UX leading after hard gates.
- Define current-source research steps using official docs plus live package/repository metadata.
- Define the chosen-stack prototype method for graph rendering, including data shape, 1k-node target, browser screenshot capture, and performance/reproduction notes.
- Define the artifact layout for `docs/design/web-framework-decision.md` and `docs/design/assets/spec-004/`.
- Define UAT that exercises the prototype evidence against representative CodeGraph data from this repository.

Constitution gates:
- No production code.
- No non-permissive or source-available-only dependencies.
- No CDN/runtime hosted services.
- No changes to extraction, retrieval, MCP, SQLite schema, or installer behavior.

Quote and use the design concept decisions from `docs/ai/specs/.process/SPEC-004-design-concept.md`, especially Q2-Q10.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | Complete | Research method, scoring model, artifact layout, validation |
| `research.md` | Complete | Candidate evidence procedure and decision rationales |
| `quickstart.md` | Complete | Reproduce prototype evidence and screenshot capture |
| `contracts/` | Not expected | No API contract in this spike |
| `data-model.md` | Complete | Decision/evidence artifact entities and validation rules |
| `contracts/decision-artifacts.md` | Complete | Durable report, evidence, screenshot, and PR packet contract |

Plan gate evidence:

- G3 passed: `validate-gate.sh G3 specs/004-web-framework-research-spike` returned `pass: true`.
- Plan reviewability estimator returned `not_estimated` because no production-file structure is declared; this is advisory and expected for a docs/process spike with 0 planned production files.
- Managed SpecKit context in `CLAUDE.md` now points to `specs/004-web-framework-research-spike/plan.md`.

## Phase 4: Domain Checklists

Run checklists after plan so they validate both `spec.md` and `plan.md`.

### 1. UX Checklist

```text
$speckit-checklist ux

Focus on SPEC-004 requirements:
- UX-first scoring after hard local-first gates.
- Decision matrix criteria for graph browsing ergonomics, discoverability, visual clarity, and interaction fit.
- Screenshot evidence quality and readability in `docs/design/web-framework-decision.md`.
- Pay special attention to whether UX claims are measurable instead of subjective.
```

### 2. Performance Checklist

```text
$speckit-checklist performance

Focus on SPEC-004 requirements:
- 1k-node graph-rendering target.
- Prototype performance notes and reproduction steps.
- Candidate footprint and package-size considerations.
- Pay special attention to whether the graph-rendering evidence is enough to unblock SPEC-006.
```

### 3. Integration Checklist

```text
$speckit-checklist integration

Focus on SPEC-004 requirements:
- Embedding static assets into the npm package in later specs.
- Standalone container recipe expectations.
- No hosted-service or CDN runtime dependency.
- Pay special attention to whether the chosen stack can integrate with the future SPEC-005 local HTTP server.
```

### 4. Reliability Checklist

```text
$speckit-checklist reliability

Focus on SPEC-004 requirements:
- Reproducible evidence for live-source research.
- Screenshot capture fallback if browser tooling is unavailable.
- Dormant-by-default behavior in later specs.
- Pay special attention to whether the report makes decision evidence durable for reviewers.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| ux | Pending | Pending | Pending |
| performance | Pending | Pending | Pending |
| integration | Pending | Pending | Pending |
| reliability | Pending | Pending | Pending |

## Phase 5: Tasks

### Tasks Prompt

```text
$speckit-tasks

Generate tasks for SPEC-004 as a single docs/process research spike.

Task constraints:
- Keep tasks ordered by independent evidence milestones, not by implementation layer.
- Include tasks for current-source research across all six candidates.
- Include tasks for hard-gate definition and weighted scoring.
- Include tasks for selecting the stack and running one chosen-stack throwaway graph-rendering prototype.
- Include tasks for browser screenshot capture, committed PNG evidence assets, and report references.
- Include tasks for self-repo dogfooding evidence using representative CodeGraph data from this repository.
- Include tasks for generating and validating the UAT runbook after `spec.md` exists.
- Include `npm run build` and `npm test` as repo health verification unless the plan documents why this docs/process spike does not require a full run.

Non-goals that must bound task generation:
- No production server or web UI code.
- No long-lived prototype source.
- No CDN/runtime hosted-service dependency.
- No source-available-only or non-permissive dependency adoption.

Reference `spec.md`, `plan.md`, and `docs/ai/specs/.process/SPEC-004-design-concept.md`.
```

### Tasks Results

| Metric | Value |
|--------|-------|
| Total Tasks | Pending |
| Phases | Pending |
| Parallel Opportunities | Pending |
| User Stories Covered | Pending |

## Atomicity Route

After Tasks / gate G5, run:

```text
bash speckit-pro/skills/speckit-autopilot/scripts/atomicity-route.sh specs/004-web-framework-research-spike
```

Record the emitted decision here:

| Field | Value | Meaning |
|-------|-------|---------|
| Route | Pending | Expected: one navigable PR or single atomic PR for the research spike |
| Releasable | Pending | Expected: true because this is docs/process and screenshot evidence |
| Signals | Pending | Detector findings |
| Warnings | Pending | Release-safety warnings |

## Phase 6: Analyze

### Analyze Prompt

```text
$speckit-analyze

Analyze SPEC-004 artifacts for consistency:
- `specs/004-web-framework-research-spike/spec.md`
- `specs/004-web-framework-research-spike/plan.md`
- `specs/004-web-framework-research-spike/tasks.md`
- `docs/ai/specs/.process/SPEC-004-design-concept.md`

Focus on:
- Drift from the design concept decisions, especially UX-first-after-hard-gates, screenshot evidence, and no production code.
- Whether all roadmap scope bullets are covered: scored matrix, graph-rendering bake-off, embedded-assets strategy, standalone container recipe.
- Whether out-of-scope items are excluded: server, production UI, in-browser indexing, LSP facade, and maintained prototype code.
- Whether current-source research and license/package facts are required before decision claims.
- Whether self-repo dogfooding and UAT runbook requirements are present.

Flag any mismatch as HIGH or CRITICAL if it could make SPEC-005/006 build on an unsupported framework decision.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| Pending | Pending | Pending | Pending |

## Phase 6.5: Confidence Gate

Run the advisory pre-Implement confidence gate after Analyze and before Implement.

| Phase | Gate | Status | Notes |
|-------|------|--------|-------|
| Confidence Gate | G6.5 | Pending | Mode: advisory |
| G6.5 | Confidence Gate | Pending | Reads the latest Phase 6 confidence block |

## Phase 7: Implement

### Implement Prompt

```text
$speckit-implement

Implement SPEC-004 tasks with evidence-first discipline:

1. Research the six framework candidates using official docs plus live package/repository metadata.
2. Apply hard gates for local-first, self-host, offline/package-shipped assets, no hosted runtime service, permissive license, and footprint.
3. Score UX first among candidates that pass hard gates, then deploy effort, DX, cost, footprint, and maintenance/license risk.
4. Select one stack and run a throwaway graph-rendering prototype only in that stack.
5. Use representative CodeGraph data from this repository and target a 1k-node graph-rendering proof.
6. Capture browser screenshots from the prototype using the available browser automation surface. If `@browser` is unavailable, use a local browser or Playwright-equivalent screenshot path and record the fallback.
7. Commit small PNG screenshots under `docs/design/assets/spec-004/` and reference them from the report.
8. Write `docs/design/web-framework-decision.md` with matrix, recommendation, shipping strategy, graph-rendering evidence, screenshots, and reproduction notes.
9. Generate `specs/004-web-framework-research-spike/.process/uat-runbook.md` once `spec.md` exists, then add a self-repo UAT step for the screenshot/prototype evidence.
10. Verify repo health with `npm run build` and `npm test`, or document a narrow, evidence-backed reason if a full run is not applicable.

Do not add production server/web app code. Do not commit throwaway prototype source unless a task explicitly promotes a small reproducible fixture and the plan explains why it remains docs/process.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| Research matrix | Pending | Pending | Six candidates |
| Prototype evidence | Pending | Pending | Chosen stack only |
| Decision report | Pending | Pending | Includes screenshot assets |
| UAT and verification | Pending | Pending | Self-repo evidence required |

## Self-Review

Before requesting review, confirm:

- The decision doc cites current official docs and live package/repository metadata for every candidate.
- The chosen stack passed every hard gate before UX scoring decided the winner.
- The graph-rendering prototype evidence includes screenshots, reproduction notes, and representative CodeGraph data.
- The screenshot assets are committed and referenced by relative paths from `docs/design/web-framework-decision.md`.
- SPEC-004 did not add production server or web UI code.
- The UAT runbook includes a self-repo dogfooding step.
- `npm run build` and `npm test` results are recorded, or a scoped verification rationale is documented.

## Post-Implementation Checklist

| Phase | Item | Status | Notes |
|-------|------|--------|-------|
| Post | Post: Doctor Extension Check | Skipped | Doctor extension not installed |
| Post | Post: Verify Implementation | Pending | Verify extension installed |
| Post | Post: Verify Tasks Phantom Check | Pending | Verify-tasks extension installed |
| Post | Post: Code Review | Pending | Built-in diff review |
| Post | Post: Integration Suite | Pending | Full project verification |
| Post | Post: Reviewability Diff Gate | Pending | Final reviewability backstop |
| Post | Post: Self-Review | Pending | Four-question audit |
| Post | Post: UAT Runbook Generation | Pending | Skeleton plus author agent |
| Post | Post: PR Body Generation | Pending | Packet/body generation |
| Post | Post: PR Creation | Pending | PR side effect after packet validation |
| Post | Post: Review Remediation | Pending | Review polling and fixes |
| Post | Post: Retrospective | Pending | Final canonical post item |

- [ ] `spec.md`, `plan.md`, `tasks.md`, and supporting SpecKit artifacts are complete.
- [ ] `docs/design/web-framework-decision.md` exists and contains the scored matrix, recommendation, shipping strategy, and graph-rendering evidence.
- [ ] Screenshot PNGs exist under `docs/design/assets/spec-004/` and are referenced from the decision doc.
- [ ] UAT runbook exists under `specs/004-web-framework-research-spike/.process/`.
- [ ] Self-repo dogfooding evidence is recorded.
- [ ] Reviewability gate warnings are acknowledged.
- [ ] Build/test verification is recorded.
- [ ] No production web/server code was introduced by the spike.

## Project Structure Reference

```text
docs/ai/specs/.process/SPEC-004-design-concept.md
docs/ai/specs/.process/SPEC-004-workflow.md
docs/design/web-framework-decision.md
docs/design/assets/spec-004/
specs/004-web-framework-research-spike/
specs/004-web-framework-research-spike/SPEC-MOC.md
specs/004-web-framework-research-spike/.process/uat-runbook.md
```

Template based on SpecKit workflow-template.md, populated for SPEC-004 from the roadmap and Grill Me design concept.
