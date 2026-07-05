# SpecKit Workflow: SPEC-023 - OCaml Language Support

**Template Version**: 1.0.0
**Created**: 2026-07-05
**Purpose**: Prepare and execute SPEC-023 through the SpecKit workflow so OCaml
joins CodeGraph's supported-language matrix with broad extraction, conservative
resolution, fixtures, docs, status visibility, and eval-backed proof.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`$speckit-scaffold-spec SPEC-023`. The full Q&A log, Goals, Non-goals, and Open
Questions live at:

```text
docs/ai/specs/.process/SPEC-023-design-concept.md
```

Re-read it before each phase if you need to disambiguate a prompt. The
Specify and Clarify prompts below were populated from that interview, so the
design concept doc is the source of truth for scoping decisions captured during
setup.

> Grill Me is human-in-the-loop only. It is not part of the autopilot loop.
> Once this workflow is populated and autopilot begins, clarifications happen via
> `$speckit-clarify` and the consensus protocol, not by rerunning Grill Me.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `$speckit-specify` | Complete | Generated `spec.md` and `requirements.md`; 4 user stories, 17 FRs, 10 acceptance scenarios, 0 clarification markers. |
| Clarify | `$speckit-clarify` | Complete | Grammar pin, package-resolution boundary, advanced syntax list, PPX route, eval repos, and validation bar resolved. |
| Plan | `$speckit-plan` | Complete | Generated plan, research, data model, quickstart, and contract; required split by grammar/status, extraction, resolution, and validation/eval slices. |
| Checklist | `$speckit-checklist` | Complete | Completed language-coverage, resolution-correctness, validation/eval, and safety/license with zero remaining gaps. |
| Tasks | `$speckit-tasks` | Complete | Generated 74 split-ready tasks across 7 phases; FR-001 through FR-017 and SC-001 through SC-006 covered. |
| Analyze | `$speckit-analyze` | Complete | Found and fixed three artifact-consistency issues; no critical PPX/package/eval drift remains. |
| Implement | `$speckit-implement` | Blocked in post-PR gate | Local implementation and verification are complete. PR packet/body generation and PR creation are blocked by final reviewability until a valid marker-aware emission plan exists or an operator-owned typed exception is committed. |

**Status Legend:** Pending | In Progress | Complete | Blocked

### Phase Gates

Each phase requires human review before proceeding.

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | No unresolved `[NEEDS CLARIFICATION]`; PPX and package-depth ambiguity explicitly marked if still open. |
| G2 | After Clarify | Grammar pin, syntax breadth, package-resolution boundary, PPX route, and eval repos are documented. |
| G3 | After Plan | Constitution gates pass; reviewability budget is updated; split route recorded if needed. |
| G4 | After Checklist | All `[Gap]` markers addressed or consciously deferred with owner and phase. |
| G5 | After Tasks | Every FR/SC has tasks; split-ready dependencies are ordered; eval proof is not lost. |
| G6 | After Analyze | No CRITICAL drift; any roadmap override is explicit and approved before implementation. |
| G7 | During Implement | Targeted tests pass per slice; build copies the OCaml WASM artifact; full verification recorded before PR. |

---

## Prerequisites

### Constitution Validation

Before each phase, verify alignment with `.specify/memory/constitution.md`:

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I - Think Before Coding | Broader syntax, deep package modeling, and PPX pressure must be stated as assumptions, not silently coded. | Clarify resolves Open Questions before Plan/Implement. |
| II - Simplicity First | Do not overbuild typechecker-grade semantics or PPX unless a split/roadmap update justifies it. | Complexity Tracking rows for any broader-than-roadmap scope. |
| III - Surgical Changes | Add OCaml support through new language/grammar/fixture paths with minimal resolver/status edits. | Diff review and reviewability gate. |
| IV - Goal-Driven Execution | Define success as extracted/resolved symbols plus eval proof, not just compiled code. | Tests, real repo smoke, and agent-eval evidence. |
| V - Deterministic Extraction | Nodes/edges derive from tree-sitter/static analysis only; ambiguous package/PPX cases fail closed. | Node/edge count stability and precision spot checks. |
| VI - Retrieval Performance | New OCaml output must help agents avoid Read/Grep and must not regress existing language retrieval. | Agent-eval on OCaml repos plus control smoke. |
| VII - Local-First, Zero Native Deps | Grammar and tooling must be permissive and shippable as WASM/static assets; no native runtime dependency. | License check, `copy-assets`, `npm run build`. |

