# Research: SPEC-023 - OCaml Language Support

## Decision: Vendor `tree-sitter-ocaml@0.24.2` implementation and interface WASMs

**Rationale**: Clarify pinned `tree-sitter-ocaml@0.24.2` from `tree-sitter/tree-sitter-ocaml`, licensed MIT, with npm integrity `sha512-H0RAeCepIyXyTPCQra6yMd7Bn5ZBYkIaddzdLNwVZpM9mCe2e8av+3O6Ojl7Z8YHrV/kYsfHvI2y+Hh7qzcYQQ==` and gitHead `0cc270ff90ca09c29d0f2f9dec69ddfef55a3eff`. SPEC-023 requires both `tree-sitter-ocaml.wasm` for `.ml` and `tree-sitter-ocaml_interface.wasm` for `.mli`.

**Alternatives considered**: `tree-sitter-wasms@0.1.13` was rejected because it ships only an older OCaml implementation artifact and produced an ERROR tree for a valid `.mli` parser probe. `tree-sitter-ocaml_type.wasm` is recorded as present in the package but is not required unless a concrete implementation need appears.

## Decision: Health-check parser artifacts before extractor acceptance

**Rationale**: Both selected WASMs must load through CodeGraph's `web-tree-sitter` runtime and parse representative `.ml` and `.mli` samples before extractor work is accepted. `npm run build` must copy both required artifacts into `dist/extraction/wasm/`.

**Alternatives considered**: Relying on copied files alone was rejected because a shipped artifact can exist while still failing parser initialization or interface parsing.

## Decision: First-slice syntax is broad but static

**Rationale**: Required extraction includes modules, signatures, functors, type declarations, records, variants, constructors, values, functions, let-bindings, classes, objects, methods, fields, labeled and optional arguments, local modules, first-class modules, GADTs, polymorphic variants, attributes, extension nodes, pattern-heavy definitions, and `.mli` declarations. This breadth is necessary for useful OCaml retrieval and matches the clarified requirements.

**Alternatives considered**: A minimal functions/modules extractor was rejected because it would not satisfy the accepted user stories or the nine-question retrieval matrix.

## Decision: `.ml` and `.mli` pairing is same-directory, same-basename, unique-only

**Rationale**: Source/interface relationships are deterministic only when the normalized directory and basename match uniquely. Ambiguous pairings fail closed.

**Alternatives considered**: Nearest-path, workspace-order, index-order, or fuzzy matching was rejected because it could create speculative relationships.

## Decision: Interface declarations emit public symbol kinds

**Rationale**: `.mli` files must produce useful searchable public symbols. Arrow or external `val` declarations map to `function`; non-arrow `val` maps to `constant`; abstract or alias `type` maps to `type_alias`; record types map to `struct` plus `field`; variant, GADT, and polymorphic variant types map to `enum` plus `enum_member`; `module` maps to `module`; `module type`, signature, and class type map to `interface`; class declarations map to `class`; method specifications map to `method`.

**Alternatives considered**: Treating `.mli` files as comments or file-only metadata was rejected because public interface exposure is one of the pinned retrieval questions.

## Decision: Resolution is Dune-scoped, unique-only, and local

**Rationale**: Module paths, functor references/applications, `open`, and `include` relationships are emitted only when exactly one local candidate survives source evidence, interface-pairing evidence, and checked-in workspace metadata constraints. Functor relationships are limited to statically named functor modules, argument modules, and result-module aliases; generated result members, type equalities, and elaborated functor semantics are not inferred. The resolver must not choose by nearest directory, index order, or fuzzy score after ambiguity remains.

**Alternatives considered**: Full OCaml module and functor-result elaboration was rejected as typechecker-grade semantics. Unconstrained name matching was rejected because it risks wrong edges in multi-package workspaces.

## Decision: Package metadata constrains local relationships only

**Rationale**: Authoritative metadata is limited to checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam` files. Metadata can restrict or confirm local relationships but must not create `package` nodes or external package edges.

**Alternatives considered**: Reading `_opam`, lock directories, templates, installed switches, network package state, or external package registries was rejected because those sources are non-local, unstable, or outside the deterministic first slice.

## Decision: PPX expansion is unsupported/future work in SPEC-023

**Rationale**: Attributes and extension nodes are parsed and preserved only as syntax. Dune preprocessing metadata may document why generated code was not expanded, but SPEC-023 must not emit PPX-expanded symbols or speculative generated relationships.

**Alternatives considered**: Implementing PPX expansion in the first pass was rejected because it conflicts with the roadmap out-of-scope line and requires semantics beyond deterministic static extraction. A future spec or split can revisit it explicitly.

## Decision: Validation corpus is Yojson, OCaml-LSP, and Dune

**Rationale**: The clarified validation bar pins `ocaml-community/yojson` as the small corpus, `ocaml/ocaml-lsp` as the medium corpus, and `ocaml/dune` as the large corpus. Each smoke record must include repository URL, commit SHA, index command, `filesByLanguage`, node count, edge count, parse warnings/errors, second-run stability, and retrieval probe outcome.

**Alternatives considered**: A fixture-only validation path was rejected because language support can pass synthetic tests while still failing real retrieval. `mirage/irmin` remains optional PPX/package stress coverage only if review budget allows.

## Decision: Nine retrieval questions are mandatory deterministic probes

**Rationale**: Yojson covers the `from_string` parse path, `to_string`/pretty-print write path, and `.ml`/`.mli` public exposure for Safe/Common/Util. OCaml-LSP covers `textDocument/hover`, `textDocument/completion`, and Dune RPC diagnostics after build. Dune covers `dune build` stanza-to-rule flow, `dune-project`/opam package metadata handling, and rule execution through scheduler/actions. `probe-explore` and `probe-node` evidence is required for all nine.

**Alternatives considered**: Ad hoc retrieval prompts were rejected because they would be hard to compare across slices and could weaken the validation bar.

## Decision: Yojson and OCaml-LSP headless A/B evidence is first-completion mandatory

**Rationale**: The first PR/slice that claims complete OCaml support must include headless A/B evidence for Yojson and OCaml-LSP. Earlier split slices may omit that evidence only when they do not claim complete support and preserve the completion gate. Dune A/B and optional Irmin stress may split only with an explicit follow-up gate before SPEC-023 is complete.

**Alternatives considered**: Deferring all A/B evidence was rejected because retrieval performance is a constitutional regression surface.

## Decision: Existing-language controls are required

**Rationale**: `npm run build`, `npm run typecheck`, `npm test`, targeted extraction/resolution/status tests, and a CodeGraph self-repo retrieval smoke are required controls. Run `scripts/agent-eval/ab-new-vs-baseline.sh` on an existing-language control only if shared MCP, explore-budget, resolver, or retrieval behavior changes.

**Alternatives considered**: OCaml-only tests were rejected because shared grammar/status/resolver changes can regress other languages.

## Decision: Implementation must split if the estimate exceeds reviewability limits

**Rationale**: The clarified scope can exceed the one-PR reviewability block threshold if delivered as a single diff. Split boundaries are grammar/status/basic health, broad syntax extraction, Dune-scoped resolution, and validation/eval/docs.

**Alternatives considered**: Keeping one large PR was rejected because it weakens review quality. Weakening the final syntax, resolution, or eval bar was rejected because those decisions were clarified already.
