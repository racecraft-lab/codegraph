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

- Focused PR-impact suite: PASS — 6 files, 27 tests.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS — 240 files, 3,954 tests passed, 7 skipped; duration 69.25s.

## PR check remediation

- Finding: GitHub rejected mutable external action references in the dogfood workflow/action because organization policy requires full commit SHA pins.
- Fix: pinned `actions/checkout`, `actions/cache/restore`, `actions/cache/save`, and `actions/upload-artifact` to full 40-character commit SHAs.
- Test: `pr-impact-action-contract.test.ts` now verifies external `actions/*` references are pinned to full commit SHAs.
- Finding: the dogfood action failed with `fail-analysis-unavailable` on a cold cache because the helper tried `codegraph index` before initialization.
- Fix: cache misses now run `codegraph init`, restored/stale caches still run `codegraph index`, and the helper restores any advisory `.gitignore` mutation from initialization.
- Test: `pr-impact-cache.test.ts` now verifies cold-cache initialization, detector execution, metadata write, and `.gitignore` restoration.
- Finding: the dogfood workflow installed the published `@colbymchenry/codegraph@1.4.1`, which does not expose the unreleased `detect-changes` command required by SPEC-020.
- Fix: the self-repository dogfood workflow installs the checked-out workspace package with `codegraph-version: "file:."`.
- Test: `pr-impact-action-contract.test.ts` now verifies the dogfood workflow uses the workspace package while keeping thresholds advisory and narrative off.
- Finding: GitHub restored a fallback cache through `restore-keys`, but the helper treated `cache-hit=false` as a cold miss and tried `codegraph init` against an existing `.codegraph` directory.
- Fix: restored cache metadata is now validated whenever the metadata file exists, even when the cache action reports a non-exact hit.
- Test: `pr-impact-cache.test.ts` now verifies fallback restored metadata is re-indexed instead of initialized when the version is incompatible.

## Verification after PR check remediation

- Focused PR-impact suite: PASS — 6 files, 27 tests.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS — 240 files, 3,954 tests passed, 7 skipped; duration 69.25s.
