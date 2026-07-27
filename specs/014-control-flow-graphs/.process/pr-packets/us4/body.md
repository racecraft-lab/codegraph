# feat(SPEC-014): Add Python CFG parity

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 10 of 11 (us4).
This slice exceeds the 400-line production target at 508 lines but remains at or below the 800-line hard ceiling.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Add Python CFG parity
- Completes tasks T032, T033, T034, T035, T036, T037, T038.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-09-us3 and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/us4/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/us4/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 132658f393fa6a960d82a001e5dd33fd0d18935f passed scoped verification.
- The marker is linearly ordered after 6c8bc414eba7432c5a2dd25e62efb1605fbd3826.

## Scope

- __tests__/analysis/cfg/cfg-contract.test.ts
- __tests__/analysis/cfg/cfg-python.test.ts
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- specs/014-control-flow-graphs/quickstart.md
- specs/014-control-flow-graphs/tasks.md
- src/analysis/cfg/index.ts
- src/extraction/extraction-version.ts
- src/extraction/languages/python.ts

## Known Gaps

- This slice exceeds the 400-line production target at 508 lines but remains at or below the 800-line hard ceiling.
- CI and review remediation will be tracked after live PR creation.
