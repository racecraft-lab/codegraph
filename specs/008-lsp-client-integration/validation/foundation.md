# Foundation Validation

## Scope

Completed tasks: T001-T018.

## Commands

```text
npx vitest run __tests__/lsp-prereqs.test.ts __tests__/lsp-config.test.ts __tests__/lsp-status.test.ts __tests__/lsp-precision-pass.test.ts
```

Result: 4 files passed, 15 tests passed.

```text
npm run typecheck
```

Result: passed.

## Evidence

- LSP module scaffold and exports exist under `src/lsp/`.
- Registry covers all SPEC-008 language rows, with COBOL disposition owned by SPEC-024.
- Config precedence preserves default-off behavior, treats environment overrides as non-activating, ignores committed command overrides with a warning, and preserves timeout source attribution.
- Prerequisite probing resolves registry alternatives, preserves environment-configured command no-fallback semantics, and handles commands that already include a PATHEXT extension.
- Status models include stable reason codes, coverage records, edge counts, minimum-runtime evidence, performance caps, and disabled-path zero-work evidence.
- Edge provenance typing includes additive `lsp` while preserving existing provenance values.
