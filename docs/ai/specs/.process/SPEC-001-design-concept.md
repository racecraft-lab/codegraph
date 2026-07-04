---
topic: "Embedding infrastructure & endpoint provider"
slug: "SPEC-001-design-concept"
date: "2026-07-04"
mode: "setup"
spec_id: "SPEC-001"
source_input:
  type: "topic"
  ref: "SPEC-001 scope from docs/ai/specs/intelligence-platform-technical-roadmap.md"
question_count: 10
stop_reason: "natural"
---

# Design Concept: Embedding Infrastructure & Endpoint Provider

> **Source:** SPEC-001 scope, `docs/ai/specs/intelligence-platform-technical-roadmap.md`
> **Date:** 2026-07-04
> **Questions asked:** 10
> **Stop reason:** natural (all critical branches walked)

## Goals

- Every indexed **declaration-level symbol** gets a persisted embedding vector computed through an OpenAI-compatible endpoint, incrementally and resiliently, with the feature fully dormant when unconfigured.
- Activation is explicit: `CODEGRAPH_EMBEDDING_URL` + `CODEGRAPH_EMBEDDING_MODEL` both set → on; anything less → completely dormant (zero behavior change, zero network traffic). `API_KEY` optional so keyless local endpoints (Ollama, LM Studio, vLLM) work.
- The embed pass is **advisory**: it never fails or blocks an index/sync result (matches the codebase's "advisory — never fail an index over it" pattern).
- Vectors stay fresh everywhere sync runs — including the MCP daemon's file-watcher syncs — because `input_hash` makes incremental cost proportional to actual change.
- A repo indexed before the endpoint was configured heals via a plain `codegraph sync` (vocab-backfill precedent); no new CLI surface.
- `codegraph status` reports backend, model, dims, and coverage %, making partial-coverage states first-class and observable.
- **Split into 2 vertical slices** (accepted in Q10, estimator: 705 LOC / warn / suggested 2):
  - **Slice A — endpoint embedding on full index:** config activation, `EmbeddingProvider` interface, endpoint HTTP client (batching, bounded concurrency, per-request timeout, exponential backoff), `node_vectors` schema migration, embed phase in `indexAll`, dims validation, status reporting.
  - **Slice B — incremental + healing:** `input_hash` change detection in `sync`, removed-node vector deletes, daemon/watcher path, sync-heals backfill, abort/resume semantics.

## Non-goals

- Embedding noise-level node kinds: `parameter`, `import`, `export`, `enum_member`, `field`/`property`, `file` nodes — answered in Q1 (Embed scope).
- Multi-model vector storage / A-B model comparison — single active model, answered in Q2 (Vector key).
- Detached background embedding lifecycle — inline pass only, answered in Q3 (Embed timing).
- New CLI commands (`codegraph embed`) — answered in Q5 (Backfill path).
- Any new telemetry — answered in Q9 (Telemetry).
- Bundled local model (SPEC-002); search-side consumption (SPEC-003); ANN/quantization (deferred until scale demands — roadmap key decision 2026-07-03: plain BLOB + brute-force scan keeps the zero-native-dep constraint).

## Design Tree (Q&A log)

### Q1. Which node kinds should get embedding vectors?

**Branch:** Embed scope (data model / cost)

**Recommended answer:** Declaration kinds only
> The graph stores 22 NodeKinds including noise-level ones; embedding parameters/imports/exports/enum_members multiplies endpoint cost 3–10x on dense repos and pollutes nearest-neighbor results. Declaration kinds (function, method, class, struct, interface, trait, protocol, enum, type_alias, module, namespace, component, route, plus top-level constant/variable) are what SPEC-003 search actually needs to retrieve.

**Alternatives offered:**
- Every node kind (literal roadmap reading): maximum coverage, but far more endpoint calls/storage and similarity noise.
- Callables + types only (narrowest): cheapest, but misses routes, components, and constants agents frequently search for.

**User's answer:** Declaration kinds only (Recommended)

---

### Q2. How should node_vectors key its rows when the configured model changes?

**Branch:** Data model / schema

**Recommended answer:** PK = node_id, one active model
> One row per node; model/dims are metadata columns. A mismatched model column is treated like a missing vector (stale → re-embed, replacing the row). SPEC-003 scans without filtering; storage stays flat. The roadmap's SPEC-002 note ("provider/model switch triggers full re-embed") already assumes this.

**Alternatives offered:**
- Composite PK (node_id, model): keeps vectors for multiple models side by side — 2x+ storage during transitions and every search must filter by active model.

**User's answer:** PK = node_id, one active model (Recommended)

---

### Q3. Where does the embedding pass execute relative to indexAll/sync?

**Branch:** Pipeline integration

**Recommended answer:** Inline post-resolution, advisory
> Runs as a new phase inside `indexAll`/`sync` after reference resolution (the established hook slot in `src/index.ts`), with its own progress reporting. Failures never fail the operation — matches the codebase's "advisory — never fail an index over it" pattern (vocab, metadata stamps). Simple lifecycle: no orphaned background work; vectors consistent when the call returns.

**Alternatives offered:**
- Background pass after lock release: better perceived first-index latency, but adds abort-on-exit/overlap-with-next-sync complexity and a stale-vector window.

**User's answer:** Inline post-resolution, advisory (Recommended)

---

### Q4. Should the MCP daemon's file-watcher syncs also trigger embedding?

**Branch:** Daemon / runtime behavior

**Recommended answer:** Embed everywhere sync runs
> Incremental cost is tiny (`input_hash` means only genuinely changed nodes re-embed) and vectors stay fresh for SPEC-003 search during live agent sessions. The user opted in by configuring the endpoint; failures stay silent/advisory in daemon context.

**Alternatives offered:**
- CLI-initiated operations only: no background network traffic, but vectors go stale mid-session and search quality degrades until the next explicit index/sync.

**User's answer:** Embed everywhere sync runs (Recommended)

---

### Q5. How does a user get vectors for a repo that's already indexed?

**Branch:** Backfill / CLI surface

**Recommended answer:** `codegraph sync` heals
> The embed phase inside sync selects every declaration node missing a current vector, so a plain `codegraph sync` (even with zero file changes) backfills the whole repo. Matches the existing vocab-backfill precedent for upgraded DBs; zero new CLI surface, zero installer changes.

**Alternatives offered:**
- New `codegraph embed` command: explicit and discoverable, but adds CLI + docs surface for something sync already does.
- Both (sync heals + thin `embed` alias): more surface than v1 needs.

**User's answer:** `codegraph sync` heals (Recommended)

---

### Q6. What minimal configuration activates the feature?

**Branch:** Configuration / activation semantics

**Recommended answer:** URL + MODEL required; API key optional
> Feature turns on only when both `CODEGRAPH_EMBEDDING_URL` and `CODEGRAPH_EMBEDDING_MODEL` are set. `CODEGRAPH_EMBEDDING_API_KEY` stays optional — local endpoints (Ollama, LM Studio, vLLM) are keyless. URL set without MODEL → one actionable config error naming the missing var; feature stays off, indexing unaffected.

**Alternatives offered:**
- URL alone activates with a default model name: one var, but no safe default exists across arbitrary OpenAI-compatible endpoints — a wrong guess yields confusing 404/400s instead of a clear config message.

**User's answer:** URL + MODEL required; key optional (Recommended)

---

### Q7. Is CODEGRAPH_EMBEDDING_DIMS required up front or inferred?

**Branch:** Configuration / validation

**Recommended answer:** Optional — infer, then enforce
> First successful batch establishes dims; persisted alongside the model and enforced on every later batch (mismatch → actionable error naming `CODEGRAPH_EMBEDDING_DIMS`). Users rarely know their model's dims — zero-friction setup, still fail-loud on drift. If the var IS set, it's validated against the first batch.

**Alternatives offered:**
- Required when feature is on: fail-fast before any HTTP, but adds a setup hurdle for a value fully discoverable from the endpoint.

**User's answer:** Optional — infer, then enforce (Recommended)

---

### Q8. When the endpoint keeps failing mid-pass, what happens to remaining batches?

**Branch:** Error paths / resilience

**Recommended answer:** Abort pass, resume next run
> After one batch exhausts its backoff retries, stop the whole pass — a down endpoint fails every remaining batch, so continuing hammers it and stalls indexing inside the index lock. Coverage stays partial (visible in `codegraph status`); the next index/sync resumes exactly where it left off because missing/stale `input_hash` rows are re-selected automatically.

**Alternatives offered:**
- Skip failed batch, keep going: maximizes coverage on per-batch flukes, but a down endpoint costs N batches × full retry backoff in wasted wall-clock.

**User's answer:** Abort pass, resume next run (Recommended)

---

### Q9. Should SPEC-001 record any anonymous telemetry about embedding usage?

**Branch:** Observability / privacy

**Recommended answer:** No new telemetry in v1
> Surgical scope (Constitution II/III): the feature works without it, and telemetry additions require TELEMETRY.md + schema-version churn. Endpoint URLs/models are user infrastructure — privacy-sensitive for a local-first tool. Can be added later as its own change.

**Alternatives offered:**
- Coarse lifecycle counter (bucketed node counts, no URLs/models): adoption signal, but adds TELEMETRY.md and schema-version surface to this spec.

**User's answer:** No new telemetry in v1 (Recommended)

---

### Q10. Split SPEC-001 into 2 vertical slices, or proceed as one spec?

**Branch:** Slice sizing

**Recommended answer:** Split into 2 vertical slices
> Shared estimator: `{estimated_loc: 705, suggested_slices: 2, status: "warn"}` (signals: 3 user stories, ~12 files, ~10 FRs, net-new). 705 exceeds even the greenfield warn line (600). Slice A — endpoint embedding on full index (config activation, provider interface, HTTP client, node_vectors migration, embed phase in indexAll, dims validation, status reporting). Slice B — incremental + healing (input_hash change detection in sync, removed-node deletes, daemon/watcher path, sync-heals backfill, abort/resume). Each slice is end-to-end testable and inside the 400-LOC review ceiling. The setup gate also flagged a multi-surface warning, and the roadmap's estimator advisory already suggested 2 slices.

**Alternatives offered:**
- Keep as one spec (greenfield allowance): one PR under the block line (1200), but a large review and the gate already warned.
- Decide at plan phase: defers, but risks rework if the split lands mid-plan.

**User's answer:** Split into 2 vertical slices (Recommended)

---

## Open Questions

- **What:** Node-identity stability across a full re-index. If `indexAll` skips unchanged files (content-hash skip, as `filesSkipped` suggests), node IDs stay stable and vectors survive; but if a forced full re-index recreates node rows, all vectors orphan and the entire repo re-embeds (real cost on paid endpoints).
  **Why deferred:** Implementation detail resolvable from the orchestrator's code, not a product decision.
  **Suggested next step:** Verify at plan phase; if node rows are recreated, consider an `input_hash`-keyed vector reuse path before writing tasks.
- **What:** Embedding-input truncation cap (how much of a symbol's snippet goes into the embedding input) and exact defaults for `BATCH_SIZE`, `CONCURRENCY`, `TIMEOUT_MS`.
  **Why deferred:** Tuning values, not design decisions; interview focused on behavior.
  **Suggested next step:** Defer to `/speckit-clarify` / plan phase — pick conservative defaults, all env-overridable (already in scope).
- **What:** Exact declaration-kind list boundary (does `variable` include local variables or only top-level?).
  **Why deferred:** Needs a look at how extractors emit `variable` scope today.
  **Suggested next step:** Resolve during `/speckit-clarify` with a quick codebase probe.

## Recommended Next Step

Setup mode — scaffolding already in progress. The calling `/speckit-pro:speckit-scaffold-spec SPEC-001` command now writes the workflow file enriched from this doc, and the accepted 2-slice split (Q10) must be recorded in the workflow's scope budget / split decision block per the setup gate's warning.
