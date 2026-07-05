# UAT Runbook: 023-ocaml-language-support

| Field | Value |
|-------|-------|
| Spec | 023-ocaml-language-support |
| Branch | 023-ocaml-language-support |
| PR | Pending until PR is opened |
| Generated from | 2026-07-05T20:24:36Z |



## Env Setup

Run these from the repository root before walking the acceptance tests.

- Build the project with `npm run build`.
- Typecheck the project with `npm run typecheck`.
- Run the full suite with `npm test`.
- For targeted reruns, use `npx vitest run <test-file>`.
- This project has no configured lint or integration-test command for this
  runbook.

## Per-Story Acceptance Tests

### User Story 1 - Index OCaml repositories (Priority: P1)

- [ ] Run `npm run build` and confirm both OCaml WASMs exist under
  `dist/extraction/wasm/`.
- [ ] Run `npx vitest run __tests__/ocaml-parser-health.test.ts
  __tests__/ocaml-status.test.ts __tests__/ocaml-extraction.test.ts` and
  confirm `.ml` and `.mli` files parse and report as public language `ocaml`.
- [ ] Inspect `specs/023-ocaml-language-support/validation/extraction.md` and
  confirm broad syntax fixture coverage is recorded.

### User Story 2 - Explore OCaml structure (Priority: P2)

- [ ] Run `npx vitest run __tests__/ocaml-resolution.test.ts` and confirm
  module paths, functors, opens/includes, interface pairs, and Dune/opam
  metadata resolve only when unique.
- [ ] Inspect `specs/023-ocaml-language-support/validation/resolution.md` and
  confirm positive and negative edge evidence is recorded.
- [ ] Confirm no package nodes or external package edges are produced for the
  OCaml fixtures.

### User Story 3 - Review shippable evidence (Priority: P3)

- [ ] Review `validation/yojson-smoke.md`, `validation/ocaml-lsp-smoke.md`, and
  `validation/dune-smoke.md` for URL, commit, status, graph counts, stability,
  and probe outcomes.
- [ ] Review `validation/yojson-probes.md`, `validation/ocaml-lsp-probes.md`,
  and `validation/dune-probes.md` for the nine deterministic probe records.
- [ ] Review `validation/yojson-ab.md`, `validation/ocaml-lsp-ab.md`, and
  `validation/dune-ab-gate.md`; confirm Dune A/B remains a follow-up gate before
  SPEC-023 completion.

### User Story 4 - Bound PPX explicitly (Priority: P4)

- [ ] Run `npx vitest run __tests__/ocaml-ppx-policy.test.ts` and confirm PPX
  attributes/extension nodes do not create generated symbols or speculative
  relationships.
- [ ] Review `ppx-policy.md` and `validation/ppx-boundary.md` and confirm PPX
  expansion is documented as unsupported/future work.



## FR Coverage Matrix

| Story | Acceptance test |
|-------|-----------------|
| User Story 1 - Index OCaml repositories (Priority: P1) | Parser health, status, extraction tests, and copied WASM checks prove `.ml` and `.mli` indexing. |
| User Story 2 - Explore OCaml structure (Priority: P2) | Resolution tests and validation evidence prove conservative unique-only relationships and ambiguity no-edge behavior. |
| User Story 3 - Review shippable evidence (Priority: P3) | Smoke, probe, A/B, existing-language, quickstart, and PR packet records provide review evidence and name deferred gates. |
| User Story 4 - Bound PPX explicitly (Priority: P4) | PPX policy tests and validation evidence prove attributes/extension nodes are parse-preserved without generated graph output. |


## Negative-Path Tests


- Source files without matching interface files still produce useful implementation symbols.
- Interface files without matching source files still produce searchable public declarations.
- Nested modules, functor references/applications, local opens, includes, and shadowed names are represented conservatively when ownership is clear.
- Ambiguous module paths, package metadata, or generated PPX constructs do not create speculative edges.
- Pattern-heavy definitions, labeled arguments, optional arguments, and anonymous nested definitions keep source spans attached to the nearest useful owning symbol.
- Workspaces containing multiple local packages do not mix package relationships unless metadata provides a deterministic boundary.
- Unsupported advanced constructs remain visible enough for users to understand the limitation without corrupting graph structure.

## Self-Review Findings

- Scope matches SPEC-023: static OCaml language support only, with PPX
  expansion, package nodes, external package edges, typechecker-grade semantics,
  functor result elaboration, and OCaml LSP precision kept out of scope.
- Verification passed locally: `npm run build`, `npm run typecheck`, and
  `npm test` passed during the post Integration Suite.
- Task verification passed: 74 verified tasks, 0 partial, 0 weak, 0 not found,
  and 0 skipped.
- Remaining gates are explicit: Dune A/B must close before SPEC-023 completion,
  and final publication must respect the reviewability split/backstop evidence.

## Sign-off

Advisory only — these checkboxes block nothing.

- [ ] Reviewer walked every Per-Story Acceptance Test above.
- [ ] Reviewer confirmed the Negative-Path Tests behave as described.
- [ ] Reviewer is satisfied the PR delivers the behavior the spec promised.

## Rollback

git revert <SHA>; see plan.md for data-migration considerations
