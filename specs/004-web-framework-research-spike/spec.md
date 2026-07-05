# Feature Specification: Web Framework Research Spike

**Feature Branch**: `004-web-framework-research-spike`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "SPEC-004 - Web Framework Research Spike: create a docs/process research spike that chooses CodeGraph's future self-hosted web stack and proves the graph-rendering path."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review a grounded framework decision (Priority: P1)

As a CodeGraph maintainer, I can review a decision matrix covering the full roadmap shortlist so I understand which web stack is recommended and why it fits CodeGraph's local-first, self-hosted, package-shipped platform.

**Why this priority**: Later web specs depend on a single framework choice. A grounded decision prevents SPEC-005, SPEC-006, and SPEC-007 from re-litigating stack selection.

**Independent Test**: Can be tested by reviewing the decision document and confirming every required candidate has current evidence, hard-gate results, weighted scoring, and a clear recommendation.

**Acceptance Scenarios**:

1. **Given** the six roadmap candidates, **When** a maintainer opens the decision document, **Then** each candidate has official-documentation evidence, live package or repository metadata, hard-gate results, and weighted scores.
2. **Given** at least one candidate fails a hard gate, **When** the matrix is reviewed, **Then** the candidate is excluded from final weighted ranking with the specific gate failure recorded.
3. **Given** multiple candidates pass hard gates, **When** the recommendation is reviewed, **Then** the chosen stack is justified by UX-first scoring after self-hosting, offline assets, hosted-service avoidance, permissive licensing, and package-footprint gates have passed.

---

### User Story 2 - Verify graph rendering before committing to the stack (Priority: P2)

As a maintainer, I can inspect screenshot evidence and prototype notes showing the selected stack rendering representative CodeGraph data, including a 1k-node target, so the highest-risk visualization path is proven before production work begins.

**Why this priority**: The web platform's value depends on graph browsing. A decision without rendering proof would leave the biggest technical and UX risk unresolved.

**Independent Test**: Can be tested by following the reproduction notes, reviewing the committed screenshots, and confirming the prototype uses representative data from this repository plus a 1k-node target.

**Acceptance Scenarios**:

1. **Given** the selected stack, **When** the prototype evidence is reviewed, **Then** screenshots demonstrate graph rendering with representative CodeGraph data from this repository.
2. **Given** the 1k-node target, **When** prototype results are reviewed, **Then** the notes describe whether the target was reached, what was measured, and any limitations that later specs must handle.
3. **Given** the prototype is throwaway work, **When** the repository diff is reviewed, **Then** no long-lived production web code is added by SPEC-004.

---

### User Story 3 - Reuse the decision in later web specs (Priority: P3)

As the author of later web specs, I can use the decision document to carry forward the framework choice, graph-rendering approach, package-shipping strategy, and known risks without repeating the research spike.

**Why this priority**: SPEC-004 enables later work. The output must be reusable enough for planning, not just persuasive for a one-time review.

**Independent Test**: Can be tested by verifying the decision document includes explicit downstream guidance for SPEC-005, SPEC-006, and SPEC-007.

**Acceptance Scenarios**:

1. **Given** SPEC-005 planning begins, **When** the decision document is consulted, **Then** it states how the chosen stack should be served locally and shipped with CodeGraph.
2. **Given** SPEC-006 planning begins, **When** graph-browser work is scoped, **Then** it can reference the graph-rendering notes, screenshots, limits, and open risks from SPEC-004.
3. **Given** SPEC-007 planning begins, **When** in-browser indexing is considered, **Then** the document identifies any stack constraints relevant to offline execution and package-shipped assets.

### Edge Cases

