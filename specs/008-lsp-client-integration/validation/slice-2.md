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
