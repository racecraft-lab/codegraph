---
topic: "Web Framework Research Spike"
slug: "web-framework-research-spike"
date: "2026-07-05"
mode: "setup"
spec_id: "SPEC-004"
source_input:
  type: "file"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md#SPEC-004"
question_count: 10
stop_reason: "natural"
---

# Design Concept: Web Framework Research Spike

> **Source:** docs/ai/specs/intelligence-platform-technical-roadmap.md#SPEC-004
> **Date:** 2026-07-05
> **Questions asked:** 10
> **Stop reason:** natural

## Goals

- Score all six roadmap shortlist candidates before recommending the web stack.
- Treat UX as the leading score among candidates that first satisfy hard local-first, self-host, offline, license, and package-shipping gates.
- Use the decision matrix to choose one stack, then build a throwaway graph-rendering prototype only in that chosen stack.
- Recommend embedded static assets in the npm package plus a standalone container recipe as the shipping strategy.
- Preserve browser screenshot evidence from the prototype in the decision report by committing small PNG assets under a SPEC-004 design-assets folder.
- Run the chosen prototype against representative CodeGraph data from this repository and record screenshots, performance notes, and reproduction steps.

## Non-goals

- Do not commit or maintain prototype source code as a production artifact; record the method and results instead (Q7).
- Do not let UX polish override hard local-first/self-host/offline/package/license constraints (Q3).
- Do not add hosted-service dependencies, CDN runtime dependencies, or source-available-only libraries (Q6).
- Do not build the full app shell or production web UI in SPEC-004; those belong to SPEC-005 and SPEC-006.

## Design Tree (Q&A log)

### Q1. For SPEC-004, should the research spike score the full roadmap shortlist before making the web stack recommendation?

**Branch:** Candidate scope

**Recommended answer:** Score all six roadmap candidates.
> The roadmap explicitly names Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart. Scoring all six keeps the decision grounded while staying inside a docs/process spike.

**Alternatives offered:**
- Narrow first: faster, but weaker evidence if later specs depend on an untested stack choice.
- Add more: broader market scan, but risks turning the spike into open-ended research.

**User's answer:** Score all six.

---

### Q2. What should be the primary weighting for the framework decision matrix?

**Branch:** Decision criteria

**Recommended answer:** Self-host first.
> The roadmap goal emphasizes self-hosting anywhere, minimal effort, cost efficiency, and local-first behavior. That suggested self-host and offline constraints should dominate the matrix.

**Alternatives offered:**
- DX first: optimizes developer velocity, but may underweight package footprint and standalone deployment.
- UX first: optimizes polish and interactivity, but may choose a heavier stack than the CLI package wants.

**User's answer:** UX first.

---

### Q3. Should UX-first weighting be allowed to beat local-first/self-host constraints, or should those remain hard gates?

**Branch:** Constraint boundaries

**Recommended answer:** Hard gates.
> The CodeGraph constitution requires local-first, private, zero-native-dependency behavior and dormancy by default. UX can lead the scoring only after a candidate passes those hard gates.

**Alternatives offered:**
- UX can override: could pick the most polished framework even if it complicates packaging or self-hosting.
- Case by case: more flexible, but makes the decision harder to verify consistently in the matrix.

**User's answer:** Hard gates.

---

### Q4. How deep should the throwaway graph-rendering prototype go before SPEC-004 declares the stack decision ready?

**Branch:** Prototype depth

**Recommended answer:** Chosen stack only.
> Use the matrix to pick the stack first, then prove the highest-risk graph-rendering path inside that stack against the roadmap's 1k-node target. This keeps the spike bounded.

**Alternatives offered:**
- Top two stacks: stronger comparison, but doubles prototype work for a spike that should stay reviewable.
- No prototype: fastest, but fails the roadmap requirement for a proven graph-rendering approach.

**User's answer:** Chosen stack only.

---

### Q5. What shipping strategy should SPEC-004 require the decision doc to recommend for the later web specs?

**Branch:** Shipping strategy

**Recommended answer:** Embedded plus container.
> This matches the roadmap: static assets ship in the npm package for SPEC-005, with a standalone container recipe for deploy-anywhere users.

**Alternatives offered:**
- Container only: clean for servers, but weakens local CLI/package distribution and offline use.
- Hosted optional: could improve convenience, but conflicts with the cost-efficient self-host-anywhere goal.

