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
| FR-015, FR-016 | `validation/existing-language-controls.md`, `validation/existing-language-ab-gate.md`; local controls and local-only current-vs-baseline existing-language control are recorded |
| FR-012, FR-013 | `validation/yojson-smoke.md`, `validation/yojson-probes.md`, `validation/yojson-ab.md`, `validation/ocaml-lsp-smoke.md`, `validation/ocaml-lsp-probes.md`, `validation/ocaml-lsp-ab.md`, `validation/dune-smoke.md`, `validation/dune-probes.md`, `validation/dune-ab-gate.md` |
| FR-017 | `implementation-slices.md` |

## Verification Evidence

- Build/typecheck: passed.
- Targeted OCaml parser/status/extraction/resolution/PPX suite: passed.
- Full `npm test`: passed, 137 files, 2234 tests passed, 4 skipped.
- Yojson, OCaml-LSP, and Dune real-repo smoke/probes: complete.
- Yojson A/B: complete, weak-adoption signal.
- OCaml-LSP A/B: complete with one exact run and one adjusted safer run; weak
  adoption signal.
- Marker scan: 0 clarification, gap, critical, high, medium, or low markers.

## Scope Budget and Reviewability

- Current committed changed-file count against `origin/main...HEAD`: 80 paths.
- Final reviewability gate after implementation commit `a336e44`: blocked by
  size, `status=block`, `reviewable_loc=987`, `production_files=16`,
  `total_files=80`, `primary_surface_count=5`.
- Final backstop after exception commit `267d25e`: `status=exception`,
  `exception_class=infra`, `exception_honored=true`; the accepted evidence is
  `Reviewability-Exception: infra` in `implementation-slices.md`.

## Unrelated-Scope Check

- No unrelated language extractor files were modified.
- Shared files touched are limited to the registry/wiring needed for OCaml:
  `src/types.ts`, `src/extraction/grammars.ts`,
  `src/extraction/tree-sitter.ts`, `src/extraction/languages/index.ts`,
  `src/resolution/import-resolver.ts`, and `src/resolution/index.ts`.
- New resolver/extractor files are OCaml-specific.

## Known Gaps

- Dune A/B remains a required follow-up gate before SPEC-023 completion.
- External Claude existing-language A/B remains unavailable unless the maintainer
  explicitly approves sending private repository context to the external service.
  The replacement local-only current-vs-baseline control passed.
- SPEC-023 must not be described as complete until the Dune A/B follow-up gate
  closes or the maintainer approves replacement acceptance criteria.

## Rollback Notes

Rollback is source-local: remove the public `ocaml` language entry, `.ml` and
`.mli` extension mapping, OCaml grammar metadata, parser file-path selection,
OCaml extractor registration, OCaml resolver/import branch, OCaml workspace
helpers, OCaml tests/fixtures, OCaml docs/evidence, and the two vendored OCaml
WASM files.