**Constitution Check:** Verified during autopilot Phase 0 on 2026-07-05.
`check-prerequisites.sh` returned `all_pass: true`; Codex agent install
validator reported `ok: codex: 10 bundled agents installed`; reviewability
setup gate returned `pass: true`, `status: warn`, 325 reviewable LOC, 4
production files, 10 total files, warning `primary surfaces 6 exceeds warn
threshold 1`; `npm run build`, `npm run typecheck`, and `npm test` passed
(`132` test files, `2223` passed, `4` skipped).

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| Spec ID | SPEC-023 |
| Name | OCaml Language Support |
| Branch | `023-ocaml-language-support` |
| Dependencies | None |
| Enables | OCaml repositories across the platform; future OCaml LSP precision via SPEC-008 when `ocamllsp` is installed |
| Priority | P2 |
| Primary Surface | harness/adapter |
| Roadmap Budget | 325 reviewable LOC, ~4 production files, ~10 total files, within budget |

### Roadmap Scope

- Grammar: tree-sitter OCaml WASM built/vendored per the grammar pipeline and wired into `copy-assets`.
- Extractor: `src/extraction/languages/ocaml.ts` for functions, modules/functors, types, variants/records, let-bindings, module opens/includes, and `.mli` files.
- Resolution: module-path references, open/include scoping heuristics, and dune project awareness in resolver/name matching.
- Validation: fixture repo, extraction/resolution tests, docs, and `codegraph status` language listing.

### Grill Me Scope Additions

- Broader syntax is desired: classes, objects, labeled/optional args, pattern-heavy definitions, and other common advanced constructs should be considered during Specify/Clarify.
- Deep package awareness is desired, but must be deterministic and fail closed.
- Full eval is desired: focused fixtures, real OCaml repo smoke, and agent-eval style retrieval proof on multiple OCaml repos.
- PPX is a research gate, not automatic coding scope. The roadmap currently lists PPX expansion as out of scope; Plan/Analyze must resolve whether to keep that, split it, or update the roadmap before implementation.

### Success Criteria Summary

- [ ] OCaml files (`.ml`, `.mli`) are discovered, parsed with the correct vendored grammar artifact, and listed in language/status output.
- [ ] Core and advanced OCaml constructs produce stable nodes with correct kinds/spans.
- [ ] Module, functor, open/include, `.ml`/`.mli`, dune workspace, and approved package-resolution cases produce conservative references/imports edges.
- [ ] Ambiguous or unsupported package/PPX cases do not create speculative graph edges.
- [ ] `npm run build` copies `tree-sitter-ocaml.wasm` and `tree-sitter-ocaml_interface.wasm` into `dist/`.
- [ ] Fixture tests cover extraction and resolution breadth.
- [ ] Yojson, OCaml-LSP, and Dune smoke evidence plus pinned retrieval probes are recorded or split with explicit gate approval.
- [ ] Headless A/B evidence is recorded for Yojson and OCaml-LSP; Dune A/B may split only with a follow-up gate before SPEC-023 is complete.
- [ ] Existing language extraction/resolution tests remain green.

---

## Phase 1: Specify

**When to run:** At the start. Focus on what OCaml support must accomplish and
what is explicitly deferred. Output: `specs/023-ocaml-language-support/spec.md`.

### Specify Prompt

