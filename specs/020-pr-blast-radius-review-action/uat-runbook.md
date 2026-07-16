# SPEC-020 UAT Runbook

## Scope

Validate the PR impact action as a reusable GitHub Action before enabling blocking thresholds.

## Local acceptance checks

1. Run focused PR-impact tests:

   ```bash
   npm test -- __tests__/pr-impact-action-contract.test.ts __tests__/pr-impact-cache.test.ts __tests__/pr-impact-delivery.test.ts __tests__/pr-impact-narrative.test.ts __tests__/pr-impact-result-matrix.test.ts __tests__/pr-impact-runtime-freshness.test.ts
   ```

2. Run full validation:

   ```bash
   npm run build
   npm run typecheck
   npm test
   ```

3. Confirm `actions/pr-impact/dist/run.mjs` is fresh after `npm run build`.

## GitHub PR acceptance checks

1. Open the SPEC-020 pull request from `020-pr-blast-radius-review-action`.
2. Wait for the `PR impact` workflow to run on the pull request.
3. Confirm the workflow uses advisory defaults:
   - thresholds unset
   - narrative disabled
   - deterministic report still published
4. Confirm the report is available through workflow summary and artifact.
5. If the token has trusted comment permission, confirm exactly one action-owned sticky comment is created or updated.
6. Record the workflow run URL and artifact URL in the PR thread or review notes.

## Expected result

- Ordinary impact remains advisory.
- Threshold breaches fail only when thresholds are configured.
- Fork-like or restricted-token runs preserve deterministic report delivery without using privileged comment or narrative paths.
- Warm-cache eligible runs remain below the three-minute median target.

## Stop conditions

- Report facts differ between deterministic JSON, summary, artifact, and PR comment.
- A fork-like or read-only-token run attempts secret-backed narrative or privileged comment writing.
- A stale, incompatible, or worktree-mismatched cache is accepted as current analysis.
- All durable delivery surfaces fail without an explicit failing conclusion.
