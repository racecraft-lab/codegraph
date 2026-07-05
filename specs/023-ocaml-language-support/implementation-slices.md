# SPEC-023 Implementation Slices

## Route

SPEC-023 remains one cohesive feature, but implementation is reviewed in ordered
slices so no PR claims complete OCaml support before the validation gate closes.

| Slice | Status | Review boundary |
|-------|--------|-----------------|
| Grammar/status | Complete locally | OCaml WASMs vendored, parser health green, `.ml`/`.mli` both report `ocaml`, build copies both artifacts. |
| Broad extraction | Complete locally | Implicit file modules, source/interface declarations, broad syntax fixture coverage, stable containment/spans, PPX syntax ignored for expansion. |
| Conservative resolution | Complete locally | Unique-only local module paths, opens/includes, functor applications, interface-pair collapse, Dune/opam metadata discovery, ambiguity no-edge tests. |
| Validation/eval/docs | In progress | Local tests/build pass; real Yojson/OCaml-LSP/Dune smoke and deterministic probes are complete; Yojson A/B is complete with weak adoption; OCaml-LSP A/B is complete with adjusted safer evidence; Dune and existing-language A/B remain gated. |

## Reviewability Budget

- Primary production surface: OCaml grammar/extractor/resolver wiring.
- Production files touched/added: `src/types.ts`, `src/extraction/grammars.ts`,
  `src/extraction/tree-sitter.ts`, `src/extraction/languages/index.ts`,
  `src/extraction/languages/ocaml.ts`, `src/resolution/import-resolver.ts`,
  `src/resolution/index.ts`, `src/resolution/ocaml-workspace.ts`,
  `src/resolution/ocaml-resolver.ts`, plus two vendored WASMs.
- Test/validation surface: focused OCaml parser, status, extraction,
  resolution, and PPX tests plus fixtures and validation records.
- Split result: local implementation slices are complete, but SPEC-023 is not
  complete until real-repository smoke/probe/A/B evidence is recorded or an
  explicit maintainer-approved follow-up gate is created.
- Reviewability gate command:
  `/Users/fredrickgabelmann/.codex/plugins/cache/racecraft-plugins-public/speckit-pro/2.17.0/skills/speckit-autopilot/scripts/reviewability-gate.sh diff origin/main...HEAD`
- Reviewability gate result: pass with warnings, `status=warn`,
  `reviewable_loc=0`, `production_files=0`, `total_files=20`,
  `primary_surface_count=4`; warnings were `total files 20 exceeds warn
  threshold 15` and `primary surfaces 4 exceeds warn threshold 1`.
- Coverage limitation: diff-mode reviewability only sees committed files in the
  supplied git range. The current implementation files are still uncommitted, so
  final reviewability must be rerun after staging/committing or through the final
  reviewability backstop before PR creation.

## Atomicity Output

- Releasable slice: grammar/status plus extraction/resolution is code-complete
  and locally verified.
- Not yet complete support claim: Dune A/B remains gated, and the
  existing-language A/B control is blocked by safe-runner constraints.
- Rollback path: remove the public `ocaml` language entry, `.ml`/`.mli`
  extension mapping, OCaml extractor registration, OCaml resolver branch, tests,
  fixtures, docs, and the two vendored WASM files.