```text
$speckit-specify

## Feature: SPEC-023 - OCaml Language Support

### Problem Statement
CodeGraph does not currently parse or reason over OCaml repositories. SPEC-023
adds OCaml to the supported-language matrix through the standard grammar,
extractor, resolver, fixture, docs, and status pipeline so agents can ask useful
structural questions about OCaml code without falling back immediately to
Read/Grep.

### Users
- Developers and agents working in OCaml repositories.
- Maintainers who need CodeGraph language support to follow the same shippable,
  deterministic, fixture-backed bar as existing languages.
- Future SPEC-008 users who can benefit from `ocamllsp` precision after the
  static OCaml substrate exists.

### User Stories
- [US1] As an operator, I index an OCaml repository and CodeGraph recognizes
  `.ml` and `.mli` files, reports OCaml in status, and emits stable nodes for
  modules, functors, types, records, variants, functions, let-bindings, classes,
  objects, and common pattern-heavy definitions.
- [US2] As an agent, I search or explore OCaml symbols and get useful source
  spans plus conservative relationships for module paths, open/include scoping,
  `.ml`/`.mli` pairs, dune workspaces, and approved package metadata.
- [US3] As a maintainer, I can review fixtures, real-repo smoke output, and
  agent-eval proof showing OCaml support helps retrieval without speculative
  graph edges or node explosions.
- [US4] As a maintainer, I can see how PPX is handled: unsupported, research
  only, separate slice, or roadmap update before implementation.

### Functional Scope
- Vendor/build `tree-sitter-ocaml.wasm` through the repo's existing grammar
  pipeline and wire it into `copy-assets`.
- Add `src/extraction/languages/ocaml.ts` following local extractor patterns.
- Support broad OCaml syntax from the design concept: modules, signatures,
  functors, types, records, variants, let-bindings, functions, labeled/optional
  arguments, classes/objects, pattern-heavy definitions, open/include, and `.mli`.
- Add conservative resolution for module paths, open/include, `.ml`/`.mli`
  pairing, dune workspace roots, and package metadata that can be grounded
  deterministically.
- Add fixtures, tests, docs/status listing, real OCaml repo smoke, and
  agent-eval proof or approved split plan.

### Constraints
- Graph structure must be deterministic and LLM-free.
- Ambiguous package/PPX relationships must fail closed instead of emitting
  speculative edges.
- No native runtime dependencies; grammar artifact must ship through
  `copy-assets`.
- Existing language behavior and retrieval budgets must not regress.
- If the broadened scope exceeds reviewability budget, split tasks before
  implementation.

### Out of Scope Unless Plan/Analyze Explicitly Changes It
- OCaml LSP precision via `ocamllsp`; that belongs to SPEC-008.
- Typechecker-grade module elaboration, type inference, PPX expansion, or
  formatter integration.
- Cross-language changes unrelated to OCaml.

Reference the design concept:
`docs/ai/specs/.process/SPEC-023-design-concept.md`.
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 17 |
| User Stories | 4 |
| Acceptance Criteria | 10 |

### Files Generated

- [x] `specs/023-ocaml-language-support/spec.md`
- [x] `specs/023-ocaml-language-support/checklists/requirements.md`

---

## Phase 2: Clarify

**When to run:** Required immediately after Specify. Maximum five targeted
questions per session.

### Clarify Prompts

#### Session 1: Grammar, Syntax Breadth, and Shipping

```text
$speckit-clarify

Focus on grammar and extraction breadth:
- Pin the exact `tree-sitter-ocaml` source/version/commit and license evidence.
- Decide the mandatory first-slice syntax list from the Design Concept:
  classes/objects, labeled/optional arguments, local modules, first-class
  modules, GADTs, polymorphic variants, attributes, extension nodes, and
  pattern-heavy definitions.
- Confirm how `.ml` and `.mli` files pair, and what node kinds each interface
  declaration should emit.
- Confirm the `copy-assets` shipping path and how build failure should surface
  if the WASM artifact is missing.
```

#### Session 2: Resolution, Dune, Packages, and PPX Gate

```text
$speckit-clarify

Focus on deterministic resolution boundaries:
- Define the first implementation boundary for module-path references,
  open/include scoping, `.ml`/`.mli` pairing, dune workspaces, and package-level
  metadata.
- Decide whether opam package metadata is in scope, and if so which files are
  authoritative.
- Define fail-closed behavior for ambiguous modules/packages.
- Resolve the PPX research gate: unsupported/future work, research note only,
  separate slice, or roadmap update before implementation.
```

#### Session 3: Validation and Eval Bar

```text
$speckit-clarify

Focus on proof required before PR:
- Pick the real OCaml repositories for smoke and agent-eval proof.
- Define at least three canonical retrieval questions per real repo.
- Decide which evidence is mandatory in the first PR and which may be split if
  reviewability gates require it.
