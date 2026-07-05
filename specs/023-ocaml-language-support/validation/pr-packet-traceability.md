# SPEC-023 PR Packet Traceability

## Review Order

1. Grammar assets and public language/status wiring.
2. OCaml extractor and fixture expectations.
3. OCaml Dune-scoped unique-only resolver.
4. PPX, safety/license, and validation evidence.
5. User-facing docs and changelog.

## Non-Goals

- No OCaml LSP precision.
- No PPX expansion.
- No functor result elaboration.
- No typechecker-grade semantics.
- No package nodes.
- No external package edges.
- No installed switch or network package state.

## Traceability

| Requirement | Files/evidence |
|-------------|----------------|
| FR-001, FR-002, FR-010 | `src/types.ts`, `src/extraction/grammars.ts`, `src/extraction/tree-sitter.ts`, `src/extraction/wasm/tree-sitter-ocaml*.wasm`, `__tests__/ocaml-parser-health.test.ts`, `__tests__/ocaml-status.test.ts`, `validation/grammar-status.md` |
| FR-003, FR-004, FR-005, FR-011 | `src/extraction/languages/ocaml.ts`, `src/extraction/languages/index.ts`, `__tests__/fixtures/ocaml/broad-syntax/`, `__tests__/ocaml-extraction.test.ts`, `validation/extraction.md` |
| FR-006, FR-007, FR-008, FR-009 | `src/resolution/ocaml-workspace.ts`, `src/resolution/ocaml-resolver.ts`, `src/resolution/import-resolver.ts`, `src/resolution/index.ts`, `__tests__/ocaml-resolution.test.ts`, `validation/resolution.md` |
| FR-014 | `specs/023-ocaml-language-support/ppx-policy.md`, `__tests__/ocaml-ppx-policy.test.ts`, `validation/ppx-boundary.md` |
| FR-015, FR-016 | `validation/existing-language-controls.md`, `validation/existing-language-ab-gate.md`; local controls are recorded, existing-language A/B remains gated |
| FR-012, FR-013 | `validation/yojson-smoke.md`, `validation/yojson-probes.md`, `validation/yojson-ab.md`, `validation/ocaml-lsp-smoke.md`, `validation/ocaml-lsp-probes.md`, `validation/ocaml-lsp-ab.md`, `validation/dune-smoke.md`, `validation/dune-probes.md`, `validation/dune-ab-gate.md` |
| FR-017 | `implementation-slices.md` |

## Verification Evidence

- Build/typecheck: passed.
- Targeted OCaml parser/status/extraction/resolution/PPX suite: passed.
- Full `npm test`: one daemon idle-timeout failure on Node 26; targeted daemon
  idle-timeout rerun passed.
- Yojson, OCaml-LSP, and Dune real-repo smoke/probes: complete.
- Yojson A/B: complete, weak-adoption signal.
- OCaml-LSP A/B: complete with one exact run and one adjusted safer run; weak
  adoption signal.
- Marker scan: 0 clarification, gap, critical, high, medium, or low markers.

## Scope Budget and Reviewability

- Current changed-file count before final staging: 62 paths.
- Reviewability gate against committed `origin/main...HEAD`: pass with warnings,
  `status=warn`, `total_files=20`, `primary_surface_count=4`.
- Limitation: the committed-range gate does not include uncommitted implementation
  files. Final PR preparation must rerun reviewability after the implementation
  is committed or through the final backstop.

## Unrelated-Scope Check

- No unrelated language extractor files were modified.
- Shared files touched are limited to the registry/wiring needed for OCaml:
  `src/types.ts`, `src/extraction/grammars.ts`,
  `src/extraction/tree-sitter.ts`, `src/extraction/languages/index.ts`,
  `src/resolution/import-resolver.ts`, and `src/resolution/index.ts`.
- New resolver/extractor files are OCaml-specific.

## Known Gaps

- Dune A/B remains a required follow-up gate before SPEC-023 completion.
- Existing-language A/B remains open until a safe repo-confined runner exists or
  the maintainer explicitly approves another unsandboxed eval.
- SPEC-023 must not be described as complete until these validation gates close
  or the maintainer approves replacement acceptance gates.

## Rollback Notes

Rollback is source-local: remove the public `ocaml` language entry, `.ml` and
`.mli` extension mapping, OCaml grammar metadata, parser file-path selection,
OCaml extractor registration, OCaml resolver/import branch, OCaml workspace
helpers, OCaml tests/fixtures, OCaml docs/evidence, and the two vendored OCaml
WASM files.
