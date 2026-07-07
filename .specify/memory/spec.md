# Completed Specs — Summary Records

## SPEC-001 — Embedding Infrastructure & Endpoint Provider (archived 2026-07-05)

Every indexed declaration-kind symbol gets a persisted embedding vector through an
OpenAI-compatible endpoint (`CODEGRAPH_EMBEDDING_*` env config), incrementally
(`input_hash` change detection), resiliently (bounded retries, advisory pass never
fails index/sync), and fully dormant when unconfigured. 31 FRs, 11 SCs, delivered
as stacked PRs #16 + #17 (schema v7→v8). Canonical code: `src/embeddings/`,
`src/db/` v8 additions. Detailed provenance + recovery:
[archive-reports/2026-07-05-SPEC-001.md](archive-reports/2026-07-05-SPEC-001.md).
The active `specs/001-embedding-infrastructure/` folder was removed because all
artifacts are recoverable at merge commit `c16d53f` and the roadmap + workflow file
carry the durable status record.

## SPEC-004 - Web Framework Research Spike (archived 2026-07-05)

The self-hosted web stack decision shipped in PR #19. Vite + React SPA is the
recommended production app stack; Cytoscape.js proved the throwaway graph-rendering
path, with Sigma.js retained as the SPEC-006 WebGL runner-up. Canonical artifacts:
`docs/design/web-framework-decision.md` and PNG evidence under
`docs/design/assets/spec-004/`. Detailed provenance + recovery:
[archive-reports/2026-07-05-SPEC-004.md](archive-reports/2026-07-05-SPEC-004.md).
The active `specs/004-web-framework-research-spike/` folder was removed because
the decision doc, screenshots, roadmap entry, and preserved workflow/process files
carry the durable record.

## SPEC-002 - Bundled Local Embedding Fallback (archived 2026-07-07)

The local embedding fallback shipped in PR #22. It added explicit opt-in local
embedding support through `src/embeddings/local-provider.ts`,
`src/embeddings/local-tokenizer.ts`, `src/embeddings/local-embed-worker.ts`, and
`src/embeddings/model-fetch.ts`, with CLI/library status integration and local
provider regression coverage. Detailed provenance + recovery:
[archive-reports/2026-07-07-SPEC-002.md](archive-reports/2026-07-07-SPEC-002.md).
The active `specs/002-local-embedding-fallback/` folder was removed because the
runtime code, tests, preserved workflow files, and archive report carry the
durable record.

## SPEC-008 - LSP Client Integration (archived 2026-07-07)

The LSP client integration shipped as stacked PRs #23 through #27. It added
default-off LSP discovery/configuration, JSON-RPC client lifecycle, compiler-backed
edge correction/provenance, graceful degradation, retrieval filtering, and parity
gates with zero unowned language or capability rows. Canonical artifacts live in
`src/lsp/`, `src/db/queries.ts`, `src/db/schema.sql`, `src/sync/`, `src/bin/codegraph.ts`,
the LSP-focused test suites, and the `scripts/spec-008-*.mjs` validation gates.
Detailed provenance + recovery:
[archive-reports/2026-07-07-SPEC-008.md](archive-reports/2026-07-07-SPEC-008.md).
The active `specs/008-lsp-client-integration/` folder was removed because all
implementation and validation evidence is preserved in shipped code, process
ledgers, and the archive report.

## SPEC-023 - OCaml Language Support (archived 2026-07-07)

OCaml language support shipped in PR #21. It added OCaml/interface tree-sitter
WASMs, `src/extraction/languages/ocaml.ts`, Dune-aware local resolution helpers,
fixture coverage, grammar docs, status listing support, and validation evidence.
Detailed provenance + recovery:
[archive-reports/2026-07-07-SPEC-023.md](archive-reports/2026-07-07-SPEC-023.md).
The active `specs/023-ocaml-language-support/` folder was removed because the
grammar/extractor/resolver/test artifacts and preserved workflow files carry the
durable record.
