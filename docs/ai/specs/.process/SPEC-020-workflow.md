# SpecKit Workflow: SPEC-020 — PR Blast-Radius Review Action

**Template Version**: 1.0.0
**Created**: 2026-07-15
**Purpose**: Execute SPEC-020 through the SpecKit workflow and deliver a reusable
GitHub Action that posts deterministic pull-request blast-radius reports,
enforces only configured thresholds, degrades safely for forks, and keeps
optional LLM narrative prose-only.

---

## Design Concept

This workflow file was enriched from the nine-question Grill Me interview run
during `$speckit-scaffold-spec SPEC-020`. The full Q&A log, Goals, Non-goals,
and Open Questions live at:

```text
docs/ai/specs/.process/SPEC-020-design-concept.md
```

Re-read it before every phase. It is the source of truth for these load-bearing
decisions:

- **Q1 — Safe fork support:** analyze every PR, but skip privileged commenting
  or secret-backed narrative when the event cannot safely provide them.
- **Q2 — Thresholds only:** ordinary impact is informational; only configured
  caller or hub threshold breaches fail the check.
- **Q3 — Fail explicitly:** if indexing or impact analysis remains unavailable
  after fallback, emit the unavailable report and fail the check.
- **Q4 — Prose only:** optional LLM narrative is off by default and cannot
  change deterministic facts, thresholds, or status.
- **Q5 — One sticky comment:** identify the action-owned comment with a stable
  hidden marker and edit it in place.
- **Q6 — Validate or rebuild:** cache is an optimization; stale or missing
  indexes are rebuilt before analysis.
- **Q7 — Durable fallback:** when commenting is unavailable, publish the exact
  deterministic report to the job summary and as an artifact.
- **Q8 — Advisory dogfood:** CodeGraph's first automatic workflow has no
  blocking thresholds.
- **Q9 — Keep one spec:** the maintainer declined the estimator's recommended
  two-slice split; planning must keep the one-spec scope reviewable.

> **Note:** Grill Me is human-in-the-loop only. It is not part of the
> autopilot loop. Once this workflow begins, clarifications happen via
> `/speckit-clarify` and the consensus protocol.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | G1 passed with 0 clarification markers |
| Clarify | `/speckit-clarify` | ✅ Complete | G2 passed with 0 clarification markers |
| Plan | `/speckit-plan` | ✅ Complete | G3 passed; reviewability warning accepted, no blockers |
| Checklist | `/speckit-checklist` | ✅ Complete | G4 passed with 48 checklist items and 0 gaps |
| Tasks | `/speckit-tasks` | ✅ Complete | G5 passed with 60 dependency-ordered tasks |
| Analyze | `/speckit-analyze` | ⏳ Pending | |
| Confidence Gate | G6.5 | ⏳ Pending | Advisory pre-implementation confidence check |
| Implement | `/speckit-implement` | ⏳ Pending | |
| Post | Post-Implementation | ⏳ Pending | Verification, reviewability, PR, and retrospective |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | Ambiguities resolved, decisions documented |
| G3 | After Plan | Architecture approved, constitution gates pass, dependencies identified |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified, dependencies ordered |
| G6 | After Analyze | No `CRITICAL` issues, `WARNING` items reviewed |
| G6.5 | Confidence Gate | Pre-implementation confidence recorded; advisory by default |
| G7 | After Each Implementation Phase | Tests pass, manual verification complete |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I–III. Deliberate, simple, surgical | Add the smallest reusable action surface under `actions/pr-impact/`; avoid detector rewrites or unrelated workflow cleanup | Plan Constitution Check plus final diff review |
| IV. Goal-driven and test-first | Specify observable PR-event, threshold, unavailable, cache, and report-delivery scenarios before implementation | Failing focused tests before each implementation task; `npm test` at G7 |
| V. Deterministic graph authority | `detect-changes` JSON/markdown and exit codes remain canonical; LLM output is prose-only | Contract tests prove narrative cannot alter findings or conclusions |
| VII. Local-first and private | Narrative is off by default; fork runs receive no privileged secrets; cache/report behavior makes no unrelated network calls or schema writes | Fork-permission tests, secret-hygiene review, dormancy tests |
| Dogfooding discipline | Exercise the action on CodeGraph itself and preserve a reproducible self-repo validation path | `.github/workflows/pr-impact.yml`, warm-cache timing evidence, manual UAT |

