# SPEC-023 Safety and License

## Grammar Assets

- Source package: `tree-sitter-ocaml@0.24.2`
- Repository: `tree-sitter/tree-sitter-ocaml`
- License: MIT
- npm integrity:
  `sha512-H0RAeCepIyXyTPCQra6yMd7Bn5ZBYkIaddzdLNwVZpM9mCe2e8av+3O6Ojl7Z8YHrV/kYsfHvI2y+Hh7qzcYQQ==`
- gitHead: `0cc270ff90ca09c29d0f2f9dec69ddfef55a3eff`

## Runtime Constraints

- No native runtime dependency was added.
- No runtime network access was added.
- OCaml package metadata is read only from checked-in `dune-project`, `dune`,
  root `*.opam`, and `opam/*.opam` files.
- `_opam`, lock directories, templates, installed switch state, and network
  package state are ignored.
- No `package` node kind or external package edge is introduced.
