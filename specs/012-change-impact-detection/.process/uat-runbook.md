# SPEC-012 UAT Runbook — Change Impact Detection

**Created:** 2026-07-15
**Status:** Draft setup runbook
**Workflow:** `docs/ai/specs/.process/SPEC-012-workflow.md`

## Purpose

Prove `codegraph detect-changes` works end-to-end on this repository with a
controlled diff:

- changed hunks map to indexed symbols,
- bounded callers and SPEC-011 flows are reported,
- stale-index status is visible when applicable,
- JSON and markdown outputs agree,
- exit codes are stable for clean, impact, and threshold-breach cases.

## Preconditions

- Work from the SPEC-012 worktree.
- Build and test prerequisites have been installed by an operator-approved
  bootstrap step.
- The repository has a healthy CodeGraph index with SPEC-011 flow catalogs
  available, or the runbook records the explicit unavailable/disabled state.

## Scenario A — clean diff

1. Ensure the worktree is clean.
2. Run `node dist/bin/codegraph.js detect-changes --json`.
3. Expected result:
   - exit code `0`,
   - no changed symbols,
   - no affected callers or flows,
   - no threshold breach.

## Scenario B — controlled symbol change

1. Make a small reversible edit to a source fixture or test helper selected
   during implementation.
2. Run `node dist/bin/codegraph.js detect-changes --all --json`.
3. Run `node dist/bin/codegraph.js detect-changes --all --format markdown`.
4. Expected result:
   - exit code `1`,
   - at least one changed symbol maps to the edited hunk,
   - bounded callers are present when graph edges exist,
   - affected flows are present when SPEC-011 catalog data references the
     changed symbol,
   - JSON and markdown describe the same impact set.

## Scenario C — threshold breach

1. Reuse the controlled change from Scenario B.
2. Run with the lowest deterministic caller threshold that the fixture can
   breach, for example `--fail-on callers>0` when callers are present.
3. Expected result:
   - exit code `2`,
   - threshold breach recorded in JSON,
   - markdown output clearly marks the breach.

## Scenario D — rename without semantic impact

1. Rename or move a selected fixture file without editing its contents.
2. Run `node dist/bin/codegraph.js detect-changes --all --json`.
3. Expected result:
   - rename/move is detected,
   - pure move does not fabricate changed-symbol impacts,
   - any warnings are explicit and non-misleading.

## Evidence to Record

- Command lines and exit codes.
- Compact JSON snippets showing changed symbols, callers, flows, warnings, and
  thresholds.
- Markdown output excerpt.
- Final `npm run build` and `npm test` results.
- Any stale-index or disabled-flow-catalog caveat and how it was resolved.