**Constitution Check:** ✅ Complete — Phase 1 specification aligns with the
constitution's deterministic graph authority, local-first privacy, and
goal-driven reviewability constraints.

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-020 |
| **Name** | PR Blast-Radius Review Action |
| **Branch** | `020-pr-blast-radius-review-action` |
| **Dependencies** | SPEC-012 (required, complete); SPEC-018 (optional narrative path, complete) |
| **Enables** | CI change-safety reporting and opt-in blast-radius enforcement |
| **Priority** | P1 |

### Reviewability Budget

| Item | Value |
|------|-------|
| Setup gate | **warn**, pass=true, no blockers; roadmap projection 405 reviewable LOC |
| Roadmap surface | Net-new · approximately 4 production files · approximately 11 total files |
| Grill Me estimator | 4 acceptance-capability groups + 4 production surfaces + 13 requirement groups → **455 LOC**, **2 suggested slices**, `warn` |
| Maintainer decision (Q9) | **Keep SPEC-020 as one spec**; the split recommendation was declined |
| Planning constraint | Do not widen scope to absorb the warning. Re-run the authoritative reviewability checks at plan, tasks, and pre-PR gates; surface any hard blocker rather than silently splitting or exceeding it. |

### Success Criteria Summary

- [ ] A reusable action prepares Node/CodeGraph, restores and validates an
  index cache keyed from the repository state, rebuilds when necessary, and
  runs `detect-changes --base-ref` for the pull request.
- [ ] The deterministic markdown report lists changed symbols, callers,
  affected flows, risks, warnings, and limits; one hidden-marker comment is
  updated in place when permissions allow.
- [ ] Successfully computed reports remain available in the job summary and
  as an artifact when PR commenting is unavailable.
- [ ] Ordinary impact passes; configured caller or hub threshold breaches map
  to a failing check; analysis unavailability after fallback also fails
  explicitly.
- [ ] Fork pull requests run without privileged secrets and degrade delivery
  or narrative safely rather than elevating trust.
- [ ] Optional SPEC-018-backed narrative is off by default, prose-only, and
  unable to alter deterministic facts or status.
- [ ] CodeGraph dogfoods the action automatically in advisory mode, with
  median warm-cache completion at or below three minutes.

---

## Phase 1: Specify

**When to run:** At the start of a new feature specification. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/020-pr-blast-radius-review-action/spec.md`

### Specify Prompt

```text
/speckit-specify Create a reusable GitHub Action that reports deterministic pull-request blast radius, enforces opt-in thresholds, degrades safely for forks, and keeps optional LLM narrative prose-only.
```

#### Detailed Prompt (for complex specs)

```text
/speckit-specify

## Feature: PR Blast-Radius Review Action

### Problem Statement
CodeGraph can already produce deterministic pull-request impact data through
SPEC-012, but repositories do not have a reusable CI integration that restores
or rebuilds the graph index, compares the pull request with its merge base,
publishes the result where reviewers work, and enforces opt-in risk thresholds.
SPEC-020 turns that existing detector into a safe, reusable GitHub Action.

### Users
- Pull-request authors who need early visibility into callers and affected
  flows before merge.
- Reviewers who need one current, compact blast-radius report.
- Repository maintainers who want configurable caller/hub policy without
  making every impacted change fail.

### User Stories
1. A reviewer receives one current deterministic impact report for each PR,
   with the same report preserved in the workflow run when commenting is not
   permitted (Q1, Q5, Q7).
