# SPEC-023 Existing-Language Controls

## Commands Run

```bash
npm run typecheck
npm run build
npx vitest run __tests__/ocaml-parser-health.test.ts __tests__/ocaml-status.test.ts __tests__/ocaml-extraction.test.ts __tests__/ocaml-resolution.test.ts __tests__/ocaml-ppx-policy.test.ts
npm test
npx vitest run __tests__/mcp-daemon.test.ts -t "daemon idle-times-out after the last client disconnects"
```

## Current Result

- `npm run typecheck`: passed.
- `npm run build`: passed.
- OCaml targeted suite: passed, 5 test files, 11 tests.
- `npm test`: 136 test files passed, 1 test file failed; 2233 tests passed,
  4 skipped, 1 failure in `__tests__/mcp-daemon.test.ts` idle-timeout case.
  Diagnostics showed the daemon/proxy hitting the unsupported Node 26 guard.
- Targeted rerun of the failed daemon idle-timeout test: passed, 1 test passed,
  8 skipped.

## Pending

- Existing-language A/B is applicable because shared grammar, parser,
  import-resolution, and resolver orchestration paths changed. The control is
  blocked until the local `claude` runner prerequisite and clean baseline
  comparison setup are available; see `existing-language-ab-gate.md`.
