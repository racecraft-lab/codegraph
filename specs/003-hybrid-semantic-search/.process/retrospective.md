---
feature: SPEC-003 — Hybrid Semantic Search
branch: 003-hybrid-semantic-search
date: 2026-07-10
completion_rate: 100%
spec_adherence: 100%
requirement_counts:
  total: 24
  implemented: 24
  modified: 0
  partial: 0
  not_implemented: 0
  unspecified: 0
finding_counts:
  critical: 0
  significant: 4
  minor: 4
  positive: 3
generated_by: speckit.retrospective.analyze (terminal worker, analyze-only)
---

# Retrospective — SPEC-003 (Hybrid Semantic Search)

## Executive Summary

SPEC-003 shipped all 34 tasks and all 17 functional requirements + 7 success
criteria with committed verification evidence (2806/0/7 full suite, p95 fusion
49.9 ms vs a 150 ms gate, retrieval-guardian PASS 6/6, an independent code
review, a scoped A/B, and self-repo dogfood UAT). Spec adherence is **100%** —
every requirement present in the final `spec.md` has traceable implementation
evidence, and no scope was silently dropped or added. This is a clean outcome
on paper.

The more useful retrospective signal is in **how** it got there: a LOC
estimate that missed by ~4x on the code-only surface, one mid-implementation
executor death that forced a real architecture decision, two rounds of test
env leakage before hermeticity settled, and one genuine correctness bug
(stale-cache invalidation) that slipped past the automated G7 gate and was
only caught by a human-equivalent post-gate review. None of these blocked the
PR — all were caught and fixed before merge — but they are the actionable
material for future specs, especially algorithm-heavy ones.

**Constitution compliance: no violations found** (0 CRITICAL findings).

---

## Proposed Spec Changes

*(Human Gate required — nothing below has been applied. Default is NO;
respond `y`/`yes`/`si`/`s`/`sí` to authorize any of these.)*

1. **FR-008b / FR-009 / Assumptions — staleness probe under-describes the shipped mechanism.**
   `spec.md` (FR-008b, FR-009, Edge Cases "Index staleness mid-session",
   Assumptions) documents the staleness probe as "matching-model vector count
   + `embedding_model`/`embedding_dims` scalars from `project_metadata`."
   The shipped implementation (post-G7 remediation, commit `3f6ec9e`) also
   reads a monotonic `vectors_write_version` metadata counter
   (`src/db/queries.ts:2464`, `src/search/hybrid.ts:504/532/558`) bumped on
   every vector write, specifically to catch same-count re-embeds/renames
   that the count-only probe missed (a real MEDIUM-severity bug an
   independent code review caught after G7 — see Finding S1 below). Neither
   `plan.md`/`data-model.md` nor `spec.md` were updated to reflect this;
   grep for `write_version` across all three returns zero hits. Proposed
   edit: add the `vectors_write_version` counter to FR-008b's probe
   definition and to the Assumptions bullet, so the spec matches what
   actually ships and a future reader doesn't reintroduce the same-count
   blind spot.

No other spec edits are proposed — the remaining findings below are process/
tooling lessons, not requirement gaps.

---

## Requirement Coverage Matrix