- Confirm control checks for existing languages so OCaml support does not
  regress extraction, resolution, or retrieval behavior.
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Grammar/syntax/shipping | 5 | Vendor `tree-sitter-ocaml@0.24.2` WASMs for `.ml` and `.mli`; require parser health checks and dist artifact assertions; first-slice syntax includes classes/objects, labels, local/first-class modules, GADTs, polymorphic variants, attributes, extension nodes, and pattern-heavy definitions; pair `.ml`/`.mli` by unique same-directory basename; `.mli` declarations emit mirrored public node kinds. |
| 2 | Resolution/package/PPX | 5 | Use Dune-scoped, unique-only local resolution for module paths/open/include; authoritative metadata is checked-in `dune-project`, `dune` stanzas, and root or `opam/` `*.opam`; metadata gates local relationships only, with no package nodes or external package edges; ambiguity emits no edge; PPX expansion is unsupported/future work. |
| 3 | Validation/eval | 5 | Pin real-repo corpus to Yojson, OCaml-LSP, and Dune; require three retrieval questions per repo; require first-PR fixture, parser health, copied-artifact, full verify, status, repeated smoke, graph stability, deterministic probe, and Yojson/OCaml-LSP A/B evidence; allow only Dune A/B and optional Irmin stress to split with an explicit follow-up gate; require existing-language controls and compact smoke metrics. |

---

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|------|----------------------|------------|-------|---------|------------|---------------|
| 1 | Clarify | Grammar source/artifacts | [codebase, domain] | 1 | both-agree | Vendor `tree-sitter-ocaml@0.24.2` WASMs for implementation and interface grammars; reject `tree-sitter-wasms@0.1.13` for this feature because it ships only one older OCaml artifact and valid `.mli` probing produced an ERROR tree. | codebase-analyst, domain-researcher |

---

## Phase 3: Plan

**When to run:** After Specify and Clarify resolve open questions. Output:
`specs/023-ocaml-language-support/plan.md`.

### Plan Prompt

```text
$speckit-plan

## Tech Stack
- Language: TypeScript, strict project style.
- Runtime: Node `>=20 <25`; from-source `node:sqlite` floor still applies.
- Parser: tree-sitter WASM grammar copied by `copy-assets`.
- Extraction: `src/extraction/languages/` one-file-per-language pattern.
- Resolution: reuse existing import/name matcher patterns; add only OCaml-specific
  module/dune/package handling needed by the approved scope.
- Tests: vitest with real files and real SQLite; no DB mocking.

## Architecture Notes
- New grammar artifacts: `src/extraction/wasm/tree-sitter-ocaml.wasm` and `src/extraction/wasm/tree-sitter-ocaml_interface.wasm`, vendored from `tree-sitter-ocaml@0.24.2`.
- New extractor: `src/extraction/languages/ocaml.ts`.
- Modify grammar registry/status wiring so OCaml is recognized and shipped.
- Modify resolver/import matching minimally for module paths, open/include,
  `.ml`/`.mli` pairing, dune workspace roots, and approved package metadata.
- Resolution is Dune-scoped and unique-only: use checked-in `dune-project`,
  `dune` stanzas, and root or `opam/` `*.opam` only to constrain local
  relationships. Do not add package nodes or external package edges.
- PPX expansion is unsupported/future work in SPEC-023; attributes and
  extension nodes are parsed/preserved only.
- Add fixtures under `__tests__/fixtures/ocaml/` and tests matching local
  language-support conventions.
- Add docs/status evidence and build verification that both WASM artifacts land
  in `dist/`.
- Add `docs/grammars/tree-sitter-ocaml.md` provenance/rebuild notes for the
  vendored `tree-sitter-ocaml@0.24.2` artifacts.
- Pin validation design to `ocaml-community/yojson`, `ocaml/ocaml-lsp`, and
  `ocaml/dune`. Record the exact commit SHA and smoke metrics for each repo:
  `filesByLanguage`, node count, edge count, parse warnings/errors, second-run
  stability, and retrieval probe outcome.
- Use the nine-question retrieval matrix from `spec.md`: three questions each
  for Yojson parse/write/interface exposure, OCaml-LSP hover/completion/Dune
  diagnostics, and Dune stanza/package/scheduler flows.
- First PR requires deterministic `probe-explore`/`probe-node` results for all
  nine questions and headless A/B evidence for Yojson and OCaml-LSP. Dune A/B
  and optional Irmin PPX/package stress may split only with an explicit
  follow-up gate before SPEC-023 is complete.
- Existing-language controls are full build/typecheck/unit verification,
  targeted extraction/resolution/status tests, and a CodeGraph self-repo
  retrieval smoke. Run `scripts/agent-eval/ab-new-vs-baseline.sh` on an
  existing-language control only if shared MCP, explore-budget, resolver, or
  retrieval behavior changes.

## Constitution and Reviewability Gates
- Re-run reviewability estimation using the clarified syntax/package/PPX scope.
- If the broadened scope exceeds budget, split into ordered slices such as:
  1. grammar + status + basic extractor,
  2. broad syntax extraction,
  3. module/dune/package resolution,
  4. PPX research or separate PPX slice,
  5. real-repo and agent-eval proof.
- Add Complexity Tracking rows for any typechecker-grade or PPX-adjacent work.
- Preserve deterministic extraction; unsupported PPX/package cases must fail closed.

Reference:
- `docs/ai/specs/.process/SPEC-023-design-concept.md`
- `docs/ai/specs/intelligence-platform-technical-roadmap.md` SPEC-023
- `.specify/memory/constitution.md`
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | Complete | Technical approach, constitution gates, reviewability estimate, and required implementation slices |
| `research.md` | Complete | Grammar pin, package metadata, PPX gate, eval repo selection, retrieval questions, and control checks |
| `data-model.md` | Complete | OCaml grammar, source-unit, symbol, pairing, metadata, relationship, PPX, validation, probe, and A/B entities |
| `contracts/` | Complete | `contracts/ocaml-language-support.md` captures observable CLI/MCP/library/status/artifact/evidence behavior |
| `quickstart.md` | Complete | Build, parser health, fixtures, smoke corpus, deterministic probes, A/B evidence, and existing-language controls |

---

## Phase 4: Domain Checklists

Run checklists after Plan so they validate both `spec.md` and `plan.md`.

### 1. Language Coverage Checklist

```text
$speckit-checklist language-coverage

