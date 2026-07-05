# Phase 0 Research: Embedding Infrastructure & Endpoint Provider (SPEC-001)

**Status**: complete — zero `[NEEDS CLARIFICATION]` remain. Every open question was
resolved across three clarification sessions recorded in `spec.md` (Sessions 1–3) and
the grill-me design interview (`docs/ai/specs/.process/SPEC-001-design-concept.md`).
This document consolidates each decision with its rationale and the alternatives
rejected, and anchors each to the existing-code precedent it follows.

---

## D1 — HTTP client: platform `fetch`, no new dependency

- **Decision**: the endpoint client uses the platform's built-in global `fetch` with
  a per-request `AbortSignal.timeout(TIMEOUT_MS)`. No npm package is added.
- **Rationale**: Constitution VII and FR-025 forbid a new runtime dependency; the
  bundled runtime is Node ≥22.5, where `fetch`/`AbortSignal.timeout` are stable
  globals. A hand-rolled client is small (batching + a bounded worker loop + backoff).
- **Alternatives rejected**: `openai` SDK or `undici` directly (adds a dependency,
  violates FR-025/VII); an abstract multi-transport HTTP layer (speculative
  configurability, violates Simplicity First).

## D2 — Provider interface: one interface, one implementation

- **Decision**: `EmbeddingProvider { embed(texts: string[]): Promise<Float32Array[]>;
  dims: number; id: string }` in `provider.ts`; the only implementation this spec ships
  is `EndpointProvider` (`endpoint-provider.ts`). See `contracts/embedding-provider.md`.
- **Rationale**: the interface is the seam SPEC-002 (bundled local model) and SPEC-003
  (retrieval) consume; defining it now keeps the vector-producer swappable **without**
  building a plugin registry today. `Float32Array` is the natural in-memory shape for
  the f32 blob codec (D7).
- **Alternatives rejected**: a provider registry / config-driven provider selection
  (no second provider exists yet — YAGNI); returning `number[]` (wastes a copy vs the
  typed array the codec wants).

## D3 — Activation: dormant unless URL **and** MODEL are both set

- **Decision**: the feature is active iff both `CODEGRAPH_EMBEDDING_URL` and
  `CODEGRAPH_EMBEDDING_MODEL` are non-empty. API key is optional (keyless local
  endpoints). When inactive, the embed pass is never constructed or called — zero
  network, zero writes, zero new log lines (byte-identical to today).
- **Rationale**: FR-001/FR-002/SC-002; dormancy is a hard requirement and the cheapest
  correct default. Two required variables avoid a half-configured active state.
- **Alternatives rejected**: a boolean `CODEGRAPH_EMBEDDING_ENABLED` flag (redundant —
  presence of URL+MODEL *is* the intent); defaulting to a well-known localhost URL
  (would make network calls without explicit opt-in, violating dormancy).

## D4 — Client tunables: env-overridable, positive-int validated + clamped

- **Decision**: `BATCH_SIZE=16`, `CONCURRENCY=4`, `TIMEOUT_MS=30000` defaults, each
  overridable via `CODEGRAPH_EMBEDDING_{BATCH_SIZE,CONCURRENCY,TIMEOUT_MS}`, parsed as
  positive integers and clamped (invalid/blank → default). See
  `contracts/embedding-config.md`.
- **Rationale**: Session 2 resolution. Follows the existing `resolveParsePoolSize`
  env-parse precedent (`src/extraction/parse-pool.ts:87` —
  `Math.max(1, Math.min(Math.floor(n), MAX))`, unset/non-numeric → computed default).
- **Alternatives rejected**: unbounded values (a hostile/typo'd value could wedge the
  index lock); a config file (env matches the existing configuration surface).

## D5 — Retry/backoff: fixed constants, abort-the-whole-pass on exhaustion

- **Decision**: on 5xx/429/timeout/network error, retry the batch with exponential
  backoff + full jitter — base 1,000 ms, ×2 growth, ~8 s per-delay cap, **3 retries
  per batch** (4 attempts), honoring `Retry-After` on 429 (capped ~30 s). These are
  **fixed constants, not env vars**. One batch exhausting retries aborts the whole pass
  (advisorily — the enclosing index/sync still succeeds).
- **Rationale**: Session 2 resolution + FR-019. The retry budget is deliberately
  smaller than hosted-API cookbook defaults because an exhausted batch aborts the pass
  (a sustained-down endpoint should fail fast, not burn wall-clock inside the index
  lock). The only observable contract is "aborts advisorily rather than hanging or
  failing the operation."
