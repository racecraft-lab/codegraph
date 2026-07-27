# fix(SPEC-014): Complete CFG review gates and hardening

## Summary

<!-- speckit-pro-editable:summary:start -->
Delivers ordered SPEC-014 marker 11 of 11 (polish).
This slice exceeds the 400-line production target at 636 lines but remains at or below the 800-line hard ceiling.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Complete CFG review gates and hardening
- Completes tasks T039, T040, T041, T042, T043.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
The final SPEC-014 diff is correctness-clean but too large for one review. This cumulative marker keeps the dependency path buildable and reviewable.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review after codex/spec014-cfg-stack-10-us4 and before the next marker.
- Start with specs/014-control-flow-graphs/.process/emission/polish/verification.json.
- Confirm the changed-file list at specs/014-control-flow-graphs/.process/emission/polish/changed-files.txt.

## How To UAT

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## UAT Runbook

No separate manual UAT runbook was committed for this feature.
Run the checkpoint-scoped commands recorded in the verification evidence.

## Verification

- Checkpoint 91238913e5358560cbca8cec804e23e4b2c03f78 passed scoped verification.
- The marker is linearly ordered after 132658f393fa6a960d82a001e5dd33fd0d18935f.

## Scope

- .codex/config.toml
- __tests__/analysis/cfg/cfg-contract.test.ts
- __tests__/analysis/cfg/cfg-lifecycle.test.ts
- __tests__/analysis/cfg/cfg-performance.test.ts
- __tests__/analysis/cfg/cfg-typescript.test.ts
- __tests__/analysis/schema-ship.test.ts
- __tests__/mcp-dogfood-runtime.test.ts
- docs/agent-dogfooding.md
- docs/ai/specs/.process/SPEC-014-workflow.md
- docs/ai/specs/.process/autopilot-state.json
- docs/ai/specs/intelligence-platform-technical-roadmap.md
- scripts/agent-eval/ab-new-vs-baseline.sh
- scripts/lib/dogfood-node-runtime.mjs
- scripts/mcp-dogfood.mjs
- specs/014-control-flow-graphs/.process/emission/full-verification.json
- specs/014-control-flow-graphs/.process/evidence/t041-retrieval-ab.json
- specs/014-control-flow-graphs/.process/reviewability/final-actual.json
- specs/014-control-flow-graphs/contracts/cfg-cli.md
- specs/014-control-flow-graphs/contracts/cfg-mcp.md
- specs/014-control-flow-graphs/contracts/cfg-status.md
- specs/014-control-flow-graphs/plan.md
- specs/014-control-flow-graphs/quickstart.md
- specs/014-control-flow-graphs/research.md
- specs/014-control-flow-graphs/tasks.md
- specs/014-control-flow-graphs/verify-tasks-report.md
- src/analysis/cfg/index.ts
- src/bin/codegraph.ts
- src/index.ts
- src/mcp/tools.ts
- src/project-config.ts

## Known Gaps

- This slice exceeds the 400-line production target at 636 lines but remains at or below the 800-line hard ceiling.
- CI and review remediation will be tracked after live PR creation.
