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