- **Alternatives rejected**: retry-forever / large budgets (holds the index lock);
  env-configurable backoff (Session 2 explicitly fixed these as constants —
  configurability nobody asked for); per-batch partial-abort that continues other
  batches (Q8 chose whole-pass abort for a simpler, resumable contract).

## D6 — Persistence keying: existing deterministic TEXT node id, **no foreign key**

- **Decision**: `node_vectors(node_id TEXT PRIMARY KEY, model TEXT, dims INTEGER,
  vector BLOB, input_hash TEXT)` — **no FK** to `nodes`. The primary key is the
  existing node id, which `generateNodeId` composes as
  `` `${kind}:${sha256(`${filePath}:${kind}:${name}:${line}`).slice(0,32)}` `` — a
  **TEXT** id (verified: `src/extraction/tree-sitter-helpers.ts:18`). Cleanup of
  vectors for symbols that no longer exist is an **explicit anti-join reconciliation**
  in the embed pass (FR-016a/FR-017), never a cascading delete.
- **Rationale**: Session 1 resolution. Node identity is deterministic in file
  path + kind + name + start line, so an unchanged symbol regenerates the identical id
  on re-extraction; because the vector table has no FK/cascade, the vector survives the
  file-level node delete-and-reinsert cycle of a sync untouched (strictly per-symbol
  re-embedding, FR-016a). This mirrors the `name_segment_vocab` no-FK precedent, where
  deletions leave orphan rows on purpose and cleanup happens by explicit re-verification
  against `nodes` (`schema.sql:135-138`).
- **Alternatives rejected**: `FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE
  CASCADE` (would delete every vector in a file the instant sync deletes-and-reinserts
  that file's node rows, forcing a full re-embed of unchanged symbols — the opposite of
  FR-016a); an integer surrogate key (node id is already unique and is the join key
  every consumer needs).

## D7 — Vector storage: little-endian f32 BLOB, brute-force scan

- **Decision**: each vector is a compact binary blob of little-endian 32-bit floats
  (`Float32Array` ↔ `Buffer`/`Uint8Array` via the platform's little-endian typed-array
  view). No ANN index, no quantization. See `contracts/node-vectors-schema.md`.
- **Rationale**: FR-011 + roadmap storage decision (2026-07-03) — preserves the
  zero-native-dependency constraint (Constitution VII); brute-force scan is acceptable
  at this version's scale and is the search side's concern (SPEC-003), not this spec's.
- **Alternatives rejected**: a native vector extension (`sqlite-vec`/`vss`) (native
  dependency, violates VII); JSON array text (bloats the DB and loses the compact
  fixed-width layout); quantized int8 (premature — deferred until scale demands).

## D8 — Migration: v8, DDL-only, in lockstep with schema.sql

- **Decision**: bump `CURRENT_SCHEMA_VERSION` 7 → 8 in `src/db/migrations.ts` and add a
  version-8 migration whose `up` runs `CREATE TABLE IF NOT EXISTS node_vectors (...)`;
  add the identical `CREATE TABLE IF NOT EXISTS node_vectors (...)` to `schema.sql` so
  fresh and upgraded databases converge. DDL-only → instant on any size DB.
- **Rationale**: FR-012; exactly the v7 `name_segment_vocab` precedent
  (`migrations.ts:104-121` + `schema.sql:139-143`). The migration runner already wraps
  each `up` in a transaction and records it in `schema_versions`.
- **Alternatives rejected**: schema-only without a migration (upgraded DBs would never
  get the table); a data-backfilling migration (unnecessary — the table starts empty
  and the next index/sync populates it; DDL-only keeps the migration instant).

## D9 — Metadata scalars: `embedding_dims` + `embedding_model` in project_metadata

- **Decision**: the inferred/enforced dimension and the active model identity persist
  as two `project_metadata` scalars, written on the first successful batch and read at
  pass start as the authoritative enforcement values. The per-row `model`/`dims`
  columns (FR-009) remain self-describing integrity metadata, not the source of truth.
- **Rationale**: Session 2 resolution (FR-004). Uses the existing
  `setMetadata`/`getMetadata` upsert helpers (`src/db/queries.ts:1987`/`1995`) over the
  `project_metadata(key, value, updated_at)` table — the same pattern as the
  `indexed_with_version` / `indexed_with_extraction_version` stamps
  (`src/index.ts:511-513`). Enforcement survives restarts because it is read from disk.
