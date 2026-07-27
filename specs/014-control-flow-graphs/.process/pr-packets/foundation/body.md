# feat(SPEC-014): Establish CFG storage and contracts

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 2 of 11 (foundation).
This slice exceeds the 400-line production target at 796 lines but remains at or below the 800-line hard ceiling.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Establish CFG storage and contracts
- Completes tasks T004, T005, T006, T007, T008.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-01-full-spec and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/foundation/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/foundation/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 11bec1fecddcd88854ac0a2d79d3ef82acf88353 passed scoped verification.
- The marker is linearly ordered after 666ce13eef9a243d12cf53da48a0d3640672214f.

## Scope

- __tests__/analysis/activation/dormancy.test.ts
- __tests__/analysis/cfg/cfg-contract.test.ts
- __tests__/analysis/cfg/cfg-lifecycle.test.ts
- __tests__/analysis/schema-ship.test.ts
- __tests__/embeddings-index.test.ts
- __tests__/foundation.test.ts
- __tests__/mcp-daemon.test.ts
- __tests__/pr19-improvements.test.ts
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- specs/014-control-flow-graphs/tasks.md
- src/analysis/cfg/index.ts
- src/db/migrations.ts
- src/db/schema.sql
- src/index.ts
- src/project-config.ts

## Known Gaps

- This slice exceeds the 400-line production target at 796 lines but remains at or below the 800-line hard ceiling.
- CI and review remediation will be tracked after live PR creation.
