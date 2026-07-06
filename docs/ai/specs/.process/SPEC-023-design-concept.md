# Design Concept: SPEC-023 - OCaml Language Support

**Created**: 2026-07-05
**Source**: Grill Me interview during `$speckit-scaffold-spec SPEC-023`
**Branch**: `023-ocaml-language-support`
**Roadmap**: `docs/ai/specs/intelligence-platform-technical-roadmap.md`

## Summary

SPEC-023 brings OCaml into CodeGraph's supported-language matrix at the same
bar as existing languages: grammar wiring, deterministic extraction,
conservative resolution, fixtures, docs, status visibility, and retrieval
validation. The desired scope is broader than the roadmap's minimum language
entry and must be controlled by reviewability gates.

The roadmap currently lists PPX expansion as out of scope. The interview
captured PPX as an important pressure point, but the final decision is a
research gate: planning and analysis must decide whether PPX remains future work,
is documented as unsupported, or requires a split/roadmap update before coding.

## Goals

- Add OCaml support through the standard tree-sitter WASM grammar pipeline and
  `copy-assets` shipping path.
- Extract broad OCaml syntax, including modules, functors, signatures,
  structures, type aliases, records, variants, let-bindings, functions,
  labeled/optional arguments, classes, objects, pattern-heavy constructs,
  `open`/`include`, and `.mli` interfaces.
- Resolve OCaml module paths conservatively across `.ml`/`.mli` pairs, local
  opens/includes, dune workspace structure, and package-level dependencies where
  the metadata is available.
- Validate beyond synthetic fixtures: require real OCaml project smoke coverage
  and agent-eval style retrieval proof unless planning records a reviewability
  split or a concrete blocker.
- Keep graph structure deterministic and LLM-free, with no speculative edges.

## Non-Goals

- Do not add OCaml LSP precision in this spec; `ocamllsp` belongs to the later
  SPEC-008 path.
- Do not implement typechecker-grade semantics, exhaustiveness analysis, module
  elaboration, or formatter integration.
- Do not silently include PPX expansion in the first coding pass. PPX requires a
  planning research gate and may need a separate slice or roadmap update.
- Do not import non-permissive grammar code or add native runtime dependencies.
- Do not expand unrelated language extraction or resolver behavior.

## Grill Me Q&A Log

### Q1. MVP extraction coverage

**Question:** For SPEC-023, what should the MVP extraction coverage include?

**Answer:** Broader syntax.

**Decision:** MVP should go beyond basic functions/modules. The spec should ask
for broad OCaml extraction coverage: modules, functors, types, records, variants,
let-bindings, open/include, `.mli` interfaces, plus advanced-but-common syntax
such as labeled/optional arguments, classes/objects, and pattern-heavy
definitions. Planning must still keep this reviewable by splitting tasks if the
surface grows.

### Q2. Resolution depth

**Question:** How deep should the first OCaml resolution pass go?

**Answer:** Deep packages.

**Decision:** Resolution should include module paths, open/include scoping,
`.ml`/`.mli` pairing, dune workspace roots, and package-level metadata when it
can be modeled deterministically. The resolver must fail closed: unresolved or
ambiguous package relationships should be reported as missing precision, not
turned into speculative edges.

### Q3. Grammar acquisition

**Question:** What grammar acquisition strategy should the scaffold assume?

**Answer:** Existing pipeline.

**Decision:** Use CodeGraph's standard tree-sitter WASM grammar pipeline. Vendor
the OCaml grammar artifact, wire it into `copy-assets`, and document the grammar
source/version/license in the implementation artifacts.

### Q4. Validation bar

**Question:** What validation bar should SPEC-023 require before PR?

**Answer:** Full eval.

**Decision:** The workflow should require focused fixtures, build/test
verification, language status visibility, at least one real OCaml project smoke,
and agent-eval style retrieval proof on multiple OCaml repos. If this exceeds
the reviewable slice, tasks must split validation into ordered, reviewable
pieces instead of weakening the final bar.

### Q5. Boundaries

**Question:** Which boundaries should the workflow enforce as out of scope?

**Answer:** Include PPX.

**Decision:** PPX matters enough to be considered explicitly, but it conflicts
with the current roadmap's out-of-scope line. Do not treat this answer as
permission to start coding PPX immediately; combine it with Q7's final route.

### Q6. Reviewability shape

**Question:** Given the broader scope choices, how should the scaffold route
reviewability?

**Answer:** Plan split.

**Decision:** Scaffold one SPEC-023 workflow, but require tasks to split grammar
wiring, extraction breadth, resolution/package modeling, PPX handling, and eval
proof into reviewable slices if gates warn or block. A single PR is allowed only
if the tasks and reviewability gates prove it stays within budget.

### Q7. Roadmap override

**Question:** Should the scaffold override the roadmap's current "PPX expansion
out of scope" line?

**Answer:** Research gate.

**Decision:** Keep the implementation bounded until Plan/Analyze resolves PPX.
The workflow must require a PPX research gate that either records PPX as
unsupported/future work, proposes a separate slice or child spec, or updates the
roadmap before implementation. This preserves the roadmap as source of truth
while still capturing the user's intent.

## Open Questions for Clarify

1. Which exact `tree-sitter-ocaml` source/version/commit and license evidence
   should be pinned for the vendored WASM artifact?
2. Which advanced constructs are mandatory in the first implementation slice:
   classes/objects, labeled/optional arguments, local modules, first-class
   modules, GADTs, polymorphic variants, attributes, or extension nodes?
3. What is the deterministic boundary for package-level resolution: dune
   workspace only, opam metadata, lockfiles, or installed package directories?
4. What is the PPX outcome: unsupported with clear status, research-only note,
   separate slice, or roadmap update?
5. Which real OCaml repositories should be used for smoke and agent-eval proof,
   and what are the three canonical questions for each?
6. If the full eval bar is too large for the first PR, which validation evidence
   must land before merge and which evidence can be required by follow-up tasks?

## Architecture Notes

- New grammar artifact: `src/extraction/wasm/tree-sitter-ocaml.wasm`.
- New extractor: `src/extraction/languages/ocaml.ts`.
- Minimal resolver changes: module-path handling, open/include scoping, `.ml`
  and `.mli` pairing, and dune/package metadata awareness.
- Tests should follow the existing language-support conventions and use real
  files with no DB mocking.
- `codegraph status` must list OCaml once the grammar is wired and shippable.
- Build verification must prove the new WASM artifact is copied into `dist/`.

## Reviewability Notes

The setup gate returned `pass: true` with 325 reviewable LOC, 4 production files,
10 total files, and a warning that the roadmap prose names six primary surfaces.
The warning is accepted for scaffold only. Plan and Tasks must re-check whether
the broadened Grill Me scope still fits a single reviewable PR.

## Capability Path

Need: scaffold SPEC-023 for autopilot.
Selected capabilities: local repo files via shell/rg/git, native picker via
`request_user_input`, repo-local SpecKit helper scripts, and manual file edits in
the dedicated worktree.
Evidence: roadmap section `docs/ai/specs/intelligence-platform-technical-roadmap.md`
SPEC-023, setup gate JSON, Grill Me picker answers in this session.
Confidence: high for repository state and captured decisions because each fact
comes from invoked local tools or picker answers.
