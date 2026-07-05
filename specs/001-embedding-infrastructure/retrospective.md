---
feature: SPEC-001 Embedding Infrastructure & Endpoint Provider
branch: 001-embedding-infrastructure
date: 2026-07-05
completion_rate: 100%  # 37/37 tasks [X]
spec_adherence: 100%   # (46 IMPLEMENTED + 2 MODIFIED) / 48 requirements (37 FR incl. lettered + 11 SC)
counts:
  requirements_total: 48
  implemented: 46
  modified: 2
  partial: 0
  not_implemented: 0
  unspecified_scope_creep: 0
  critical_findings: 0
  significant_findings: 0
  minor_findings: 2
  positive_findings: 2
---

# Retrospective: SPEC-001 — Embedding Infrastructure & Endpoint Provider

## Executive Summary

37/37 tasks complete (100%). All 37 functional requirements (FR-001…FR-031, including
lettered sub-requirements) and all 11 success criteria (SC-001…SC-011) trace to
implemented code and passing tests per `tasks.md`'s own traceability table — verified
independently rather than taken on faith (`src/mcp/` diff vs `main` is empty, confirming
FR-026; `package.json` diff vs `main` is empty, confirming FR-025/SC-008 no-new-dependency).
**Spec adherence: 100%**, with two documented, consensus-ratified implementation-approach
deviations (both positive) and zero undocumented scope creep.

The feature shipped as two stacked, currently-open PRs — **#16** (Slice A / US1, base
`main`) and **#17** (Slice B / US2+US3, base `001-embedding-infrastructure-slice-a`) — per
the spec's own ratified Reviewability Budget split. The final whole-feature diff gate
recorded a hard **block** (5,463 reviewable LOC / 21 production files / 54 total files / 6
primary surfaces, against thresholds of 800/8/25/1), which is exactly the split the spec
anticipated; both individual PR packets passed validation "within budget." Six pre-PR-review
fixes were folded in before emission (commit `0fb29aa`), and full-suite evidence at the
final checkpoint shows 2,212 passed / exit 0 with zero regressions against the 2,078-test
baseline (+129 net new tests, +134 vs. the mid-point 2,078 baseline check).

**No spec changes are recommended.** Both deviations are implementation-detail divergences
from the literal task text, not requirement drift — the underlying FR/SC is satisfied either
way, and both were explicitly ratified during implementation rather than discovered after
the fact.

## Proposed Spec Changes

