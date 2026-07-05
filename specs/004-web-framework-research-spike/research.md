# Phase 0 Research: Web Framework Research Spike

## Decisions

### Candidate scope

**Decision**: Evaluate the full roadmap shortlist: Vite+React SPA, SvelteKit static/adapter-node, Next.js standalone, Astro islands, TanStack Start, and SolidStart.

**Rationale**: Later web specs depend on this choice. Evaluating all six prevents the stack decision from being re-opened during SPEC-005, SPEC-006, and SPEC-007.

**Alternatives considered**: Narrowing to one or two candidates would be faster but would weaken the decision record. Adding candidates would turn a bounded research spike into open-ended market research.

### Decision priority

**Decision**: Use hard gates first, then weighted scoring with UX as the leading score.

**Rationale**: The design concept records Q2 as "UX first" and Q3 as "Hard gates." That means the best interaction model should win only among candidates that already satisfy CodeGraph's local-first and package-shipping constraints.

**Alternatives considered**: Allowing UX to override local-first constraints could produce a polished stack that is wrong for a private, self-hosted npm package. Treating every criterion as equal would underweight the future graph-browser experience.

### Prototype depth

**Decision**: Build a throwaway graph-rendering prototype only in the chosen stack.

**Rationale**: The design concept records Q4 as "Chosen stack only." The prototype proves the highest-risk rendering path without doubling work across runner-up stacks.

**Alternatives considered**: Prototyping the top two stacks would add evidence but exceed the docs/process spike's reviewability goal. Skipping a prototype would leave the graph-rendering risk unresolved.

### Shipping strategy

**Decision**: Recommend embedded package-shipped static assets plus a standalone container recipe.

**Rationale**: The design concept records Q5 as "Embedded plus container." This matches CodeGraph's npm distribution and gives deploy-anywhere users a clear server/container path.

**Alternatives considered**: Container-only would weaken CLI/package distribution. Hosted deployment would conflict with the no hosted-service runtime dependency gate.

### Dependency policy

**Decision**: Require offline, permissively licensed framework and graph-rendering dependencies.

**Rationale**: The design concept records Q6 as "Offline permissive." CodeGraph is local-first and MIT-oriented; web dependencies must not add CDN, hosted-service, native-build, source-available-only, or non-permissive runtime requirements.

**Alternatives considered**: CDN-backed demos are easier to prototype but not acceptable as the shipped posture. Source-available packages add license and redistribution risk.

### Evidence standard

**Decision**: Use official documentation plus live package/repository metadata for every candidate.

**Rationale**: The design concept records Q8 as "Official plus live." Framework facts are current-state facts, so implementation must refresh versions, licenses, package sizes, and repository health when the spike is performed.

**Alternatives considered**: Official docs alone may miss stale releases or package footprint. Prototype-only evidence would not explain why rejected candidates failed.

### Evidence artifacts

**Decision**: Record prototype results, browser screenshots, and notes; do not commit prototype source.

**Rationale**: The design concept records Q7 as "Record results, with browser-tool screenshots added to the report," Q9 as "Screenshots plus notes," and Q10 as "Commit PNGs." Small committed PNGs keep the report reviewable without adding long-lived web code.

**Alternatives considered**: Committing prototype source creates maintenance burden and risks productionizing throwaway work. Ephemeral image links can expire or be inaccessible to reviewers.

## Candidate Matrix Template

The implementation fills this matrix in `docs/design/web-framework-decision.md` after current-source research:

| Candidate | Official docs evidence | Live metadata | Hard gates | Weighted score | Outcome |
|-----------|------------------------|---------------|------------|----------------|---------|
| Vite+React SPA | Build/static serving docs; React docs | npm package data and repository health | Gate status with evidence | Score only if all gates pass | Recommend/reject |
| SvelteKit static/adapter-node | Adapter/static/Node deployment docs | npm package data and repository health | Gate status with evidence | Score only if all gates pass | Recommend/reject |
| Next.js standalone | Standalone output/deployment docs | npm package data and repository health | Gate status with evidence | Score only if all gates pass | Recommend/reject |
| Astro islands | Static build/islands docs | npm package data and repository health | Gate status with evidence | Score only if all gates pass | Recommend/reject |
| TanStack Start | Self-host/build/deployment docs | npm package data and repository health | Gate status with evidence | Score only if all gates pass | Recommend/reject |
| SolidStart | Self-host/build/deployment docs | npm package data and repository health | Gate status with evidence | Score only if all gates pass | Recommend/reject |

