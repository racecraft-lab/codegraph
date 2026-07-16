# SPEC-020 PR Review Packet

## Review order

1. Public action contract: `actions/pr-impact/action.yml` and `actions/pr-impact/README.md`.
2. Helper behavior: `actions/pr-impact/run.ts`.
3. Generated runtime freshness: `actions/pr-impact/dist/run.mjs`.
4. Focused tests under `__tests__/pr-impact-*.test.ts`.
5. Dogfood workflow: `.github/workflows/pr-impact.yml`.
6. Spec artifacts and changelog.

## Scope budget

- Spec: SPEC-020 — PR Blast-Radius Review Action.
- Primary surface: harness/adapter.
- Accepted reviewability budget: warning, 455 reviewable LOC, 4 production files,
  11 total files.
- Latest setup-mode reviewability gate: `warn`, pass=true, no blockers.

## Traceability

| Requirement area | Implementation evidence | Test evidence |
| --- | --- | --- |
| Deterministic report and sticky comment | `actions/pr-impact/run.ts`, `actions/pr-impact/action.yml` | `__tests__/pr-impact-delivery.test.ts` |
| Fork/restricted-token fallback | `actions/pr-impact/run.ts` | `__tests__/pr-impact-delivery.test.ts`, `__tests__/pr-impact-result-matrix.test.ts` |
| Threshold-only failures | `actions/pr-impact/run.ts` | `__tests__/pr-impact-result-matrix.test.ts`, `__tests__/pr-impact-action-contract.test.ts` |
| Cache validation/rebuild | `actions/pr-impact/run.ts`, `actions/pr-impact/action.yml` | `__tests__/pr-impact-cache.test.ts` |
| Prose-only narrative | `actions/pr-impact/run.ts` | `__tests__/pr-impact-narrative.test.ts` |
| Dogfood workflow | `.github/workflows/pr-impact.yml` | `__tests__/pr-impact-action-contract.test.ts` |
| Generated runtime | `actions/pr-impact/dist/run.mjs` | `__tests__/pr-impact-runtime-freshness.test.ts` |

## Verification evidence

- Focused PR-impact tests: PASS — 6 files, 26 tests.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS — 240 files, 3,953 tests, 7 skipped.
- Warm-cache deterministic sample median: 149s, below 180s target.
- Code review remediation: PASS — event-base defaulting, final delivery metadata consistency, and merge-base metadata fixed.
- PR check remediation: PASS locally — external `actions/*` references are pinned to full commit SHAs.
- PR check remediation: PASS locally — cold cache misses initialize the CodeGraph index before analysis.
- PR check remediation: PASS locally — dogfood installs the checked-out workspace package so unreleased detector commands are available.

## Known gaps

- Live GitHub dogfood artifact URL is pending until GitHub Actions reruns after
  the cold-cache initialization remediation.
- Optional narrative is represented by deterministic local seams in this spec;
  endpoint/agent narrative quality remains owned by SPEC-018.

## Rollback notes

- Disable the dogfood workflow by removing `.github/workflows/pr-impact.yml`.
- Consumers can stop using the action by deleting the `uses: ./actions/pr-impact`
  workflow step.
- The action is additive and does not change `detect-changes` detector internals.
