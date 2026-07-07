# SPEC-008 Full Verification Evidence

Date: 2026-07-06

Scope: SPEC-008 LSP client integration, including TypeScript-family JSX/TSX parity remediation.

Full gate command:

```bash
source ~/.nvm/nvm.sh && nvm use >/dev/null && npm run build && npm run typecheck && env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm test
```

Result:

- Build: passed.
- Typecheck: passed.
- Full test suite: passed, 141 test files, 2,280 tests passed, 4 skipped, 25.05s.
- Real server validation: passed, 17 verified server rows, 1 future-owned COBOL row, 0 missing, 0 unowned.
- Parity gate: passed, 18 language rows, 17 capability rows, 0 unowned.
- Retrieval probe: passed with public search, callers, callees, impact, explore-equivalent, and context surfaces clean.
- Manual CLI UAT: passed with isolated fixture `/var/folders/jp/nt5kjq_11m3fvxg9ftwjjqsw0000gn/T/spec008-manual-uat-xkntzk`; evidence recorded in `specs/008-lsp-client-integration/.process/uat-evidence.md`.
- Diff hygiene: `git diff --check` passed.
- Restricted-name scan: passed.
- Outbound-link scan across SPEC-008 artifacts and scripts: passed.
