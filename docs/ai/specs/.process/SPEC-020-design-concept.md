---
topic: "PR Blast-Radius Review Action"
slug: "SPEC-020-design-concept"
date: "2026-07-15"
mode: "setup"
spec_id: "SPEC-020"
source_input:
  type: "file"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md § SPEC-020"
question_count: 9
stop_reason: "natural"
---

# Design Concept: SPEC-020 PR Blast-Radius Review Action

> **Source:** docs/ai/specs/intelligence-platform-technical-roadmap.md § SPEC-020
> **Date:** 2026-07-15
> **Questions asked:** 9
> **Stop reason:** natural (the high-impact trust, reporting, failure, cache, narrative, rollout, and sizing branches converged)

## Goals

- Ship a reusable GitHub Action that runs CodeGraph's deterministic `detect-changes --base-ref` analysis for every pull request, including forks, while safely degrading operations that lack permission or secrets (Q1).
- Keep the deterministic impact report authoritative: update one action-owned sticky comment when possible, and retain the same report in the job summary and an artifact when commenting is unavailable (Q4, Q5, Q7).
- Keep ordinary blast radius informational. Fail the check only for configured caller or hub threshold breaches, while failing explicitly if indexing or impact analysis remains unavailable after fallback (Q2, Q3).
- Treat the restored index as an optimization: validate it against the relevant checkout and rebuild on a miss or stale result, preserving the roadmap's warm-cache performance target (Q6).
- Keep optional LLM narrative off by default and prose-only; it may explain deterministic findings but never change facts, thresholds, or check status (Q4).
- Dogfood the action automatically on CodeGraph pull requests in advisory mode before maintainers enable blocking thresholds (Q8).
- Keep SPEC-020 as one spec despite the advisory size warning and two-slice recommendation (Q9).

## Non-goals

- Same-repository-only support or elevated identical behavior for untrusted forks; fork execution must degrade safely instead (Q1).
- Failing a check merely because impact exists, or making all threshold breaches advisory (Q2).
- Passing silently when the analysis itself is unavailable, or adding a configurable pass/fail policy for that condition in v1 (Q3).
- Giving LLM output machine authority over risk classification or the check conclusion (Q4).
- Creating one comment per run or maintaining a separate comment history (Q5).
- Trusting a cache hit without validation or rebuilding the index unconditionally on every run (Q6).
- Logs-only fallback when a PR comment cannot be updated (Q7).
- Blocking CodeGraph's own pull requests from the first dogfood run or requiring manual dispatch for initial adoption (Q8).
- Other CI vendors and inline code comments, per the roadmap's explicit out-of-scope boundary.

## Design Tree (Q&A log)

### Q1. Which pull requests must SPEC-020 support in its first release?

**Branch:** Trust boundary / PR coverage

**Recommended answer:** Safe fork support
> Analyze every pull request, but degrade privileged behavior when the event's permissions or secrets are unavailable. This preserves useful deterministic coverage without requiring untrusted changes to receive elevated credentials, consistent with the project's privacy and dormancy constraints.

**Alternatives offered:**
- Same-repo PRs only: Limit v1 to trusted branches in this repository for a simpler permission model.
- Identical behavior everywhere: Require comments and optional narrative on forks too, accepting a more complex trust and credential design.

**User's answer:** Safe fork support (Recommended)

---

### Q2. When should the PR-impact job fail the pull request check?

**Branch:** Check policy / threshold semantics

**Recommended answer:** Thresholds only
> The existing detector already distinguishes ordinary impact from configured threshold breaches. Preserving that distinction makes the report useful by default while allowing repositories to opt into enforceable policy.

**Alternatives offered:**
- Any impact: Fail whenever changed code affects callers or flows, making the action highly restrictive.
- Never fail: Always report advisory information and ignore threshold breaches for check status.

**User's answer:** Thresholds only (Recommended)

---

### Q3. How should CI conclude when indexing or impact analysis is unavailable after its fallback attempt?

**Branch:** Failure semantics / unavailable analysis

**Recommended answer:** Fail explicitly
> An unavailable analysis must not be confused with a safe change. Surface the unavailable report and fail the check after the action has exhausted its cache-validation and rebuild fallback.

**Alternatives offered:**
- Warn and pass: Report the unavailable state but allow the check to succeed.
- Configurable policy: Add an input that lets each workflow choose fail or pass for unavailable analysis.

**User's answer:** Fail explicitly (Recommended)

---

### Q4. What authority should the optional LLM narrative have over the report or check result?

**Branch:** Determinism / narrative authority

**Recommended answer:** Prose only
> The constitution makes deterministic static analysis the product authority. Optional LLM output can improve explanation, but keeping it off by default and outside machine decisions preserves reproducibility and dormant no-network behavior.

**Alternatives offered:**
- Risk classification: Allow it to add machine-consumed risk labels while deterministic thresholds still control failure.
- Check authority: Allow its assessment to influence whether the pull request check fails.