- **Alternatives rejected**: deriving the active dimension from an arbitrary existing
  row (ambiguous during a model switch when rows of two models coexist mid-pass); a new
  bespoke metadata table (the scalar store already exists).

## D10 — Dimension inference + conflict handling

- **Decision**: `CODEGRAPH_EMBEDDING_DIMS` is optional. When unset, the dimension is
  inferred from the first successful batch's vector length, persisted (D9), and enforced
  on every subsequent vector. A vector whose length conflicts with the enforced
  dimension raises an actionable error **naming `CODEGRAPH_EMBEDDING_DIMS`** and treats
  the pass as failed (advisory — enclosing operation still succeeds).
- **Rationale**: FR-004/FR-021 + interview Q7. Inference removes a required config knob
  while the persisted value keeps enforcement deterministic across runs; naming the env
  var makes the error actionable.
- **Alternatives rejected**: requiring `DIMS` always (worse UX — the endpoint already
  knows its dimension); silently truncating/padding on mismatch (would corrupt vectors
  and hide a real misconfiguration).

## D11 — Deterministic embedding input + input hash (change detection)

- **Decision**: compose the per-symbol input deterministically from name + kind +
  signature + docstring + a trimmed source snippet, capped at a fixed **~6,000
  characters** (snippet trimmed to fit), character-based. Derive `input_hash =
  sha256(composedInput)`. Identical symbol content ⇒ identical input ⇒ identical hash.
  See `contracts/embedding-provider.md` (input section) and `data-model.md`.
- **Rationale**: FR-007/FR-008 + Session 2. The cap is character-based to avoid a
  tokenizer dependency (FR-025); ~6,000 chars ≈ ~1,500–1,700 code tokens, under common
  local-model 2,048-token contexts and far under hosted 8,191-token limits. The hash is
  the incremental-freshness trigger (Slice B): a symbol is re-embedded iff its
  input_hash changed or it has no current vector.
- **Alternatives rejected**: token-accurate truncation (needs a tokenizer — FR-025);
  hashing raw source (a formatting-only change would needlessly re-embed); embedding
  the whole file (loses per-symbol granularity and blows the context cap).

## D12 — Symbol selection: flat declaration-kind membership test

- **Decision**: embed only declaration kinds — `function`, `method`, `class`, `struct`,
  `interface`, `trait`, `protocol`, `enum`, `type_alias`, `module`, `namespace`,
  `component`, `route`, plus `constant` and `variable`. Skip `parameter`, `import`,
  `export`, `enum_member`, `field`, `property`, `file`. No scope predicate.
- **Rationale**: FR-005/FR-006 + Session 1. The extractor emits `constant`/`variable`
  only at file/module scope or as type-member constants — never for function locals
  (locals are not graph symbols) — so selection is a flat `kind IN (...)` membership
  test with no scope check needed.
- **Alternatives rejected**: embedding all node kinds (noise-level kinds waste endpoint
  cost and dilute retrieval — a non-goal); a scope predicate for locals (unnecessary —
  locals never enter the graph).

## D13 — Pass placement: inline, post-resolution, advisory, everywhere sync runs

- **Decision**: the embed pass runs inline **after reference resolution** inside both
  `indexAll()` and `sync()`, wrapped so any failure is swallowed with a debug log — it
  never fails the enclosing operation. It runs in every context where sync runs,
  including the background daemon watcher's syncs.
- **Rationale**: FR-013/FR-014/FR-015 + interview Q3/Q4. Follows the established
  "advisory — never fail an index over it" pattern already used for the segment-vocab
  clear (`src/index.ts:443`) and the version-stamp metadata writes (`:511-513`). Running
  in `sync()` (which the daemon watcher already calls) automatically covers the
  watcher path — no separate daemon wiring.
- **Alternatives rejected**: a separate `codegraph embed` command / background job
  (interview Q5 chose the sync-heal path, no new command); making embedding failures
  fatal (would let a flaky endpoint break indexing — violates FR-014).

## D14 — Incremental freshness, backfill, and resume (Slice B)

- **Decision**: on sync, select for embedding exactly the symbols with **no current
  vector** or a **changed input_hash** (current = a `node_vectors` row exists for the
  node id with the active model). Delete vectors of symbols that no longer exist via an
  explicit anti-join (`node_vectors` LEFT JOIN live `nodes` … WHERE node id absent).
  A plain sync backfills all missing-current vectors (late config) with no new command.
  Resume after an aborted pass is automatic — the next run re-selects the still-missing
  and still-stale symbols; there is **no separate resume checkpoint**.