Focus on SPEC-023 syntax coverage:
- Broad OCaml constructs from the Design Concept.
- Interface files and `.ml`/`.mli` pairing.
- Node kind choices and span accuracy.
- Pay special attention to advanced syntax that may silently drop symbols.
```

### 2. Resolution Correctness Checklist

```text
$speckit-checklist resolution-correctness

Focus on conservative resolution:
- Module paths, open/include scoping, functor references, dune workspace roots,
  package metadata, and `.ml`/`.mli` joins.
- Ambiguous package/PPX cases must fail closed.
- Pay special attention to speculative edges and node/edge explosion risk.
```

### 3. Validation and Eval Checklist

```text
$speckit-checklist validation-eval

Focus on proof before PR:
- Fixture coverage, real OCaml repo smoke, agent-eval prompts, control checks,
  build/copy-assets verification, and `codegraph status`.
- Pinned smoke corpus: `ocaml-community/yojson`, `ocaml/ocaml-lsp`, and
  `ocaml/dune`.
- Retrieval matrix: three structural questions per pinned corpus, matching
  `spec.md` Clarifications Session 3.
- Mandatory first-PR evidence: deterministic probes for all nine questions,
  Yojson and OCaml-LSP headless A/B, compact smoke metrics, and full verify.
- Pay special attention to whether eval evidence is required in the same PR or
  split without weakening the final bar.
```

### 4. Safety and License Checklist

```text
$speckit-checklist safety-license

Focus on local-first constraints:
- Grammar source/version/license, no native runtime dependencies, no networked
  runtime behavior, deterministic extraction, and no non-permissive assets.
- Pay special attention to any grammar vendoring or package metadata parsing
  that could import incompatible code.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| language-coverage | 20 | 0 | `spec.md`, `data-model.md`, `contracts/ocaml-language-support.md` |
| resolution-correctness | 23 | 0 | `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/ocaml-language-support.md`, `quickstart.md` |
| validation-eval | 32 | 0 | `spec.md`, `plan.md`, `research.md`, `contracts/ocaml-language-support.md`, `quickstart.md` |
| safety-license | 28 | 0 | `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/ocaml-language-support.md`, `quickstart.md` |

