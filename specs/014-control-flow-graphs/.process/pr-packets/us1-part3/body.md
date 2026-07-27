# feat(SPEC-014): Add expression control flow

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 5 of 11 (us1-part3).
This slice exceeds the 400-line production target at 546 lines but remains at or below the 800-line hard ceiling.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Add expression control flow
- Completes tasks T014.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-04-us1-part2 and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/us1-part3/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/us1-part3/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 688c0d21cebac1eb907e7d9bf16da18825722dc6 passed scoped verification.
- The marker is linearly ordered after bc34465b2325bf8f9bfa2faca79af222dade93f6.

## Scope

- __tests__/analysis/cfg/cfg-typescript.test.ts
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- specs/014-control-flow-graphs/tasks.md
- src/analysis/cfg/index.ts

## Known Gaps

- This slice exceeds the 400-line production target at 546 lines but remains at or below the 800-line hard ceiling.
- CI and review remediation will be tracked after live PR creation.
