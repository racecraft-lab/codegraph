# Completed Plans — Summary Records

## SPEC-001 — Embedding Infrastructure & Endpoint Provider (archived 2026-07-05)

Plan shape that shipped: new `src/embeddings/` module behind env-var opt-in
(Principle III fork discipline); `node_vectors` table with NO foreign key (vectors
survive node delete/re-insert; cleanup via anti-join reconciliation); dims/model as
project_metadata scalars; batch 16 / concurrency 4 / timeout 30s defaults; full
error replacement with endpoint redaction; advisory embedding pass in indexAll +
sync. Slice A (US1 full-index) then Slice B (US2+US3 freshness/healing) — the
stacked-PR route reconciled a size-block with the hard-atomic v8 schema pin.
Full plan recoverable: `git show c16d53f:specs/001-embedding-infrastructure/plan.md`.
