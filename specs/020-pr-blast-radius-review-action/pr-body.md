# SPEC-020: PR Blast-Radius Review Action

## What changed

- Added a reusable composite GitHub Action at `actions/pr-impact/`.
- Added a packaged helper runtime with deterministic PR impact report generation.
- Added fork-safe fallback delivery through workflow summary and artifact.
- Added advisory dogfood workflow coverage for CodeGraph pull requests.
- Added focused contract, cache, delivery, result-matrix, narrative, and runtime freshness tests.

## Why

Reviewers need one current deterministic blast-radius report on pull requests. The action keeps ordinary impact advisory, enforces only opt-in thresholds, validates restored graph caches before use, and keeps optional narrative prose-only.

## Non-goals

- No detector rewrite.
- No default blocking thresholds.
- No new narrative provider system; SPEC-018 remains the owner of optional narrative behavior.
- No `pull_request_target` execution of untrusted PR code.

## Review order

1. `actions/pr-impact/action.yml`
2. `actions/pr-impact/README.md`
3. `actions/pr-impact/run.ts`
4. `actions/pr-impact/dist/run.mjs`
5. `__tests__/pr-impact-*.test.ts`
6. `.github/workflows/pr-impact.yml`
7. SPEC-020 docs and `CHANGELOG.md`

## Scope budget

- Reviewability gate: warning accepted, pass=true.
- Reviewable LOC: 455.
- Production files: 4.
- Total files: 11.
- Blockers: none.

## Traceability

| Requirement area | Implementation | Verification |
| --- | --- | --- |
| Deterministic report and sticky comment | `actions/pr-impact/run.ts`, `actions/pr-impact/action.yml` | `__tests__/pr-impact-delivery.test.ts` |
| Fork/restricted-token fallback | `actions/pr-impact/run.ts` | `__tests__/pr-impact-delivery.test.ts`, `__tests__/pr-impact-result-matrix.test.ts` |
| Threshold-only failures | `actions/pr-impact/run.ts` | `__tests__/pr-impact-result-matrix.test.ts`, `__tests__/pr-impact-action-contract.test.ts` |
| Cache validation/rebuild | `actions/pr-impact/run.ts`, `actions/pr-impact/action.yml` | `__tests__/pr-impact-cache.test.ts` |
| Prose-only narrative | `actions/pr-impact/run.ts` | `__tests__/pr-impact-narrative.test.ts` |
| Dogfood workflow | `.github/workflows/pr-impact.yml` | `__tests__/pr-impact-action-contract.test.ts` |
| Generated runtime | `actions/pr-impact/dist/run.mjs` | `__tests__/pr-impact-runtime-freshness.test.ts` |

## Verification

- Focused PR-impact suite: PASS — 6 files, 25 tests.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS — 240 files, 3,952 tests passed, 7 skipped.
- Warm-cache deterministic sample median: 149s, below the 180s target.
- Verify-tasks phantom check: PASS — 60/60 completed tasks verified.
- Code review remediation: PASS — event-base defaulting, final delivery metadata consistency, and merge-base metadata fixed.
- PR check remediation: PASS locally — external `actions/*` references are pinned to full commit SHAs.

## Known gaps

- Live dogfood workflow artifact URL is pending until GitHub Actions reruns after the full-SHA pinning remediation.
- Optional narrative quality and provider behavior remain owned by SPEC-018.

## Rollback

- Remove `.github/workflows/pr-impact.yml` to disable dogfood.
- Remove or stop using the `uses: ./actions/pr-impact` workflow step for consumers.
- The action is additive and does not change detector internals.
