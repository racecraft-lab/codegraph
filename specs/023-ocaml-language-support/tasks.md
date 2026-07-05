# Tasks: SPEC-023 - OCaml Language Support

**Input**: Design documents from `specs/023-ocaml-language-support/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/ocaml-language-support.md`, checklists, and `docs/ai/specs/.process/SPEC-023-design-concept.md`

**Tests**: Required by SPEC-023. Create fixtures and failing tests before implementation where practical.

**Reviewability**: Split-ready required. Work must remain ordered by reviewable slices: grammar/status, broad extractor, resolution/package metadata, PPX research gate, validation/eval, and docs/UAT. A slice may not claim complete OCaml support unless its PR packet preserves the full validation gate.

**Format**: `- [ ] T### [P?] [US?] Description with file path`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish reviewability, provenance, validation evidence locations, and the PPX gate before implementation tasks begin.

- [ ] T001 Record the SPEC-023 implementation slice route and reviewability budget in `specs/023-ocaml-language-support/implementation-slices.md`
- [ ] T002 Document `tree-sitter-ocaml@0.24.2` source, MIT license, npm integrity, gitHead, and required WASM names in `docs/grammars/tree-sitter-ocaml.md`
- [ ] T003 [P] Create the validation evidence index with required smoke/probe/A/B/control fields in `specs/023-ocaml-language-support/validation/README.md`
- [ ] T004 [P] Create the PR packet traceability template for FR/SC-to-file/evidence mapping in `specs/023-ocaml-language-support/validation/pr-packet-traceability.md`
- [ ] T005 Resolve the PPX research gate as unsupported/future work for SPEC-023 before PPX-adjacent coding in `specs/023-ocaml-language-support/ppx-policy.md`
- [ ] T006 Record no-native-runtime, no-runtime-network, and permissive-asset constraints for SPEC-023 in `specs/023-ocaml-language-support/validation/safety-license.md`
- [ ] T007 Run the post-tasks atomicity route and record split/releasability output in `specs/023-ocaml-language-support/implementation-slices.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add failing grammar/status/parser health tests and shared fixture scaffolding before user-story implementation.

**Critical**: No user-story implementation should begin until this phase is complete.

- [ ] T008 Create representative parser health fixture samples for `.ml` and `.mli` in `__tests__/fixtures/ocaml/parser-health/`
- [ ] T009 Write failing parser health tests for `tree-sitter-ocaml.wasm` and `tree-sitter-ocaml_interface.wasm` in `__tests__/ocaml-parser-health.test.ts`
- [ ] T010 Write failing copied-artifact assertions for both OCaml WASMs under `dist/extraction/wasm/` in `__tests__/ocaml-parser-health.test.ts`
- [ ] T011 Create fixture files for OCaml language detection and status output in `__tests__/fixtures/ocaml/status/`
- [ ] T012 Write failing `codegraph status` and language-count tests for OCaml `.ml` and `.mli` files in `__tests__/ocaml-status.test.ts`
- [ ] T013 Vendor `tree-sitter-ocaml.wasm` from `tree-sitter-ocaml@0.24.2` into `src/extraction/wasm/tree-sitter-ocaml.wasm`
- [ ] T014 Vendor `tree-sitter-ocaml_interface.wasm` from `tree-sitter-ocaml@0.24.2` into `src/extraction/wasm/tree-sitter-ocaml_interface.wasm`
- [ ] T015 Add the public `ocaml` language token, `.ml`/`.mli` source-file coverage, and grammar metadata in `src/types.ts` and `src/extraction/grammars.ts`
- [ ] T016 Verify `npm run build` copies both OCaml WASM artifacts from `src/extraction/wasm/` into `dist/extraction/wasm/` through the existing wildcard `copy-assets` path, editing `package.json` only if that wildcard path no longer covers new WASMs
- [ ] T017 Add extension-aware internal OCaml parser selection so `.ml` and `.mli` both detect/store/report as `ocaml`, while `.mli` loads `tree-sitter-ocaml_interface.wasm` instead of a second public language, in `src/extraction/grammars.ts` and parser callers
- [ ] T018 Run parser health, copied-artifact, and status tests and record results in `specs/023-ocaml-language-support/validation/grammar-status.md`

**Checkpoint**: Grammar/status slice can be reviewed independently but must not claim complete OCaml support.

---

## Phase 3: User Story 1 - Index OCaml Repositories (Priority: P1)

**Goal**: Index `.ml` and `.mli` files, report OCaml in status, and emit stable symbols/spans for required OCaml constructs.

**Independent Test**: Index the OCaml fixture repository, confirm OCaml appears in status, and verify expected symbols, node kinds, source spans, and containment for required constructs.

### Tests for User Story 1

- [ ] T019 [P] [US1] Create broad implementation syntax fixtures covering modules, functors, types, records, variants, values, functions, lets, classes, objects, local modules, first-class modules, GADTs, polymorphic variants, attributes, extension nodes, and pattern-heavy definitions in `__tests__/fixtures/ocaml/broad-syntax/implementation.ml`
- [ ] T020 [P] [US1] Create interface syntax fixtures covering `val`, `external`, type, record, variant, GADT, polymorphic variant, module, module type, class type, class, method, `open`, and `include` declarations in `__tests__/fixtures/ocaml/broad-syntax/interface.mli`
- [ ] T021 [US1] Write failing extraction tests for `.ml` and `.mli` file recognition, node kinds, spans, and containment in `__tests__/ocaml-extraction.test.ts`
- [ ] T022 [US1] Write failing extraction tests for labeled parameters, optional parameters, pattern-only bindings, and nearest-owner fallback spans in `__tests__/ocaml-extraction.test.ts`
- [ ] T023 [US1] Write failing extraction tests for interface declaration symbol kinds and source/interface-only behavior in `__tests__/ocaml-extraction.test.ts`

### Implementation for User Story 1

- [ ] T024 [US1] Implement the OCaml language extractor skeleton and source-unit handling in `src/extraction/languages/ocaml.ts`
- [ ] T025 [US1] Implement OCaml module, signature, functor, type, record, variant, GADT, polymorphic variant, value, function, and let-binding extraction in `src/extraction/languages/ocaml.ts`
- [ ] T026 [US1] Implement OCaml class, object, method, field, labeled/optional parameter, local module, first-class module, attribute, extension-node, and pattern-heavy extraction behavior in `src/extraction/languages/ocaml.ts`
- [ ] T027 [US1] Implement stable source-span, containment, nearest-owner fallback, and no-synthetic-name handling in `src/extraction/languages/ocaml.ts`
- [ ] T028 [US1] Register the OCaml extractor in `src/extraction/languages/index.ts`
- [ ] T029 [US1] Verify User Story 1 extraction/status tests and record node/span coverage in `specs/023-ocaml-language-support/validation/extraction.md`

**Checkpoint**: User Story 1 should be independently functional and reviewable as grammar/status plus broad extraction, without claiming resolution or complete OCaml support.

---

## Phase 4: User Story 2 - Explore OCaml Structure (Priority: P2)

**Goal**: Add conservative, unique-only local OCaml relationships for module paths, functors, `open`, `include`, `.ml`/`.mli` pairs, Dune workspace boundaries, and checked-in package metadata.

**Independent Test**: Ask structural questions against OCaml fixtures and verify the returned graph includes deterministic relationships while ambiguous module/package/PPX cases emit no edge, no package nodes, and no external package edges.

### Tests for User Story 2

- [ ] T030 [P] [US2] Create positive resolution fixtures for module paths, nested modules, local opens, includes, functor applications, functor arguments, result-module aliases, and unique `.ml`/`.mli` pairs in `__tests__/fixtures/ocaml/resolution/positive/`
- [ ] T031 [P] [US2] Create Dune and opam metadata fixtures using checked-in `dune-project`, `dune`, root `*.opam`, and `opam/*.opam` files in `__tests__/fixtures/ocaml/resolution/workspace/`
- [ ] T032 [P] [US2] Create negative ambiguity fixtures for duplicate module candidates, ambiguous interface pairs, ambiguous package metadata, unsupported PPX-generated references, and functor result elaboration cases in `__tests__/fixtures/ocaml/resolution/negative/`
- [ ] T033 [US2] Write failing positive resolution tests for module paths, functor references/applications, opens, includes, interface pairing, and metadata-constrained local relationships in `__tests__/ocaml-resolution.test.ts`
- [ ] T034 [US2] Write failing negative resolution tests proving ambiguous module/package candidates emit no edge in `__tests__/ocaml-resolution.test.ts`
- [ ] T035 [US2] Write failing graph-shape tests proving no package nodes and no external package edges are produced in `__tests__/ocaml-resolution.test.ts`
- [ ] T036 [US2] Write failing tests proving no PPX expansion and no functor result elaboration or type-equality inference in `__tests__/ocaml-resolution.test.ts`

### Implementation for User Story 2

- [ ] T037 [US2] Implement checked-in Dune and opam metadata discovery for local OCaml boundaries in `src/resolution/ocaml-workspace.ts`
- [ ] T038 [US2] Implement unique-only OCaml module candidate selection for qualified paths, nested modules, opens, and includes in `src/resolution/ocaml-resolver.ts`
- [ ] T039 [US2] Implement unique same-directory `.ml`/`.mli` pairing constraints in `src/resolution/ocaml-resolver.ts`
- [ ] T040 [US2] Implement statically named functor reference/application relationships without result elaboration in `src/resolution/ocaml-resolver.ts`
- [ ] T041 [US2] Integrate OCaml local relationship resolution into the existing resolver path in `src/resolution/import-resolver.ts`
- [ ] T042 [US2] Enforce no package nodes, no external package edges, no installed switch state, no lock/template metadata, and no network package state in `src/resolution/ocaml-workspace.ts`
- [ ] T043 [US2] Verify User Story 2 resolution tests and record positive/negative edge evidence in `specs/023-ocaml-language-support/validation/resolution.md`

**Checkpoint**: User Story 2 should be independently reviewable as conservative local resolution. PPX expansion, package graph modeling, and typechecker-grade semantics remain out of scope.

---

## Phase 5: User Story 3 - Review Shippable Evidence (Priority: P3)

**Goal**: Produce fixture, real-repository smoke, deterministic probe, A/B, graph-stability, and existing-language control evidence for complete OCaml support.

**Independent Test**: Review validation artifacts for fixture expectations, repeated index stability, Yojson/OCaml-LSP/Dune smoke metrics, all nine probe results, required A/B records, and existing-language controls.

### Validation Setup for User Story 3

- [ ] T044 [US3] Create the nine-question deterministic retrieval probe matrix for Yojson, OCaml-LSP, and Dune in `specs/023-ocaml-language-support/validation/retrieval-probes.md`
- [ ] T045 [P] [US3] Create the Yojson smoke evidence file with URL, commit SHA, index command, `filesByLanguage`, node count, edge count, parse warnings/errors, second-run stability, and retrieval probe outcome fields in `specs/023-ocaml-language-support/validation/yojson-smoke.md`
- [ ] T046 [P] [US3] Create the OCaml-LSP smoke evidence file with URL, commit SHA, index command, `filesByLanguage`, node count, edge count, parse warnings/errors, second-run stability, and retrieval probe outcome fields in `specs/023-ocaml-language-support/validation/ocaml-lsp-smoke.md`
- [ ] T047 [P] [US3] Create the Dune smoke evidence file with URL, commit SHA, index command, `filesByLanguage`, node count, edge count, parse warnings/errors, second-run stability, and retrieval probe outcome fields in `specs/023-ocaml-language-support/validation/dune-smoke.md`

### Smoke and Probe Evidence for User Story 3

- [ ] T048 [P] [US3] Run `ocaml-community/yojson` smoke, second-run stability, and `codegraph status` evidence and record metrics in `specs/023-ocaml-language-support/validation/yojson-smoke.md`
- [ ] T049 [P] [US3] Run `ocaml/ocaml-lsp` smoke, second-run stability, and `codegraph status` evidence and record metrics in `specs/023-ocaml-language-support/validation/ocaml-lsp-smoke.md`
- [ ] T050 [P] [US3] Run `ocaml/dune` smoke, second-run stability, and `codegraph status` evidence and record metrics in `specs/023-ocaml-language-support/validation/dune-smoke.md`
- [ ] T051 [P] [US3] Run `scripts/agent-eval/probe-explore.mjs` and `scripts/agent-eval/probe-node.mjs` for Yojson `from_string`, `to_string` or pretty-print, and Safe/Common/Util `.ml`/`.mli` exposure questions and record results in `specs/023-ocaml-language-support/validation/yojson-probes.md`
- [ ] T052 [P] [US3] Run `scripts/agent-eval/probe-explore.mjs` and `scripts/agent-eval/probe-node.mjs` for OCaml-LSP `textDocument/hover`, `textDocument/completion`, and Dune RPC diagnostics questions and record results in `specs/023-ocaml-language-support/validation/ocaml-lsp-probes.md`
- [ ] T053 [P] [US3] Run `scripts/agent-eval/probe-explore.mjs` and `scripts/agent-eval/probe-node.mjs` for Dune `dune build` stanza-to-rule, `dune-project`/opam metadata, and scheduler/action execution questions and record results in `specs/023-ocaml-language-support/validation/dune-probes.md`

### A/B and Control Evidence for User Story 3

- [ ] T054 [P] [US3] Run Yojson headless A/B with at least two runs per arm and record model/effort, duration, Read/Grep counts, CodeGraph calls, and interpretation in `specs/023-ocaml-language-support/validation/yojson-ab.md`
- [ ] T055 [P] [US3] Run OCaml-LSP headless A/B with at least two runs per arm and record model/effort, duration, Read/Grep counts, CodeGraph calls, and interpretation in `specs/023-ocaml-language-support/validation/ocaml-lsp-ab.md`
- [ ] T056 [US3] Record Dune A/B evidence or an explicit follow-up gate that must close before SPEC-023 completion in `specs/023-ocaml-language-support/validation/dune-ab-gate.md`
- [ ] T057 [US3] Run `npm run build`, `npm run typecheck`, and `npm test` and record full verification output plus copied OCaml WASM proof in `specs/023-ocaml-language-support/validation/existing-language-controls.md`
- [ ] T058 [US3] Run targeted extraction, resolution, status, parser-health, and copied-artifact tests and record command output in `specs/023-ocaml-language-support/validation/existing-language-controls.md`
- [ ] T059 [US3] Run CodeGraph self-repo retrieval smoke and record the prompt, tool output summary, and Read/Grep outcome in `specs/023-ocaml-language-support/validation/self-repo-smoke.md`
- [ ] T060 [US3] Run `scripts/agent-eval/ab-new-vs-baseline.sh` on an existing-language control only if shared MCP, explore-budget, resolver, status, or retrieval behavior changed, and record the run or non-applicability rationale in `specs/023-ocaml-language-support/validation/existing-language-ab-gate.md`
- [ ] T061 [US3] Update FR/SC traceability with changed files, verification evidence, known gaps, and deferred gates in `specs/023-ocaml-language-support/validation/pr-packet-traceability.md`

**Checkpoint**: User Story 3 completes the evidence gate for any slice that claims complete OCaml support. Dune A/B may remain deferred only if `dune-ab-gate.md` names the approved follow-up gate before SPEC-023 completion.

---

## Phase 6: User Story 4 - Bound PPX Explicitly (Priority: P4)

**Goal**: Ensure PPX remains explicitly unsupported/future work in SPEC-023 and that attributes/extension nodes are parse-preserved without generated symbols or speculative relationships.

**Independent Test**: Review `ppx-policy.md`, PPX negative fixtures, and validation evidence showing unsupported generated behavior is documented and no speculative graph output is emitted.

### Tests for User Story 4

- [ ] T062 [P] [US4] Create PPX attribute and extension-node negative fixtures in `__tests__/fixtures/ocaml/ppx/`
- [ ] T063 [US4] Write failing PPX boundary tests proving attributes and extension nodes do not create PPX-expanded symbols or generated relationships in `__tests__/ocaml-ppx-policy.test.ts`

### Implementation for User Story 4

- [ ] T064 [US4] Preserve source-level attribute and extension-node visibility without PPX expansion in `src/extraction/languages/ocaml.ts`
- [ ] T065 [US4] Add unsupported/future-work PPX limitation text to OCaml validation evidence in `specs/023-ocaml-language-support/validation/ppx-boundary.md`
- [ ] T066 [US4] Verify PPX boundary tests and record no-generated-symbol/no-speculative-edge evidence in `specs/023-ocaml-language-support/validation/ppx-boundary.md`

**Checkpoint**: PPX is bounded explicitly. SPEC-023 still does not implement OCaml LSP precision, PPX expansion, generated-code inference, typechecker-grade semantics, package nodes, or external package edges.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish documentation, user-visible limitations, UAT, and final review packet without broadening implementation scope.

- [ ] T067 [P] Update user-facing OCaml support and limitation notes in `README.md`
- [ ] T068 [P] Add a user-facing Unreleased changelog entry for OCaml language support in `CHANGELOG.md`
- [ ] T069 [P] Update OCaml grammar provenance and shipping notes after implementation evidence is final in `docs/grammars/tree-sitter-ocaml.md`
- [ ] T070 Run the complete quickstart validation path and record pass/fail evidence in `specs/023-ocaml-language-support/validation/quickstart-run.md`
- [ ] T071 Run final reviewability and scope-budget check against changed files and record result in `specs/023-ocaml-language-support/implementation-slices.md`
- [ ] T072 Confirm no unrelated language extractors or resolver behavior were modified and record review notes in `specs/023-ocaml-language-support/validation/pr-packet-traceability.md`
- [ ] T073 Finalize the PR packet with review order, non-goals, scope budget, rollback notes, FR/SC traceability, verification evidence, known gaps, and deferred work in `specs/023-ocaml-language-support/validation/pr-packet-traceability.md`
- [ ] T074 Confirm no unresolved clarification, gap, or critical markers remain in SPEC-023 artifacts and record the scan in `specs/023-ocaml-language-support/validation/quickstart-run.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. Establishes split route, provenance, safety/license, PR traceability, and PPX policy.
- **Foundational (Phase 2)**: Depends on Setup. Blocks all user-story implementation.
- **User Story 1 (Phase 3)**: Depends on Foundational. Delivers grammar/status plus broad extraction.
- **User Story 2 (Phase 4)**: Depends on User Story 1. Resolution needs extracted OCaml symbols and source units.
- **User Story 3 (Phase 5)**: Depends on User Story 2 for complete support evidence. Smoke/probe/A/B records may run in parallel after implementation is available.
- **User Story 4 (Phase 6)**: PPX gate task T005 is foundational; PPX negative verification depends on User Story 1 extraction and User Story 2 no-speculative-edge behavior.
- **Polish (Phase 7)**: Depends on the intended implementation/evidence slices being complete.

### Slice Chains

- **Grammar/status**: T001, T002, T008-T018, T029, T057, T070, T073
- **Broad extractor**: T019-T029, T062-T066, T057-T058, T070, T073
- **Resolution/package metadata**: T030-T043, T056-T061, T070, T073
- **PPX research gate**: T005, T036, T062-T066, T074
- **Validation/eval**: T003, T044-T061, T070, T073
- **Docs/UAT**: T004, T067-T074

### User Story Dependencies

- **US1 (P1)**: MVP after Foundational. No dependency on US2/US3/US4 completion.
- **US2 (P2)**: Depends on US1 extracted symbols and source units.
- **US3 (P3)**: Depends on the slice that claims complete OCaml support.
- **US4 (P4)**: PPX decision is required before PPX-adjacent code; final PPX evidence depends on extraction and resolution negative tests.

---

## Parallel Opportunities

- T003 and T004 can run in parallel because they create different SPEC-023 validation files.
- T019 and T020 can run in parallel because they create separate broad-syntax fixture files.
- T030, T031, and T032 can run in parallel because they create disjoint resolution fixture directories.
- T045, T046, and T047 can run in parallel after OCaml support builds because each records a separate smoke evidence file.
- T048, T049, and T050 can run in parallel after successful indexing of each corpus because they use separate repositories and evidence files.
- T051, T052, and T053 can run in parallel after smoke succeeds because probe results write to separate files.
- T054 and T055 can run in parallel if separate worktrees or scratch directories are used for each A/B run.
- T067, T068, and T069 can run in parallel because they update separate documentation files.

## Parallel Example: User Story 2

```bash
Task: "T030 Create positive resolution fixtures in __tests__/fixtures/ocaml/resolution/positive/"
Task: "T031 Create Dune and opam metadata fixtures in __tests__/fixtures/ocaml/resolution/workspace/"
Task: "T032 Create negative ambiguity fixtures in __tests__/fixtures/ocaml/resolution/negative/"
```

## Parallel Example: User Story 3

```bash
Task: "T048 Run Yojson smoke and record specs/023-ocaml-language-support/validation/yojson-smoke.md"
Task: "T049 Run OCaml-LSP smoke and record specs/023-ocaml-language-support/validation/ocaml-lsp-smoke.md"
Task: "T050 Run Dune smoke and record specs/023-ocaml-language-support/validation/dune-smoke.md"
```

---

## Coverage Matrix

### Functional Requirements

- **FR-001**: T011, T012, T015, T017, T021, T024, T028, T029
- **FR-002**: T012, T015, T018, T048-T050, T057
- **FR-003**: T019-T027, T029
- **FR-004**: T021-T027, T029
- **FR-005**: T019, T022, T026, T027, T029
- **FR-006**: T030, T033, T037-T043
- **FR-007**: T020, T023, T030, T033, T039, T043
- **FR-008**: T031, T033, T037, T041-T043
- **FR-009**: T005, T032, T034-T036, T042, T062-T066
- **FR-010**: T002, T009, T010, T013-T017, T018, T057
- **FR-011**: T019-T023, T029-T036, T043, T062-T066
- **FR-012**: T045-T050
- **FR-013**: T044, T051-T056, T060-T061
- **FR-014**: T005, T062-T066, T067, T073
- **FR-015**: T057-T060, T072
- **FR-016**: T048-T050, T057-T061
- **FR-017**: T001, T007, T071, T073

### Success Criteria

- **SC-001**: T019-T029, T062-T066
- **SC-002**: T045-T050, T057
- **SC-003**: T044, T051-T056, T060-T061
- **SC-004**: T032, T034-T036, T042, T062-T066
- **SC-005**: T009-T018, T057-T058
- **SC-006**: T004, T061, T073-T074

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 for US1 grammar/status and broad extraction.
3. Validate parser health, copied artifacts, status output, and extraction fixtures.
4. Stop before claiming complete OCaml support unless later phases are complete.

### Incremental Delivery

1. Grammar/status slice: T001-T018.
2. Broad extractor slice: T019-T029.
3. Resolution/package metadata slice: T030-T043.
4. PPX boundary slice: T005 and T062-T066.
5. Validation/eval/docs slice: T044-T074.

### Review Discipline

- Keep each implementation PR/slice reviewable and traceable.
- Do not implement OCaml LSP precision, PPX expansion, typechecker-grade semantics, package nodes, external package edges, or functor result elaboration.
- Do not modify unrelated language extractors or resolver behavior.
- Do not commit as part of task execution unless the maintainer explicitly asks.
