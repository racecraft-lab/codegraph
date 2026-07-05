# SPEC-023 Existing-Language Controls

## Commands Run

```bash
npm run typecheck
npm run build
npx vitest run __tests__/ocaml-parser-health.test.ts __tests__/ocaml-status.test.ts __tests__/ocaml-extraction.test.ts __tests__/ocaml-resolution.test.ts __tests__/ocaml-ppx-policy.test.ts
npm test
```

## Current Result

- `npm run typecheck`: passed.
- `npm run build`: passed.
- OCaml targeted suite: passed, 5 test files, 14 tests.
- `npm test`: passed, 137 test files, 2237 tests passed, 4 skipped.

## Existing-Language A/B Control

- Existing-language A/B is applicable because shared grammar, parser,
  import-resolution, and resolver orchestration paths changed.
- External Claude A/B was rejected by the sandbox reviewer because it would send
  private repository contents to an external service.
- Local-only current-vs-baseline deterministic control passed; see
  `existing-language-ab-gate.md`.