---

## Phase 5: Tasks

**When to run:** After checklists complete. Output:
`specs/023-ocaml-language-support/tasks.md`.

### Tasks Prompt

```text
$speckit-tasks

Generate tasks for SPEC-023 with split-ready reviewability.

Task constraints:
- Start with tests and fixtures before implementation where practical.
- Preserve one task chain per slice: grammar/status, broad extractor,
  resolution/package metadata, PPX research gate, validation/eval, docs/UAT.
- Mark parallel-safe tasks with [P] only when they touch different files and do
  not depend on the same generated fixture or schema/status wiring.
- Include explicit tasks for `copy-assets` and verifying both OCaml WASM
  artifacts in `dist/`: `tree-sitter-ocaml.wasm` and
  `tree-sitter-ocaml_interface.wasm`.
- Include tasks for `codegraph status` language listing.
- Include real OCaml repo smoke and agent-eval proof, or split them with an
  explicit gate if the reviewability route requires it.
- Include smoke tasks for `ocaml-community/yojson`, `ocaml/ocaml-lsp`, and
  `ocaml/dune`; each task must record URL, commit SHA, index command,
  `filesByLanguage`, node count, edge count, parse warnings/errors, second-run
  stability, and retrieval probe outcome.
- Include deterministic `probe-explore`/`probe-node` tasks for all nine pinned
  retrieval questions.
- Include headless A/B tasks for Yojson and OCaml-LSP. Dune A/B and optional
  Irmin PPX/package stress may split only with an explicit follow-up gate.
- Include existing-language control tasks: full build/typecheck/unit verify,
  targeted extraction/resolution/status tests, CodeGraph self-repo retrieval
  smoke, and conditional `ab-new-vs-baseline.sh` only if shared retrieval
  behavior changes.
- Include a task that resolves the PPX research gate before any PPX-related code.
- Include negative tasks/tests proving ambiguous module/package candidates emit
  no edge and no package nodes or external package edges are produced.

Non-goals to enforce:
- Do not implement OCaml LSP precision.
- Do not implement PPX expansion unless Plan/Analyze records a split or roadmap
  update.
- Do not add typechecker-grade semantics.
- Do not modify unrelated language extractors or resolver behavior.

Reference `spec.md`, `plan.md`, and
`docs/ai/specs/.process/SPEC-023-design-concept.md`.
```

### Tasks Results

| Metric | Value |
|--------|-------|
| Total Tasks | 74 |
| Phases | 7 |
| Parallel Opportunities | 22 |
| User Stories Covered | US1, US2, US3, US4 |

---

## Atomicity Route

After Tasks and gate G5, run:

```text
bash speckit-pro/skills/speckit-autopilot/scripts/atomicity-route.sh specs/023-ocaml-language-support
```

Record the emitted decision here:

| Field | Value | Meaning |
|-------|-------|---------|
| Route | one-navigable-PR | Atomicity route allows one navigable PR while retaining split-ready task ordering |
| Releasable | true | Tasks preserve independently reviewable checkpoints and completion gates |
| Signals | change-shape:modify-heavy | Detector finding |
| Warnings | none | No release-safety warnings |

---

## Phase 6: Analyze

### Analyze Prompt

