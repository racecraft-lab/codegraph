# test(SPEC-014): Add deterministic CFG acceptance fixtures

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 1 of 11 (full-spec).
This non-production slice spans 42 files and should be reviewed as contracts and fixtures rather than runtime code.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Add deterministic CFG acceptance fixtures
- Completes tasks T001, T002, T003.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after main and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/full-spec/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/full-spec/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 666ce13eef9a243d12cf53da48a0d3640672214f passed scoped verification.
- The marker is linearly ordered after 474729007ebb6bf400857003790cc296a0238d75.

## Scope

- .specify/feature.json
- __tests__/analysis/cfg/cfg-python.test.ts
- __tests__/analysis/cfg/cfg-typescript.test.ts
- __tests__/analysis/cfg/fixtures/python/async_await.py
- __tests__/analysis/cfg/fixtures/python/comprehensions.py
- __tests__/analysis/cfg/fixtures/python/generators.py
- __tests__/analysis/cfg/fixtures/python/lambdas_and_nested_classes.py
- __tests__/analysis/cfg/fixtures/python/match_case.py
- __tests__/analysis/cfg/fixtures/python/parity_baseline.py
- __tests__/analysis/cfg/fixtures/python/raise_and_unreachable.py
- __tests__/analysis/cfg/fixtures/tsjs/baseline.ts
- __tests__/analysis/cfg/fixtures/tsjs/nested-functions.ts
- __tests__/analysis/cfg/fixtures/tsjs/no-op.ts
- __tests__/analysis/cfg/fixtures/tsjs/nullish-coalescing.js
- __tests__/analysis/cfg/fixtures/tsjs/optional-chaining.ts
- __tests__/analysis/cfg/fixtures/tsjs/over-limit.ts
- __tests__/analysis/cfg/fixtures/tsjs/short-circuit.ts
- __tests__/analysis/cfg/fixtures/tsjs/switch.js
- __tests__/analysis/cfg/fixtures/tsjs/throw-finally.js
- __tests__/analysis/cfg/fixtures/tsjs/unreachable.js
- __tests__/analysis/cfg/fixtures/tsjs/unsupported.js
- docs/ai/specs/.process/SPEC-014-design-concept.md
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- docs/ai/specs/intelligence-platform-roadmap-MOC.md
- docs/ai/specs/intelligence-platform-technical-roadmap.md
- specs/014-control-flow-graphs/SPEC-MOC.md
- specs/014-control-flow-graphs/checklists/api-contracts.md
- specs/014-control-flow-graphs/checklists/data-integrity.md
- specs/014-control-flow-graphs/checklists/error-handling.md
- specs/014-control-flow-graphs/checklists/performance.md
- specs/014-control-flow-graphs/checklists/requirements.md
- specs/014-control-flow-graphs/contracts/cfg-cli.md
- specs/014-control-flow-graphs/contracts/cfg-mcp.md
- specs/014-control-flow-graphs/contracts/cfg-shared-contract.md
- specs/014-control-flow-graphs/contracts/cfg-status.md
- specs/014-control-flow-graphs/data-model.md
- specs/014-control-flow-graphs/plan.md
- specs/014-control-flow-graphs/quickstart.md
- specs/014-control-flow-graphs/research.md
- specs/014-control-flow-graphs/spec.md
- specs/014-control-flow-graphs/tasks.md

## Known Gaps

- This non-production slice spans 42 files and should be reviewed as contracts and fixtures rather than runtime code.
- CI and review remediation will be tracked after live PR creation.
