# Data Model: Bundled Local Embedding Fallback (SPEC-002)

**Branch**: `002-local-embedding-fallback` | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

This feature adds **no new persisted schema**. It extends one in-memory discriminated
union (the embedding config) and adds one on-disk artifact family (the model cache). The
vector store (`node_vectors`) is reused unchanged.

---

## 1. Embedding configuration — discriminated union (extended)

`loadEmbeddingConfig(env)` in `src/embeddings/config.ts` today returns
`EmbeddingConfig | EmbeddingMisconfig | null`. SPEC-002 adds a **fourth arm** for the
local provider and a `CODEGRAPH_EMBEDDING_PROVIDER` selector. The existing arms are
**preserved unchanged** (null-dormancy + half-config error).

```ts
// NEW arm — the local provider config (in-memory only, never persisted).
export interface EmbeddingLocalConfig {
  provider: 'local';
  /** Stable model identifier — the checkpoint id, e.g. 'Xenova/all-MiniLM-L6-v2'.
   *  This is the value written to node_vectors.model and drives FR-022 re-embed. */
  model: string;
  /** Statically known from the checkpoint (384). Enforced from pass start. */
  dims: 384;
  /** Batch size per worker message; positive-int clamped (mirrors endpoint). */
  batchSize: number;
  /** In-flight batch concurrency (super-chunk = batchSize × concurrency). */
  concurrency: number;
}

// The result union grows by one arm; the other three are untouched.
export type EmbeddingConfigResult =
  | EmbeddingConfig        // endpoint (SPEC-001, unchanged)
  | EmbeddingLocalConfig   // local (SPEC-002, NEW)
  | EmbeddingMisconfig     // half-config (SPEC-001, unchanged)
  | null;                  // dormant (SPEC-001, unchanged)
```

`EmbeddingLocalConfig`'s `batchSize`/`concurrency` defaults and clamp ceilings are chosen
for single-worker WASM CPU inference — NOT inherited from the endpoint provider's
network-tuned ceilings (2048/64, sized for an OpenAI-style HTTP endpoint). For the local
provider, `concurrency` does NOT create parallel inference — one long-lived worker runs
every batch sequentially (research.md OQ-3) — it only sizes the super-chunk
(`batchSize × concurrency`) and the commit cadence, the same way it does for the endpoint
provider.

### Fields `runEmbeddingPass` reads (the seam contract)

`RunEmbeddingPassOptions.config` is read for exactly `{ model, batchSize, concurrency,
dims? }`. `EmbeddingLocalConfig` supplies all four. To let the same pass accept either
provider config without a `url`, the pass's `config` param is retyped to a **structural
subset** both variants satisfy (a minimal, surgical change in `indexer-hook.ts`):

```ts
// The only fields the pass reads — both EmbeddingConfig and EmbeddingLocalConfig satisfy it.
export interface EmbedPassConfig {
  model: string;
  batchSize: number;
  concurrency: number;
  dims?: number;
}
```

Because `dims = 384` is known up front, the pass's `enforcedDims` is 384 from the first
batch; the local provider returns 384-dim vectors, so the dimension check passes with no
abort. No other pass logic changes.

### Selection precedence (FR-003) — resolution table

Resolution runs top-to-bottom; the first matching row wins. An "explicit selection" is
`CODEGRAPH_EMBEDDING_PROVIDER` **or** the `--embeddings` CLI flag (the flag overrides the
env for one invocation).

| # | Explicit selection | Endpoint URL | Endpoint MODEL | → Result |
|---|---|---|---|---|
| 1 | `off` | (any) | (any) | `null` (short-circuit; present URL/MODEL ignored) |
| 2 | `local` | (any) | (any) | `EmbeddingLocalConfig` (no URL required) |
| 3 | `endpoint` | set | set | `EmbeddingConfig` (endpoint) |
| 4 | `endpoint` | missing/one | — | `EmbeddingMisconfig` (names the missing var — **never** a downgrade to local) |
| 5 | *(none)* | set | set | `EmbeddingConfig` — SPEC-001 unchanged |
| 6 | *(none)* | exactly one set | — | `EmbeddingMisconfig` — SPEC-001 half-config, preserved |
| 7 | *(none)* | neither | neither | `null` (dormant) — SPEC-001 unchanged |

**Invariants**: a half-config is NEVER silently downgraded to `off`/local (rows 4, 6);
`local` is reachable ONLY by explicit selection (row 2) — there is no implicit
"no URL → local" fallthrough (rows 5–7 never yield local); a fully-unset config stays
`null` (row 7), preserving byte-identical dormancy (FR-005 / SC-004).

---

## 2. Vector store — `node_vectors` (REUSE, no migration)

The SPEC-001 table is reused **verbatim** — no new columns, no new migration:

```sql
CREATE TABLE IF NOT EXISTS node_vectors (
    node_id    TEXT PRIMARY KEY,
    model      TEXT NOT NULL,   -- local: the checkpoint id, e.g. 'Xenova/all-MiniLM-L6-v2'
    dims       INTEGER NOT NULL,-- local: 384
    vector     BLOB NOT NULL,   -- little-endian f32, byteLength === dims*4 (encodeVector)
    input_hash TEXT NOT NULL
);
```