| Requirement | Status | Evidence |
|---|---|---|
| FR-001…FR-002a (mode plumbing, library default, auto resolution) | IMPLEMENTED | `hybrid-search.test.ts`, `hybrid-mcp-surface` 12/12, `hybrid-cli-surface` 30/30 |
| FR-003/003a (internal-caller dormancy, zero-touch latency) | IMPLEMENTED | zero-embed-call spy assertion (FR-014); explore/prompt-hook/context-builder untouched (retrieval-guardian check 1) |
| FR-004/004a (RRF fusion, rank-only, intra-arm rescoring) | IMPLEMENTED | `hybrid-search.test.ts` fusion suite |
| FR-005/006/006a (lazy init, keyword-while-warming, embed budget, late-vector discard) | IMPLEMENTED | US3 degradation suite T018–T024, retrieval-guardian check 5 |
| FR-007 (no new env vars/knobs) | IMPLEMENTED | non-goals verified held (T033 ledger item 5) |
| FR-008/008a/008b/009/009a/009b/009c (perf gate, matrix cache, staleness probe, single-owner, memory guard) | IMPLEMENTED | p95 49.9 ms (T033-corrected) / 85.2 ms (integration-suite standalone run) vs 150 ms gate; FR-009c guard tests `:495/:510/:1824` |
| FR-010/011 (filter pre-/post-gating, embed input = stripped text) | IMPLEMENTED | filter-parity tests in `hybrid-search.test.ts` |
| FR-012 (matchType + fused score, `score`=`fusedScore`, offset semantics) | IMPLEMENTED | surface suites; consensus items CHK009/CHK015 |
| FR-013 (deterministic tie-breaks, both levels) | IMPLEMENTED | T006 run-twice deep-equal assertion (Analyze finding G1) |
| FR-014/014c/014d (CI gates, fixture seams, p95 methodology, non-tautology) | IMPLEMENTED | `hybrid-search.test.ts` 84/84 |
| FR-015 (degradation hints, 4 literal strings) | IMPLEMENTED | byte-pinned string assertions; empty-degraded-results gap fixed in remediation (retrieval-guardian advisory → resolved) |
| FR-016 (filter parity across modes) | IMPLEMENTED | US4 dormancy suite T025–T027 |
| FR-017 (status availability line + `--json` fields) | IMPLEMENTED | status-json 5/5 |
| SC-001…SC-007 | IMPLEMENTED | integration-suite.md, ab-evidence.md, dogfood-uat.md |

**Total Requirements** (FR + NFR + SC in `spec.md`): 17 + 0 + 7 = 24.
**Spec Adherence** = ((24 IMPLEMENTED + 0 MODIFIED + 0×0.5 PARTIAL) / (24 − 0 UNSPECIFIED)) × 100 = **100%**.

## Success Criteria Assessment

| SC | Result |
|---|---|
| SC-001 (hybrid hit-rate ≥ keyword, semantic-only strictly greater) | PASS — deterministic CI gate; scored `npm run eval` blocked by a pre-existing (predates SPEC-003) ES-corpus requirement, not a SPEC-003 regression (Finding M1) |
| SC-002 (p95 ≤150 ms) | PASS — 49.9 ms grounded figure (~3x headroom), corrected from an initial min-not-p95 misreading (Finding M2) |
| SC-003 (100% degraded searches success-shaped) | PASS — retrieval-guardian check 2, zero `isError` in diff |
| SC-004 (byte-identical keyword) | PASS — structural deep-equal + field-absence checks |
| SC-005 (100% provenance labeling) | PASS |
| SC-006 (deterministic ordering) | PASS — added run-twice assertion (Analyze G1) |
| SC-007 (`status` truthfulness) | PASS — status-json 5/5 |

## Architecture Drift Against Plan

| Area | Planned | Actual | Classification |
|---|---|---|---|
| Reviewability budget | ~195 LOC / ~4 production files (setup-gate estimate) | 1830 raw LOC / 743 code-only / 6 production files (~3.8x code-only overage) | SIGNIFICANT — see Finding S2 |
| Query-vector acquisition | Not detailed in plan.md beyond "matrix cache + staleness probe + cosine top-k" | Async `acquireQueryVectorForSearch` + bounded sync LRU query-vector cache (`QUERY_VECTOR_CACHE_MAX=32`) bridging `searchNodes`'s sync contract to async embedding providers — added mid-implementation (T012) | POSITIVE — see Finding P1 |
| Staleness probe mechanism | count + `embedding_model`/`embedding_dims` scalars (FR-008b) | Same, plus a `vectors_write_version` monotonic counter added post-G7 | SIGNIFICANT (spec now trails shipped code) — see Finding S1 and Proposed Spec Change #1 |

## Significant Deviations