2. A maintainer opts into caller or hub thresholds; ordinary impact remains
   advisory, threshold breaches fail, and unavailable analysis fails
   explicitly rather than looking safe (Q2, Q3).
3. A CI run restores a compatible index when possible and validates or rebuilds
   it before analysis, meeting the warm-cache performance target without
   sacrificing correctness (Q6).
4. A maintainer may enable SPEC-018 narrative for trusted runs, but deterministic
   findings and status remain canonical; CodeGraph initially dogfoods the
   action without blocking thresholds (Q4, Q8).

### Constraints
- Re-read `docs/ai/specs/.process/SPEC-020-design-concept.md`; its Q1–Q9
  decisions are binding scoping inputs.
- Build on SPEC-012's `base-ref` mode, stable JSON/markdown schema, affected
  flow states, warnings, limits, and exit-code meanings. Do not redesign the
  detector unless a proven contract gap blocks the action.
- Analyze fork PRs without privileged secrets. A delivery-permission limitation
  may skip the comment or narrative, but must not erase a successful report.
- Cache is an optimization only: validate restored state and rebuild on a miss
  or stale result. Never report a stale index as current.
- Optional narrative is off by default and prose-only. It cannot add
  machine-consumed facts, change thresholds, or decide the check result.
- Median warm-cache runtime target: no more than 3 minutes on CodeGraph's
  self-repository dogfood workflow.
- Keep the roadmap's one-spec scope despite Q9's advisory size warning; do not
  widen it with speculative inputs, providers, or CI abstractions.

### Out of Scope
- Other CI vendors and inline code comments.
- Comment history, one-comment-per-run behavior, or elevated identical behavior
  for untrusted forks.
- Failing on any nonzero impact or adding a configurable pass policy for
  unavailable analysis.
- LLM-derived machine risk classification or check authority.
- Trusting any cache hit without validation or rebuilding every run
  unconditionally.
```

### Specify Results

<!-- Fill in after running the command -->

| Metric | Value |
|--------|-------|
| Functional Requirements | FR-001 through FR-049 after clarify |
| User Stories | 4 |
| Acceptance Criteria | 13 |
| Quality Checklist | 16/16 complete |
| G1 Gate | Passed — `spec.md` exists with 0 `[NEEDS CLARIFICATION]` markers |

### Files Generated

- [x] `specs/020-pr-blast-radius-review-action/spec.md`
- [x] `specs/020-pr-blast-radius-review-action/checklists/requirements.md`

### SpecKit Traceability Markers

Use these markers in spec.md for traceability through later phases:

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] User searches by query` |
| `[FR-001]` | Functional requirement | `[FR-001] API returns paginated results` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `Auth method [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Can run alongside other tasks` |
| `[Gap]` | Missing coverage | `[Gap] No task covers error handling` |

---

## Phase 2: Clarify (Optional but Recommended)

**When to run:** When spec has areas that could be interpreted multiple ways. 10-20 minutes here saves hours of rework later.

**Best Practice:** Maximum 5 targeted questions per Clarify session.

### Clarify Prompts

#### Session 1: Action Runtime and Cache Contract

```text
/speckit-clarify Focus on the reusable action contract: how action.yml invokes
the roadmap's TypeScript helper without depending on uncompiled source; how the
action pins the CodeGraph CLI/runtime reproducibly; exact action inputs and
outputs; cache-key composition from lockfile, merge base, base ref, and PR head;
and the freshness proof that decides whether a restored index is valid or must
be rebuilt. Preserve Q6's "Validate or rebuild" decision.
```

#### Session 2: Trust Boundary and Report Delivery

```text
/speckit-clarify Focus on safe PR execution: trusted same-repo events versus
forks; minimum token permissions; secret and narrative suppression; how a
successful report degrades from sticky comment to job summary plus artifact;
hidden-marker ownership and duplicate-comment recovery; and explicit behavior
for permission-denied, deleted-comment, and rerun races. Preserve Q1 "Safe fork
support", Q5 "One sticky comment", and Q7 "Job summary and artifact".
```

