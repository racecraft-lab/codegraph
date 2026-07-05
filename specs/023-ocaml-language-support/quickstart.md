# Quickstart: SPEC-023 Validation

This guide lists the runnable validation path for OCaml language support. It is a verification guide, not an implementation recipe.

## Prerequisites

- Use a supported Node runtime. From-source development needs Node 22.5+ because `node:sqlite` is the only database backend.
- Install project dependencies in the worktree.
- Keep real-repository smoke clones outside committed source, for example under `/tmp` or another ignored scratch directory.

## 1. Build and Static Verification

```bash
npm run build
npm run typecheck
npm test
```

Expected outcome:

- TypeScript builds successfully.
- `dist/extraction/wasm/tree-sitter-ocaml.wasm` exists.
- `dist/extraction/wasm/tree-sitter-ocaml_interface.wasm` exists.
- Unit tests pass without existing-language regressions.

## 2. Parser Health

Run targeted parser health tests for representative `.ml` and `.mli` samples.

Expected outcome:

- Both OCaml WASM artifacts load through the existing tree-sitter WASM runtime.
- Representative `.ml` and `.mli` samples parse without fatal parser initialization errors.
- Valid interface samples do not produce the known older-artifact ERROR tree failure.

## 3. Fixture Coverage

Run the targeted OCaml extraction, resolution, and status tests.

Expected fixture coverage:

- `.ml` and `.mli` file recognition.
- OCaml language/status listing.
- Modules, signatures, functors, type aliases, records, variants, GADTs, polymorphic variants, values, functions, let-bindings, classes, objects, methods, fields, labeled and optional arguments, local modules, first-class modules, attributes, extension nodes, and pattern-heavy definitions.
- Same-directory, same-basename `.ml`/`.mli` pairing when unique.
- Dune-scoped module path, `open`, and `include` resolution when unique.
- Negative cases for ambiguous modules, ambiguous source/interface pairs, unsupported package relationships, and PPX-expanded symbols.

Expected outcome:

- Required symbols have stable names, node kinds, spans, and containment.
- Deterministic local relationships appear only when exactly one candidate survives.
- No package nodes or external package edges are produced.

## 4. Real-Repository Smoke

For each pinned corpus, record:

- Repository URL.
- Commit SHA.
- Index command.
- `filesByLanguage`.
- Node count.
- Edge count.
- Parse warnings/errors.
- Second-run stability.
- Retrieval probe outcome.

Pinned corpora:

| Corpus | Repository | Size |
|--------|------------|------|
| Yojson | `ocaml-community/yojson` | Small |
| OCaml-LSP | `ocaml/ocaml-lsp` | Medium |
| Dune | `ocaml/dune` | Large |

Expected outcome:

- Each repository indexes without fatal errors.
- OCaml appears in language/status output.
- Repeated indexing has stable graph counts or an explained deterministic variance.
- Unsupported PPX/package cases do not produce speculative edges.

## 5. Deterministic Retrieval Probes

Run `probe-explore` and `probe-node` for all nine pinned questions.

Yojson:

- Trace the `from_string` parse path.
- Trace the `to_string` or pretty-print write path.
- Show `.ml`/`.mli` public exposure for Safe, Common, and Util.

OCaml-LSP:

- Trace `textDocument/hover`.
- Trace `textDocument/completion`.
- Trace Dune RPC diagnostics after build.

Dune:

- Trace `dune build` stanza-to-rule flow.
- Trace `dune-project`/opam package metadata handling.
- Trace rule execution through scheduler/actions.

Expected outcome:

- Each question returns useful graph-backed context within the repository-size explore budget.
- Known gaps are recorded explicitly instead of weakened into a pass.

## 6. Headless A/B Evidence

Run headless A/B evidence for:

- Yojson.
- OCaml-LSP.

Dune A/B may defer only with an explicit follow-up gate before SPEC-023 is complete.

Expected outcome:

- A/B records include the command, model/effort settings, run count per arm, duration range, Read/Grep counts, CodeGraph call counts, and interpretation.
- Results show OCaml support improves or preserves retrieval behavior without creating speculative graph output.

## 7. Existing-Language Controls

Required controls:

```bash
npm run build
npm run typecheck
npm test
```

Also run:

- Targeted extraction/resolution/status tests affected by shared wiring.
- CodeGraph self-repo retrieval smoke.
- `scripts/agent-eval/ab-new-vs-baseline.sh` on an existing-language control only if shared MCP, explore-budget, resolver, or retrieval behavior changes.

Expected outcome:

- Existing supported languages and status output remain green.
- Any shared retrieval change has control evidence.

## Completion Gate

SPEC-023 is complete only when:

- Grammar artifacts are vendored, health-checked, and copied by build.
- Fixture, smoke, deterministic probe, and required A/B evidence are recorded.
- PPX is documented as unsupported/future work.
- Ambiguous module/package/PPX cases fail closed.
- No package nodes or external package edges are produced.
- Existing-language controls remain green.
