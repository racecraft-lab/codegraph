---
name: embedding-pass
description: SPEC-001 runEmbeddingPass (src/embeddings/indexer-hook.ts) seam + behavior — the readSource hook, dims-enforcement precedence, checkpoint condition
metadata:
  type: project
---

`runEmbeddingPass(opts)` in `src/embeddings/indexer-hook.ts` is SPEC-001's full-index embed pass (task T016). It streams eligible symbols in `config.batchSize` chunks, composes→embeds→persists each chunk in ONE `transaction()` per batch, infers/enforces dims, and aborts advisorily — never throws.

**Why:** it is the orchestration entry the indexer (src/index.ts, a later task) wires post-resolution; the seam it exposes constrains that wiring, and several behaviors are non-obvious.

**How to apply — facts that will bite the caller-wiring task or SPEC-002/003:**
- **The caller MUST supply `readSource`.** `Node` carries NO source-text field, so the pass takes an optional `readSource?: (node) => string | undefined`; it composes source per-chunk (FR-028) via this hook. The pass is deliberately fs/path/root-free — the caller (which owns the project root, reads the file slice startLine..endLine) provides source. **Omit it and embeddings are composed from kind/name/signature/docstring only — no code body.** This is the easy thing to forget when wiring index.ts.
- **Seam = thunks, not a DatabaseConnection:** `{ queries: QueryBuilder, provider, config, transaction: <T>(fn)=>T, runMaintenance: ()=>void, onProgress?, refreshLock?, readSource? }`. Wire `transaction` → `DatabaseConnection.transaction`, `runMaintenance` → `DatabaseConnection.runMaintenance`.
- **Dims-enforcement precedence:** `config.dims` (CODEGRAPH_EMBEDDING_DIMS) enforces from the start; else a persisted `embedding_dims` scalar enforces ONLY if `embedding_model` matches the active model. A scalar from a DIFFERENT model does NOT enforce — the pass re-infers and overwrites both scalars (model changed, FR-010). Scalars persist once, on first-batch success (idempotent). A rejected pass leaves scalars untouched.
- **WAL checkpoint fires only when ≥1 batch was written** (`wroteAnyBatch`). A dims-mismatch abort on batch 1 writes nothing → no `runMaintenance()`. A provider failure on batch 2 keeps batch 1 durable AND still checkpoints (FR-030).
- **Never throws:** any `provider.embed` rejection → advisory abort returning `{attempted, embedded, aborted:true, abortReason}`. `attempted` = total eligible (coverage denominator). `abortReason` is the provider's already-redacted message only — never source/composed input (FR-025a).
- Reuses [[embedding-endpoint-provider]]'s provider seam + `encodeVector`/`composeEmbeddingInput`/`computeInputHash` (same file) + `queries.selectEmbeddableNodesMissingVector`/`upsertNodeVector`/`get|setMetadata`.
