# SPEC-023 Resolution Evidence

## Command

```bash
npx vitest run __tests__/ocaml-resolution.test.ts
```

## Result

Passed: 1 test file, 2 tests.

## Positive Evidence

- `open Foo` resolves to the unique same-directory `.mli` interface module when
  a `.ml`/`.mli` pair exists.
- `include Common.S` resolves to the unique module type/interface symbol.
- `module Built = Make(Foo)` resolves both the statically named functor and the
  argument module without functor result elaboration.
- `Foo.run ()` resolves to the implementation body when a paired interface also
  declares the public function.
- Checked-in Dune/opam metadata is discovered for local boundary context.

## Negative Evidence

- Duplicate `Util` modules in separate directories produce no guessed
  relationship for `open Util` or `Util.run ()`.
- `Yojson.Safe` package-looking references produce no local edge when no unique
  local candidate exists.
- No package nodes or external package edges are created.
