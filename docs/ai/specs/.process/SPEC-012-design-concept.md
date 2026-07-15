---
topic: "Change impact detection"
slug: "spec-012-change-impact-detection"
date: "2026-07-15"
mode: "setup"
spec_id: "SPEC-012"
source_input:
  type: "file"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md#spec-012-change-impact-detection"
question_count: 8
stop_reason: "natural"
---

# Design Concept: Change Impact Detection

> **Source:** `docs/ai/specs/intelligence-platform-technical-roadmap.md`, SPEC-012
> **Date:** 2026-07-15
> **Questions asked:** 8
> **Stop reason:** natural

## Goals

- Map git diffs to the indexed CodeGraph symbols they touch, then report the
  bounded caller and SPEC-011 flow impact that those changes endanger.
- Expose the same core impact engine through `codegraph detect-changes` and an
  MCP tool so humans and agents can use one stable contract.
- Support local and CI-oriented diff modes: unstaged, staged, all working-tree
  changes, and `--base-ref` merge-base comparison.
- Emit stable JSON and readable markdown, with CI-stable exit codes: `0` clean,
  `1` impacts found, `2` configured risk threshold breached.
- Detect renames and moves with git rename detection and suppress phantom impact
  reports when a move does not change mapped symbol behavior.
- Warn and continue when the index may be stale, rather than hiding useful
  local-first impact data behind a hard stop.
- Deliver as two vertical slices because both the setup reviewability gate and
  the shared size estimator recommend a split.
- Prove the feature through a controlled self-repo UAT diff that exercises
  symbol mapping, caller/flow expansion, JSON/markdown output, and exit codes.

## Non-goals

- PR comments, GitHub Actions wiring, and repository-review automation are out
  of scope for SPEC-012 and remain assigned to SPEC-020.
- Cross-repository impact detection is out of scope for SPEC-012 and remains
  assigned to SPEC-022.
- REST endpoints are out of scope for v1. The roadmap only requires CLI and MCP
  surfaces for this capability.
- A general-purpose git range language is out of scope. V1 supports the
  explicit local and base-ref modes listed above.
- Full transitive graph expansion is out of scope. Default caller and flow
  expansion must stay bounded to avoid noisy blast-radius reports.
- Failing by default on stale indexes is out of scope. CI can use threshold
  options, but local default behavior warns and continues.

## Design Tree (Q&A log)

### Q1. For SPEC-012 v1, which delivery surfaces should be in scope?

**Branch:** Delivery surfaces

**Recommended answer:** CLI + MCP.
> This implements the core diff-to-impact engine once, exposes it to both
> humans and agents, and keeps PR/GitHub wiring deferred to SPEC-020. It follows
> the roadmap scope and avoids adding a REST surface nobody requested for v1.

**Alternatives offered:**
- CLI only: smaller first slice, but agents cannot use the capability until a
  later spec or follow-up.
- CLI + MCP + REST: broader platform surface now, but increases review size and
  duplicates work not required by the roadmap.

**User's answer:** CLI + MCP (Recommended)

---

### Q2. Which git diff modes should SPEC-012 support in the first implementation?

**Branch:** Diff acquisition

**Recommended answer:** Unstaged, staged, all, base-ref.
> This matches the roadmap: local working-tree checks and CI/PR-style
> merge-base comparisons without GitHub-specific wiring. It is explicit enough
> to test deterministically and small enough to avoid a general git-range parser.

**Alternatives offered:**
- Base-ref only: simpler CI-first behavior, but weak for local developer and
  agent preflight use.
- All git ranges: more flexible, but likely adds parsing and configuration
  surface that is not needed for this spec.

**User's answer:** Unstaged, staged, all, base-ref (Recommended)

---

### Q3. How should detect-changes behave when the CodeGraph index may be stale relative to the checked diff?

**Branch:** Staleness behavior

**Recommended answer:** Warn and continue.
> The roadmap calls for a staleness guard, not a default hard failure. Warning
> and continuing preserves local-first usability while still making uncertainty
> visible in JSON, markdown, and MCP responses.

**Alternatives offered:**
- Fail by default: safer for CI, but frustrating locally and can block useful
  approximate impact reports.
- Ignore staleness: simplest implementation, but risks misleading impact
  reports when spans are outdated.

**User's answer:** Warn and continue (Recommended)

---

