# SPEC-020 Code Review Report

Date: 2026-07-16

## Verdict

Passed after remediation.

## Findings remediated

1. Critical: omitted `base-ref` input defaulted detector comparison to `HEAD^` instead of the pull-request event base ref.
   - Fix: `runDetector()` now receives pull-request context and resolves the effective base ref from input, event base ref, then `HEAD^` fallback.
   - Test: `pr-impact-action-contract.test.ts` now verifies omitted `INPUT_BASE_REF` uses `pull_request.base.ref`.

2. Important: summary/comment delivery surfaces could contain preliminary delivery metadata.
   - Fix: comment delivery is finalized after final delivery status is known, and summary/file output now use the final report content.
   - Test: `pr-impact-delivery.test.ts` now verifies comment, summary, and report file contain final `Delivery status: comment`.

3. Important: report metadata labeled the event base SHA as merge base.
   - Fix: merge-base metadata now uses explicit `PR_IMPACT_MERGE_BASE` when provided, otherwise attempts `git merge-base <baseRef> <headSha>` before falling back to event base SHA.
   - Test: cache/result fixtures now pin explicit merge-base identity where command-call ordering matters.

## Verification after remediation

- Focused PR-impact suite: PASS — 6 files, 24 tests.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS — 240 files, 3,951 tests passed, 7 skipped; duration 65.40s.
