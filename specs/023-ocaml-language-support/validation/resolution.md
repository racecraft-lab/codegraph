# SPEC-023 Resolution Evidence

## Command

```bash
npx vitest run __tests__/ocaml-resolution.test.ts
```

## Result

Passed: 1 test file, 5 tests.

## Positive Evidence

- `open Foo` resolves to the unique same-directory `.mli` interface module when
  a `.ml`/`.mli` pair exists.
- `include Common.S` resolves to the unique module type/interface symbol.
- `module Built = Functors.Make(Foo)` resolves both the statically named functor and the
  argument module without functor result elaboration.
- `Foo.run ()` resolves to the implementation body when a paired interface also
  declares the public function.
- `Foo.(run ())` records and resolves the local-open module relationship.
- Checked-in root `dune-project`, root `dune`, root `*.opam`, and `opam/*.opam`
  metadata are discovered for local boundary context even though they are not
  indexed as OCaml source files.

## Negative Evidence

- Duplicate `Util` modules in separate directories produce no guessed
  relationship for `open Util` or `Util.run ()`.
- `Yojson.Safe` package-looking references produce no local edge when no unique
  local candidate exists.
- No package nodes or external package edges are created.
- Implementation-only symbols hidden by a paired `.mli` are not resolved from
  external consumers.
- A unique nested module such as `Functors.Make` is not resolved from bare
  `Make` unless the source uses an explicit visible path.
- Functor body references such as `X.build` do not elaborate result members or
  type-equality relationships.
