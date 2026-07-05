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