```text
$speckit-analyze

Analyze SPEC-023 artifacts for consistency:
- `specs/023-ocaml-language-support/spec.md`
- `specs/023-ocaml-language-support/plan.md`
- `specs/023-ocaml-language-support/tasks.md`
- `docs/ai/specs/.process/SPEC-023-design-concept.md`
- `docs/ai/specs/intelligence-platform-technical-roadmap.md`

Focus on:
- Drift between the roadmap's original out-of-scope PPX line and the Grill Me
  research-gate decision.
- Whether broad syntax and deep package modeling remain deterministic and
  reviewable.
- Whether package metadata remains limited to checked-in `dune-project`, `dune`
  stanzas, and root or `opam/` `*.opam`, with no package nodes or external
  package edges.
- Whether tasks preserve the full eval bar instead of silently weakening it.
- Whether Yojson, OCaml-LSP, and Dune smoke/probe tasks preserve the pinned
  validation bar, with Yojson and OCaml-LSP A/B in the first PR and any Dune A/B
  split explicitly gated.
- Whether existing-language controls are present and whether conditional
  `ab-new-vs-baseline.sh` is required by any shared retrieval changes.
- Whether unsupported or ambiguous OCaml features fail closed.
- Whether build/copy-assets/status/docs/UAT are covered.
- Whether existing language and retrieval behavior have control checks.

Flag as CRITICAL if PPX expansion, package graph modeling, external package
edges, package nodes, or eval requirements enter implementation without a
recorded split/roadmap decision.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| A1 | High | The `.ml`/`.mli` grammar contract required one public OCaml language with two WASM grammars, but plan/tasks did not explicitly cover the internal extension-aware parser path or `src/types.ts` language registry. | Updated `spec.md`, `plan.md`, and `tasks.md` to require public `ocaml` reporting, `.ml` implementation grammar selection, `.mli` interface grammar selection, and `src/types.ts` registry coverage without introducing a public `ocaml_interface` language. |
| A2 | Medium | Build/status tasks over-specified implementation files: `copy-assets` already wildcard-copies WASM files, and status output derives from `filesByLanguage` rather than a hardcoded OCaml list in `src/bin/codegraph.ts`. | Updated T016/T017 in `tasks.md` to verify the existing wildcard copy path and internal parser/status behavior instead of forcing unnecessary `package.json` or `src/bin/codegraph.ts` edits. |
| A3 | Medium | Domain checklist files were still unchecked despite the workflow recording Phase 4 completion with zero gaps; one checklist also referenced nonexistent `Quickstart §8`. | Marked the validated domain checklist items complete and corrected the stale quickstart reference to `Quickstart §Completion Gate`. |

---

## Phase 6.5: Confidence Gate

Run after Analyze and before Implement. Confidence mode resolved at autopilot
startup.

| Confidence Gate | G6.5 | Status | Notes |
|-----------------|------|--------|-------|
| Confidence Gate | G6.5 | Soft Skipped | Advisory mode returned `NO_DATA` because no synthesizer confidence emit was present; recommended action was `soft_skip`. |

---

## Phase 7: Implement

### Implement Prompt

```text
$speckit-implement

Implement SPEC-023 tasks with TDD-first discipline.

1. Start from `tasks.md`; do not code PPX expansion unless Plan/Analyze recorded
   an approved split or roadmap update.
2. Add OCaml fixtures and failing tests for the approved syntax/resolution
   surface before implementing each slice.
3. Wire `tree-sitter-ocaml.wasm` and `tree-sitter-ocaml_interface.wasm`
   through the grammar pipeline and `copy-assets`.
4. Add `src/extraction/languages/ocaml.ts` following existing extractor style.
5. Add conservative resolver support for approved module/dune/package cases,
   failing closed on ambiguity.
   Do not add package nodes, external package edges, or PPX-expanded symbols.
6. Add docs/status updates and verify `codegraph status` lists OCaml.
7. Run targeted tests, then `npm run build`, `npm run typecheck`, and `npm test`
   before review claims.
8. Record fixture results, real OCaml repo smoke, agent-eval proof or approved
   split evidence, and self-repo UAT. The first PR must include deterministic
   probes for all nine pinned retrieval questions and headless A/B for Yojson
   and OCaml-LSP unless an explicit gate records a blocker.

Every changed line must trace to SPEC-023 tasks. Do not refactor unrelated
languages, resolver paths, MCP tools, or installer code.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| Grammar/status | Complete | T001-T018, T057 | OCaml implementation/interface WASMs vendored; public `ocaml` status path verified; build copies both artifacts. |
| Broad extraction | Complete | T019-T029, T062-T066 | Fixtures and tests cover modules, signatures, functors, classes/objects, labels, records, variants, GADTs, polymorphic variants, and PPX parse-preservation boundaries. |
| Resolution/packages | Complete | T030-T043, T061 | Conservative OCaml unique-only resolution is implemented for local module/interface/dune cases; ambiguous package and external package cases fail closed. |
| PPX gate | Complete | T005, T036, T062-T066, T074 | PPX expansion remains out of scope; attributes/extensions are parsed and documented without generated graph edges. |
| Validation/eval | Complete with follow-up gate | T044-T061 | Real-repo smoke/probes are complete for Yojson, OCaml-LSP, and Dune; Yojson and OCaml-LSP A/B are complete with weak/partial adoption; existing-language local-only current-vs-baseline control passed; Dune A/B remains an explicit T056 follow-up gate. |
| Docs/UAT | Complete for current branch evidence | T067-T074 | README, changelog, grammar docs, validation index, self-repo smoke, PR packet, marker scan, quickstart evidence, and final reviewability/backstop evidence are recorded. |

