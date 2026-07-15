# SPEC-012 UAT Runbook — Change Impact Detection

**Created:** 2026-07-15
**Status:** Executed on 2026-07-15
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

## Actual Evidence — 2026-07-15

Runtime note: commands were run from the SPEC-012 worktree with Node
`v24.11.1` prepended to `PATH`. The local worktree index was refreshed first
with `node dist/bin/codegraph.js sync`.

| Scenario | Command | Exit | Result |
|----------|---------|------|--------|
| Staged clean | `node dist/bin/codegraph.js detect-changes --mode staged --format json` | 0 | `status: clean`; 0 changed symbols, 0 unmapped hunks, 0 callers, 0 affected flows |
| All changes JSON | `node dist/bin/codegraph.js detect-changes --mode all --format json --max-callers 10` | 1 | `status: impact`; 9 changed symbols, 68 unmapped diagnostics, 10 bounded callers, 0 affected flows; warnings for unsupported and untracked changes |
| All changes markdown | `node dist/bin/codegraph.js detect-changes --mode all --format markdown --max-callers 10` | 1 | Markdown summary reported Mode `all`, Status `impact`, 9 changed symbols, 68 unmapped hunks, 10 impacted callers, 0 affected flows, 4 risks, and 2 warnings |
| Threshold breach | `node dist/bin/codegraph.js detect-changes --mode all --format json --fail-on callers>0 --max-callers 10` | 2 | `status: threshold_breach`; threshold-breach risks emitted alongside high-caller, hub, unavailable-flow-enrichment, and truncation risks |
| Missing index | `node dist/bin/codegraph.js detect-changes --path <tempdir> --mode all --format json` | 3 | `status: unavailable`; normal unavailable report with 0 changed symbols, 0 callers, 0 affected flows, and an unavailable warning |

Sample changed symbols from the self-repo UAT:

- `main` in `src/bin/codegraph.ts`
- `SERVER_INSTRUCTIONS` in `src/mcp/server-instructions.ts`
- `SERVER_INSTRUCTIONS_NO_ROOT_INDEX` in `src/mcp/server-instructions.ts`
- `tools` in `src/mcp/tools.ts`
- `DEFAULT_MCP_TOOLS` in `src/mcp/tools.ts`

Verification evidence:

- `npm run build` passed.
- `npm run typecheck` passed.
- Focused detect-changes suite passed: 3 files, 12 tests.
- MCP/default-surface/retrieval-safety focused suite passed: 5 files, 36 tests.
- Full suite passed outside the sandbox: 234 files, 3,925 tests passed, 7 skipped.

Notes:

- The first full-suite attempt inside the sandbox was stopped after unrelated
  environment failures: GPG signing was blocked, loopback/Unix socket listeners
  hit `listen EPERM`, and endpoint/embedding tests timed out. The same suite
  passed with the standard project runtime outside the sandbox.
- SPEC-011 flow enrichment was available to the command surface, but this
  self-repo implementation diff did not match any affected flows.
