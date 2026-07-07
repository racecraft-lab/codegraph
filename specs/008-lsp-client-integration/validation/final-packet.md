# Final Packet

## Review Scope

SPEC-008 adds an opt-in LSP precision path. It preserves default structural
indexing, records per-language degradation, and validates every internal
baseline language/capability row as implemented or concrete-spec-owned.

## README and Changelog Decision

No README or CHANGELOG edit is included in the implementation checkpoint unless
final review determines a release note is required. The feature is guarded by
explicit opt-in behavior and is fully documented in SPEC-008 artifacts for this
review packet.

## Commands

```text
npm run build
```

Result: passed on Node `24.11.1`.

Evidence: `tsc`, asset copy, and `dist/bin/codegraph.js` chmod completed with
exit 0.

```text
npm run typecheck
```

Result: passed on Node `24.11.1`.

Evidence: `tsc --noEmit` completed with exit 0.

```text
npm test
```

Result: passed on Node `24.11.1`.

Evidence: 141 test files passed; 2,280 tests passed; 4 skipped; duration
25.05s.

Note: the full-suite command was executed outside the sandbox with
process-local Git signing disabled because the repo's temp-Git tests inherit
global commit signing and daemon/watch/socket tests require host OS resources.
The override was scoped to the test process:

```text
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm test
```

During this run, `__tests__/lsp-disabled.test.ts` exposed one SPEC-008
watch-test race. The test now uses the existing deterministic inert watcher
test seam and synthetic watch event, matching the watcher test suite's pattern.
The focused verification passed:

```text
npx vitest run __tests__/lsp-disabled.test.ts
```

Result: 1 test file passed; 4 tests passed.

```text
npm run build && npm run typecheck && npm test
```

Result: passed on Node `24.11.1`.

Evidence: build passed, typecheck passed, then the full suite passed with 141
test files, 2,280 tests passed, 4 skipped, and duration 25.05s.

The combined run used the same process-local Git signing override for the test
phase.

```text
node scripts/spec-008-validate-real-servers.mjs
```

Result: passed.

Evidence: 17 verified local server rows, 1 future-owned COBOL disposition,
0 missing rows, and 0 unowned rows.

```text
node scripts/spec-008-parity-gate.mjs
```

Result: passed.

Evidence: 18 language rows, 17 capability rows, and 0 unowned rows.

Additional retrieval safety gate:

```text
node scripts/spec-008-retrieval-probes.mjs
```

Result: passed.

Evidence: nodes +3, raw edges +2, active outgoing 1, inactive audit rows hidden
1, and public search/callers/callees/impact/explore-equivalent surfaces clean.

Final hygiene:

- `git diff --check`: passed.
- Restricted-name scan: no matches.
- Outbound-link scan across SPEC-008 artifacts and validation scripts: no
  matches.

## Post-Implementation Reviewability Status

Final reviewability backstop:

- Result: blocked before PR body generation or PR creation.
- Reason: 5,511 reviewable LOC, 29 production files, and 90 total files exceed
  the one-PR block thresholds.
- Evidence:
  `specs/008-lsp-client-integration/.process/final-reviewability/gate-state.json`
  and
  `specs/008-lsp-client-integration/.process/final-reviewability/reslicing-packet.json`.

PRSG continuation:

- PRSG-007 routing: completed, one navigable PR route with size warning
  evidence in
  `specs/008-lsp-client-integration/.process/reviewability/atomicity-route.json`.
- PRSG-008 layer plan: completed, 6 valid increments in
  `specs/008-lsp-client-integration/.process/reviewability/layer-plan.json`.
- PRSG-009 candidate emission: validated in dry-run mode, 6 layer slices,
  `branches=false`, `pull_requests=false`.
- Candidate artifacts:
  `specs/008-lsp-client-integration/.process/emission/candidates/`.

Remaining blocker: autopilot completion still requires valid slice PR emission
or an operator-owned typed exception. No fake PR fixture or simulated opened PR
was used.

## What Changed

- Added an opt-in LSP precision pass for explicit `--lsp` and config-enabled
  indexing while preserving default structural indexing.
- Added local language-server registry, command probing, environment/project
  overrides, timeout handling, status reporting, and graceful degradation.
- Added LSP correction/suppression behavior with inactive audit rows hidden
  from traversal and retrieval surfaces.
- Added bounded watch-mode LSP verification keyed to changed-file batches and
  capped work items.
- Added real-server validation, parity gates, retrieval probes, and self-repo
  dogfood evidence for SPEC-008.
- Closed post-review gaps by adding JSX/TSX to the LSP-owned TypeScript-family
  path and expanding the retrieval probe to named public surfaces.

## Why It Matters

Users can opt into compiler-accurate definition/reference checks without
changing the default graph path, installing tools automatically, or allowing
language-server failures to break indexing.

## Review Order

1. `src/lsp/` foundation, client, config, prereqs, status, precision pass, and
   correction logic.
2. `src/index.ts` and `src/sync/` integration for index, sync, and watch.
3. `src/db/queries.ts` filtering for inactive LSP audit rows.
4. SPEC-008 validation scripts under `scripts/`.
5. Tests and validation artifacts.

## Scope Budget

SPEC-008 stays inside the three planned review slices:

- Slice 1: activation, config, status, client lifecycle, TypeScript, and
  JavaScript.
- Slice 2: correction/suppression, retrieval safety, Python, Go, Rust, C, C++,
  Swift, and Java.
- Slice 3: remaining server rows, COBOL disposition, bounded watch behavior,
  parity gates, self-repo dogfood, and final validation.

## Traceability

- T001-T018: LSP foundation and registry scaffolding.
- T019-T037: opt-in indexing, JSON-RPC lifecycle, TypeScript-family
  precision, and status.
- T038-T049: project and environment configuration.
- T050-T062: degradation, caps, batching, and status reason codes.
- T063-T076: correction, suppression, ambiguity handling, and retrieval safety.
- T077-T095: real-server rows and bounded watch verification.
- T096-T101: language and capability parity closure.
- T102-T105: self-repo dogfood and representative validation.
- T106-T114: final packet and full validation.

## Representative Validation

- Small: focused fake-server and retrieval fixtures cover correction,
  suppression, ambiguity no-op, inactive audit hiding, and bounded watch
  behavior.
- Medium: self-repo dogfood validates 425 files, 6,233 nodes, 25,189 edges,
  explicit LSP opt-in, initialized local servers, and worktree-local status.
- Large or bounded-cap representative: TypeScript full-index work cap and
  watch oversized-batch tests prove deterministic skip/degrade reasons instead
  of an unbounded repository-wide LSP pass.

## Known Gaps

- COBOL LSP parity is future-owned by SPEC-024.
- Non-LSP capabilities recorded outside SPEC-008's scope are future-owned by
  SPEC-024 where marked in the parity artifacts.
- Self-repo dogfood only covers languages present in this repository; remaining
  language-server rows are validated by the real-server script.

## Feature Flags and Activation

- Default behavior remains LSP disabled.
- `codegraph index --lsp` explicitly enables LSP for that run.
- `codegraph index --no-lsp` explicitly disables LSP for that run.
- `codegraph.json.lsp.enabled` enables project opt-in.
- Environment command and timeout overrides do not activate LSP by themselves.

## Non-Goals

- No language-server auto-install.
- No CodeGraph-as-LSP-server facade.
- No rename/refactor operation.
- No implicit LSP activation from PATH discovery.
- No remote network dependency.

## Rollback

Omit `--lsp`, pass `--no-lsp`, or set `codegraph.json.lsp.enabled` to `false`.
Structural indexing and existing graph queries remain the fallback behavior.
