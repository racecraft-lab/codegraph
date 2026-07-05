# Feature Specification: SPEC-023 - OCaml Language Support

**Feature Branch**: `023-ocaml-language-support`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Add OCaml to the supported-language matrix through the standard grammar, extractor, resolver, fixture, docs, and status pipeline so agents can ask useful structural questions about OCaml code without falling back immediately to Read/Grep."

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
2. **Given** at least one real OCaml repository, **When** the maintainer reviews smoke output, **Then** indexing completes without fatal errors, language status is visible, and graph counts remain stable across repeated runs.
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
- **FR-003**: System MUST emit stable searchable symbols for OCaml modules, signatures, functors, type declarations, records, variants, constructors, values, functions, let-bindings, classes, objects, methods, and fields.
- **FR-004**: System MUST preserve useful source spans and containment relationships for extracted OCaml symbols.
- **FR-005**: System MUST handle labeled arguments, optional arguments, and common pattern-heavy definitions without dropping the nearest useful owning symbol.
- **FR-006**: System MUST represent OCaml module paths, opens, and includes conservatively when the relationship can be determined from source evidence.
- **FR-007**: System MUST connect OCaml source and interface files when the pair is unambiguous.
- **FR-008**: System MUST use workspace and package metadata only when it is available, deterministic, and directly relevant to local OCaml relationships.
- **FR-009**: System MUST fail closed for ambiguous module, package, or PPX relationships by omitting unsupported precision instead of emitting speculative graph edges.
- **FR-010**: System MUST ship OCaml parsing support through the existing distribution path without adding native runtime dependencies.
- **FR-011**: System MUST include fixture coverage for the required OCaml constructs and relationship categories.
- **FR-012**: System MUST include real OCaml repository smoke evidence or an approved split plan that names the blocking condition and follow-up validation.
- **FR-013**: System MUST include retrieval-evaluation evidence for agreed OCaml structural questions or an approved split plan that preserves the final validation bar.
- **FR-014**: System MUST document user-visible OCaml limitations, including the selected PPX handling outcome.
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
- **OCaml Relationship**: A deterministic connection between symbols, files, modules, source/interface pairs, workspace metadata, or package metadata.
- **Workspace Metadata**: Local project information that can improve OCaml relationship resolution when it provides clear deterministic boundaries.
- **Validation Evidence**: Fixture expectations, real-repository smoke output, graph stability records, retrieval-evaluation results, and documented split decisions.
- **PPX Policy**: The recorded outcome that defines whether PPX is unsupported, research-only, split into separate work, or moved into scope by a roadmap update.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of required OCaml fixture constructs produce expected searchable symbols, source spans, and containment relationships.
- **SC-002**: At least one real OCaml repository indexes successfully, reports OCaml in language/status output, and shows stable graph counts across repeated indexing.
- **SC-003**: For agreed OCaml structural questions, retrieval evidence shows useful graph-backed context within the current repository-size retrieval budget, or records an approved split that preserves this requirement before release.
- **SC-004**: Validation identifies zero speculative relationships for ambiguous package, module, or PPX cases.
- **SC-005**: Existing supported-language behavior remains green under the standard build, typecheck, and unit-test verification commands.
- **SC-006**: The PR review packet maps every functional requirement and success criterion to concrete evidence or named deferred work.

## Assumptions

- The existing `023-ocaml-language-support` branch and `specs/023-ocaml-language-support/` directory are the intended SPEC-023 location.
- PPX expansion is out of implementation scope until Plan/Analyze records a different approved outcome.
- OCaml LSP precision belongs to a later capability path and is not required for this specification.
- The exact grammar source, version, license evidence, fixture inventory, real OCaml repositories, and retrieval questions will be pinned during planning without changing the feature's acceptance bar.
- Existing CodeGraph language-support conventions remain the default for symbol naming, status display, fixture shape, and validation evidence.
