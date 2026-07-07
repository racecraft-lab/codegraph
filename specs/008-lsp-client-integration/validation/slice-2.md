# Slice 2 Validation

## Scope

Completed tasks: T050-T062.

Slice 2 proves normal runtime LSP degradation, bounded server recovery,
status reason categories, per-language coverage counters, full-index caps,
batch/request high-water reporting, and deterministic no-unbounded fallback
behavior.

## Commands

```text
npm test -- __tests__/lsp-prereqs.test.ts __tests__/lsp-client.test.ts __tests__/lsp-status.test.ts __tests__/lsp-precision-pass.test.ts
```

RED result: 4 files ran, 29 tests ran, 6 tests failed before implementation.
Failures covered missing status helpers, missing degradation fixture README,
missing one-restart behavior, and missing bounded cap/batch orchestration.

GREEN/REFACTOR result: 4 files passed, 37 tests passed.

```text
npm run typecheck
```

Result: passed.

```text
npm run build
```

Result: passed.

## Evidence

- Missing default and configured-unavailable servers are reported with stable
  reason codes, selected argv, expected alternatives, and per-language
  degradation instead of whole-index failure.
- Crash, initialize timeout, request timeout, malformed protocol response, and
  shutdown failure map to bounded degradation reasons.
- Shutdown failure is recorded in server state and degradation counters without
  failing the enclosing precision pass.
- The precision pass attempts at most one fresh server session restart per
  language per explicit run before marking remaining candidate work degraded.
- Another language can still initialize and verify candidates when a different
  language server is unavailable.
- Status counters now cover checked, verified, corrected, suppressed,
  skipped-by-reason, and degraded totals through shared accounting helpers.
- Full-index LSP work records structural elapsed time, LSP elapsed time,
  enabled overhead ratio, effective caps, active-session high-water mark, and
  in-flight request high-water mark.
- Full-index source-file and work-item caps skip excess work with
  `full-index-file-cap-exceeded` and `full-index-work-cap-exceeded`.
- Full-index work is processed in bounded batches; the slice test uses a
  reduced batch size to prove no later batch starts before the current batch is
  released.
- Watch scope policy helper tests reject absent, unbounded, oversized
  changed-file sets and oversized per-language work without falling back to a
  repository-wide LSP pass; runtime watch integration remains deferred to
  T091-T093.
- The degradation fixture README documents local-only missing-server, crash,
  timeout, malformed-response, shutdown-failure, cap, and no-fallback scenarios.

## Non-Goals Preserved

- LSP remains default-off.
- CodeGraph does not install language servers.
- The precision pass does not create speculative graph edges.
- Status reads continue to use persisted status or config context; they do not
  start language-server subprocesses.

## Real-Server Validation (T077-T083)

```text
node scripts/spec-008-validate-real-servers.mjs --slice us2
```

Result: passed on `darwin/arm64`.

| Language | Server command | Probe command | Resolved executable | Version/status evidence |
|---|---|---|---|---|
| Python | `pyright-langserver --stdio` | `pyright --version` | `/opt/homebrew/bin/pyright-langserver` | exit 0; `pyright 1.1.411` |
| Go | `gopls` | `gopls version` | `/opt/homebrew/bin/gopls` | exit 0; `golang.org/x/tools/gopls v0.22.0` |
| Rust | `rust-analyzer` | `rust-analyzer --version` | `/opt/homebrew/bin/rust-analyzer` | exit 0; `rust-analyzer 0.0.0 (972c4e7bee 2026-06-28)` |
| C | `clangd` | `clangd --version` | `/Users/fredrickgabelmann/.swiftly/bin/clangd` | exit 0; `Apple clangd version 21.0.0 ([redacted-url] b6f042d4515f83404d3f44012144b5e67b2c5791)` |
| C++ | `clangd` | `clangd --version` | `/Users/fredrickgabelmann/.swiftly/bin/clangd` | exit 0; `Apple clangd version 21.0.0 ([redacted-url] b6f042d4515f83404d3f44012144b5e67b2c5791)` |
| Swift | `sourcekit-lsp` | `sourcekit-lsp --help` | `/Users/fredrickgabelmann/.swiftly/bin/sourcekit-lsp` | exit 0; help banner observed |
| Java | `jdtls -configuration <validation-config-dir> -data <validation-workspace-dir>` | `jdtls --help` | `/opt/homebrew/bin/jdtls` | exit 0; help banner observed |

Coverage summary: 7 verified, 0 missing, 0 future-owned, 0 unowned.

Validation remains prerequisite-only: the helper records command availability,
resolved executable paths, selected probe output, and stdio initialize smoke
evidence where a server has no reliable version flag. Normal `codegraph index
--lsp` degradation remains per-language runtime behavior if a resolved server
later fails initialize, request, or shutdown.

## US4 Correction/Retrieval Evidence (T063-T076)

```text
npm test -- __tests__/lsp-precision-pass.test.ts __tests__/lsp-retrieval-regression.test.ts
```

RED result: 2 files ran, 12 tests ran, 4 tests failed before implementation.
Failures covered Location/LocationLink selection-range dedupe, corrected edge
retargeting, external/generated/unindexed suppression, and inactive audit-row
retrieval leakage.

GREEN result: 2 files passed, 12 tests passed.

```text
npm run typecheck
```

Result: passed.

```text
npm run build
```

Result: passed.

```text
node scripts/spec-008-retrieval-probes.mjs
```

Result: passed. Node/edge delta evidence: nodes +3, raw edges +2, active
outgoing edges 1, inactive audit rows hidden 1.

Evidence summary:
- Location and LocationLink results normalize to project paths, prefer
  `targetSelectionRange`, and dedupe equivalent targets.
- Unique compatible LSP corrections retarget or replace the structural edge
  while keeping exactly one active retrieval edge.
- External, generated, and unindexed targets are suppressed through audit
  metadata without creating graph nodes.
- Ambiguous LSP results leave the original edge active and create no
  speculative replacement edge.
- Retrieval APIs and graph traversal exclude inactive LSP suppression rows
  while preserving active heuristic-only edges.
