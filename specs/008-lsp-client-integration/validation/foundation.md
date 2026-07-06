# Foundation Validation

## Scope

Completed tasks: T001-T018.

## Commands

```text
npx vitest run __tests__/lsp-prereqs.test.ts __tests__/lsp-config.test.ts __tests__/lsp-status.test.ts __tests__/lsp-precision-pass.test.ts
```

Result: 4 files passed, 12 tests passed.

```text
npm run typecheck
```

Result: passed.

## Evidence

- LSP module scaffold and exports exist under `src/lsp/`.
- Registry covers all SPEC-008 language rows, with COBOL disposition owned by SPEC-024.
- Config precedence preserves default-off behavior and treats environment overrides as non-activating.
- Prerequisite probing resolves registry alternatives and preserves configured-command no-fallback semantics.
- Status models include stable reason codes, edge counts, performance caps, and disabled-path zero-work evidence.
- Edge provenance typing includes additive `lsp` while preserving existing provenance values.
