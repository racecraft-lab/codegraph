# Data Integrity Checklist: Embedding Infrastructure & Endpoint Provider (SPEC-001)

**Purpose**: Validate the *quality* (completeness, clarity, consistency, measurability, coverage) of the **data-integrity requirements** in `spec.md` + `plan.md` — the persistence, hashing, staleness, delete/reconciliation, node-identity, and write-integrity contracts. This is "unit tests for the requirements," not the implementation.
**Created**: 2026-07-04
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/](../contracts/)
**Domain focus**: migration v8 lockstep/idempotency · input_hash cross-platform determinism · model-switch staleness · delete wiring · node-identity stability (no silent orphans)
**Status**: Loop 2 — all 6 gaps surfaced in Loop 1 remediated in spec.md/plan.md (see resolution tags).

## Migration & Schema Integrity (node_vectors v8)

- [ ] CHK001 Is the v8 migration explicitly required to be DDL-only (no data backfill) so it stays instant on any DB size? [Completeness, Spec §FR-012, research §D8]
- [x] CHK002 Is the lockstep between the `schema.sql` `node_vectors` DDL and the v8 migration DDL protected against silent drift — i.e., is a fresh-vs-upgraded **convergence check** required so the two definitions cannot diverge into differently-shaped tables? [Resolved →§FR-12: added DDL-only + idempotent (`IF NOT EXISTS`) + a required fresh-vs-upgraded convergence assertion (identical `node_vectors` shape) + atomic-apply clause; plan Storage prose mirrors it]
- [ ] CHK003 Is migration idempotency specified (re-open / already-applied version is a safe no-op)? [Consistency, Spec §FR-012] (inherited: runner filters `version > fromVersion` + `CREATE TABLE IF NOT EXISTS`; now stated in FR-012)
- [ ] CHK004 Are atomicity/rollback expectations documented for a v8 migration that fails partway (no partial-schema state)? [Consistency, Spec §FR-012, contract node-vectors-schema] (inherited: runner wraps each `up` in `db.transaction()`; now stated in FR-012 + plan)
- [ ] CHK005 Is the table's **no-foreign-key** design (vector survives the node delete/re-insert cycle) explicitly required and justified? [Completeness, Spec §FR-016a]

## Input Hash Determinism

- [ ] CHK006 Is deterministic composition (fixed field order/format) required so identical symbol content always yields byte-identical composed text? [Clarity, Spec §FR-007]
- [x] CHK007 Is the composed input required to be **normalized** (line endings, and encoding) before hashing, so `input_hash` is identical for the same symbol across platforms (Windows CRLF vs Unix LF) and line-ending/checkout settings — preventing spurious whole-project re-embeds? [Resolved →§FR-007/§FR-008: composition now normalizes line endings→LF + UTF-8 and hashes SHA-256 over the normalized bytes; hash required identical across platforms/runs, no spurious re-embed; mirrored in plan Constraints + data-model rule 4]
- [ ] CHK008 Is the hash function and its input encoding pinned (sha256 over UTF-8) so the hash is stable and reproducible across runs? [Clarity, Spec §FR-008, contract embedding-provider §3]
- [ ] CHK009 Is the ~6,000-character cap's snippet-trim rule deterministic (identical input ⇒ identical trimmed output, no tokenizer nondeterminism)? [Clarity, Spec §Assumptions, contract embedding-provider §3]
- [ ] CHK010 Is it clearly specified that `input_hash` drives change detection (staleness), independent of vector-value equality? [Clarity, Spec §FR-008/FR-016]

## Model-Switch Staleness

- [ ] CHK011 Is a stored row whose `model` ≠ active model required to be treated as stale and replaced on the next pass? [Completeness, Spec §FR-010]
- [x] CHK012 Is the model-identity comparison used for staleness precisely defined (exact string equality vs normalized), so a benign model-name/tag/case formatting difference does not silently force a full false re-embed? [Resolved →§FR-010: defined as exact, case-sensitive equality against `project_metadata.embedding_model` (the same value coverage filters on); a differing tag/case is intentionally a new model that converges via re-embed]
- [ ] CHK013 Is coverage required to count only active-model rows so a mismatched (stale) row is never reported as covered? [Consistency, Spec §FR-022]
- [ ] CHK014 Is single-active-model storage (exactly one row per `node_id`, upsert-replace) required so two models never coexist for one symbol? [Completeness, Spec §FR-009/FR-010, data-model]
- [ ] CHK015 Are requirements defined for a model switch interrupted by an aborted pass — the transiently mixed-model table must converge to the active model on resume? [Coverage, Spec §FR-010 + §FR-020]