- **Rationale**: FR-016/FR-016a/FR-017/FR-018/FR-020 + Sessions 1/3. The backfill-heal
  follows the `vocabWasEmpty` end-of-sync heal precedent (`src/index.ts:560-636`),
  where a table that was empty when sync started over a populated graph triggers a
  batched backfill. "Missing/stale re-selection" doubling as resume is why no checkpoint
  can corrupt (edge case in spec).
- **Alternatives rejected**: re-embedding every symbol in a touched file (Session 1
  chose strictly-per-symbol; wasteful and unnecessary given stable node ids); a resume
  checkpoint/journal (redundant — the missing/stale query already encodes remaining
  work, and a checkpoint is one more thing to corrupt).

## D15 — Coverage query + status surface + progress phase

- **Decision**: coverage is computed by a new `getEmbeddingCoverage` query that **joins
  from live embeddable (declaration-kind) `nodes` to `node_vectors` filtered to the
  active model** — "current" = present ∧ model-match. `codegraph status` gains an
  embedding section (endpoint redacted to scheme+host+port; model; dimension; coverage
  as `embedded/embeddable (NN%)`) with a **parallel `embedding` object in `--json`**.
  Dormant = a neutral (never warning-styled) line naming the two activation variables;
  if prior-run vectors exist on disk their model/dims/coverage are shown labeled "from
  a previous run" (disk-read only). The `IndexProgress.phase` union gains `'embedding'`
  and `PHASE_NAMES` gains a matching label; emitted only when active; progress =
  embedded ÷ eligible. See `contracts/status-embedding-json.md`.
- **Rationale**: Session 3 (FR-022) + interview. Joining from live nodes structurally
  excludes transient orphan vector rows from the count; input-hash staleness is a
  sync-time re-embed trigger, not a status-time check. `--json` parity is required —
  automated probes read machine output. Endpoint redaction to scheme+host+port is the
  strictest credential-safe rendering (FR-023). The phase union edit sits beside the
  existing `'scanning' | 'parsing' | 'storing' | 'resolving'`
  (`src/extraction/index.ts:72`) and `PHASE_NAMES` (`src/ui/shimmer-progress.ts:4`).
- **Alternatives rejected**: counting rows in `node_vectors` directly (would count
  orphan rows and misreport coverage during a model switch); a warning-styled dormant
  line (dormancy is not an error — FR-022); status-time hash re-check (expensive and
  redundant with the sync-time trigger).

## D16 — Security: API key redaction everywhere

- **Decision**: the API key is read from `CODEGRAPH_EMBEDDING_API_KEY` into memory,
  sent only as the `Authorization: Bearer` header, and **never** persisted, logged, or
  echoed. The endpoint is always rendered redacted to **scheme + host + port only** —
  userinfo, path, and query stripped — so a credential embedded in the URL is never
  displayed. See `contracts/embedding-config.md` (redaction) and
  `contracts/status-embedding-json.md`.
- **Rationale**: FR-023/SC-007 + Session 3 (security-flagged, strictest option chosen).
- **Alternatives rejected**: rendering the full endpoint URL (could leak userinfo/query
  credentials); persisting the key to the DB for convenience (violates FR-023).

---

## Precedent index (existing code the design follows)

| Concern | Precedent (file:line) |
|---|---|
| Advisory "never fail an index over it" | `src/index.ts:443` (vocab clear), `:511-513` (metadata) |
| End-of-sync backfill heal | `src/index.ts:560-636` (`vocabWasEmpty`) |
| Env parse + positive-int clamp | `src/extraction/parse-pool.ts:87` (`resolveParsePoolSize`) |
| Metadata scalar upsert/read | `src/db/queries.ts:1995` (`setMetadata`) / `:1987` (`getMetadata`) |
| DDL-only lockstep migration | `src/db/migrations.ts:104-121` (v7) + `src/db/schema.sql:139-143` |
| No-FK table, orphan cleanup by re-verification | `src/db/schema.sql:135-143` (`name_segment_vocab`) |
| Deterministic TEXT node id | `src/extraction/tree-sitter-helpers.ts:18` (`generateNodeId`) |
| Progress phase union + labels | `src/extraction/index.ts:72` + `src/ui/shimmer-progress.ts:4` |
| Status command + `--json` block | `src/bin/codegraph.ts:761-920` |

**Outcome**: all unknowns resolved; no blocking research remains. Proceed to Phase 1.