#### Session 3: Check Conclusion, Narrative, and Performance

```text
/speckit-clarify Focus on the result matrix: SPEC-012 detector exits for clean,
ordinary impact, configured threshold breach, and unavailable analysis; exact
mapping to action outputs, step outcome, and job conclusion; caller/hub input
syntax and unset defaults; optional SPEC-018 narrative behavior when disabled,
misconfigured, or unavailable; and the measurement protocol for the <=3 minute
median warm-cache target. Preserve Q2 "Thresholds only", Q3 "Fail explicitly",
Q4 "Prose only", and Q8 "Advisory first".
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Action Runtime and Cache Contract | 3 | Added clarifications for packaged pinned runtime, minimum action input/output contract, detector policy mapping, and cache freshness proof. G2 marker check passed. Consensus checkpoint: no unresolved items. |
| 2 | Trust Boundary and Report Delivery | 3 | Added clarifications for pull-request trust boundary, least-privilege comment/narrative eligibility, sticky-comment recovery, duplicate handling, rerun identity, and summary/artifact fallback. G2 marker check passed. Consensus checkpoint: no unresolved items. |
| 3 | Check Conclusion, Narrative, and Performance | 3 | Added clarifications for detector-result to check-conclusion mapping, narrative degradation/status, and the five-run warm-cache measurement protocol. G2 marker check passed. Consensus checkpoint: no unresolved items. |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Generates technical implementation blueprint. Output: `specs/020-pr-blast-radius-review-action/plan.md`

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Language/runtime: TypeScript strict mode on Node `>=20 <25`; source paths
  using `node:sqlite` require Node 22.5+, and the repository pins Node 24.11.1.
- Action surface: reusable composite action under `actions/pr-impact/`, with
  `action.yml` and the roadmap's `run.ts` helper; resolve the executable
  packaging/versioning question rather than assuming TypeScript runs directly.
- Existing capability: SPEC-012 `detect-changes --base-ref` with stable
  schema-versioned JSON/markdown and exit codes 0 clean, 1 impact, 2 threshold
  breach, 3 unavailable.
- Storage/cache: CodeGraph's local SQLite/FTS5 index under `.codegraph/`;
  GitHub Actions cache is an optimization around that deterministic state.
- Testing/build: Vitest under `__tests__/`; `npm test`; `npm run build`
  (TypeScript plus `copy-assets`). Any shipped generated action artifact must
  be accounted for in the build/release plan.

## Constraints
- Re-read `docs/ai/specs/.process/SPEC-020-design-concept.md`; Q1–Q9 are
  ratified inputs. Quote and preserve the chosen answers when a plan decision
  depends on them.
- Keep the detector contract canonical. Optional narrative is "Prose only"
  (Q4) and may never change structured findings, thresholds, or conclusion.
- Implement "Safe fork support" (Q1) with least privilege and no privileged
  secrets in untrusted runs. Delivery permission failure is not analysis
  failure; successful reports still reach the summary and artifact (Q7).
- Implement "Validate or rebuild" (Q6): prove cache freshness before use and
  rebuild on stale/missing state. Preserve SPEC-012's stale and unavailable
  states rather than masking them.
- Map "Thresholds only" (Q2) and "Fail explicitly" (Q3) into one exhaustive
  detector-result/action-conclusion table.
- Dogfood automatically but "Advisory first" (Q8): thresholds unset in the
  initial `.github/workflows/pr-impact.yml`.
- Median warm-cache completion must be <=3 minutes on this repository.
- Q9 keeps one spec despite a 455-LOC advisory estimate. Plan the smallest
  complete surface, list production/total files, run the reviewability
  estimator, and do not invent extra configuration to absorb edge cases.

## Architecture Notes
- The action orchestration is checkout/setup → cache restore → freshness
  validation/rebuild → `detect-changes --base-ref` → deterministic markdown
  publication → optional narrative append. Every stage needs an explicit,
  testable failure class.
- One stable hidden marker identifies the action-owned PR comment (Q5); edit it
  in place and avoid touching unrelated comments.
- Separate analysis availability from report delivery availability in types,
  outputs, and tests. Analysis unavailable after fallback fails; comment
  unavailable safely degrades without rewriting the analysis conclusion.
- Keep narrative integration behind SPEC-018's public seam and disabled by
  default. Do not duplicate provider, secret, retry, or prompt infrastructure.
- Prefer action/input contract fixtures and dependency injection around GitHub
  API calls over live-network unit tests. The dogfood workflow supplies the
  binding self-repository UAT surface.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ | Technical context, execution flow, constitution check, declared file operations, and reviewability gate fields |
| `research.md` | ✅ | Runtime packaging, version pinning, detector mapping, trust boundary, cache validation, narrative, and performance decisions |
| `data-model.md` | ✅ | Pull request context, action inputs, detector result, cache, delivery, narrative, and conclusion state |
| `contracts/` | ✅ | Action contract, result matrix, and report contract |
| `quickstart.md` | ✅ | Focused validation scenarios and PR evidence checklist |
| Reviewability | ⚠️ | Setup-mode gate passed with warning: 455 reviewable LOC > 400 warning threshold; no blockers |
| G3 Gate | ✅ | `plan.md` exists with 0 unresolved markers |

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates both spec AND plan together. Run multiple times for different domains.

**Best Practice:** Don't guess which domains to check. Analyze the spec first, then generate enriched prompts with spec-specific focus areas.

### Step 1: Analyze Spec for Recommended Domains

| Signal in SPEC-020 | Recommended Domain |
|---|---|
| Reusable `action.yml` inputs/outputs, detector exit mapping, sticky-comment marker contract | **api-contracts** |
| Fork trust boundaries, token permissions, secrets, optional narrative, comment ownership | **security** |
| Cache miss/staleness, rebuild failure, detector unavailable, delivery degradation, rerun races | **error-handling** |
| <=3 minute warm-cache target, index restore/rebuild behavior, PR update frequency | **performance** |

These four domains cover the risk concentration. UX, accessibility,
data-integrity, and streaming-protocol are not primary domains for this
headless CI adapter.

### Step 2: Run Enriched Checklist Prompts

For each domain, include spec-specific focus areas in the prompt — not just the bare domain name.

#### 1. api-contracts Checklist

Why this domain: `action.yml`, step outputs, markdown publication, and
detector exit-code mapping form a public integration contract for consuming
repositories.

```text
/speckit-checklist api-contracts