---

## Post-Implementation Checklist

- [x] `spec.md`, `plan.md`, `tasks.md`, and supporting artifacts are complete.
- [x] PPX route is resolved before PPX-related implementation.
- [x] Both OCaml grammar artifacts are copied into `dist/` by `npm run build`.
- [x] Extraction/resolution fixtures pass.
- [x] `codegraph status` reports OCaml language support.
- [x] Real OCaml repo smoke evidence is recorded.
- [x] Deterministic probes are recorded for all nine pinned retrieval questions.
- [x] Yojson and OCaml-LSP headless A/B proof is recorded; any Dune A/B split has an explicit follow-up gate.
- [x] Existing language/control tests remain green.
- [x] `npm run build`, `npm run typecheck`, and `npm test` are recorded.
- [x] UAT runbook includes the required self-repo step.
- [x] CHANGELOG `## [Unreleased]` entry is user-facing and avoids internals.
- [x] PR packet records scope budget, review order, non-goals, verification,
  known gaps, and rollback notes.

### Canonical Post Items

| Post | Status | Notes |
|------|--------|-------|
| Post: Doctor Extension Check | Skipped | Doctor extension is not installed. |
| Post: Verify Implementation | Complete | Read-only verify gate found 0 findings; task completion and FR/SC coverage are recorded in `autopilot-state.json`. |
| Post: Verify Tasks Phantom Check | Complete | `verify-tasks-report.md` records 74 verified tasks, 0 partial, 0 weak, 0 not found, and 0 skipped. |
| Post: Code Review | Complete | Parent-session fallback review completed after RepoPrompt agent transport closed twice; no new actionable code defects found. |
| Post: Integration Suite | Complete | `npm run build`, `npm run typecheck`, and `npm test` passed; full evidence is in `.process/emission/full-verification-evidence.md`. |
| Post: Self-Review | Complete | Four-question self-review is recorded in `.process/self-review.md`. |
| Post: UAT Runbook Generation | Complete | `.process/uat-runbook.md` generated, authored, and validated with `validate-uat-runbook.sh`. |
| Post: Reviewability Diff Gate | Complete with exception | Final backstop wrote `.process/final-reviewability/gate-state.json` and accepted the infra reviewability exception in `implementation-slices.md`; no PR side-effect blocker remains. |
| Post: PR Body Generation | Complete | Generated and validated the single-PR packet/body; `validate-pr-packet.sh` passed and workflow contract validation passed for `feat(speckit-pro): Add OCaml language support`. |
| Post: PR Creation | Complete | Opened PR #21: https://github.com/racecraft-lab/codegraph/pull/21. The branch was merged with current `origin/main`, pushed, and GitHub now reports `mergeable=MERGEABLE`. |
| Post: Review Remediation | Complete | Initial PR review check found 0 comments and 0 reviews; all GitHub checks passed after the mergeability fix. |
| Post: Retrospective | Complete | `retrospective.md` saved with no proposed `spec.md` edits. |

## Project Structure Reference

```text
docs/ai/specs/.process/SPEC-023-design-concept.md
docs/ai/specs/.process/SPEC-023-workflow.md
specs/023-ocaml-language-support/
specs/023-ocaml-language-support/SPEC-MOC.md
src/extraction/wasm/tree-sitter-ocaml.wasm
src/extraction/wasm/tree-sitter-ocaml_interface.wasm
src/extraction/languages/ocaml.ts
docs/grammars/tree-sitter-ocaml.md
__tests__/fixtures/ocaml/
```

Template based on the shared speckit-pro workflow template and populated from
the SPEC-023 roadmap entry plus the Grill Me design concept.
