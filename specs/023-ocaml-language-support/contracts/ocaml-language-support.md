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

| OCaml construct | Required CodeGraph kind | Span and ownership rule |
|-----------------|-------------------------|-------------------------|
| Named modules, including nested modules | `module` | Span the full module declaration, including body or signature when syntactically present. |
| Named functors | `module` | Span the full functor declaration, including module parameters and body or result signature. |
| Signatures, module types, and class types | `interface` | Span the public specification item. |
| Functions, named function-like `let`/`let rec` bindings, external declarations, and arrow/external `val` declarations | `function` | Span the full binding or declaration body when syntactically available. |
| Stable non-function `let` value bindings and non-arrow `val` declarations | `constant` | Span the binding or public declaration. |
| Pattern-only `let` bindings | `constant` or `variable` only for stable identifier leaves; otherwise no standalone node | Do not synthesize a name from the whole pattern; attach unnamed or unstable structure to the nearest useful owner. |
| Abstract or alias types | `type_alias` | Span the type declaration or specification. |
| Records | `struct` with `field` children | Span the record type declaration; fields span their source field declarations. |
| Variants, GADTs, and polymorphic variants | `enum` with `enum_member` children | Span the variant type declaration; constructors/tags span their source declarations. |
| Named classes | `class` | Span the full class declaration. |
| Class methods | `method` | Span the full method declaration body when syntactically available. |
| Visible class/object fields | `field` | Span the source field declaration. |
| Labeled and optional parameters | `parameter` when a stable source name exists | Span the parameter pattern or name, including `~label`, `?label`, and `~label:local` forms. |
| Anonymous object, module, functor, and pattern-only forms | No synthetic standalone owner | Attach covered child symbols to the nearest useful owner or file. |
| Attributes and extension nodes | No PPX-expanded symbol kind | Preserve source-level visibility only; do not synthesize generated symbols or relationships. |

## Relationship Output

- Containment relationships are emitted for symbol ownership.
- Module paths, functor references/applications, `open`, and `include` relationships are emitted only when exactly one local target survives source, interface-pairing, and workspace metadata constraints.
- Functor relationships may point to statically named functor modules, argument modules, and result-module aliases when unique; they must not synthesize generated result members, type equalities, or elaborated functor semantics.
- `.ml`/`.mli` relationships are emitted only for unique same-directory, same-basename pairs.
- Checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam` files may constrain local relationships.
- Metadata must not create package nodes or external package edges.

## Fail-Closed Behavior

The graph must omit unsupported precision rather than guess when:

- More than one local module or functor candidate remains.
- A source/interface pair is ambiguous.
- Package metadata cannot deterministically constrain a local relationship.
- A relationship would require installed switch state, network package metadata, `_opam`, lock directories, or templates.
- A relationship would require PPX expansion or generated-code inference.
- A relationship would require functor result elaboration or type-equality inference.

The implementation must not choose by nearest directory, index order, or fuzzy score after ambiguity remains.

## Validation Evidence Contract

Any PR/slice that claims complete OCaml support must satisfy this evidence contract. Earlier split slices may omit mandatory eval evidence only when they explicitly do not claim complete support and preserve this completion gate. Before SPEC-023 is complete, evidence must include:

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