Focus on PR Blast-Radius Review Action requirements:
- Every action input has type-like validation, a deterministic default, and a
  documented mapping to SPEC-012 `detect-changes` behavior.
- Outputs and conclusions distinguish clean, ordinary impact, threshold breach,
  analysis unavailable, and report-delivery unavailable.
- The sticky marker and markdown structure are stable across reruns.
- Pay special attention to backward-compatible versioning of the action and
  CodeGraph CLI/helper it executes.
```

#### 2. security Checklist

Why this domain: fork PRs are untrusted while commenting and optional narrative
may require privileges or secrets.

```text
/speckit-checklist security

Focus on PR Blast-Radius Review Action requirements:
- Minimum token permissions and safe same-repo versus fork behavior.
- No secret-backed narrative or elevated execution for untrusted changes.
- Comment lookup/editing cannot modify comments the action does not own.
- Cache keys and restored paths cannot be steered outside the intended
  repository state.
- Pay special attention to event/context choices that could execute PR code
  with write credentials.
```

#### 3. error-handling Checklist

Why this domain: the feature's correctness depends on distinguishing analysis
failure from safe delivery degradation.

```text
/speckit-checklist error-handling

Focus on PR Blast-Radius Review Action requirements:
- Cache miss, stale cache, corrupt cache, index rebuild failure, and detector
  exit 3 each have an explicit observable outcome.