### Q4. What should the default impact expansion include beyond directly changed symbols?

**Branch:** Impact expansion

**Recommended answer:** Callers + flows, bounded.
> Use existing graph callers plus SPEC-011 `flow_steps` when available, with
> depth and width caps to prevent noisy blast-radius reports. This satisfies the
> roadmap goal without turning every diff into a full transitive graph dump.

**Alternatives offered:**
- Direct symbols only: very precise and small, but does not answer the roadmap
  goal of endangered callers and flows.
- Full transitive graph: maximal coverage, but likely too noisy and risky for
  CI thresholds.

**User's answer:** Callers + flows, bounded (Recommended)

---

### Q5. Which exit-code policy should `codegraph detect-changes` use by default?

**Branch:** CI contract

**Recommended answer:** `0` clean, `1` impacts, `2` threshold breach.
> This exactly matches the roadmap and gives CI a stable way to distinguish an
> ordinary impact report from a configured hard-fail condition such as
> `--fail-on callers>N|hub`.

**Alternatives offered:**
- Always `0` unless error: friendlier for local use, but weak for CI and
  automation.
- `1` for any risk: simpler, but conflates normal impact reports with hard
  threshold failures.

**User's answer:** 0 clean, 1 impacts, 2 threshold breach (Recommended)

---

### Q6. How should SPEC-012 treat renamed or moved files in the diff mapper?

**Branch:** Rename and move handling

**Recommended answer:** Detect renames and suppress phantom impacts.
> Use git rename detection and validate hunk-to-symbol mapping so pure moves do
> not look like semantic changes. This is an explicit roadmap correctness
> requirement and prevents noisy reports during ordinary file organization.

**Alternatives offered:**
- Treat as delete/add: simpler git integration, but creates noisy impact
  reports for file moves.
- Ignore renames in v1: keeps mapper small, but misses an explicit roadmap
  correctness requirement.

**User's answer:** Detect renames and suppress phantom impacts (Recommended)

---

### Q7. Given the 405 projected LOC warning and 2-slice roadmap hint, how should SPEC-012 be sliced for review?

**Branch:** Slice sizing

**Recommended answer:** Two vertical slices.
> The setup reviewability gate warned at 405 projected reviewable LOC and the
> shared estimator returned `estimated_loc=610`, `suggested_slices=2`,
> `status=warn`. Two vertical slices keep each review end-to-end and under the
> intended review size.

**Alternatives offered:**
- One PR: may be manageable, but the setup gate already warns and the roadmap
  estimates two slices.
- Three smaller slices: more reviewable, but adds coordination overhead for a
  capability that is only slightly over the setup warning threshold.

**User's answer:** Two vertical slices (Recommended)

---

### Q8. What should the SPEC-012 self-repo UAT prove before the spec is considered complete?

**Branch:** Dogfood UAT

**Recommended answer:** Detect real repo changes end-to-end.
> Use a controlled diff in this repo to prove changed symbols, impacted
> callers/flows, markdown/JSON output, and exit codes work together. This
> satisfies the constitution's dogfooding requirement with reproducible evidence
> rather than a screenshot or one-off demo.

**Alternatives offered:**
- Unit/integration tests only: faster and deterministic, but misses the
  dogfooding requirement for this repo.
- Manual CLI demo only: useful smoke evidence, but weaker than a reproducible
  runbook with checked commands and expected outputs.

**User's answer:** Detect real repo changes end-to-end (Recommended)

## Open Questions

- **What:** Exact MCP tool name and response envelope field names.
  **Why deferred:** Existing tool naming conventions should be confirmed during
  Specify/Plan against `src/mcp/server-instructions.ts` and `src/mcp/tools.ts`.
  **Suggested next step:** Resolve in `/speckit-specify` or `/speckit-plan`;
  keep CLI and MCP JSON semantics shared.
- **What:** Exact default caller depth, width cap, and hub threshold.
  **Why deferred:** The design chooses bounded expansion but leaves constants to
  implementation planning where existing graph traversal behavior can be checked.
  **Suggested next step:** Pick conservative fixed defaults in Plan, with tests
  proving output stays bounded.

## Recommended Next Step

Use `docs/ai/specs/.process/SPEC-012-workflow.md` as the setup input for the
autonomous SpecKit run:

```text
$speckit-autopilot docs/ai/specs/.process/SPEC-012-workflow.md
```