### S1 — Staleness-invalidation bug escaped the automated G7 gate, caught only by post-gate human-equivalent review
- **What happened:** G7 (34/34 tasks, 2799/0/7 suite, p95 green, A/B + dogfood recorded) passed on commit `64ad550` with the staleness probe defined as vector-count + model/dims scalars only. An independent post-G7 code review (opus, MEDIUM severity) found that a **same-count re-embed or rename** would not bump the probe's count, so the in-memory matrix cache would silently serve stale vectors. Fixed in `3f6ec9e` by adding a monotonic `vectors_write_version` metadata counter, bumped on every vector write, with 7 new TDD tests.
- **Severity:** SIGNIFICANT (real correctness bug in a shipped feature, not merely cosmetic — but caught before merge, no user impact).
- **Discovery point:** post-implementation review (after G7, before PR merge).
- **Cause:** spec gap — FR-008b's staleness definition ("count + scalars") never accounted for a same-count content change, and neither the deterministic CI fixture gate nor the p95 fixture gate exercises a same-count re-embed scenario.
- **Prevention recommendation:** for any spec introducing a staleness/invalidation cache, require a dedicated test case for "content changed but cardinality didn't" in the FR itself (not left to post-hoc review to discover). Consider adding this as a standing checklist item in the `performance` or `error-handling` checklist template for cache-bearing specs.

### S2 — Setup-gate LOC estimator missed the fusion module by ~3.8x (code-only)
- **What happened:** the roadmap estimator projected ~195 reviewable LOC / ~4 production files for a "thin vertical slice." Actual: 1830 raw LOC / 743 code-only across 6 production files — `hybrid.ts` alone is 406 code-only lines. The Reviewability Diff Gate recorded this honestly as a WARN (not a silent pass) with a documented proceed decision (`autopilot-state.json` `final_diff_gate`).
- **Severity:** SIGNIFICANT (process-quality, not a functional defect — the gate is advisory and the honest-overage path worked as designed).
- **Discovery point:** implementation (T033 findings ledger), confirmed at the post-impl Reviewability Diff Gate.
- **Cause:** scope evolution / estimator calibration gap — the estimator's heuristic for "thin slice" doesn't distinguish plumbing-shaped work from algorithm-shaped work (RRF merge, a single-owner matrix cache, a staleness probe, 4 degradation conditions, an embed-budget state machine).
- **Prevention recommendation:** calibrate the LOC estimator with an "algorithm density" signal (e.g., a spec introducing a new scoring/fusion/cache subsystem gets a multiplier over a plumbing-only spec), or explicitly flag specs matching that shape for a wider manual estimate at setup time rather than trusting the automated projection.

