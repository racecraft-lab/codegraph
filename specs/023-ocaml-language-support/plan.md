# Implementation Plan: SPEC-023 - OCaml Language Support

**Branch**: `023-ocaml-language-support` | **Date**: 2026-07-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/023-ocaml-language-support/spec.md`, with the Phase 3 Plan Prompt from `docs/ai/specs/.process/SPEC-023-workflow.md`.

## Summary

Add OCaml to CodeGraph's supported-language matrix through the existing tree-sitter WASM grammar pipeline, a new OCaml extractor, conservative Dune-scoped local resolution for module paths, functor references/applications, opens, includes, and interface pairs, status/build wiring, fixtures, docs, and eval-backed retrieval proof. SPEC-023 keeps PPX expansion, functor result elaboration, external package graph modeling, package nodes, and typechecker-grade semantics out of scope; unsupported or ambiguous cases fail closed.

The clarified scope is broader than the roadmap's original minimum, so SPEC-023 remains one cohesive specification but implementation must split into ordered reviewable slices before coding. A PR/slice that claims OCaml support as complete must preserve the full validation bar: fixtures, parser health, copied-artifact checks, repeated smoke on Yojson/OCaml-LSP/Dune, deterministic probes for all nine pinned questions, Yojson and OCaml-LSP headless A/B evidence, and an explicit follow-up gate for any deferred Dune A/B. Earlier split slices may omit mandatory eval evidence only when their PR packet explicitly states that the slice does not claim complete OCaml support and preserves this completion gate.

## Technical Context

**Language/Version**: TypeScript, strict project style. Runtime target remains Node `>=20 <25`; from-source development still requires the effective `node:sqlite` floor of Node 22.5+.

**Primary Dependencies**: Existing `web-tree-sitter` runtime and CodeGraph extraction/resolution stack; the public `ocaml` language token in `src/types.ts`; vendored `tree-sitter-ocaml@0.24.2` implementation and interface WASM artifacts; `node:sqlite`; vitest.

**Storage**: Existing local SQLite database through `node:sqlite`; source fixtures and validation records are file-based project artifacts.

**Testing**: vitest with real files and real SQLite; targeted parser health checks; targeted extraction/resolution/status tests; `npm run build`; `npm run typecheck`; `npm test`; deterministic `probe-explore`/`probe-node`; headless A/B via the existing agent-eval harness.

**Target Platform**: Local-first CodeGraph library, CLI, and MCP server on supported Node runtimes. Grammar artifacts must ship as static WASM files copied into `dist/extraction/wasm/`.

**Project Type**: Local code-intelligence library + CLI + MCP server.

**Performance Goals**: OCaml structural questions should resolve within the existing repo-size explore-call budget, with useful graph-backed context and no Read/Grep fallback caused by missing OCaml support. Repeated indexing must keep node and edge counts stable, and existing language retrieval/status behavior must not regress.

**Constraints**: Deterministic AST/static-analysis graph only; no LLM-generated graph structure; no native runtime dependency; no package nodes; no external package edges; no PPX expansion; no functor result elaboration or type-equality inference; ambiguous module/functor/package/PPX relationships emit no edge; Dune/opam metadata only constrains local relationships when unique.

**Scale/Scope**: `.ml` and `.mli` support; both extensions report as the public `ocaml` language while the parser path selects the implementation grammar for `.ml` and the interface grammar for `.mli`. Broad first-slice syntax includes modules, signatures, functors, types, records, variants, values, functions, let-bindings, labeled/optional arguments, classes/objects, local modules, first-class modules, GADTs, polymorphic variants, attributes, extension nodes, and pattern-heavy definitions. Validation corpus is Yojson, OCaml-LSP, and Dune with nine pinned retrieval questions.

**Reviewability Budget**: Primary surface: harness/adapter. Secondary surfaces: docs/process, seed/config, language status, validation fixtures, retrieval evaluation. Re-estimate after Clarify: 650-900 reviewable production LOC if delivered as one change, 6-8 production files, 16-24 total files excluding vendored/generated grammar artifacts. Result: warning-to-block risk for one PR. Split decision: required implementation slicing before coding; SPEC-023 remains one specification.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-Design Gate | Evidence |
|-----------|-----------------|----------|
| I. Think Before Coding | PASS | Clarify resolved grammar pin, syntax breadth, package boundary, PPX policy, and validation corpus. Remaining assumptions are stated in this plan. |
| II. Simplicity First | PASS WITH SPLIT | PPX expansion, external package graph modeling, and typechecker-grade semantics are excluded. Broader syntax/resolution requires ordered slices and Complexity Tracking rows. |
| III. Surgical Changes | PASS | Work is constrained to OCaml grammar assets, one OCaml extractor, minimal grammar/status/resolver wiring, fixtures, docs, and validation artifacts. |
| IV. Goal-Driven Execution | PASS | Success is defined by parser health, copied artifacts, fixture expectations, smoke metrics, deterministic probes, A/B evidence, and existing-language controls. |
| V. Deterministic, LLM-Free Extraction | PASS | OCaml graph structure derives from tree-sitter/static metadata only. Ambiguity and unsupported PPX/package cases fail closed. |
| VI. Retrieval Performance Is a Regression Surface | PASS | The plan preserves the nine-question retrieval matrix, repo-size explore budgets, Yojson/OCaml-LSP A/B, and conditional existing-language A/B if shared retrieval behavior changes. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | Grammar ships as vendored WASM/static assets through `copy-assets`; no native runtime dependency, installed switch, network package state, or runtime network behavior is introduced. |

### Post-Design Re-Check

| Gate | Status | Result |
|------|--------|--------|
| Clarifications resolved | PASS | All clarification markers are resolved in the plan artifacts. |
| Reviewability route | PASS WITH REQUIRED SPLIT | A one-PR implementation would risk the block threshold. Implementation must be split by grammar/status, extraction breadth, Dune-scoped resolution, and validation/eval/docs. |
| Determinism | PASS | Data model and contract prohibit package nodes, external package edges, PPX-expanded symbols, and ambiguity-based guesses. |
| Validation bar | PASS | Quickstart and contract preserve all mandatory smoke/probe/A/B/control evidence. Dune A/B may defer only behind an explicit follow-up gate before SPEC-023 is complete. |

## Project Structure

### Documentation (this feature)

```text
specs/023-ocaml-language-support/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   `-- ocaml-language-support.md
`-- tasks.md
```

### Source Code (repository root)

```text
src/
|-- types.ts
|-- extraction/
|   |-- languages/
|   |   `-- ocaml.ts
|   `-- wasm/
|       |-- tree-sitter-ocaml.wasm
|       `-- tree-sitter-ocaml_interface.wasm
|-- resolution/
|   `-- [minimal OCaml module/dune/package constraint wiring]
`-- [grammar registry/status/parser wiring touched only where required]

__tests__/
|-- fixtures/
|   `-- ocaml/
`-- [targeted extraction, resolution, status, and copied-artifact tests]

docs/
`-- grammars/
    `-- tree-sitter-ocaml.md
```