**User's answer:** Prose only (Recommended)

---

### Q5. How should repeated runs manage the pull request report comment?

**Branch:** Report lifecycle / comment ownership

**Recommended answer:** One sticky comment
> A stable hidden marker lets the action edit only its own report and keeps pull requests readable across synchronize and rerun events. The deterministic report remains the current source of truth rather than a stream of stale snapshots.

**Alternatives offered:**
- Comment each run: Create a new report comment every time so history remains visible but noisy.
- Latest plus history: Maintain a current summary and separate historical run comments, adding more state and API calls.

**User's answer:** One sticky comment (Recommended)

---

### Q6. What guarantee should the restored CodeGraph index cache provide before analysis uses it?

**Branch:** Cache correctness / index freshness

**Recommended answer:** Validate or rebuild
> The cache should change latency, not correctness. Validate restored state against the relevant checkout and rebuild on a miss or stale result so the action never presents an old graph as current analysis.

**Alternatives offered:**
- Trust cache key: Use any cache hit directly and rebuild only when no entry exists.
- Always rebuild: Avoid restoration risk by indexing from scratch on every pull request run.

**User's answer:** Validate or rebuild (Recommended)

---

### Q7. When the workflow cannot update a PR comment, where must the deterministic report remain available?

**Branch:** Safe degradation / durable report delivery

**Recommended answer:** Job summary and artifact
> The job summary preserves immediate visibility and the artifact preserves the exact markdown for later inspection. A permission limitation should affect delivery, not erase a successfully computed report.

**Alternatives offered:**
- Job summary only: Keep the fallback visible in the workflow run without retaining a separate artifact.
- Logs only: Emit the markdown in step logs and avoid additional workflow outputs.

**User's answer:** Job summary and artifact (Recommended)

---

### Q8. How should CodeGraph's own PR workflow adopt SPEC-020 initially?

**Branch:** Dogfood rollout / enforcement

**Recommended answer:** Advisory first
> Automatic advisory reports provide real self-repository UAT and threshold calibration without making an unobserved policy immediately blocking. Maintainers can enable thresholds after reviewing representative blast-radius results.

**Alternatives offered:**
- Block from launch: Configure caller and hub thresholds in the first dogfood workflow so qualifying changes fail immediately.
- Manual trigger first: Run only on demand until maintainers decide it is reliable enough for automatic PR execution.

**User's answer:** Advisory first (Recommended)

---

### Q9. The shared estimator projects about 455 reviewable LOC and recommends two slices; how should SPEC-020 be scoped?

**Branch:** Slice-sizing

**Recommended answer:** Two vertical slices
> With four acceptance-capability groups, four production surfaces, and thirteen functional-requirement groups, the shared estimator returned `{estimated_loc: 455, suggested_slices: 2, status: warn}`. The recommended seam was deterministic advisory reporting end-to-end first, followed by blocking policy and optional narrative, keeping each review below the approximately 400-LOC ceiling.

**Alternatives offered:**
- Keep one spec: Retain the full roadmap scope as one borderline review unit despite the advisory warning.
- Three vertical slices: Separate advisory reporting, blocking policy, and optional narrative into three smaller capabilities.

**User's answer:** Keep one spec — deviation from recommendation. The estimate is advisory, so SPEC-020 remains one spec and later planning must control reviewability within that choice.

## Open Questions

- **What:** How the reusable composite action packages and pins its executable helper and CodeGraph CLI version while the roadmap names a TypeScript `run.ts` implementation.
  **Why deferred:** This is a technical planning choice, not a product-behavior choice; it depends on the repository's action build and release conventions.
  **Suggested next step:** Resolve during `/speckit-plan`, requiring a reproducible version and no runtime dependence on uncompiled TypeScript.
- **What:** The exact contract that distinguishes analysis unavailability (fail the check) from report-delivery unavailability (preserve the analysis result and degrade to summary plus artifact).
  **Why deferred:** The user selected both outcomes; the precise outputs and exit-code mapping belong in `spec.md` and the action contract.
  **Suggested next step:** Make the two failure classes explicit during `/speckit-specify` and verify them with fork-permission and analyzer-failure scenarios.
- **What:** The cache-validity predicate and key composition across lockfile, merge base, base ref, and pull-request head.
  **Why deferred:** The behavior is settled as validate-or-rebuild, but the exact key and freshness proof require implementation-aware planning.
  **Suggested next step:** Resolve during `/speckit-plan` against CodeGraph's current index freshness metadata and the roadmap's lockfile-plus-merge-base requirement.

## Recommended Next Step

Setup mode — scaffolding continues automatically: `$speckit-scaffold-spec SPEC-020` populates `docs/ai/specs/.process/SPEC-020-workflow.md`; then start a new Codex task rooted in the dedicated worktree and run `$speckit-autopilot docs/ai/specs/.process/SPEC-020-workflow.md`.
