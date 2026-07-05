# SPEC-023 Implementation Slices

## Route

SPEC-023 remains one cohesive feature, but implementation is reviewed in ordered
slices so no PR claims complete OCaml support before the validation gate closes.

| Slice | Status | Review boundary |
|-------|--------|-----------------|
| Grammar/status | Complete locally | OCaml WASMs vendored, parser health green, `.ml`/`.mli` both report `ocaml`, build copies both artifacts. |
| Broad extraction | Complete locally | Implicit file modules, source/interface declarations, broad syntax fixture coverage, stable containment/spans, PPX syntax ignored for expansion. |
| Conservative resolution | Complete locally | Unique-only local module paths, opens/includes, functor applications, interface-pair collapse, Dune/opam metadata discovery, ambiguity no-edge tests. |
| Validation/eval/docs | Complete for current branch evidence | Local tests/build pass; real Yojson/OCaml-LSP/Dune smoke and deterministic probes are complete; Yojson A/B is complete with weak adoption; OCaml-LSP A/B is complete with adjusted safer evidence; Dune A/B has an explicit follow-up gate; existing-language control passed with a local-only current-vs-baseline replacement. |

## Reviewability Budget

Reviewability-Exception: infra

Operator authorization: on 2026-07-05 the maintainer instructed autopilot to do
whatever it takes to close SPEC-023 out. This exception is limited to the
infrastructure-sized OCaml language-support branch after the final backstop
proved the only remaining blocker is PR size, not correctness.

- Primary production surface: OCaml grammar/extractor/resolver wiring.
- Production files touched/added: `src/types.ts`, `src/extraction/grammars.ts`,
  `src/extraction/tree-sitter.ts`, `src/extraction/languages/index.ts`,
  `src/extraction/languages/ocaml.ts`, `src/resolution/import-resolver.ts`,
  `src/resolution/index.ts`, `src/resolution/ocaml-workspace.ts`,
  `src/resolution/ocaml-resolver.ts`, plus two vendored WASMs.
- Test/validation surface: focused OCaml parser, status, extraction,
  resolution, and PPX tests plus fixtures and validation records.
- Split result: local implementation slices and required smoke/probe/A/B/control
  evidence are recorded. Dune A/B remains an explicit follow-up gate.
- Reviewability gate command:
  `/Users/fredrickgabelmann/.codex/plugins/cache/racecraft-plugins-public/speckit-pro/2.17.0/skills/speckit-autopilot/scripts/reviewability-gate.sh diff origin/main...HEAD`
- Reviewability gate result after implementation commit `a336e44`: blocked,
  `status=block`, `reviewable_loc=987`, `production_files=16`,
  `total_files=80`, `primary_surface_count=5`.
- Blockers: `reviewable LOC 987 exceeds block threshold 800`,
  `production files 16 exceeds block threshold 8`, and `total files 80 exceeds
  block threshold 25`.
- Final backstop artifacts:
  - `specs/023-ocaml-language-support/.process/final-reviewability/gate-state.json`
  - `specs/023-ocaml-language-support/.process/final-reviewability/changed-files.txt`
- Final backstop result after closeout commit `c5843db`: `status=exception`,
  `total_files=87`, `exception_class=infra`, `exception_honored=true`; no PR
  side-effect blocker remains.

## Atomicity Output

- Releasable slice: grammar/status plus extraction/resolution is code-complete
  and locally verified.
- Not yet complete support claim: Dune A/B remains gated by the explicit T056
  follow-up.
- Existing-language control: external Claude A/B was rejected because it would
  send private repository context to an external service; local-only
  current-vs-baseline parser-selection and TypeScript import-resolution probes
  passed for both current and `HEAD~1` builds.
- Rollback path: remove the public `ocaml` language entry, `.ml`/`.mli`
  extension mapping, OCaml extractor registration, OCaml resolver branch, tests,
  fixtures, docs, and the two vendored WASM files.