- Comment permission denial, deleted sticky comments, duplicate markers, API
  retries, and artifact upload failure do not erase computed analysis.
- Threshold breach remains distinguishable from infrastructure failure.
- Pay special attention to exhaustive result-to-check-conclusion mapping and
  whether any unavailable path can accidentally pass as safe.
```

#### 4. performance Checklist

Why this domain: the roadmap binds the action to a median warm-cache runtime of
three minutes or less while requiring correctness-preserving cache validation.

```text
/speckit-checklist performance

Focus on PR Blast-Radius Review Action requirements:
- Define the benchmark event, checkout size, cache state, sample count, and
  median calculation for the warm-cache target.
- Ensure validation is cheaper than unconditional indexing while still proving
  freshness.
- Bound API retries and optional narrative so they cannot silently consume the
  entire runtime budget.
- Pay special attention to fork and cache-miss paths being measured separately
  from the binding warm-cache path.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| api-contracts | 14 | 0 | FR-022–FR-029; contracts/action-contract.md; contracts/result-matrix.md; contracts/report-contract.md |
| security | 12 | 0 | FR-030–FR-033; Q1 safe fork support; Q4 prose-only narrative |
| error-handling | 12 | 0 | FR-013–FR-015; FR-039–FR-047; Q3 explicit unavailable failure |
| performance | 10 | 0 | FR-048–FR-049; SC-016; Q6 validate-or-rebuild |
| **Total** | 48 | 0 | G4 passed with 0 `[Gap]` markers |

### Addressing Gaps

When checklist identifies `[Gap]` items:

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/020-pr-blast-radius-review-action/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, testable chunks (1-2 hours each)
- Clear acceptance criteria referencing FR-xxx
- Dependency ordering: contract fixtures → advisory reporting → policy
  enforcement → optional narrative/dogfood validation
- Mark parallel-safe tasks explicitly with [P]
- Organize by user story, not by technical layer
- Re-read `spec.md`, `plan.md`, and
  `docs/ai/specs/.process/SPEC-020-design-concept.md`; include the Q-number
  behind each security, degradation, conclusion, cache, and rollout test.
- Write the failing test or fixture assertion before each behavior task.

## Implementation Phases
1. Contract fixtures and the smallest reproducible action runtime seam.
2. Advisory report end-to-end: cache validate/rebuild, base-ref analysis, one
   sticky comment, summary plus artifact fallback, safe fork degradation.
3. Policy end-to-end: caller/hub inputs, threshold-only blocking, explicit
   unavailable-analysis failure, exhaustive conclusion tests.
4. Optional prose-only narrative, advisory CodeGraph dogfood workflow,
   warm-cache measurement, documentation and release-note validation.

## Constraints
- Roadmap production files are centered on
  `actions/pr-impact/action.yml`, `actions/pr-impact/run.ts`, and
  `.github/workflows/pr-impact.yml`; tests belong under `__tests__/` using
  repository conventions. The plan owns any additional exact paths.
- Keep changes to SPEC-012 detector code additive and only when a contract test
  proves the action cannot consume the existing public surface.
- No other CI vendors, inline comments, comment history, LLM machine authority,
  or speculative action inputs (Design Concept Non-goals).
- Q9 keeps one spec despite the 455-LOC advisory estimate. Generate the minimum
  task set, preserve one coherent spec scope, and carry reviewability checks
  into task and pre-PR gates.
- If the action ships generated JavaScript or another static asset, add explicit
  source-of-truth, build, freshness-test, and package-inclusion tasks; do not
  hand-maintain an unexplained bundle.
