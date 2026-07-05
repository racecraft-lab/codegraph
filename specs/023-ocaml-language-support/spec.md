# Feature Specification: SPEC-023 - OCaml Language Support

**Feature Branch**: `023-ocaml-language-support`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Add OCaml to the supported-language matrix through the standard grammar, extractor, resolver, fixture, docs, and status pipeline so agents can ask useful structural questions about OCaml code without falling back immediately to Read/Grep."

## Clarifications

### Session 2026-07-05 - Grammar, Syntax Breadth, and Shipping

- Grammar source: vendor the `tree-sitter-ocaml@0.24.2` npm WASM artifacts from `tree-sitter/tree-sitter-ocaml`, licensed MIT, with npm integrity `sha512-H0RAeCepIyXyTPCQra6yMd7Bn5ZBYkIaddzdLNwVZpM9mCe2e8av+3O6Ojl7Z8YHrV/kYsfHvI2y+Hh7qzcYQQ==` and gitHead `0cc270ff90ca09c29d0f2f9dec69ddfef55a3eff`.
- Required shipped grammar artifacts for the first slice are `tree-sitter-ocaml.wasm` for `.ml` and `tree-sitter-ocaml_interface.wasm` for `.mli`; `tree-sitter-ocaml_type.wasm` is recorded as present in the package but not required unless planning proves a concrete need.
- The current `tree-sitter-wasms@0.1.13` OCaml artifact is not the selected source because it provides only `tree-sitter-ocaml.wasm`, is sourced from older `tree-sitter-ocaml`, and produced an ERROR tree for a valid top-level `.mli` parser probe.
- Implementation must health-check both selected WASMs with CodeGraph's `web-tree-sitter` runtime against representative `.ml` and `.mli` samples before extractor work is accepted.
- Missing OCaml WASM artifacts must fail a targeted build/test assertion: `npm run build` must copy both required artifacts into `dist/extraction/wasm/`.
- First-slice syntax coverage includes classes/objects, labeled and optional arguments, local modules, first-class modules, GADTs, polymorphic variants, attributes, extension nodes, and pattern-heavy definitions. Attributes and extension nodes are parsed/preserved only; they do not imply PPX expansion or speculative edges.
- `.ml` and `.mli` files both report as OCaml. Pairing is same normalized directory plus basename only when unique; ambiguous pairings fail closed.
- Interface declarations emit useful public symbols: arrow/external `val` as `function`, non-arrow `val` as `constant`, abstract or alias `type` as `type_alias`, record types as `struct` with `field`, variant/GADT/polymorphic variant types as `enum` with `enum_member`, `module` as `module`, `module type`/signature/class type as `interface`, class declarations as `class`, and method specifications as `method`. `open` and `include` contribute conservative relationship evidence rather than standalone public symbols.

### Session 2026-07-05 - Resolution, Dune, Packages, and PPX Gate