- What happens when a candidate has strong UX but fails a hard local-first, offline, hosted-service, license, or package-footprint gate?
- What happens when official documentation conflicts with current package or repository metadata?
- What happens when current package metadata is unavailable, stale, or insufficient to assess licensing, footprint, or maintenance risk?
- What happens when the chosen stack renders representative data but struggles with the 1k-node target?
- What happens when browser screenshot tooling is unavailable in the implementation session?
- What happens when the prototype reveals a graph-rendering library or packaging dependency that violates the dependency policy?
- What happens when self-repo UAT cannot be completed because local indexing, representative export, or prototype execution fails?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The spike MUST evaluate all six roadmap candidates: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart.
- **FR-002**: The spike MUST gather official documentation evidence for every candidate before scoring.
- **FR-003**: The spike MUST gather current package and repository metadata for every candidate before scoring, including version, license, package footprint, and maintenance signals where available.
- **FR-004**: The decision matrix MUST apply hard gates for self-host-anywhere support, offline/package-shipped assets, absence of runtime hosted services, permissive licensing, and acceptable package footprint.
- **FR-005**: The decision matrix MUST exclude any candidate that fails a hard gate from final weighted ranking and record the failed gate with evidence.
- **FR-006**: For candidates that pass all hard gates, the spike MUST score criteria in this priority order: UX, deployment effort, developer experience, cost, footprint, and license/maintenance risk.
- **FR-007**: The spike MUST select exactly one stack as the recommendation and explain why it is the best fit for CodeGraph's local-first, self-hosted, package-shipped web platform.
- **FR-008**: The spike MUST build a throwaway graph-rendering prototype only in the selected stack.
- **FR-009**: The prototype MUST use representative CodeGraph data from this repository.
- **FR-010**: The prototype MUST include or simulate a 1k-node graph-rendering target and record whether that target was reached.
- **FR-011**: The spike MUST capture browser screenshot evidence from the prototype and commit small PNG assets under `docs/design/assets/spec-004/`.
- **FR-012**: The spike MUST write `docs/design/web-framework-decision.md` with the decision matrix, recommendation, shipping strategy, graph-rendering notes, screenshot references, and reproduction steps.
- **FR-013**: The spike MUST record a shipping strategy covering embedded package-shipped static assets and a standalone container recipe for later specs.
- **FR-014**: The spike MUST include a self-repo UAT step that exercises representative CodeGraph data from this repository and records the outcome.
- **FR-015**: The spike MUST keep committed artifacts docs/process-focused and MUST NOT add production web code.
- **FR-016**: The spike MUST NOT introduce hosted-service runtime dependencies, CDN runtime dependencies, source-available-only dependencies, or non-permissive dependencies.
- **FR-017**: The spike MUST document any fallback used when browser automation, package metadata, or graph-rendering validation cannot be performed exactly as planned.

### Reviewability Budget *(mandatory)*

- **Primary surface**: docs/process
- **Secondary surfaces, if any**: screenshot evidence assets
- **Projected reviewable LOC**: 250-500 documentation lines, excluding PNG assets
- **Projected production files**: 0
- **Projected total files**: 4-8
- **Budget result**: within budget
- **Split decision**: This remains one spec because it produces a bounded decision document, small screenshot evidence assets, and reproducible prototype notes with no production web code. Later production implementation belongs to SPEC-005, SPEC-006, and SPEC-007.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order,
  scope budget, traceability, verification evidence, known gaps, and rollback
  or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed
  files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities *(include if feature involves data)*

- **Framework Candidate**: One of the six roadmap web-stack options being evaluated, with associated documentation evidence, current metadata, hard-gate results, and weighted scores.
- **Hard Gate**: A pass/fail criterion that must be satisfied before weighted scoring can influence the recommendation.
- **Weighted Criterion**: A scored comparison factor used only after hard gates pass, ordered by UX, deployment effort, developer experience, cost, footprint, and license/maintenance risk.
- **Decision Document**: The reviewable output that records evidence, matrix results, recommendation, shipping strategy, graph-rendering notes, screenshots, and reproduction steps.
- **Prototype Evidence**: Screenshot assets and notes proving the selected stack can render representative CodeGraph graph data, including the 1k-node target.
- **Self-Repo UAT Result**: The recorded outcome of exercising the selected prototype path against data from this repository.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the six roadmap candidates have documented official-source evidence and current package or repository metadata before scoring.
- **SC-002**: 100% of hard-gate decisions cite evidence and clearly mark pass or fail for each candidate.
- **SC-003**: A maintainer can identify the recommended stack, the runner-up tradeoffs, and the reason for the final choice within 10 minutes of opening the decision document.
- **SC-004**: The prototype evidence includes at least two committed browser screenshots: one for representative self-repo graph data and one for the 1k-node target or the closest achieved fallback.
- **SC-005**: The reproduction notes allow a maintainer to rerun the prototype validation from a clean checkout using only documented local steps and package-shipped or locally generated assets.
- **SC-006**: The final SPEC-004 diff contains zero production web implementation files and no long-lived prototype source unless a later phase explicitly promotes it.
- **SC-007**: The decision document names every deferred implementation concern and maps each one to SPEC-005, SPEC-006, SPEC-007, or a clearly labeled follow-up.

## Assumptions

- The user of this spike is a CodeGraph maintainer or later web-spec author reviewing a docs/process decision, not an end user of a production web UI.
- The implementation phase may use temporary local prototype files during research, but only durable documentation, notes, and small PNG evidence assets are committed.
- The decision may name specific frameworks and graph-rendering libraries because the purpose of the feature is stack selection; this is evaluation scope, not production implementation.
- Current external facts such as package versions, repository activity, and license metadata must be refreshed during implementation rather than assumed from this specification.
- Representative CodeGraph data can be generated from this repository using the existing local-first CodeGraph workflow.
- If the full 1k-node target cannot be reached, the spike records the closest achieved result, the blocker, and the downstream implication instead of silently lowering the bar.