- Add a user-facing `CHANGELOG.md` bullet under `## [Unreleased]`.
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | 60 |
| **Phases** | 7 — setup, foundation, US1, US2, US3, US4, polish |
| **Parallel Opportunities** | 6 groups — foundation tests, US1 tests, US2 tests, US3 tests, US4 tests, polish docs/changelog |
| **User Stories Covered** | 4 of 4 — US1 current report, US2 safe fallback, US3 policy enforcement, US4 cache/narrative |

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot SKILL runs
the read-only atomicity classifier and records its decision here. This is a
**placeholder** until then — leave the cells blank during scoping. The classifier
emits one machine-readable decision; the SKILL is what writes it into this section
(the script never writes a file of its own). This route is recorded only here in the
workflow file — never in the spec map. It is read downstream by the layer-planner and
multi-PR emission work that builds on top of it; recording it now wires no PR creation
or branch splitting on its own.

The decision answers "can this change be split into multiple small PRs safely?" by
inspecting the change's structural seams (independent additive capabilities), not its
line count. Surface the four fields the SKILL extracts from the emitted decision:

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | `one-navigable-PR` | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | `true` | `true`, or `false` for a destructive-migration or concurrency-sensitive change (a passing CI run does not prove such a change is safe to release). |
| **Signals** | `change-shape:modify-heavy` | The decisive detector findings behind the route and releasability reading (may be empty when the classifier abstains). |
| **Warnings** | none | Any release-safety warning attached to the change (empty when there is no releasability risk). |

To produce the decision, run the classifier against the feature directory:

```text
runner helper atomicity-route specs/020-pr-blast-radius-review-action
```

See the classifier script at
[`speckit-autopilot/scripts/atomicity-route`](../../speckit-autopilot/scripts/atomicity-route).

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks to catch issues.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Cross-artifact consistency across `spec.md`, `plan.md`, `tasks.md`,
   and `docs/ai/specs/.process/SPEC-020-design-concept.md`.
2. Decision drift: prove Q1 safe fork support, Q2 threshold-only blocking, Q3
   explicit unavailable failure, Q4 prose-only narrative, Q5 one sticky
   comment, Q6 validate-or-rebuild, Q7 summary+artifact fallback, Q8 advisory
   dogfood, and Q9 one-spec scope all have requirements and tasks.
3. Exhaustive result coverage: clean, ordinary impact, caller breach, hub
   breach, stale/missing/corrupt cache, rebuild failure, detector unavailable,
   comment unavailable, and narrative unavailable.
4. Security and dormancy: no fork path executes untrusted code with privileged
   secrets; narrative is disabled by default; LLM prose has no machine
   authority.
5. File-path and build consistency: action runtime packaging is reproducible,
   generated assets have freshness/package tasks, and no task assumes
   TypeScript executes directly without a supported runner.
6. Reviewability: the maintainer kept one spec despite the 455-LOC warning.
   Flag scope growth, missing estimator evidence, or tasks that turn vertical
   user stories into horizontal implementation layers.
```

### Analyze Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| `CRITICAL` | Blocks implementation, violates constitution | **Must fix before G6 gate** |
| `HIGH` | Significant gap, impacts quality | Should fix |
| `MEDIUM` | Improvement opportunity | Review and decide |
| `LOW` | Minor inconsistency | Note for future |

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| | | | |

---

## Phase 6.5: Confidence Gate

**When to run:** After analyze and before implementation.

**Mode:** Advisory unless overridden by local SpecKit Pro configuration.

| Gate | Status | Evidence |
|------|--------|----------|
| G6.5 | ⏳ Pending | Awaiting Phase 6 confidence emit |

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```text
/speckit-implement

## Approach: TDD-First

For each task, follow this cycle:

1. **RED**: Write failing test defining expected behavior
2. **GREEN**: Implement minimum code to make test pass
3. **REFACTOR**: Clean up while tests still pass
4. **VERIFY**: Manual verification of acceptance criteria

### Pre-Implementation Setup

