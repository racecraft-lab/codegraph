# Contract: `node_vectors` persistence schema + f32 blob codec + metadata scalars

The storage contract: the new table, its migration, the vector byte encoding, the
enforcement metadata scalars, and the coverage query. Shipped in `src/db/schema.sql`,
`src/db/migrations.ts`, and `src/db/queries.ts`.

## Table (schema.sql + migration v8, in lockstep — FR-012 / D8)

```sql
CREATE TABLE IF NOT EXISTS node_vectors (
    node_id    TEXT PRIMARY KEY,   -- existing node id; NO foreign key (D6/FR-016a)
    model      TEXT NOT NULL,
    dims       INTEGER NOT NULL,
    vector     BLOB NOT NULL,      -- little-endian f32; byteLength == dims * 4
    input_hash TEXT NOT NULL
);
```

- **No `FOREIGN KEY` / no `ON DELETE CASCADE`** — the vector must survive the
  file-level `nodes` delete/re-insert cycle of a sync (FR-016a). This mirrors the
  `name_segment_vocab` no-FK precedent.
- **Lockstep**: the identical `CREATE TABLE IF NOT EXISTS` lives in both `schema.sql`
  (fresh DBs) and the version-8 migration `up` (upgraded DBs), so both converge (the v7
  precedent). No index is added in this version (brute-force scan; FR-011).

### Migration wiring (`src/db/migrations.ts`)

- Bump `CURRENT_SCHEMA_VERSION` from `7` to `8`.
- Append a `{ version: 8, description: 'Add node_vectors …', up }` entry whose `up`
  runs the `CREATE TABLE IF NOT EXISTS node_vectors (...)` above. DDL-only → instant on
  any size DB. The runner already wraps each `up` in a transaction and records it in
  `schema_versions`.
- **copy-assets**: no change needed — the DDL is added inside the existing `schema.sql`,
  which `copy-assets` already ships (Constitution VII).

## Vector blob codec (little-endian f32 — FR-011 / D7)

```text
encode(v: Float32Array) -> BLOB:
  bytes := little-endian byte view of v            # length = v.length * 4
  store bytes as the BLOB

decode(blob: BLOB, dims: number) -> Float32Array:
  assert blob.byteLength === dims * 4
  return Float32Array view over the blob bytes (little-endian)
```

- Round-trip identity: `decode(encode(v), v.length)` equals `v` element-for-element.
- Endianness is fixed little-endian regardless of host (the search side, SPEC-003,
  decodes with the same assumption).

## Enforcement metadata scalars (`project_metadata` — D9 / FR-004)

Written via existing `setMetadata(key, value)` / read via `getMetadata(key)`:

| Key | Value | Semantics |
|---|---|---|
| `embedding_dims` | stringified positive int | Authoritative enforced dimension (inferred on first success or configured). |
| `embedding_model` | model name string | Active model; defines which rows are "current" for coverage. |

## Query helpers (`src/db/queries.ts` — additive)

| Helper | Slice | Purpose |
|---|---|---|
| `upsertNodeVector(node_id, model, dims, vector, input_hash)` | A | `INSERT ... ON CONFLICT(node_id) DO UPDATE` — persist/replace one vector (FR-009/FR-010). |
| `selectEmbeddableNodesMissingVector(activeModel)` | A | Live declaration-kind nodes with no current-model vector — the full-index/backfill work set (FR-005/FR-016/FR-018). |
| `getEmbeddingCoverage(activeModel)` | A | `{ embeddable, embedded }` by **joining FROM live nodes** (declaration kinds) to `node_vectors` filtered to `activeModel`; orphan rows structurally excluded (FR-022). |
| `selectStaleVectors(activeModel)` (or hash compare in-pass) | B | Rows whose `model ≠ activeModel` (model switch) — re-embed set (FR-010). Input-hash staleness is compared in the pass against freshly composed input (FR-016). |
| `deleteRemovedVectors()` | B | Anti-join delete: `DELETE FROM node_vectors WHERE node_id NOT IN (SELECT id FROM nodes)` — removes vectors of deleted symbols (FR-017). |

### Write batching & WAL checkpoint (FR-029 / FR-030)

`upsertNodeVector` is a single-**row** helper, but the pass MUST invoke it **inside a
batch-sized transaction** — the vectors of one completed embedding batch committed
together via the existing `db.transaction()` bulk-write path — never one implicit
transaction per row (per-row `fsync` churn) nor one pass-long transaction held open
across network I/O (unbounded WAL growth + non-durable partial progress, which would
break the FR-020 resume contract). Writes go **synchronously through the single
`node:sqlite` connection** — bounded concurrency governs only in-flight HTTP requests,
so there is no concurrent-writer contention on `node_vectors`. After the pass's bulk
writes, the WAL is checkpointed via the same `runMaintenance()`
(`PRAGMA wal_checkpoint(PASSIVE)` + `PRAGMA optimize`) the index/sync already runs after
bulk writes (`src/db/index.ts`), with the pass positioned so its writes are covered by
that checkpoint rather than growing the WAL unbounded (FR-030).

### Coverage query shape (FR-022)

```sql
-- embeddable: live declaration-kind symbols
-- embedded:   those that also have a current-model vector
SELECT
  COUNT(*)                                          AS embeddable,
  COUNT(v.node_id)                                  AS embedded
FROM nodes n
LEFT JOIN node_vectors v
  ON v.node_id = n.id AND v.model = :activeModel
WHERE n.kind IN ( /* declaration kinds, FR-005 */ );
```

- "Current" = present ∧ model-match. Input-hash staleness is a **sync-time re-embed
  trigger**, not counted against coverage at status time (Session 3).

## Verification

- `embeddings-codec.test.ts`: encode/decode round-trip; `byteLength === dims*4`;
  little-endian fixed.
- `embeddings-index.test.ts`: fresh DB has the v8 table; an upgraded DB (start at v7)
  gains it after open; coverage reaches 100% after a full index; node/edge counts
  identical with vs without the feature (FR-024/SC-006).
- `embeddings-sync.test.ts`: reconciliation delete removes exactly the deleted symbol's
  row; a model switch marks old-model rows stale (coverage drops then heals).
