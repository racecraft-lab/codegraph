# feat(SPEC-014): Complete TypeScript CFG semantics

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 7 of 11 (us1-part5).
This slice is within the reviewability budget.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Complete TypeScript CFG semantics
- Completes tasks T016.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-06-us1-part4 and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/us1-part5/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/us1-part5/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 91235007d4de2e8bd0f68b9a2abdc83bdb967c5b passed scoped verification.
- The marker is linearly ordered after a3cff3b299d39b8d6aad17c95b8017b9ec0a1369.

## Scope

- __tests__/analysis/cfg/cfg-typescript.test.ts
- __tests__/pr-impact-action-contract.test.ts
- __tests__/pr-impact-cache.test.ts
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- specs/014-control-flow-graphs/tasks.md
- src/analysis/cfg/index.ts

## Known Gaps

- This slice is within the reviewability budget.
- CI and review remediation will be tracked after live PR creation.
