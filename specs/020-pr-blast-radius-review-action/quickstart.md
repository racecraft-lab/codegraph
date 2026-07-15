# Quickstart: Validate PR Blast-Radius Review Action

## Prerequisites

- Use the dedicated branch `020-pr-blast-radius-review-action`.
- Use Node 24.11.1 for local source validation.
- Run from repository root.

## Baseline checks

```bash
npm run build
npm run typecheck
npm test
```

### Pre-implementation baseline evidence

Recorded on 2026-07-15 before SPEC-020 implementation edits.

Runtime:

- Node: `v24.11.1` from `/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin/node`
- npm: pinned npm CLI from `/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/lib/node_modules/npm/bin/npm-cli.js`

Results:

- `npm ci`: PASS. Installed 83 packages; audit reported 0 vulnerabilities.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: BASELINE FAIL before implementation edits. Vitest reported 22 failed test files, 209 failed tests, and 91 errors. The dominant failures were local execution constraints (`listen EPERM` on loopback or Unix sockets), sandboxed temp-git/GPG behavior, local endpoint/embedding/LLM timeout paths, and watcher timeout behavior. This is recorded as an environmental baseline, not a SPEC-020 regression.

## Focused validation scenarios

### 1. Action contract

Run the action contract tests.

Expected:

- `action.yml` exposes the inputs and outputs in [contracts/action-contract.md](./contracts/action-contract.md).
- The compiled helper artifact is fresh relative to `run.ts`.

### 2. Detector result matrix

Run fixtures for clean, ordinary impact, threshold breach, and unavailable analysis.

Expected:

- Clean passes.
- Ordinary impact passes when thresholds are unset.
- Caller or hub threshold breach fails.
- Analysis unavailable after fallback fails.

### 3. Cache validation

Run cache fixtures for warm-valid, miss, stale, corrupt, incompatible, rebuilt, and unavailable paths.

Expected:

- Invalid restored state is never used as current analysis.
- Rebuild path records cache status.
- Unrecoverable cache/index failure produces an unavailable report and failing conclusion.

### 4. Fork and delivery fallback

Run trusted same-repository and fork-like permission fixtures.

Expected:

- Same-repository trusted runs update or create one action-owned sticky comment.
- Fork-like runs skip privileged comment/narrative behavior.
- Successful analysis remains available in the workflow summary and artifact when comment delivery is unavailable.

### 5. Narrative behavior

Run narrative-disabled, suppressed, misconfigured, endpoint-failure, pending-agent, fallback, and appended fixtures.

Expected:

- Deterministic facts and final conclusion match the no-narrative baseline.
- Narrative status is recorded.
- Prose, when present, appears only after deterministic sections.

### 6. Dogfood workflow

Trigger or observe `.github/workflows/pr-impact.yml` on CodeGraph pull requests in advisory mode.

Expected:

- Threshold inputs are unset.
- The action publishes deterministic reports automatically.
- At least five eligible warm-cache samples show median completion ≤3 minutes.

## Evidence to record before PR

- Focused test output for all scenarios above.
- `npm run build`, `npm run typecheck`, and `npm test`.
- Generated helper freshness evidence.
- Dogfood report link or artifact.
- Warm-cache sample table and median.
- Reviewability gate output.