**User's answer:** Embedded plus container.

---

### Q6. What dependency policy should the spike apply when evaluating web frameworks and graph-rendering libraries?

**Branch:** Dependency and license policy

**Recommended answer:** Offline permissive.
> The package is MIT, local-first, and self-hosted. Candidate frameworks and graph libraries should use permissive licenses, avoid runtime hosted services, and support package-shipped assets.

**Alternatives offered:**
- Allow CDN: can simplify demos, but violates the offline/local-first posture for the shipped app.
- Allow source-available: expands options, but creates license risk for an MIT package.

**User's answer:** Offline permissive.

---

### Q7. Should the throwaway prototype code be committed as part of SPEC-004, or only its method and results recorded?

**Branch:** Prototype artifact boundary

**Recommended answer:** Record results.
> The roadmap budgets SPEC-004 as docs/process with zero production files. Recording results keeps the prototype throwaway while preserving enough method detail for review.

**Alternatives offered:**
- Commit prototype: gives reviewers runnable code, but expands the file surface and risks productionizing throwaway work.
- Commit script: middle ground, but still adds maintenance burden unless SPEC-005 or SPEC-006 reuse it directly.

**User's answer:** Record results, with browser-tool screenshots added to the report.

**Notes:** The workflow should use available browser automation to capture screenshots when the prototype runs. If a specific browser tool is unavailable in the implementation session, use an equivalent local browser or Playwright screenshot path and record the fallback.

---

### Q8. What source standard should the SPEC-004 workflow require for framework and graph-library evaluation?

**Branch:** Research evidence

**Recommended answer:** Official plus live.
> Framework and graph-library facts are temporally unstable, so the implementation should use official docs, repository/package metadata, and current release/license facts before recommending a stack.

**Alternatives offered:**
- Docs only: cleaner and faster, but may miss current package health, bundling, or license constraints.
- Prototype only: directly tests UX/performance, but weakens traceability for maintainers reviewing the decision.

**User's answer:** Official plus live.

---

### Q9. What should count as the required self-repo dogfooding evidence for this research spike?

**Branch:** Dogfooding evidence

**Recommended answer:** Screenshots plus notes.
> The roadmap's Dogfooding Protocol requires web specs to browse and serve this repo first. For a research spike, representative CodeGraph data plus screenshots, performance notes, and reproduction steps is the right-sized evidence.

**Alternatives offered:**
- Written rationale only: lowest effort, but too weak for the roadmap's web specs browse-and-serve-this-repo requirement.
- Full app demo: stronger evidence, but belongs in SPEC-006 rather than a research spike.

**User's answer:** Screenshots plus notes.

---

### Q10. How should prototype screenshots be preserved in the SPEC-004 decision report?

**Branch:** Evidence storage

**Recommended answer:** Commit PNGs.
> Tool-generated image links can expire or be unavailable to reviewers. Small committed PNGs keep the report self-contained and reviewable.

**Alternatives offered:**
- Link ephemeral: less repo churn, but generated links can expire or be unavailable to reviewers.
- Describe only: smallest artifact set, but loses visual evidence for the prototype decision.

**User's answer:** Commit PNGs.

## Open Questions

- **What:** Exact candidate versions, graph-library versions, license facts, and package health.
  **Why deferred:** These are current external facts that must be gathered live during SPEC-004 implementation.
  **Suggested next step:** In the Specify/Plan phases, require official documentation plus live package/repository metadata for every candidate.
- **What:** Exact browser automation surface available during prototype capture.
  **Why deferred:** The scaffold session found browser-adjacent capability, but the implementation session must use the real available tool surface.
  **Suggested next step:** Use browser automation when available; otherwise use an equivalent local Playwright/browser screenshot flow and record the fallback.

## Size Advisory

The shared estimator was run with `--spike` using one user story, three files/surfaces, five functional requirements, and net-new work. It returned `{"estimated_loc":0,"suggested_slices":1,"status":"ok"}`. No split is recommended because SPEC-004 is a research spike sized by evidence and timebox, not production LOC.

## Recommended Next Step

Run setup continuation for SPEC-004 using this design concept. The workflow should seed Specify, Clarify, Plan, Checklist, Tasks, Analyze, and Implement prompts from these decisions.