- First-slice module-path, `open`, and `include` resolution is Dune-scoped and unique-only. Relationships are emitted only when exactly one local candidate survives source, interface-pairing, and workspace metadata constraints.
- Authoritative metadata for the first slice is limited to checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam` files. `_opam`, lock directories, templates, installed switches, and network package state are out of scope.
- Package metadata gates and constrains local relationships only. SPEC-023 does not add `package` nodes and does not emit external package edges.
- Ambiguous module or package candidates fail closed: emit no edge unless exactly one candidate survives. The implementation must not choose by nearest directory, index order, or fuzzy score after ambiguity remains.
- PPX expansion is unsupported/future work for SPEC-023 implementation. Attributes and extension nodes are parse-preserved as syntax, and Dune preprocessing metadata may document why generated code was not expanded, but no PPX-expanded symbols or speculative generated relationships are emitted.

### Session 2026-07-05 - Validation and Eval Bar

- Real-repository smoke and eval proof are pinned to `ocaml-community/yojson` as the small corpus, `ocaml/ocaml-lsp` as the medium corpus, and `ocaml/dune` as the large corpus. `mirage/irmin` is optional PPX/package stress coverage only if budget allows.
- The canonical retrieval matrix is three questions per pinned corpus. Yojson covers the `from_string` parse path, the `to_string`/pretty-print write path, and `.ml`/`.mli` public exposure for Safe/Common/Util. OCaml-LSP covers `textDocument/hover`, `textDocument/completion`, and Dune RPC diagnostics after build. Dune covers `dune build` stanza-to-rule flow, `dune-project`/opam package metadata handling, and rule execution through scheduler/actions.
- The first PR must include fixture coverage, parser health checks, copied-artifact assertions, full build/typecheck/unit verification, OCaml language status evidence, repeated smoke on all three pinned repositories, graph-count stability, and deterministic `probe-explore`/`probe-node` evidence for all nine retrieval questions.
- Headless A/B evidence is mandatory for Yojson and OCaml-LSP in the first PR. Dune A/B and optional Irmin PPX/package stress may split only with an explicit follow-up gate before SPEC-023 is complete.
- Existing-language controls are `npm run build`, `npm run typecheck`, `npm test`, targeted extraction/resolution/status tests, and a CodeGraph self-repo retrieval smoke. Run `scripts/agent-eval/ab-new-vs-baseline.sh` on an existing-language control only if shared MCP, explore-budget, resolver, or retrieval behavior changes.
- Each real-repository smoke record must include repository URL, commit SHA, index command, `filesByLanguage`, node count, edge count, parse errors or warnings, second-run stability, and retrieval probe outcome. Passing smoke requires OCaml language status, no fatal indexing errors, stable graph counts, no speculative edges for unsupported PPX/package cases, and retrieval probes within the size-based explore budget.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Index OCaml repositories (Priority: P1)

As an operator, I can index an OCaml repository and see OCaml handled as a supported language instead of ignored source text.

**Why this priority**: This is the minimum useful slice. Without reliable indexing and status visibility, no downstream search, exploration, or validation is meaningful.

**Independent Test**: Can be tested by indexing a fixture repository containing OCaml source and interface files, then confirming the language appears in status and expected symbols have stable source spans.

**Acceptance Scenarios**:

1. **Given** a repository with OCaml source and interface files, **When** the operator indexes it, **Then** the system recognizes those files as OCaml and reports OCaml in language/status output.
2. **Given** OCaml files that define modules, signatures, functors, types, records, variants, functions, let-bindings, classes, objects, and pattern-heavy definitions, **When** indexing completes, **Then** the system emits stable searchable symbols with useful source spans and containment.

---

### User Story 2 - Explore OCaml structure (Priority: P2)

As an agent, I can search and explore OCaml symbols and get conservative relationships for module paths, local scoping, source/interface pairing, workspace layout, and package metadata where the evidence is deterministic.

**Why this priority**: CodeGraph's value is the agent stopping after graph-backed context. Searchable symbols alone are not enough if common OCaml relationships are absent or misleading.

**Independent Test**: Can be tested by asking structural questions against OCaml fixtures and real OCaml repositories, then verifying the returned context includes the relevant symbols, relationships, and limitations without speculative edges.

**Acceptance Scenarios**:

1. **Given** an OCaml module that references another module through a path, local open, or include, **When** an agent explores the involved symbols, **Then** the system shows only relationships grounded in deterministic source or workspace evidence.
2. **Given** an OCaml source/interface pair, **When** an agent searches for a public symbol, **Then** the system can connect the implementation and interface when the pairing is unambiguous.
3. **Given** package or workspace metadata that clearly identifies local dependencies, **When** resolution runs, **Then** the system uses that metadata to improve relationships without inventing missing package links.

---

### User Story 3 - Review shippable evidence (Priority: P3)

As a maintainer, I can review fixtures, real-repository smoke output, and retrieval proof showing that OCaml support is deterministic, useful, and does not regress existing languages.

**Why this priority**: Language support changes can silently degrade retrieval or create graph explosions. The feature is not complete without evidence that it improves agent behavior safely.

**Independent Test**: Can be tested by reviewing the fixture expectations, repeated index stability, real-repository smoke records, retrieval-evaluation results, and the standard build/test verification evidence.

**Acceptance Scenarios**:

1. **Given** the OCaml fixture suite, **When** the maintainer reviews expected output, **Then** each required construct has explicit symbol and relationship coverage.
2. **Given** the pinned real OCaml repositories, **When** the maintainer reviews smoke output, **Then** each record names the repository URL, commit SHA, index command, language counts, node/edge counts, parse warnings, second-run stability, and retrieval probe outcome.
3. **Given** agreed OCaml retrieval questions, **When** the maintainer reviews evaluation proof, **Then** the evidence shows useful CodeGraph context and records any approved split or blocker instead of weakening the validation bar.

---

### User Story 4 - Bound PPX explicitly (Priority: P4)

As a maintainer, I can see the PPX decision before implementation proceeds so generated or rewritten OCaml syntax is not accidentally treated as solved.

**Why this priority**: PPX is important for OCaml users, but it can require expansion semantics beyond this language-support slice. Making the boundary explicit prevents speculative graph behavior.

**Independent Test**: Can be tested by reviewing the plan or analysis outcome and confirming it records PPX as unsupported, research-only, a separate slice, or a roadmap update before implementation tasks proceed.

**Acceptance Scenarios**:

1. **Given** the feature enters planning, **When** the PPX research gate is reached, **Then** the workflow records the selected PPX outcome before implementation begins.
2. **Given** OCaml code containing PPX attributes or extension nodes that are outside the selected scope, **When** indexing or validation encounters them, **Then** the system fails closed by omitting unsupported precision and documenting the limitation rather than emitting speculative relationships.

### Edge Cases

- Source files without matching interface files still produce useful implementation symbols.
- Interface files without matching source files still produce searchable public declarations.
- Nested modules, functors, local opens, includes, and shadowed names are represented conservatively when ownership is clear.
- Ambiguous module paths, package metadata, or generated PPX constructs do not create speculative edges.
- Pattern-heavy definitions, labeled arguments, optional arguments, and anonymous nested definitions keep source spans attached to the nearest useful owning symbol.
- Workspaces containing multiple local packages do not mix package relationships unless metadata provides a deterministic boundary.
- Unsupported advanced constructs remain visible enough for users to understand the limitation without corrupting graph structure.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST recognize OCaml source and interface files as indexable language inputs.
- **FR-002**: System MUST report OCaml in language/status output when OCaml files are present and indexed.
- **FR-003**: System MUST emit stable searchable symbols for OCaml modules, signatures, functors, type declarations, records, variants, constructors, values, functions, let-bindings, classes, objects, methods, fields, and interface declarations.
- **FR-004**: System MUST preserve useful source spans and containment relationships for extracted OCaml symbols.
- **FR-005**: System MUST handle labeled arguments, optional arguments, and common pattern-heavy definitions without dropping the nearest useful owning symbol.
- **FR-006**: System MUST represent OCaml module paths, opens, and includes conservatively when exactly one local relationship can be determined from source, interface-pairing, and Dune-scoped workspace evidence.
- **FR-007**: System MUST connect OCaml source and interface files when the pair is unambiguous.
- **FR-008**: System MUST use only checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam` package metadata, and only to constrain deterministic local OCaml relationships.
- **FR-009**: System MUST fail closed for ambiguous module, package, or PPX relationships by omitting unsupported precision instead of emitting speculative graph edges, package nodes, or external package edges.
- **FR-010**: System MUST ship OCaml parsing support through vendored `tree-sitter-ocaml@0.24.2` WASM artifacts copied by the existing distribution path, without adding native runtime dependencies.
- **FR-011**: System MUST include fixture coverage for the required OCaml constructs and relationship categories.
- **FR-012**: System MUST include real OCaml repository smoke evidence for `ocaml-community/yojson`, `ocaml/ocaml-lsp`, and `ocaml/dune`, or an approved split plan that names the blocking condition and follow-up validation.
- **FR-013**: System MUST include deterministic retrieval probe evidence for the nine pinned OCaml structural questions, headless A/B evidence for Yojson and OCaml-LSP, and either Dune A/B evidence or an approved follow-up gate that preserves the final validation bar.
- **FR-014**: System MUST document user-visible OCaml limitations, including that PPX expansion is unsupported/future work in SPEC-023.
- **FR-015**: System MUST avoid regressions to existing supported languages, status output, and retrieval budget behavior.
- **FR-016**: System MUST record graph stability evidence showing repeated indexing does not create node or edge explosions.
- **FR-017**: System MUST split implementation work before coding if planning or analysis shows the broadened OCaml scope exceeds reviewability limits.

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter
- **Secondary surfaces, if any**: docs/process; seed/config; language status; validation fixtures; retrieval evaluation
- **Projected reviewable LOC**: 325-650 excluding generated, lock, vendor, and grammar artifacts
- **Projected production files**: 4-6
- **Projected total files**: 10-16
- **Budget result**: warning accepted
- **Split decision**: SPEC-023 remains one specification because the language-support goal is cohesive, but Plan/Analyze must split implementation before coding if the final estimate exceeds reviewability budget. Expected split boundaries are grammar distribution, extraction breadth, conservative resolution, PPX policy, and validation proof.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order,
  scope budget, traceability, verification evidence, known gaps, and rollback
  or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed
  files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities

- **OCaml Source Unit**: A source or interface file that can be indexed and associated with language status.
- **OCaml Symbol**: A searchable code element such as a module, type, value, function, class, object, method, field, constructor, or signature item.
- **OCaml Relationship**: A deterministic local connection between symbols, files, modules, source/interface pairs, workspace metadata, or checked-in package metadata; it is not an external package edge.
- **OCaml Interface Pairing**: A same-directory, same-basename `.ml`/`.mli` relationship that is used only when the pair is unique and unambiguous.
- **Workspace Metadata**: Checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam` files that can improve OCaml relationship resolution when they provide clear deterministic local boundaries.
- **Validation Evidence**: Fixture expectations, real-repository smoke output, graph stability records, deterministic retrieval probe results, headless A/B results, existing-language control checks, and documented split decisions.
- **PPX Policy**: The recorded outcome that PPX expansion is unsupported/future work for SPEC-023; syntax-level attributes and extension nodes may be parsed without expanding generated code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of required OCaml fixture constructs produce expected searchable symbols, source spans, and containment relationships.
- **SC-002**: Yojson, OCaml-LSP, and Dune index successfully, report OCaml in language/status output, and show stable graph counts across repeated indexing, unless a specific repository split is approved with a follow-up gate.
- **SC-003**: The nine pinned OCaml structural questions return useful graph-backed context within the current repository-size retrieval budget, with Yojson and OCaml-LSP headless A/B evidence in the first PR and any Dune A/B split explicitly gated before SPEC-023 is complete.
- **SC-004**: Validation identifies zero speculative relationships for ambiguous package, module, or PPX cases.
- **SC-005**: Existing supported-language behavior remains green under the standard build, typecheck, and unit-test verification commands, and build verification proves both required OCaml WASM artifacts are copied into `dist/extraction/wasm/`.
- **SC-006**: The PR review packet maps every functional requirement and success criterion to concrete evidence or named deferred work.

## Assumptions

- The existing `023-ocaml-language-support` branch and `specs/023-ocaml-language-support/` directory are the intended SPEC-023 location.
- Grammar provenance is pinned to `tree-sitter-ocaml@0.24.2`; parser health and copied-artifact checks must still be run during implementation.
- PPX expansion is out of implementation scope until Plan/Analyze records a different approved outcome.
- Dune/opam metadata is used only from checked-in project files and never from installed switch state.
- OCaml LSP precision belongs to a later capability path and is not required for this specification.
- The fixture inventory may be refined during planning, but real-repository validation is pinned to Yojson, OCaml-LSP, and Dune with the nine-question retrieval matrix above.
- Existing CodeGraph language-support conventions remain the default for symbol naming, status display, fixture shape, and validation evidence.
