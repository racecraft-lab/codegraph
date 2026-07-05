# SPEC-023 Retrieval Probe Matrix

## Yojson

1. How does `from_string` parse JSON text into a Yojson value?
2. How does `to_string` or pretty-printing serialize a Yojson value?
3. How are Safe/Common/Util declarations exposed across `.ml` and `.mli` files?

## OCaml-LSP

1. How does `textDocument/hover` reach the code that computes hover output?
2. How does `textDocument/completion` reach completion construction?
3. How do Dune RPC diagnostics reach the LSP diagnostic publication path?

## Dune

1. How does a `dune build` stanza become a build rule?
2. How are `dune-project` and opam package metadata read and applied?
3. How does rule execution flow through scheduler/action execution?

## Required Evidence Per Probe

- Repository URL and commit SHA.
- `probe-explore` command and result summary.
- `probe-node` command and result summary.
- Whether the result stayed within the repo-size explore budget.
- Known gap or follow-up gate if not passing.
