# feat(SPEC-014): Add CFG lifecycle management

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 8 of 11 (us2).
This slice exceeds the 400-line production target at 556 lines but remains at or below the 800-line hard ceiling.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Add CFG lifecycle management
- Completes tasks T017, T018, T019, T020, T021, T022, T023.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-07-us1-part5 and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/us2/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/us2/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint ee70c09c2cca9b7641248c7912d24705b3bf151a passed scoped verification.
- The marker is linearly ordered after 91235007d4de2e8bd0f68b9a2abdc83bdb967c5b.

## Scope

- __tests__/analysis/cfg/cfg-lifecycle.test.ts
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- specs/014-control-flow-graphs/tasks.md
- src/analysis/cfg/index.ts
- src/index.ts
- src/project-config.ts

## Known Gaps

- This slice exceeds the 400-line production target at 556 lines but remains at or below the 800-line hard ceiling.
- CI and review remediation will be tracked after live PR creation.