Before starting any task:
1. Verify branch `020-pr-blast-radius-review-action` and a clean task boundary.
2. Use the repository-pinned Node 24.11.1; engines are `>=20 <25`.
3. No separate repository bootstrap command is documented. Follow the generated
   `quickstart.md`; do not infer `npm install`, build, or indexing as
   bootstrap work. Never run `codegraph init` unless the operator explicitly
   asks.
4. Run the smallest relevant baseline test before editing; use `npm test` and
   `npm run build` as the full gates at phase boundaries.
5. Use CodeGraph exploration before structural file search; if the graph cannot
   answer, record that and continue with normal inspection.

### Implementation Notes
- Re-read `tasks.md`, `plan.md`, and the Design Concept before each user
  story. The Q&A log carries the "why" behind edge-case and refactor choices.
- Keep production changes centered on `actions/pr-impact/` and the dogfood
  workflow. Modify detector/LLM internals only for a plan-proven contract gap.
- Tests precede behavior. Use deterministic PR-event, detector-result, cache,
  and GitHub-API fixtures; inject external calls instead of relying on live
  GitHub mutations in unit tests.
- Treat analysis and delivery as separate state machines. A delivery limitation
  cannot rewrite a successful analysis, and an unavailable analysis cannot pass
  as safe.
- Preserve one-spec reviewability: implement the minimum behavior for each
  vertical user story, run the configured reviewability checks, and stop on a
  hard gate rather than silently widening scope.
- Optional narrative must call the SPEC-018 public seam, remain off by default,
  and append prose only after the deterministic report/conclusion is fixed.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Foundation | | | |
| 2 - User Story 1 | | | |
| 3 - User Story 2 | | | |
| 4 - Polish | | | |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Focused action, cache, threshold, fork, delivery, and narrative tests pass
- [ ] Full tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Generated action runtime artifacts, if any, are fresh and package-visible
- [ ] Fork fixtures prove no privileged secret/narrative path is used
- [ ] Self-repo sticky-comment and fallback UAT evidence is recorded
- [ ] Warm-cache benchmark median is <=3 minutes with method and samples recorded
- [ ] Reviewability gates pass or any warning is explicitly adjudicated
- [ ] `CHANGELOG.md` has a user-facing bullet under `## [Unreleased]`
- [ ] PR created and reviewed
- [ ] Merged to main branch

### Autopilot Post Plan

- [ ] Post: Doctor Extension Check
- [ ] Post: Verify Implementation
- [ ] Post: Verify Tasks Phantom Check
- [ ] Post: Code Review
- [ ] Post: Integration Suite
- [ ] Post: Reviewability Diff Gate
- [ ] Post: Self-Review
- [ ] Post: UAT Runbook Generation
- [ ] Post: Final Reviewability Backstop
- [ ] Post: PR Packet/Body Generation
- [ ] Post: PR Body Generation
- [ ] Post: PR Creation
- [ ] Post: Review Remediation
- [ ] Post: Retrospective

---

## Lessons Learned

### What Worked Well

-

### Challenges Encountered

-

### Patterns to Reuse

-

---

## Project Structure Reference

```text
actions/pr-impact/
├── action.yml                         # Reusable composite action contract
├── run.ts                             # Roadmap-named orchestration helper source
└── [plan-resolved runtime artifact]   # Only if required; generated and freshness-tested
__tests__/
└── [plan-resolved action tests]       # PR, cache, conclusion, delivery, narrative fixtures
.github/workflows/pr-impact.yml         # Advisory self-repository dogfood workflow
specs/020-pr-blast-radius-review-action/
├── SPEC-MOC.md
├── spec.md
├── plan.md
├── tasks.md
└── [generated design artifacts]
docs/ai/specs/.process/
├── SPEC-020-design-concept.md
└── SPEC-020-workflow.md
CHANGELOG.md                            # User-facing Unreleased entry
```

---

Instantiated from the shared SpecKit workflow template for SPEC-020.
