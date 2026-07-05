# Contract: OCaml Language Support

## Scope

This contract documents public observable behavior for SPEC-023 through existing CodeGraph surfaces: CLI indexing/status, MCP/library graph queries, shipped grammar artifacts, and validation evidence. It does not add a new command, endpoint, database schema, or public package API.

## File Recognition and Status

- `.ml` files are recognized as OCaml implementation source units.
- `.mli` files are recognized as OCaml interface source units.
- When OCaml files are indexed, language/status output reports OCaml.
- `npm run build` copies both required artifacts into `dist/extraction/wasm/`:
  - `tree-sitter-ocaml.wasm`
  - `tree-sitter-ocaml_interface.wasm`

## Symbol Output

OCaml extraction must emit existing CodeGraph node kinds only.

| OCaml construct | Expected node behavior |
|-----------------|------------------------|
| Modules and functors | Searchable module/function-like ownership as appropriate, with containment. |
| Signatures and module types | `interface`-style public symbols. |
| Functions and arrow/external `val` declarations | `function`. |
| Non-arrow `val` declarations | `constant`. |
| Let-bindings | Useful `function`, `variable`, or `constant` nodes based on syntax. |
| Abstract or alias types | `type_alias`. |
| Records | `struct` with `field` children. |
| Variants, GADTs, polymorphic variants | `enum` with `enum_member` children. |
| Classes and objects | `class`, `method`, `field`, and contained symbols where statically visible. |
| Labeled/optional parameters | Useful parameter/name evidence without changing public node-kind vocabulary. |
| Attributes and extension nodes | Parse-preserved syntax only; no PPX-expanded symbols. |

## Relationship Output

- Containment relationships are emitted for symbol ownership.
- Module paths, `open`, and `include` relationships are emitted only when exactly one local target survives source, interface-pairing, and workspace metadata constraints.
- `.ml`/`.mli` relationships are emitted only for unique same-directory, same-basename pairs.
- Checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam` files may constrain local relationships.
- Metadata must not create package nodes or external package edges.

## Fail-Closed Behavior

The graph must omit unsupported precision rather than guess when:

- More than one local module candidate remains.
- A source/interface pair is ambiguous.
- Package metadata cannot deterministically constrain a local relationship.
- A relationship would require installed switch state, network package metadata, `_opam`, lock directories, or templates.
- A relationship would require PPX expansion or generated-code inference.

The implementation must not choose by nearest directory, index order, or fuzzy score after ambiguity remains.

## Validation Evidence Contract

Before SPEC-023 is complete, evidence must include:

- Fixture coverage for required syntax and negative ambiguity cases.
- Parser health checks for `.ml` and `.mli`.
- Copied-artifact assertions for both OCaml WASMs.
- Repeated smoke on `ocaml-community/yojson`, `ocaml/ocaml-lsp`, and `ocaml/dune`.
- For each smoke record: repository URL, commit SHA, index command, `filesByLanguage`, node count, edge count, parse warnings/errors, second-run stability, and retrieval probe outcome.
- Deterministic `probe-explore` and `probe-node` results for all nine pinned retrieval questions.
- Headless A/B evidence for Yojson and OCaml-LSP.
- Dune A/B evidence or an explicit follow-up gate before SPEC-023 is complete.
- Existing-language controls: `npm run build`, `npm run typecheck`, `npm test`, targeted extraction/resolution/status tests, and CodeGraph self-repo retrieval smoke.

## Non-Contract

SPEC-023 does not guarantee:

- OCaml LSP precision.
- PPX expansion.
- Typechecker-grade module elaboration or inference.
- External package graph modeling.
- Package nodes.
- External package edges.