**None.** No FR, SC, or user story requires amendment. The two deviations below are
implementation-approach decisions within tasks that already granted latitude ("your call,
keep it minimal") or that produce a *stronger* test than the literal task text specified —
neither changes what the spec requires or how it's verified at the requirement level.

## Requirement Coverage Matrix (summary)

| Category | Count | Notes |
|---|---|---|
| IMPLEMENTED | 46 | Direct 1:1 task→FR/SC per `tasks.md` traceability table (T001–T037) |
| MODIFIED | 2 | FR-009/FR-010/FR-016/FR-017 (T025 helper-folding) and FR-024/SC-006 (T001 dynamic-parity test) — same requirement satisfied via a different concrete mechanism than the task text literally described |
| PARTIAL | 0 | — |
| NOT IMPLEMENTED | 0 | — |
| UNSPECIFIED (scope creep) | 0 | The six post-review fixes are correctness fixes against *existing* FRs (advisory/retry/lock/validation semantics), not new capability |

Full FR/SC → task mapping already exists and was cross-checked: `tasks.md`'s
"Requirement → Task Traceability" table (lines 240–282) covers all 37 FR items and all 11 SC
items with no gaps.

## Success Criteria Assessment

All 11 success criteria (SC-001…SC-011) have direct test coverage referenced in
`tasks.md`'s traceability table and are exercised in `__tests__/embeddings-*.test.ts`. Two
notable evidence points independently verified during this analysis:

- **SC-006 / FR-024** (node/edge count parity): `__tests__/embeddings-index.test.ts` test
  "4. node/edge counts are identical with embeddings ON vs OFF" indexes two fresh projects
  (one with the endpoint configured, one without) and asserts `countsOn === countsOff`,
  plus non-vacuously confirms the ON run populated `node_vectors` and the OFF run did not.
- **FR-026** (retrieval surface untouched): `git diff main...HEAD -- src/mcp/` is empty —
  confirmed directly, not just asserted in test T035.
- **FR-025/SC-008** (no new dependency, no telemetry): `git diff main...HEAD -- package.json`
  is empty — confirmed directly.

## Architecture Drift

None against `plan.md`. The implementation matches the planned module layout exactly:
`src/embeddings/{config,provider,endpoint-provider,indexer-hook}.ts`, the v8
`node_vectors` migration in lockstep with `schema.sql`, and the planned edit set to
`src/index.ts`, `src/db/queries.ts`, `src/extraction/index.ts`, `src/ui/shimmer-progress.ts`,
and `src/bin/codegraph.ts`. No unplanned files or unplanned production-file edits were found.

## Significant Deviations

None rated CRITICAL or SIGNIFICANT. Two MINOR/POSITIVE deviations, both consensus-ratified
during implementation (not discovered in retrospect):

### Deviation 1 — T025: `selectStaleVectors` folded into existing selection helper (POSITIVE)

- **What the task said**: implement `selectStaleVectors(activeModel)` as an additive query
  helper alongside the incremental-sync branch.
- **What was built**: no standalone helper was created. `selectEmbeddableNodesMissingVector(activeModel)`
  (already built in T013) already returns other-model rows as "missing" via its
  `LEFT JOIN … AND v.model = ?` — a model-mismatched row already fails that join and
  surfaces as missing. A standalone `selectStaleVectors` would have been dead code.
- **Discovery point**: implementation (T025, during Slice B).
- **Cause**: the task text itself granted explicit latitude ("or fold into the selection
  helper; your call, keep it minimal") — this is a planned decision point, not an
  unplanned deviation.
- **Evidence**: `.claude/agent-memory/speckit-pro-implement-executor/project_embedding-incremental-freshness.md`;
  behavior verified by a dedicated model-switch scenario (Scenario 6) passing in both the
  RED and GREEN builds.
- **Root cause classification**: improvement (Constitution II Simplicity First / III
  Surgical Changes — no dead code).
- **Prevention / no action needed**: this is the discipline working as intended; no
  process change is recommended.

### Deviation 2 — T001: static baseline snapshot superseded by a dynamic ON/OFF parity test (POSITIVE)

- **What the task said**: record a `codegraph status --json` `{nodeCount, edgeCount}`
  snapshot on a throwaway project at Setup time, to compare against later.
- **What was built**: no persisted snapshot value was written down anywhere (no file,
  no recorded numbers). Instead, FR-024/SC-006 parity is proven by test 4 in
  `embeddings-index.test.ts`, which indexes **two fresh projects in the same test run** —
  one with the endpoint configured, one without — and asserts the resulting node/edge
  counts are equal to each other (and both non-zero).
- **Discovery point**: implementation (T001 was marked `[X]` in the same commit that
  introduced the foundational substrate, `faa7490`, alongside the dynamic-parity test
  infrastructure).
- **Cause**: a dynamic same-run comparison is strictly more robust than a persisted
  snapshot value — it can't go stale as the codebase evolves, and it doesn't require a
  separate "record the baseline, then remember to compare against it later" step that a
  static snapshot demands.
- **Root cause classification**: improvement (the dynamic test subsumes what the static
  snapshot was for).
- **Prevention / recommendation**: worth noting explicitly in a future task's *acceptance
  criteria* when a "record a baseline" task is really in service of a parity check —
  phrasing the task as "prove parity" rather than "record then compare" would let this
  substitution be made without looking like a task-completion shortcut. Low-priority
  process note, not a spec issue.

## Innovations and Best Practices

- **Unified full+incremental embed pass** (`runEmbeddingPass` in `indexer-hook.ts`): rather
  than two separate code paths for full-index vs. incremental sync, one pass handles both —
  on a fresh graph the incremental selection naturally reduces to the full selection. This
  is directly reusable: T029 (backfill) and T031 (resume) both reuse the same
  selection/reconcile machinery with zero new logic.
- **Full error replacement over wrapping** in `endpoint-provider.ts` for credential
  redaction (FR-023): rather than attempting to sanitize an error's message and hope no
  property leaks, the provider fully replaces any transport/endpoint error with a new
  redacted error before it leaves the module — closing the recursive `cause`-chain /
  own-property leak vector more robustly than field-by-field redaction would.
- **Reusability**: both patterns are candidates for reuse in SPEC-002 (bundled local model)
  and SPEC-003 (semantic retrieval), which the plan already names as consumers of this
  provider/vector contract.

## Constitution Compliance

| Principle | Result | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | Three clarification sessions resolved every spec ambiguity before planning; zero `[NEEDS CLARIFICATION]` markers remain in `spec.md`. |
| II. Simplicity First | PASS | No speculative abstraction; T025's folded-helper decision is a direct instance of this principle in action. |
| III. Surgical Changes | PASS | All new logic confined to `src/embeddings/`; `src/mcp/` diff against `main` is empty (independently verified); shared-file edits are additive only. |
| IV. Goal-Driven Execution | PASS | Every task is TDD (failing test → implementation); full-suite evidence recorded at both slice checkpoints (M1, M2) and the final run. |
| V. Deterministic, LLM-Free Extraction | PASS | No node/edge added or changed by this feature (SC-006 test); embedding input is composed from already-extracted fields only. |
| VI. Retrieval Performance Is a Regression Surface | PASS | FR-026 explicitly forbids touching the retrieval/MCP surface; `src/mcp/` diff is empty (independently verified, not just asserted). |
| VII. Local-First, Private, Zero Native Dependencies | PASS | `package.json` diff against `main` is empty (independently verified) — no new runtime dependency; no telemetry event added. |

**No constitution violations found.**

## Unspecified Implementations

None found. The six post-PR-review fixes (commit `0fb29aa`: surfaced advisory aborts,
activated concurrency via super-chunking, reclassified mid-body transport failures as
retryable vs. not, timer-based lock-freshness refresh, zero-length-vector rejection,
changelog wording) are all corrections against requirements that already existed in the
spec (FR-014 advisory semantics, FR-019/FR-019a retry classification, FR-021a response
validation, FR-031 lock-hold bounding) — not new, unspecified capability.

## Task Execution Analysis

- 37/37 tasks marked `[X]` in `tasks.md`; both slice checkpoints (T023 Slice A, T032/T037
  Slice B) recorded as green in `.process/autopilot-state.json` with concrete evidence:
  - **M1 (Slice A) checkpoint**: "full suite green ... embeddings suites: index 35,
    endpoint 22, config 37, input-hash 13, codec 8" at commit `322d001`.
  - **M2 (Slice B) checkpoint**: "G7 full verify green: build+typecheck+2207 passed/4
    skipped (+129 vs 2078 baseline, 0 regressions)"; refreshed after the review-fix commit
    to "131 files/2212 passed/exit 0" at commit `24ebd90`.
- One flaky full-suite failure was observed once during the run (name not retained in
  available records); a rerun was green with no code change — consistent with normal
  test-infra flakiness rather than a real regression, and doesn't affect the adherence
  score since the final recorded run is clean.
- Reviewability gate history: the tasks-phase gate first flagged `block` at
  1,480 LOC/24 files/154 total (`tasks-gate.json`); the final whole-feature diff gate
  again recorded `block` at 5,463 LOC/21 production files/54 total files/6 primary
  surfaces (`final-reviewability/gate-state.json`) — both consistent with the spec's own
  projection that the combined feature would exceed block thresholds. The ratified
  stacked-PR split (marker M1 → PR #16, marker M2 → PR #17, hazard route
  `single-atomic-PR` due to the hard-atomic schema-version pin v7→v8) resolved this, and
  both individual PR packets passed their own `within_budget` validation.

## Lessons Learned and Recommendations

1. **Task latitude clauses ("your call, keep it minimal") work as designed and should be
   used more.** T025's explicit fold-or-don't-fold latitude let the implementer avoid
   writing a dead-code helper without that decision reading as an unauthorized deviation —
   because it was pre-authorized. Future task-writing should look for other "either
   mechanism satisfies the requirement" points and grant the same latitude explicitly,
   rather than over-specifying a single concrete mechanism.
2. **"Record a baseline" tasks should be phrased as the invariant they serve, not the
   mechanism.** T001 asked for a persisted snapshot; the team correctly recognized a
   same-run dynamic comparison was strictly better and built that instead — but because
   the task text prescribed a specific artifact (a recorded snapshot), completing it a
   different way needed retrospective justification. Phrasing this kind of task as "prove
   FR-024/SC-006 parity" (outcome) rather than "record a baseline snapshot" (mechanism)
   would let equally-valid implementations satisfy the task without any deviation bookkeeping.
3. **The reviewability gate caught what the spec predicted, twice, and the stacked-PR
   remediation worked cleanly.** The spec's own Reviewability Budget section forecast a
   block-tier result and a two-slice split before any code was written; both the
   tasks-phase gate and the final diff gate independently confirmed that forecast at
   implementation time, and the automated re-slicing → stacked-PR-emission path produced
   two individually-passing PR packets without manual intervention. This is a working
   example of a projected budget from planning holding up under real measurement — worth
   citing as a reference case when future specs are asked to project their own
   reviewability budget.

## File Traceability Appendix

- Spec: `specs/001-embedding-infrastructure/spec.md` (37 FR + 11 SC)
- Plan: `specs/001-embedding-infrastructure/plan.md`
- Tasks: `specs/001-embedding-infrastructure/tasks.md` (T001–T037, full traceability table lines 240–282)
- Production code: `src/embeddings/{config,provider,endpoint-provider,indexer-hook}.ts`;
  `src/db/{schema.sql,migrations.ts,queries.ts}`; `src/index.ts`; `src/extraction/index.ts`;
  `src/ui/shimmer-progress.ts`; `src/bin/codegraph.ts`
- Tests: `__tests__/embeddings-{config,codec,input-hash,endpoint,index,sync,resilience}.test.ts`
- PRs: [#16](https://github.com/racecraft-lab/codegraph/pull/16) (Slice A, base `main`),
  [#17](https://github.com/racecraft-lab/codegraph/pull/17) (Slice B, base slice-a) — both
  OPEN as of this analysis
- Process evidence: `specs/001-embedding-infrastructure/.process/{autopilot-state.json,layer-plan.json,final-reviewability/,pr/,pr-packets/,reviewability/}`
- Deviation evidence: `.claude/agent-memory/speckit-pro-implement-executor/project_embedding-incremental-freshness.md`
- Post-review fix commit: `0fb29aa`

## Self-Assessment Checklist

- Evidence completeness: **PASS** — every deviation cites a file/commit/test.
- Coverage integrity: **PASS** — all 37 FR + 11 SC accounted for via `tasks.md`'s own traceability table, cross-checked against no gaps.
- Metrics sanity: **PASS** — completion_rate = 37/37 = 100%; spec_adherence = (46+2)/48 = 100%.
- Severity consistency: **PASS** — both deviations are MINOR/POSITIVE, consistent with their described impact (no requirement unmet, no regression).
- Constitution review: **PASS** — all seven principles independently re-verified (not just plan.md's self-report); no violations.
- Human Gate readiness: **N/A** — no spec changes are proposed, so no gate is triggered.
- Actionability: **PASS** — three recommendations above are specific and tied to concrete findings.

## Addendum — Live dogfood validation (2026-07-05, post-retrospective)

After this report was written, the full UAT runbook was executed twice more against real
infrastructure (a headless LM Studio endpoint serving nomic-embed-code, 3584 dims): once
per stacked PR head, all story and negative-path checkboxes passing (mid-pass outage via
proxy-kill, SIGINT recovery, model-switch re-inference to 768 dims, credential byte-scan
clean). The repository then dogfooded itself: the feature worktree embedded 3,569/3,569
declaration symbols and the main checkout's live index migrated v7→v8 additively and
backfilled 3,398/3,398 — while the released-binary MCP daemon kept serving it. The
process is now codified as the roadmap's binding Dogfooding Protocol for every future
spec.
