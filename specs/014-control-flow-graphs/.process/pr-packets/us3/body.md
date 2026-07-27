# feat(SPEC-014): Expose CFG CLI MCP and status reads

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 9 of 11 (us3).
This slice exceeds the 400-line production target at 459 lines but remains at or below the 800-line hard ceiling.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Expose CFG CLI MCP and status reads
- Completes tasks T024, T025, T026, T027, T028, T029, T030, T031.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-08-us2 and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/us3/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/us3/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 6c8bc414eba7432c5a2dd25e62efb1605fbd3826 passed scoped verification.
- The marker is linearly ordered after ee70c09c2cca9b7641248c7912d24705b3bf151a.

## Scope

- __tests__/analysis/cfg/cfg-contract.test.ts
- __tests__/mcp-server-instructions.test.ts
- __tests__/mcp-tool-allowlist.test.ts
- __tests__/rename-mcp.test.ts
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- specs/014-control-flow-graphs/quickstart.md
- specs/014-control-flow-graphs/tasks.md
- src/analysis/cfg/index.ts
- src/bin/codegraph.ts
- src/index.ts
- src/mcp/server-instructions.ts
- src/mcp/tools.ts

## Known Gaps

- This slice exceeds the 400-line production target at 459 lines but remains at or below the 800-line hard ceiling.
- CI and review remediation will be tracked after live PR creation.
