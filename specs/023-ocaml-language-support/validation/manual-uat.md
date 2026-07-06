# SPEC-023 Manual UAT Evidence

Status: passed for the PR #21 runbook, with the existing Dune A/B follow-up gate
preserved.

Executed: 2026-07-06T15:48:23Z

## Scope

This manual UAT pass walked
`specs/023-ocaml-language-support/.process/uat-runbook.md` against PR #21:
https://github.com/racecraft-lab/codegraph/pull/21

The runbook requires local verification, focused OCaml checks, artifact review,
negative-path review, and confirmation that Dune A/B remains a follow-up gate
before SPEC-023 is called complete. It does not require rerunning Dune A/B as
part of manual UAT.

## Commands Run

```bash
npm run build
npm run typecheck
npm test
npx vitest run __tests__/ocaml-parser-health.test.ts __tests__/ocaml-status.test.ts __tests__/ocaml-extraction.test.ts
npx vitest run __tests__/ocaml-resolution.test.ts
npx vitest run __tests__/ocaml-ppx-policy.test.ts
```

## Results

- `npm run build`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 137 files, 2239 tests passed, 4 skipped.
- OCaml parser/status/extraction focused suite: passed, 3 files, 10 tests.
- OCaml resolution suite: passed, 1 file, 5 tests.
- OCaml PPX policy suite: passed, 1 file, 1 test.
- `dist/extraction/wasm/tree-sitter-ocaml.wasm` exists.
- `dist/extraction/wasm/tree-sitter-ocaml_interface.wasm` exists.

## Artifact Review

- `validation/extraction.md`: broad `.ml` and `.mli` fixture coverage is
  recorded, including modules, functors, module types, records, variants,
  GADTs, classes, local modules, first-class modules, and conservative
  unresolved references for resolution.
- `validation/resolution.md`: positive and negative relationship evidence is
  recorded, including unique interface pairing, functor/module references,
  local opens, Dune/opam metadata discovery, ambiguous no-edge behavior, no
  package nodes, and no external package edges.
- `validation/yojson-smoke.md`, `validation/ocaml-lsp-smoke.md`, and
  `validation/dune-smoke.md`: URL, commit, graph counts, second-run stability,
  and probe outcome summaries are recorded.
- `validation/yojson-probes.md`, `validation/ocaml-lsp-probes.md`, and
  `validation/dune-probes.md`: all nine deterministic probe records are
  present.
- `validation/yojson-ab.md`: complete, with weak adoption noted.
- `validation/ocaml-lsp-ab.md`: complete with adjusted safer evidence, with
  weak/partial adoption noted.
- `validation/dune-ab-gate.md`: Dune A/B remains a required follow-up gate
  before SPEC-023 completion.
- `ppx-policy.md` and `validation/ppx-boundary.md`: PPX expansion is explicitly
  unsupported/future work, and PPX syntax does not create generated symbols or
  speculative relationships.

## External Claude A/B Note

An attempted Dune A/B rerun through Claude was not accepted as valid evidence.
The sandboxed Claude invocation reached authentication/session setup only and
reported `Not logged in`, with zero CodeGraph tools exposed. The unsandboxed
authenticated Claude invocation was denied by the command approval reviewer
because it could transmit repository or local Claude state to an external
service. This manual UAT pass therefore preserves the already-recorded Dune A/B
follow-up gate instead of claiming Dune A/B completion.

## Sign-off

- Reviewer walked every per-story acceptance test in the UAT runbook.
- Reviewer confirmed the negative-path tests behave as described by the focused
  tests and validation evidence.
- Reviewer is satisfied PR #21 delivers the behavior claimed for this PR, with
  Dune A/B still explicitly blocked from being described as complete until the
  follow-up gate closes or replacement acceptance criteria are approved.
