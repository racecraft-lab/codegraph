# tree-sitter-ocaml Grammar Provenance

SPEC-023 vendors the OCaml grammars from `tree-sitter-ocaml@0.24.2`.

## Source

- Package: `tree-sitter-ocaml@0.24.2`
- Repository: `tree-sitter/tree-sitter-ocaml`
- License: MIT
- npm integrity: `sha512-H0RAeCepIyXyTPCQra6yMd7Bn5ZBYkIaddzdLNwVZpM9mCe2e8av+3O6Ojl7Z8YHrV/kYsfHvI2y+Hh7qzcYQQ==`
- gitHead: `0cc270ff90ca09c29d0f2f9dec69ddfef55a3eff`

## Vendored Artifacts

The feature requires two WASM artifacts:

- `src/extraction/wasm/tree-sitter-ocaml.wasm`
- `src/extraction/wasm/tree-sitter-ocaml_interface.wasm`

Both `.ml` and `.mli` files report as the public CodeGraph language `ocaml`.
The parser path selects the implementation grammar for `.ml` files and the
interface grammar for `.mli` files. CodeGraph does not expose a second public
`ocaml_interface` language.

The package also includes `tree-sitter-ocaml_type.wasm`; SPEC-023 does not
vendor or load it because the planned source/interface slice does not require a
separate type-fragment parser.

## Verification

Run:

```bash
npm run build
npx vitest run __tests__/ocaml-parser-health.test.ts __tests__/ocaml-status.test.ts __tests__/ocaml-extraction.test.ts __tests__/ocaml-resolution.test.ts __tests__/ocaml-ppx-policy.test.ts
```

Expected results:

- both OCaml WASMs are copied into `dist/extraction/wasm/`;
- both WASMs load through `web-tree-sitter`;
- representative `.ml` and `.mli` samples parse without parser errors;
- status and extraction keep the public language as `ocaml`;
- conservative local resolution passes unique-only positive and negative cases;
- PPX syntax does not produce generated symbols or speculative relationships.