## Hard Gates

| Gate | Measurement |
|------|-------------|
| Self-host anywhere | Candidate has documented local static or Node/container serving path and no mandatory proprietary platform. |
| Offline/package-shipped assets | Candidate can run with package-shipped JS/CSS/assets and locally generated CodeGraph data; no runtime CDN required. |
| No hosted-service runtime dependency | Candidate does not require hosted SaaS, cloud functions, hosted databases, hosted auth, telemetry, or remote asset services for normal operation. |
| Permissive license | Runtime framework, graph renderer, and required runtime dependencies are permissively licensed and redistributable with an MIT package. |
| Package footprint | Implementation measures production asset size and runtime dependency size, then records whether the candidate is acceptable for npm package shipping. |
| Maintenance health | Candidate is not archived/deprecated, has meaningful activity within the last 12 months, and shows no current maintainer warning that makes it risky as the base stack. |

Any hard-gate failure excludes the candidate from weighted ranking.

## Weighted Scoring

Use a 0-5 score per criterion and report the weighted total out of 100:

| Criterion | Weight |
|-----------|--------|
| UX and graph-interaction fit | 35 |
| Deployment effort | 20 |
| Developer experience | 15 |
| Cost/self-host operations | 10 |
| Footprint | 10 |
| License and maintenance risk | 10 |

UX leads after gates pass. It must not override local-first, offline, hosted-service, license, footprint, or maintenance-health failures.

## Current-Source Research Procedure

1. For each framework, collect official docs for build output, self-hosting, routing, static assets, adapter/runtime model, and container suitability.
2. For each framework and graph-rendering library under consideration, collect live npm metadata: latest version, license, dependency summary, package size signals, and repository URL.
3. Collect live repository metadata: archive/deprecation status, latest release, latest meaningful activity, license file, and obvious maintenance warnings.
4. Record access dates and source URLs next to each claim in the decision document.
5. If official docs and metadata disagree, document the conflict and use the stricter interpretation unless the prototype reproduces the safer path locally.
6. Apply hard gates before weighted scoring.

## Prototype Research Procedure

1. Select one stack after gates and weighted scoring.
2. Create throwaway prototype source outside the durable repo tree.
3. Use representative CodeGraph data from this repository in the documented graph JSON shape.
4. Render both a representative self-repo graph and a 1k-node target or closest fallback.
5. Capture browser screenshots and save small PNG assets under `docs/design/assets/spec-004/`.
6. Record commands, browser/tooling, machine context, node/edge counts, render timing, interaction observations, and limitations.
7. Delete or leave untracked all prototype source and generated build output.

## Artifact Decisions

**Decision**: The durable decision report is `docs/design/web-framework-decision.md`.

**Rationale**: This keeps the later SPEC-005/SPEC-006/SPEC-007 plans anchored to one reviewable source.

**Alternatives considered**: Keeping the decision only under `specs/004...` would bury the reusable architecture decision inside the workflow folder.

**Decision**: Screenshot evidence lives under `docs/design/assets/spec-004/`.

**Rationale**: Versioned PNGs keep evidence self-contained and avoid expiring generated-image links.

**Alternatives considered**: Describing screenshots without committing assets would not satisfy the evidence requirement.

## Resolved Planning Questions

- Exact candidate versions, package footprints, license facts, and maintenance signals are implementation-time facts, not plan blockers. They must be refreshed during SPEC-004 implementation.
- Browser automation surface is implementation-time tooling. If the preferred browser tool is unavailable, the implementation may use local Playwright or equivalent browser screenshot capture and must record the fallback.
- No production code, schema changes, extraction changes, retrieval changes, MCP changes, or installer changes are required.
