# SPEC-023 PPX Boundary Evidence

## Command

```bash
npx vitest run __tests__/ocaml-ppx-policy.test.ts
```

## Result

Passed: 1 test file, 1 test.

## Evidence

- Attribute syntax on a source-level binding parses without blocking extraction.
- Extension-node syntax parses without creating generated symbols.
- No PPX-generated unresolved references or graph edges are emitted.
- PPX expansion remains unsupported/future work as recorded in
  `../ppx-policy.md`.
