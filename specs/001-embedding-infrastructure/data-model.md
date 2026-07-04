# Phase 1 Data Model: Embedding Infrastructure & Endpoint Provider (SPEC-001)

Derived from the Key Entities and Functional Requirements in `spec.md`, grounded in the
existing schema (`src/db/schema.sql`) and node-id scheme
(`src/extraction/tree-sitter-helpers.ts`). This spec adds **one table**, **two metadata
scalars**, and **zero changes to the node/edge graph** (FR-024/SC-006).

---

## Entity 1 — Symbol vector record (`node_vectors` row)

One row per embedded declaration-level symbol: the persisted embedding plus the
self-describing integrity metadata needed to detect staleness and validate dimension.

### Table DDL (new — added to `schema.sql` and migration v8 in lockstep)

```sql
CREATE TABLE IF NOT EXISTS node_vectors (
    node_id    TEXT PRIMARY KEY,   -- existing deterministic node id (kind:sha256(path:kind:name:line))
    model      TEXT NOT NULL,      -- active model name at write time (self-describing)
    dims       INTEGER NOT NULL,   -- vector length (self-describing; must equal enforced dims)
    vector     BLOB NOT NULL,      -- little-endian f32; byte length == dims * 4
    input_hash TEXT NOT NULL        -- sha256 of the composed embedding input (change detection)
);
```

### Fields

| Field | Type | Notes |
|---|---|---|
| `node_id` | TEXT (PK) | The existing symbol identity. **No foreign key** to `nodes` (D6) — the vector survives the file-level node delete/re-insert cycle of a sync (FR-016a). Format is `` `${kind}:${sha256(`${filePath}:${kind}:${name}:${line}`).slice(0,32)}` `` (`generateNodeId`). |
| `model` | TEXT | The active model name persisted with the row (FR-009). Rows whose `model ≠ active model` are **stale** and replaced on the next pass (FR-010) — the store holds exactly one active model's vectors. |
| `dims` | INTEGER | The vector's length; must equal the enforced dimension (D9/D10). Self-describing integrity metadata, not the enforcement source of truth. |
| `vector` | BLOB | Compact little-endian 32-bit-float blob (FR-011). `byteLength === dims * 4`. No native storage component. |
| `input_hash` | TEXT | `sha256(composedInput)` (FR-008). Drives incremental freshness: a row is stale if the symbol's freshly-composed input hashes differently. |

### Key rules & invariants

- **Exactly one row per embedded symbol**, keyed by `node_id` (FR-009). Writes are an
  **upsert** (`INSERT ... ON CONFLICT(node_id) DO UPDATE`) so a model switch or input
  change replaces the row in place (FR-010).
- **Single active model** (FR-010): a row with a non-matching `model` is treated as
  stale and replaced; no multi-model storage.
- **No cascading delete** (FR-016a): deleting/re-inserting a file's `nodes` rows during
  re-extraction does **not** touch `node_vectors`. Removal is only via the explicit
  reconciliation (Entity 4 / FR-017).
- **Additive & rollback-safe**: the table is new; existing graph data is untouched.
  Rollback = unset the two activation env vars (the table may remain, harmlessly empty
  or populated).

---

## Entity 2 — Enforcement metadata (`project_metadata` scalars)

The authoritative dimension and active-model identity, so enforcement survives restarts
(D9, FR-004). Stored in the **existing** `project_metadata(key TEXT PK, value TEXT,
updated_at INTEGER)` table via the existing `setMetadata`/`getMetadata` helpers — **no
new table**.

| Key | Value | Written | Read |
|---|---|---|---|
| `embedding_dims` | stringified integer (the inferred or configured dimension) | on the first successful batch of a pass, if not already set for the active model | at pass start — the enforcement value for every subsequent vector |
| `embedding_model` | the active model name | on the first successful batch | at pass start — identifies which rows are "current" for coverage |

### Rules

- Written **once per pass on first success** (idempotent upsert); read at pass start.
- The per-row `model`/`dims` columns (Entity 1) are self-describing copies for
  integrity checks; these scalars are the source of truth for **enforcement** (D9).
- When the active model changes between runs, `embedding_model` is rewritten on the
  next pass's first success; rows of the old model are stale and get replaced (FR-010).

---

## Entity 3 — Embedding input (transient — not persisted beyond its hash)

The deterministic text composed per symbol and sent to the endpoint. Only its
`input_hash` is persisted (Entity 1).

- **Composition** (FR-007, D11): `name` + `kind` + `signature` + `docstring` +
  trimmed source `snippet`, joined in a fixed order/format. Deterministic — identical
  symbol content always produces byte-identical composed text.
- **Cap**: the composed input is capped at a fixed **~6,000 characters**; the snippet
  is trimmed to fit (character-based, no tokenizer — FR-025).
- **Hash**: `input_hash = sha256(composedInput)` (hex). Drives change detection
  (FR-008) and incremental re-embed selection (Entity 4 / FR-016).
- **Lifecycle**: built in-memory during the pass, sent to the provider, discarded; only
  the hash lands in `node_vectors`.

See `contracts/embedding-provider.md` for the exact field order and trimming rule.

---

## Entity 4 — Embedding pass (behavior, not stored state)

The inline, post-resolution reconciliation that produces and persists vectors. Holds no
persistent state of its own — its "state" is entirely derived from `node_vectors` vs
live `nodes` (which is why abort/resume needs no checkpoint, D14).