- The **`model` column** holds the local checkpoint id when the local provider is active.
- **Re-embed (FR-022) rides the existing model-column-mismatch mechanism — no new
  mechanism.** `selectEmbeddableNodesMissingVector(model)` returns every symbol lacking a
  vector *for the currently active model*. Switching from an endpoint model to
  `Xenova/all-MiniLM-L6-v2` (or vice-versa) changes the active `model`, so all previously
  embedded symbols are re-selected and re-embedded on the next index/sync. Node/edge
  counts are untouched by this vector-layer churn (FR-023 / SC-007).
- Vectors are a **prose-layer** artifact (Principle V): they are derived embeddings, never
  graph nodes/edges. A re-embed produces zero graph growth.

---

## 3. Model cache entry (`model-fetch`)

A machine-wide, platform-aware directory holding **verified** model artifacts, shared
across all projects (never inside a project's `.codegraph/`).

### Cache directory resolution (FR-016, 4-case formula)

| Platform | Condition | Resolved cache dir |
|---|---|---|
| POSIX | `XDG_CACHE_HOME` unset | `~/.codegraph/models` |
| POSIX | `XDG_CACHE_HOME` set | `$XDG_CACHE_HOME/codegraph/models` |
| Windows | `%LOCALAPPDATA%` set | `%LOCALAPPDATA%\codegraph\models` |
| Windows | `%LOCALAPPDATA%` unset | `<home>/AppData/Local/codegraph/models` |

- `CODEGRAPH_MODEL_CACHE_DIR` overrides the resolved value (FR-017).
- The resolved dir (default, `CODEGRAPH_MODEL_CACHE_DIR`, or `XDG_CACHE_HOME`-derived) is
  **validated** with a cache-appropriate guard (FR-017a): reject `../` traversal and
  `SENSITIVE_PATHS`, but **do not** reuse `validateProjectPath` verbatim (it rejects
  `~/.config`, which is a legitimate cache root — see research.md finding 1). A rejected or
  unwritable dir degrades like the offline case (actionable message; structural index
  still completes).

### Cache entry (per artifact)

```ts
interface ModelCacheArtifact {
  /** Absolute path in the resolved cache dir, e.g. <cache>/all-MiniLM-L6-v2/model_quantized.onnx */
  path: string;
  /** Pinned SHA-256 the bytes MUST match before use (the trust anchor). */
  sha256: string;
  /** Commit-pinned default source URL; CODEGRAPH_MODEL_BASE_URL overrides the base. */
  sourceUrl: string;
}
```

Artifacts fetched + verified together: `model_quantized.onnx` (22,972,370 bytes, sha256
`afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`) and `tokenizer.json`
(711,661 bytes; sha256 pinned at implement time).

### Acquisition state machine (verify-before-use)

```
resolve+validate cache dir ─┬─ invalid/unwritable ─→ Unavailable{cache}  (actionable msg)
                            └─ ok
                               │
   for each artifact: cached AND sha256 matches? ─┬─ yes ─→ reuse (no download, FR-018)
                                                  └─ no / partial temp
                                                     │
   download base+relpath → temp file ─┬─ network fail ─→ Unavailable{offline} (FR-019 msg)
                                       └─ ok
                                          │
   sha256(temp) === pinned? ─┬─ no ─→ discard temp ─→ Unavailable{checksum} (FR-019a msg)
                             └─ yes ─→ atomic rename temp → path (verified, usable)
```

- A **partially written** temp is treated as absent and re-acquired; it is never renamed
  into place, so a `path` that exists is always complete + verified (atomic verify-then-
  rename).
- The three `Unavailable` reasons carry **distinct messages**: offline (FR-019 — names the
  cache dir, `CODEGRAPH_MODEL_BASE_URL`, and the exact filename to pre-seed) vs checksum
  (FR-019a — tamper-aware: bytes failed SHA-256, discarded, advise retry / check the
  override) vs cache (unwritable/invalid dir). All three degrade identically: structural
  index completes, embed pass skipped, `codegraph status` reports the reason (FR-020).
- Acquisition **never throws** — it returns a typed outcome the provider/pass treats as an
  advisory skip, mirroring `runEmbeddingPass`'s `{aborted, abortReason}` posture.

---

## 4. Key entities (spec § Key Entities → this model)

| Spec entity | Realized as |
|---|---|
| Embedding Provider Selection | The `EmbeddingConfigResult` union + FR-003 precedence table (§1) |
| Local Embedding Model | The pinned checkpoint + `ModelCacheArtifact` (name, dims=384, license, source URL, SHA-256) (§3) |
| Model Cache | The platform-aware cache dir + verify-before-use state machine (§3) |
| Embedding Configuration Inputs | `CODEGRAPH_EMBEDDING_PROVIDER`, `--embeddings`, SPEC-001 URL/MODEL, `CODEGRAPH_MODEL_BASE_URL`, `CODEGRAPH_MODEL_CACHE_DIR` |
