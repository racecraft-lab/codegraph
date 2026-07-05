---
name: embedding-incremental-freshness
description: SPEC-001 Slice B T024/T025 — runEmbeddingPass is now unified full+incremental; hash-compare staleness scan + anti-join reconciliation; selectStaleVectors folded in, result shape unchanged
metadata:
  type: project
---

SPEC-001 Slice B (T024 RED / T025 GREEN) made `runEmbeddingPass`
(src/embeddings/indexer-hook.ts) **unified full + incremental** — there is NO
separate "incremental mode". Every pass now: selects (missing-or-stale-model via
`selectEmbeddableNodesMissingVector`) ∪ (hash-changed via a new compose-and-compare
scan) → embeds → **reconciles** (`deleteRemovedVectors`). On a fresh graph it
reduces to the old full pass. Builds on [[embedding-pass]].

**Why:** T026 wires this same pass into `sync()`; T029 (backfill) and T031
(resume) reuse the exact selection/reconcile machinery. Several decisions here
constrain those tasks and are non-obvious.

**How to apply — decisions that will bite T026/T027/T029/T031:**
- **`selectStaleVectors` was FOLDED IN, not created standalone.** The existing
  `selectEmbeddableNodesMissingVector(model)` ALREADY returns other-model rows as
  "missing" (its `LEFT JOIN … AND v.model = ?` makes a prior-model row NULL on the
  active model). So a model switch is handled with zero new code — a standalone
  `selectStaleVectors` would be dead code (Constitution II/III). The task gave
  explicit latitude ("or fold into the selection helper; your call, keep it
  minimal"). Scenario-6 (model switch) passes in BOTH the RED and GREEN builds,
  confirming this.
- **The NEW query is `selectEmbeddedNodeHashes(activeModel)`** (queries.ts,
  additive): returns `{node, inputHash}` for every embeddable live node that HAS a
  current-model vector. The pass recomposes each (`computeInputHash(compose(...))`)
  and re-embeds only when it differs from the stored hash. This is the network-free
  O(embeddable) scan; `missing` and `selectEmbeddedNodeHashes` sets are DISJOINT by
  the join, so `[...missing, ...changed]` never dupes.
- **`deleteRemovedVectors()` = `DELETE … WHERE node_id NOT IN (SELECT id FROM nodes)`**
  (returns `.changes`). Called via the QueryBuilder directly (NOT the `transaction`
  seam — wrapping it would bump the harness's `counters.transaction` and break T016).
  Runs on EVERY pass incl. embed-nothing (pure delete) and aborted passes. Folded
  into the checkpoint gate: `if (wroteAnyBatch || reconciledAny) runMaintenance()`.
- **Result shape (`EmbeddingPassResult`) kept UNCHANGED — no `reconciled` field.**
  T016 asserts `expect(result).toEqual({attempted, embedded, aborted})`; adding a
  field breaks it. Tests assert reconciliation by reading `node_vectors` directly.
- **Node ids are `sha256(filePath:kind:name:line)` (include start line).** This is
  WHY hash-compare is needed: an in-place body edit (no line shift) keeps the id →
  the vector survives the node delete-reinsert (node_vectors has NO FK) → missing-
  vector selection alone would never notice. Test edits are all CHARACTER-LEVEL (no
  line-count change) to hold ids stable; deletions target the file's TRAILING symbol
  so siblings above don't line-shift. `storeExtractionResult` early-returns on
  unchanged content-hash, so `indexAll()` is store-level incremental (only changed
  files delete-reinsert) — a vector-preserving in-place re-index.
- **Test harness (embeddings-sync.test.ts) is library-level** (CodeGraph.init/open +
  indexAll against a request-recording node:http mock) and deliberately reusable for
  T026/T027: swap the `reindex()` driver's `indexAll()` for `sync()` and every
  assertion still holds. sync() does NOT yet run the pass (that's T026).