### Inputs

- Active `EndpointConfiguration` (Entity 5) — the pass only runs if active.
- Live `nodes` filtered to embeddable kinds (D12/FR-005/FR-006).
- Existing `node_vectors` rows + the `embedding_dims`/`embedding_model` scalars.

### Selection sets (per run)

| Set | Definition | FR |
|---|---|---|
| **Embeddable** | live nodes with `kind IN (declaration kinds)` | FR-005/FR-006 |
| **Missing/stale (to embed)** | embeddable nodes with no `node_vectors` row for the active model, OR whose freshly-composed `input_hash` differs from the stored one | FR-016/FR-018/FR-020 |
| **Removed (to delete)** | `node_vectors` rows whose `node_id` is absent from live `nodes` (anti-join) | FR-017 |

### State transitions (per symbol)

```text
                 ┌────────────────────────────────────────────────┐
                 │                                                  │
 (new/backfill)  ▼            input_hash changed / model switch     │
   ─────────► [ missing ] ──embed──► [ current ] ──────────────► [ stale ]
                                          │                          │
                          symbol removed  │                          │ re-embed
                          from graph       ▼                          ▼
                                     [ deleted (row removed) ]   [ current ]
```

- **missing → current**: eligible symbol embedded and upserted.
- **current → stale**: input changed or active model changed → re-selected next pass.
- **stale → current**: re-embedded and upserted (replace).
- **any → deleted**: symbol no longer in the graph → reconciliation delete (FR-017).
- **Abort/resume**: a batch exhausting retries aborts the pass advisorily
  (FR-014/FR-019); already-written rows remain `current`; the next run re-derives the
  missing/stale set and continues — no checkpoint (D14).

### Slice mapping

- **Slice A** (US1): produce the missing set for a **full index** and persist it
  (backfill of an empty table); dimension infer/enforce; status/coverage; progress.
- **Slice B** (US2+US3): the missing/stale **diff** on sync, the removed **delete**,
  the late-config **backfill** (heal), and the abort/**resume** path — plus the
  daemon-watcher path (covered automatically because it calls `sync()`).

---

## Entity 5 — Endpoint configuration (transient — sourced from environment)

The activation surface; never persisted (D3/D16). See `contracts/embedding-config.md`.

| Variable | Required | Default | Validation |
|---|---|---|---|
| `CODEGRAPH_EMBEDDING_URL` | yes (to activate) | — | non-empty |
| `CODEGRAPH_EMBEDDING_MODEL` | yes (to activate) | — | non-empty |
| `CODEGRAPH_EMBEDDING_API_KEY` | no | unset (keyless) | never persisted/logged/echoed |
| `CODEGRAPH_EMBEDDING_DIMS` | no | inferred from first batch | positive int |
| `CODEGRAPH_EMBEDDING_BATCH_SIZE` | no | 16 | positive int, clamped |
| `CODEGRAPH_EMBEDDING_CONCURRENCY` | no | 4 | positive int, clamped |
| `CODEGRAPH_EMBEDDING_TIMEOUT_MS` | no | 30000 | positive int, clamped |

- **Active iff** `URL` and `MODEL` are both non-empty (FR-001). Otherwise fully dormant
  (FR-002) — the pass is never constructed.
- **API key** lives only in memory; sent as `Authorization: Bearer`; redacted
  everywhere (FR-023). The endpoint is rendered scheme+host+port only.

---

## Relationships & integrity summary

```text
project_metadata (existing)                nodes (existing, UNCHANGED)
  embedding_dims  ─┐  enforce/read              │  id (TEXT, deterministic)
  embedding_model ─┤  at pass start             │  kind ∈ declaration kinds → embeddable
                   │                            │
                   ▼                            │ (logical join by id; NO FK)
              embedding pass ──selects missing/stale──┐
                   │                                   ▼
                   └──upsert──►  node_vectors (NEW)  ──anti-join delete──► removed
                                  node_id (PK = nodes.id, no FK)
                                  model, dims, vector(blob f32 LE), input_hash
```

- **Logical, not enforced, referential link**: `node_vectors.node_id` corresponds to
  `nodes.id` but carries **no FK** (D6/FR-016a). Integrity is maintained by the pass:
  coverage joins from live nodes (orphans excluded), and reconciliation deletes orphans.
- **No graph mutation**: the feature adds no node/edge and changes no count
  (FR-024/SC-006) — `node_vectors` is a side table only.

## Validation rules (enforced by the pass / config layer)

1. **Activation** — pass runs only when config is active (URL+MODEL) (FR-001/FR-002).
2. **Dimension** — every returned vector's length must equal the enforced dimension
   (inferred-then-persisted or configured); a conflict raises an actionable error naming
   `CODEGRAPH_EMBEDDING_DIMS` and fails the pass advisorily (FR-021/D10).
3. **Blob integrity** — `vector` byte length must equal `dims * 4` (little-endian f32).
4. **Determinism** — identical symbol content ⇒ identical composed input ⇒ identical
   `input_hash` (FR-007/FR-008).
5. **Single active model** — a stored row with a non-matching model is stale and
   replaced; coverage counts only active-model rows (FR-010/FR-022).
6. **Env tunables** — batch/concurrency/timeout parsed as positive integers and clamped;
   invalid/blank falls back to the default (D4).
7. **Redaction** — API key and any URL-embedded credentials never appear in any
   persisted file, log, or error (FR-023/SC-007).
