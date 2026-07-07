# SPEC-008 UAT Evidence

Recorded: 2026-07-06

## Automated UAT

Command:

```bash
source ~/.nvm/nvm.sh && nvm use >/dev/null && npm run build && npm run typecheck && env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm test && node scripts/spec-008-validate-real-servers.mjs && node scripts/spec-008-parity-gate.mjs && node scripts/spec-008-retrieval-probes.mjs
```

Result: passed.

Evidence summary:

- Build and typecheck passed.
- Full test suite passed: 141 test files, 2,280 tests passed, 4 skipped.
- Real-server validation passed: 17 verified rows, 1 future-owned row, 0 missing rows, 0 unowned rows.
- Parity gate passed: 18 language rows, 17 capability rows, 0 unowned rows.
- Retrieval probe passed: active LSP correction edge visible where expected, inactive audit rows hidden from public graph lookup surfaces.

## Manual CLI UAT

Runner:

```bash
source ~/.nvm/nvm.sh && nvm use >/dev/null && node /private/tmp/spec008-manual-uat.mjs
```

Result: passed.

Fixture:

```text
/var/folders/jp/nt5kjq_11m3fvxg9ftwjjqsw0000gn/T/spec008-manual-uat-xkntzk
```

Checks executed:

- Initialized an isolated TypeScript and TSX project.
- Confirmed default indexing keeps LSP precision disabled.
- Confirmed explicit `--lsp` enables LSP precision for one run.
- Confirmed project config opt-in enables LSP without a CLI enable flag.
- Confirmed environment command and timeout overrides apply to one run without editing `codegraph.json`.
- Confirmed `--no-lsp` on a full reindex leaves no persisted LSP run timestamp, no LSP server rows, no LSP coverage rows, and zero LSP edge counters.
- Confirmed environment overrides alone do not activate LSP.
- Confirmed a configured missing server degrades visibly without failing structural indexing.
- Re-ran focused TypeScript-family real-server validation, parity gate, and retrieval probe.

## Runbook Validation

Runbook:

```text
specs/008-lsp-client-integration/.process/uat-runbook.md
```

The disabled-path UAT step was corrected after manual testing showed the original compare-before-after expectation was too strict for `codegraph index`, which performs a full structural reindex and recreates the database. The corrected UAT expectation checks the implemented contract: no new LSP run metadata or LSP result rows are present after a disabled full reindex.
