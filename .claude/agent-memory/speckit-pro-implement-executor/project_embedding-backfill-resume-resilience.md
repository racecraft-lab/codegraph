---
name: embedding-backfill-resume-resilience
description: SPEC-001 T028-T031 — late-config backfill + abort/resume are ALL emergent (no new prod code); the two distinct dims-conflict paths; abortReason invisible at library level
metadata:
  type: project
---

SPEC-001 Slice B tasks T028/T029 (late-config backfill) and T030/T031 (abort &
resume resilience) needed **ZERO new production code** — every guarantee is
emergent from the unified pass ([[embedding-incremental-freshness]]) +
unconditional sync slot ([[embedding-sync-watcher-wiring]]) + the provider
([[embedding-endpoint-provider]]). Tests live in
`__tests__/embeddings-resilience.test.ts` (new file, 4 tests, all green-on-first-write).

**Why:** SPEC-002/003 and future maintenance will re-touch this seam; several
facts below are non-obvious and were only established by writing falsifiable pins.

**How to apply — facts that will bite a future edit:**
- **Resume is STATELESS re-selection, not checkpoint replay.** After a mid-pass
  outage, a later plain `cg.sync()` heals to 100% purely because
  `selectEmbeddableNodesMissingVector` returns the still-missing rows again. There
  is **NO** persisted checkpoint/cursor/offset anywhere — the ONLY embedding
  persistence is the `node_vectors` table + exactly two `project_metadata` scalars
  (`embedding_dims`, `embedding_model`). Grep confirms no other `embedding_*` key
  and no runtime `CREATE TABLE`. A resume pin can assert this structurally (metadata
  keys == those two; no `.codegraph` file matching /checkpoint|resume|cursor/).
- **TWO distinct dims-conflict paths — don't conflate them.** (1)
  `runEmbeddingPass`'s `enforcedDims` only checks the **first** batch against
  `config.dims`/persisted-scalar (covered by T016). (2) A dimension that changes on
  a **LATER** batch is caught ONLY by `EndpointProvider.reconcileDims` via its
  `_dims` memory, which **persists across `embed()` calls on the same provider
  instance** — so batch-1 sets `_dims`, batch-2's different length throws
  `EmbeddingEndpointError` naming `CODEGRAPH_EMBEDDING_DIMS`, which becomes the
  pass's `abortReason`. Prior batch's vectors stay durable (FR-021). Test this with
  a REAL `EndpointProvider` + dims-switching node:http mock, NOT the T016 FakeProvider
  (which returns a constant dim and can't reproduce it).
- **`maybeRunEmbeddingPass` (src/index.ts) DISCARDS the pass result**, so
  `abortReason` is **invisible at the library level** (indexAll/sync only expose
  `result.success`). To assert an abort *reason* (e.g. it names the dims var), call
  `runEmbeddingPass` **directly** with a real `EndpointProvider` constructed with
  tiny backoff overrides (`{baseDelayMs:1,maxDelayMs:2,retryAfterCapMs:5,maxRetries:3}`).
- **Bounded abort = break-on-first-failing-batch.** A fully-down endpoint makes
  exactly `maxRetries+1` (=4) HTTP attempts for the FIRST batch, then the pass
  `break`s — batches 2..n are never sent. So `mock.requestCount() === 4` is an exact,
  falsifiable FR-020 boundedness pin. At the LIBRARY level the provider uses
  production backoff (no override hook in `maybeRunEmbeddingPass`), so a retryable-500
  outage costs ~3-7s once (full-jitter, observed ~3s) — keep such tests to ONE
  aborting batch and a ~30s timeout.
- **Library-level outage harness:** batchSize env `CODEGRAPH_EMBEDDING_BATCH_SIZE='2'`
  over the 6-symbol base project → 3 batches; a mock that serves 2 OK then 500s
  commits 4 vectors durably, aborts advisorily, `indexAll().success===true`. Script
  the mock by an `okServed` counter (NOT request count — retries inflate it). Compute
  "what was embedded" from `node_vectors` (readVectorsByName), never from request
  bodies (a 500'd request still records its input body).
- **Verified falsifiable** (green-on-first-write pins are worthless if they can't
  fail): inverting the resume-set expectation → RED (resume really sent only the 2
  missing); disabling the dims switch → RED (pass completes, no abort). Do this for
  emergent pins.
