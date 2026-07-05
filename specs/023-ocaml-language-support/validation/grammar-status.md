# SPEC-023 Grammar and Status Evidence

## Commands

```bash
npm run build
npx vitest run __tests__/ocaml-parser-health.test.ts __tests__/ocaml-status.test.ts
```

## Result

- `npm run build`: passed.
- Build copied `tree-sitter-ocaml.wasm` and
  `tree-sitter-ocaml_interface.wasm` into `dist/extraction/wasm/`.
- Parser health tests passed for representative `.ml` and `.mli` fixtures.
- Status test passed: `.ml` and `.mli` are counted under public language
  `ocaml`; no public `ocaml_interface` language is reported.