### S3 — Executor death mid-T012 forced a live architecture pivot
- **What happened:** `searchNodes` is contract-bound synchronous, but embedding providers are async-only. A first attempt at a synchronous-over-asynchronous bridge (a spin-wait) deadlocked the main thread; that executor attempt was abandoned/reverted. The orchestrator then designed and landed the async-acquire-then-sync-read bounded LRU cache pattern documented at T012.
- **Severity:** SIGNIFICANT (execution-process risk — a deadlocked main thread on a shared daemon is a serious failure mode, even though it never reached production).
- **Discovery point:** implementation (T012, mid-run).
- **Cause:** tech constraint discovered during implementation (sync/async API mismatch not surfaced in plan.md's architecture notes) compounded by an executor attempting a mechanically unsound approach instead of stopping to escalate.
- **Prevention recommendation:** (a) plan.md's architecture notes should call out sync/async boundary crossings explicitly as a design risk before implementation starts, since this repo's `searchNodes` sync contract was known going in; (b) formalize a policy for detecting and stopping/reaping an executor that appears to be spinning or deadlocking rather than letting it run to timeout — this session's own team conventions already carry a "reap idle/finished agents" rule (auto-memory: subagent-management-rules.md); extending it to "abort and escalate on suspected deadlock, don't let a sub-agent silently retry a mechanically unsound approach" would generalize this specific incident into a standing practice.

### S4 — Env-hermeticity leakage into embedding-adjacent tests, twice
- **What happened:** a direnv-loaded live HAL embedding endpoint activated semantic code paths inside tests meant to exercise the dormant/keyword path — once via subprocess `CHILD_ENV` (fixed in commit `929f13f`), and again via the in-process vitest worker environment (fixed in commit `15bdf71`).
- **Severity:** SIGNIFICANT (test hermeticity — false negatives/positives possible until settled; caught both times before merge).
- **Discovery point:** testing (twice, at different points in implementation).
- **Cause:** process skip — no shared, reusable "scrub ambient embedding env" helper existed before this spec; each surface (subprocess CLI tests, in-process MCP tests) independently discovered the leak.
- **Prevention recommendation:** promote the resulting scrub pattern (both the `CHILD_ENV` subprocess scrub and the in-process vitest-worker scrub) into a shared test utility referenced by name in CLAUDE.md or a test-helpers module, so the next embedding-adjacent spec doesn't rediscover this twice.

## Minor Deviations

### M1 — Scored `npm run eval` blocked by a pre-existing ES-corpus assumption
Pre-existing limitation (predates SPEC-003, commit `13d3ff3`): the eval harness requires `EVAL_CODEBASE` pointing at an already-indexed Elasticsearch-shaped corpus; no such corpus exists locally, so the 4 new T028 hybrid-paraphrase cases could not run through the scored report. FR-014 evidence stands on the deterministic `npm test` gate instead (84/84). Not a SPEC-003 regression — a standing gap in the eval harness worth a follow-up to make it corpus-agnostic or ship a minimal self-contained corpus.

### M2 — p95 figure was corrected mid-implementation (min vs p95 confusion)
The US1-close note recorded "19.9 ms" as the p95, which was actually the distribution's minimum; T033 re-grounded it at 49.9 ms (median 22.4 ms). Caught by re-running the suite before finalizing evidence, not by an external reviewer. No spec/gate impact (still ~3x headroom under 150 ms). Worth a note in the eval helper's output labeling to make min vs p95 unambiguous at a glance.

### M3 — Local machine load spikes produced transient vitest false failures
The US3 degradation suite showed false failures under load contention (72) that cleared on a quiet re-run (110/110). Handled correctly (re-run-when-quiet), but cost investigation time before being recognized as environmental rather than a real regression.

### M4 — `.git/`-convention PR artifacts don't work inside a git worktree
The PR-body generation step (commit `cda7744`) discovered the runner's default `.git/`-relative artifact location doesn't resolve inside a worktree checkout and relocated to `.process/`. Purely a tooling-location issue, already fixed in the same commit; flagged here so the pattern is recognized immediately (not rediscovered) on the next spec run from a worktree.

## Innovations and Best Practices

### P1 — Async-acquire / bounded-sync-cache bridge pattern
Born from the S3 executor failure, the shipped resolution (`acquireQueryVectorForSearch` populates a `QUERY_VECTOR_CACHE_MAX=32` internal LRU keyed by (filter-stripped text, model id); sync `searchNodes` reads it, treating a cache miss as "still warming") is a clean way to expose an async capability through a frozen synchronous contract without threading async through every caller. **Reusability:** any future spec needing to bridge a sync core API to an async provider (e.g., a hypothetical future re-ranker) can reuse this shape directly. **Constitution candidate:** possibly worth naming as a documented pattern (not a new principle) in the module's own header comment (already done, per T012 note) — no constitution change needed.

### P2 — Honest overage reporting instead of gate-gaming
The T033 findings ledger records the ~3.8x LOC estimator miss plainly rather than adjusting the estimate after the fact, and the Reviewability Diff Gate recorded a WARN with justification rather than silently passing. This is the intended behavior of an advisory gate and is worth reinforcing as the expected norm.

### P3 — Deterministic probe as a fallback when agent-level A/B is null
The scoped A/B (T029) found Sonnet never called `codegraph_explore`/`codegraph_search` in either arm (the documented low-salience wall), which would normally leave the A/B inconclusive. The team substituted a deterministic probe (paraphrase query: keyword ground-truth miss → semantic/hybrid/auto rank #1) as decisive evidence instead of treating the null agent A/B as a blocker. **Reusability:** worth keeping as the standard fallback methodology whenever a retrieval-affecting spec's agent-level A/B comes back null by adoption rather than by quality.

## Constitution Compliance

| Principle | Verification | Result |
|---|---|---|
| I. Think Before Coding | Fusion depths, degradation wording, fixture design all resolved in Clarify before Plan/Tasks | PASS |
| II. Simplicity First | Brute-force scan + RRF only; no ANN, no re-ranker, no new env vars (T033 ledger item 5 confirms) | PASS |
| III. Surgical Changes | New logic isolated to `src/search/hybrid.ts`; existing files (`queries.ts`, `index.ts`, `tools.ts`, `codegraph.ts`) gained plumbing only | PASS (see S2 for the size caveat — surgical in *placement*, larger than projected in *volume*) |
| IV. Goal-Driven Execution | TDD evidence per task; T006 gate RED→GREEN at T012 with zero assertion rewrites | PASS |
| V. Deterministic Extraction | Fused ranking deterministic; graph structure untouched; SC-006 run-twice assertion added (Analyze G1) | PASS |
| VI. Retrieval Performance Is a Regression Surface | `codegraph_explore` and `server-instructions.ts` untouched (retrieval-guardian checks 1/6); no `isError` on expected conditions (check 2); scoped A/B + dogfood UAT recorded | PASS |
| VII. Local-First, Zero Native Deps | Pure-JS scan over `node:sqlite` BLOBs; no new runtime deps; dormant path byte-identical | PASS |

**Constitution violations: None.**

## Unspecified Implementations

None found beyond what's already noted as innovation (P1). No code exists that isn't traceable to a requirement or an explicitly-scoped implementation decision (the T012 mid-implementation design note is itself committed and cited in the workflow log, so it isn't "unspecified" — it's a documented deviation with rationale).

## Task Execution Analysis

- 34/34 tasks completed, 0 dropped, 0 added outside the T012 in-scope redesign.
- `verify-tasks` phantom check: 33 VERIFIED / 1 PARTIAL (T015 — `resolveAutoMode` implemented and tested but dead in production behind 3 duplicated inline implementations) → consolidated into production during post-G7 remediation (`3f6ec9e`), per the PR-review-packet addendum. Not counted as PARTIAL in the final spec-adherence math above because it was resolved before PR creation.
- Self-review flagged 3 `[edge-case-gap]` items (US1/SC-001 adversarial test, US2 scenario 2 MCP/CLI-level vector seeding, SC-002 perf-gate failure-mode branch) — all judged non-blocking, with UAT evidence substituting for test coverage where noted.
- Self-review tidiness pass: 2 fixed (stale doc-comment, accidentally-committed eval result JSON files — `results/` now gitignored), 1 deliberately kept (test-only async matrix-cache pair, called out for reviewer judgment rather than silently removed).

## Lessons Learned and Recommendations

**What worked well:**
- The Clarify → Checklist → Analyze pipeline caught real spec gaps before implementation (12 consensus items, all Round-1 resolved) — no CRITICAL/HIGH findings reached G6.
- Honest gate reporting (WARN with justification, not silent pass) on the reviewability overage.
- Post-G7 independent review (retrieval-guardian + code review) caught a real correctness bug (S1) that the automated test gate did not — the two-layer review structure did its job.
- Deterministic-probe fallback (P3) kept the A/B evidence meaningful despite a null agent-adoption result.

**What didn't work well:**
- The LOC estimator's blind spot for algorithm-heavy modules (S2) — worth fixing at the estimator level, not just noting per-spec.
- Test-env hermeticity for embedding-adjacent suites had to be discovered twice (S4) before a durable pattern existed.
- A same-count cache-invalidation edge case (S1) wasn't caught until after the automated gate — the deterministic CI fixture gate should be extended to include this class of case going forward.

**Actionable improvements (prioritized):**
1. **HIGH** — Extend the FR-008b staleness-probe CI gate (or the checklist template for any future caching spec) with an explicit "same-cardinality content change" test case, so S1's bug class is caught pre-G7 next time.
2. **HIGH** — Calibrate the roadmap LOC estimator with an algorithm-density signal, or flag specs introducing a new scoring/cache/fusion subsystem for manual re-estimation at setup (S2).
3. **MEDIUM** — Promote the env-hermeticity scrub pattern (subprocess `CHILD_ENV` + in-process vitest-worker) into a named, shared test helper referenced from CLAUDE.md, so future embedding-adjacent specs don't rediscover it (S4).
4. **MEDIUM** — Formalize an "abort/escalate on suspected sub-agent deadlock" rule extending the existing reap-idle-agents convention, informed by the S3 incident.
5. **LOW** — Fix or replace the `npm run eval` harness's hard Elasticsearch-corpus dependency so scored evaluation isn't permanently blocked for specs without that corpus (M1).
6. **LOW** — Apply Proposed Spec Change #1 (document `vectors_write_version` in FR-008b/Assumptions) once a maintainer approves it via the Human Gate below.

---

## Self-Assessment Checklist

| Check | Result |
|---|---|
| Evidence completeness — every major deviation has concrete evidence (file/task/commit) | PASS |
| Coverage integrity — FR/NFR/SC coverage complete, no missing IDs (17 FR + 0 NFR + 7 SC = 24, all classified) | PASS |
| Metrics sanity — `completion_rate` (34/34=100%) and `spec_adherence` (24/24=100%) formulas applied correctly | PASS |
| Severity consistency — CRITICAL/SIGNIFICANT/MINOR/POSITIVE labels match stated impact | PASS |
| Constitution review — violations explicitly listed (None) | PASS |
| Human Gate readiness — Proposed Spec Changes populated and ready for confirmation | PASS |
| Actionability — recommendations specific, prioritized, tied to findings | PASS |

All checklist items PASS — report finalized without gaps requiring rework.

---

## Human Gate — Spec Changes

**Do you want me to modify `spec.md` now? (y/N)**

Only one change is proposed (see "Proposed Spec Changes" above): documenting
the `vectors_write_version` counter in FR-008b and Assumptions to match the
shipped staleness-probe implementation. Default is **NO** — this retrospective
takes no action on `spec.md` without an explicit `y`/`yes`/`si`/`s`/`sí` from
a maintainer. No such approval was given in this session, so `spec.md` was
**not modified**.

---

## File Traceability Appendix

| Area | Files |
|---|---|
| Spec artifacts | `specs/003-hybrid-semantic-search/{spec,plan,tasks,research,data-model,quickstart}.md`, `checklists/`, `contracts/` |
| New production module | `src/search/hybrid.ts` |
| Plumbing diffs | `src/db/queries.ts`, `src/index.ts`, `src/mcp/tools.ts`, `src/bin/codegraph.ts` |
| Tests | `__tests__/hybrid-search.test.ts` (84), plus MCP/CLI/status surface suites |
| Process evidence | `specs/003-hybrid-semantic-search/.process/{ab-evidence,dogfood-uat,integration-suite,pr-review-packet,retrieval-guardian-report,verify-tasks-report,pr-body,pr-packet*.json}` |
| Durable execution record | `docs/ai/specs/.process/SPEC-003-workflow.md`, `docs/ai/specs/.process/autopilot-state.json` |
| Key remediation commits | `3f6ec9e` (staleness write-version, empty-hint, resolveAutoMode consolidation, SC-003 hardening), `a2d5c77` (self-review tidiness), `8f4004f` (security-test mock fix), `929f13f`/`15bdf71` (env-hermeticity scrubs) |