**Structure Decision**: Use the existing single-project library/CLI/MCP layout. Add a new OCaml language extractor and grammar assets, touch shared registries/resolvers only at narrow integration points, and keep validation artifacts under the SPEC-023 feature directory and existing test fixture conventions.

## Implementation Slices

| Slice | Review Goal | Required Evidence | Completion Boundary |
|-------|-------------|-------------------|---------------------|
| 1. Grammar/status/basic health | Vendor `tree-sitter-ocaml@0.24.2` implementation and interface WASMs, add the public `ocaml` language registry entry, select the internal grammar by extension, verify copy-assets/status, and prove both parsers load. | Grammar provenance, parser health checks for `.ml` and `.mli`, copied-artifact assertion, status test. | May not claim full OCaml support until later slices pass. |
| 2. Broad syntax extraction | Add `ocaml.ts` and fixtures for required syntax. | Fixture expectations for nodes, spans, containment, interface declarations, and unsupported syntax visibility. | No resolver/package behavior beyond what tests require. |
| 3. Dune-scoped conservative resolution | Add unique-only local module/functor/open/include/interface-pairing and metadata constraints. | Positive and negative resolution fixtures, ambiguity no-edge tests, no functor result elaboration, and no package node/external edge assertions. | PPX remains unsupported/future work. |
| 4. Validation/eval/docs | Record real-repo smoke, deterministic probes, A/B evidence, docs, and PR packet traceability. | Yojson, OCaml-LSP, Dune smoke; all nine probes; Yojson and OCaml-LSP A/B; existing-language controls; compact metrics. | SPEC-023 is not complete until this evidence exists or an explicit approved follow-up gate preserves any deferred Dune A/B. |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Broader-than-roadmap syntax coverage | Clarify made classes/objects, labeled/optional arguments, local/first-class modules, GADTs, polymorphic variants, attributes, extension nodes, and pattern-heavy definitions first-slice requirements. | Basic functions/modules would pass indexing but fail common OCaml retrieval questions and force agents back to Read/Grep. |
| Dune-scoped local resolution | OCaml module and functor relationships often depend on workspace boundaries, source/interface pairing, and Dune metadata. | Symbol-only extraction would not satisfy FR-006, FR-007, or the pinned retrieval matrix. |
| Multi-slice implementation | The clarified scope can exceed the one-PR reviewability block threshold if implemented as one diff. | Weakening eval or syntax scope would violate clarified requirements; slicing keeps each PR reviewable while preserving the final bar. |

## Phase 0 Research Summary

Research output is captured in [research.md](research.md). All technical context unknowns are resolved:

- Grammar source is `tree-sitter-ocaml@0.24.2`, MIT, with implementation and interface WASMs required.
- OCaml exposes one public language token, `ocaml`; the implementation must use an internal extension-aware parser/grammar key so `.mli` files use `tree-sitter-ocaml_interface.wasm` without adding a public `ocaml_interface` language.
- Resolution is Dune-scoped, unique-only, and local for module paths, functor references/applications, open/include scope, and interface pairing.
- Package metadata constrains local relationships only; package nodes and external package edges are prohibited.
- PPX expansion is unsupported/future work for SPEC-023.
- Validation uses Yojson, OCaml-LSP, and Dune with nine pinned retrieval questions and mandatory Yojson/OCaml-LSP A/B evidence.

## Phase 1 Design Summary

Design output is captured in [data-model.md](data-model.md), [quickstart.md](quickstart.md), and [contracts/ocaml-language-support.md](contracts/ocaml-language-support.md).

The contract exists because OCaml support changes public observable behavior through existing CodeGraph CLI, MCP, and library surfaces: indexed files, status language reporting, search/explore/node output, copied distribution artifacts, and validation evidence. It does not introduce a new command, endpoint, schema, or public package API.

## Review Packet Source

The PR packet for any SPEC-023 implementation slice must include:

- What changed and why.
- Non-goals: no OCaml LSP precision, no PPX expansion, no functor result elaboration, no typechecker-grade semantics, no package nodes, no external package edges.
- Review order by slice.
- Scope budget and split status.
- Traceability from FR/SC to files and evidence.
- Verification evidence, including copied WASM artifacts and validation metrics when the slice claims them.
- Known gaps and explicit follow-up gate for any deferred Dune A/B.
- Rollback notes for disabling/removing OCaml grammar/extractor wiring if needed.