## Delete / Reconciliation Wiring

- [ ] CHK016 Is reconciliation (deleting vectors of symbols that no longer exist) required on sync? [Completeness, Spec §FR-017]
- [x] CHK017 Is reconciliation required on **every vector-preserving re-index path** — including the library in-place `indexAll()` re-index that Session 1 says "preserves vectors," not only `sync()` — so that path cannot leave silently-orphaned vectors? [Resolved →§FR-017: now mandates reconciliation on every vector-preserving pass (sync + library in-place indexAll), against the complete live node set, exempting only the DB-recreating full re-index; plan Constraints mirrors it]
- [ ] CHK018 Is it required that file **modification** removes/replaces exactly the affected symbols' vectors (survivors untouched, changed re-embedded, removed deleted)? [Completeness, Spec §FR-016/FR-016a/FR-017]
- [ ] CHK019 Is it required that whole-file **deletion** removes exactly that file's symbols' vectors via the anti-join (no over- or under-deletion)? [Completeness, Spec §FR-017, data-model]
- [ ] CHK020 Is the reconciliation anti-join required to compare against the **complete** live node set (not a partial sync scope) so untouched files' vectors are never falsely deleted? [Clarity, Spec §FR-017, contract node-vectors-schema deleteRemovedVectors] (now explicit in FR-017: "evaluated against the whole live node set")
- [ ] CHK021 Is node identity required to be deterministic (stable across sync/re-index for unchanged content), and is that stability the basis for vector reuse? [Completeness, Spec §Key Entities, Clarifications Session 1]

## Node-Identity Stability & Orphan Prevention

- [x] CHK022 Are requirements/edge-cases defined for a symbol whose content is unchanged but whose **start line shifts** (e.g., an inserted line above it): its old node-id vector is orphaned and MUST be reconciled (never silently retained), and a new-id vector produced? [Resolved →§Edge Cases "Symbol unchanged but moved (start-line shift)" + §FR-017: enumerates the line-shift orphan, requires reconciliation to remove the old-id vector, and states the no-silent-orphan + 100%-coverage invariant]
- [ ] CHK023 Is it required that a full (DB-recreating) re-index cannot leave orphans (fresh table), while every preserving path relies on reconciliation for cleanup? [Consistency, Spec §Clarifications Session 1 / §FR-017]
- [ ] CHK024 Is it required that transient orphan vector rows never inflate coverage (coverage joins FROM live nodes to active-model vectors)? [Consistency, Spec §FR-022]

## Concurrency & Write Integrity

- [x] CHK025 Are requirements defined so concurrent embedding passes (a CLI `sync` and the daemon-watcher `sync`) cannot interleave or corrupt `node_vectors` writes — i.e., the pass executes within the enclosing index/sync mutual-exclusion (the existing index lock)? [Resolved →§FR-015a: pass MUST run inside the enclosing index/sync mutual-exclusion (existing index lock), adds no second lock, so concurrent CLI+daemon passes serialize and never interleave writes or race reconciliation. NOTE: escalated to consensus — cross-process daemon/CLI lock semantics only partially traced (see summary)]
- [ ] CHK026 Is vector persistence required to be an idempotent upsert keyed by `node_id` (repeated writes converge, never duplicate a symbol's row)? [Consistency, Spec §FR-009, data-model]

## Blob & Scope Integrity

- [ ] CHK027 Is the vector blob's byte-length invariant required (`byteLength === dims * 4`, fixed little-endian f32) so a stored vector is self-consistent with its `dims`? [Completeness, contract node-vectors-schema, data-model rule 3]
- [ ] CHK028 Is read-time vector validation intentionally deferred to the consumer (SPEC-003), consistent with this spec writing — but never reading — vectors? [Coverage, Spec §FR-026]

## Notes

- Marker legend: a "Gap" tag (used in Loop 1) meant a data-integrity requirement missing/under-specified/unverified in `spec.md`/`plan.md`; items citing `[Spec §…]`/`[contract …]` reference an existing, adequately-specified requirement. A `[Resolved →§…]` tag with a checked box marks a Loop-1 gap now closed by a spec/plan edit.
- Loop-1 gaps (6): CHK002, CHK007, CHK012, CHK017, CHK022, CHK025 — all remediated in spec.md (+ mirrored in plan.md/data-model.md). CHK025's fix is applied but escalated for consensus (cross-process lock semantics).
- Inherited-mechanism items (CHK003/CHK004) trace to existing DB-runner behavior (`src/db/migrations.ts`: `db.transaction()` wrap + `version > fromVersion` filter), now also stated in FR-012.
- Check items off as completed: `[x]`.
