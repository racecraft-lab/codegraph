# SPEC-020 Retrospective

## Outcome

SPEC-020 delivered the planned reusable PR impact action with deterministic reporting, opt-in threshold enforcement, fork-safe delivery fallback, cache validation, and prose-only optional narrative handling.

## Spec adherence

- Implemented all four user stories.
- Satisfied the action contract, result matrix, report delivery, cache, trust-boundary, and narrative requirements.
- Preserved the accepted reviewability warning instead of widening scope or silently splitting the spec.
- Kept the action additive; detector internals were not changed.

## Verification

- Focused PR-impact tests passed: 6 files, 26 tests.
- `npm run build` passed.
- `npm run typecheck` passed.
- `npm test` passed: 240 files, 3,953 tests, 7 skipped.
- Verify-tasks phantom check passed: 60/60 completed tasks verified.
- Warm-cache deterministic sample median was 149s, under the 180s target.
- Code review remediation passed for event-base defaulting, final delivery metadata consistency, and merge-base metadata.
- PR check remediation passed locally for full-SHA external action pinning.
- PR check remediation passed locally for cold-cache CodeGraph initialization.
- PR check remediation passed locally for self-dogfood using the checked-out workspace package.

## Deviations

- Live dogfood artifact evidence is deferred until GitHub Actions reruns after the cold-cache initialization remediation.
- Optional narrative remains represented by deterministic seams; live provider quality remains outside SPEC-020 and belongs to SPEC-018.

## Lessons

- The cache contract needed stronger runtime validation than metadata alone. Worktree mismatch, pending changes, incomplete index state, extraction-version compatibility, and reindex recommendations are now checked before warm-cache acceptance.
- Report metadata needs action run identity to make reruns and synchronize events distinguishable.
- A reusable action cannot assume an index exists on a first run; cold-cache paths need initialization, not only re-indexing.
- Self-dogfood for unreleased CLI features must install the checked-out workspace package, not the last published package.
- Advisory dogfood should remain threshold-free until enough live PR samples exist to justify blocking defaults.

## Follow-up

- Record the first live dogfood workflow run and artifact URL after the PR is opened.
- Revisit blocking thresholds only after observing advisory reports on real CodeGraph pull requests.
