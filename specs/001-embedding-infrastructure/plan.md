# Implementation Plan: Embedding Infrastructure & Endpoint Provider (SPEC-001)

**Branch**: `001-embedding-infrastructure` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-embedding-infrastructure/spec.md`

## Summary

Every indexed declaration-level symbol gets a semantic vector computed through a
user-configured, OpenAI-compatible embedding endpoint — incrementally, resiliently,
and **fully dormant when unconfigured** (zero behavior change, zero network traffic).
The vectors and the provider interface are the substrate that SPEC-003 (semantic
retrieval) and downstream intelligence features (SPEC-011 labels, SPEC-019 wiki)
consume; this spec **writes** vectors but never queries them (FR-026).

**Technical approach**: a net-new `src/embeddings/` module (fork discipline,
Constitution III) holds the provider interface, an endpoint HTTP client built on the
platform's global `fetch` + `AbortSignal.timeout` (no new dependency, FR-025/VII),
environment-variable configuration, and an inline embed pass. The pass runs **after
reference resolution** inside `indexAll()` and `sync()`, wrapped so any failure is
**advisory** — it never fails the enclosing index/sync (the established
"advisory — never fail an index over it" pattern used by the segment-vocab and
metadata writes). Persistence is a single additive table `node_vectors` keyed by the
existing deterministic **TEXT** node id, shipped as schema migration **v8** in
lockstep with `schema.sql` (the v7 `name_segment_vocab` precedent). Coverage is
observable via a new `codegraph status` embedding section with `--json` parity and an
`embedding` progress phase.

Delivered as **two independently-reviewable slice-PRs** (the reviewability budget
forces a split): **Slice A = User Story 1** (configure + full-index embedding, the
complete observable MVP) then **Slice B = User Stories 2 + 3** (incremental freshness,
reconciliation delete, late-config backfill, endpoint resilience, daemon-watcher path).
Slice A must be fully deliverable and testable before Slice B begins.

## Technical Context

**Language/Version**: TypeScript (strict), compiled with `tsc`; ESM-style imports
with `.js` suffix. Node engines `>=20 <25`; the effective from-source floor is Node
22.5+ (for `node:sqlite`), which the bundled runtime satisfies.

**Primary Dependencies**: **None new** (FR-025, Constitution VII). The endpoint client
uses the platform's built-in global `fetch` + `AbortSignal.timeout`. Persistence uses
the existing `node:sqlite` (`DatabaseSync`). Input hashing uses the existing
`node:crypto` (`createHash('sha256')`, already used by `generateNodeId`). No new npm
package, no telemetry.

**Storage**: `node:sqlite` (`DatabaseSync`), WAL + FTS5 — the sole backend. One
additive table `node_vectors(node_id TEXT PRIMARY KEY, model TEXT, dims INTEGER,
vector BLOB, input_hash TEXT)` — little-endian f32 BLOB, **no foreign key** (vectors
survive the file-level node delete/re-insert cycle). Two `project_metadata` scalars
`embedding_dims` and `embedding_model` (via existing `setMetadata`/`getMetadata`) hold
the authoritative enforcement values. All data lives under `.codegraph/`. The table
ships in lockstep in both `schema.sql` (fresh DBs) and an idempotent, DDL-only
(`CREATE TABLE IF NOT EXISTS`) v8 migration (upgraded DBs); a **fresh-vs-upgraded
convergence check MUST assert both paths yield an identical `node_vectors` shape**,
guarding the two definitions against silent drift (FR-012). The migration inherits the
runner's per-`up` transaction, so a failed apply leaves no partial-schema state.

**Testing**: `vitest` (real files + real SQLite in temp dirs via `fs.mkdtempSync`; **no
DB mocking**). Endpoint behavior is exercised against a **local mock OpenAI-compatible
HTTP server** (`node:http` on an ephemeral port) returning deterministic vectors —
covering success, dimension inference, keyless vs keyed auth, 5xx/429 retry+backoff,
timeout, and dimension-conflict paths.

**Target Platform**: cross-platform (macOS/Linux/Windows). Dev + default `npm test` =
macOS; the feature is network/SQLite/CLI only (no file-watching or process-lifecycle
divergence beyond the existing sync path it hooks into).

**Project Type**: single project (library + CLI + MCP server) rooted at `src/`.

**Performance Goals**: the embed pass is bounded and advisory — batch size 16,
concurrency 4, per-request timeout 30,000 ms (all env-overridable). Bounded retries
(3 per batch, exponential backoff + full jitter, ~8 s per-delay cap, honoring
`Retry-After` on 429) then a clean advisory abort — a sustained-down endpoint fails
fast rather than burning wall-clock inside the index lock. The v8 migration is DDL-only
(instant on any size DB). Brute-force scan is acceptable this version — no ANN, no
quantization (deferred). Vectors are written but never read on the retrieval path
(FR-026), so there is **no retrieval regression surface** here (Constitution VI).
There is deliberately **no fixed wall-clock target** for a full-index pass — throughput
is endpoint-bound, not codegraph-bound (SC-010) — so the measurable codegraph-side
bounds are the ones that matter: **incremental cost is scoped to endpoint work**
(requests/writes scale with the changed/missing set; the per-sync staleness scan +
FR-017 anti-join are network-free `O(embeddable-symbols)` local work — FR-027);
**peak memory is bounded** by batched/streaming selection, never materializing all
symbols + composed inputs at once (FR-028, the existing batched-resolution-to-avoid-OOM
precedent); **vector writes are committed in batch-sized transactions** — not per-row
(fsync churn) and not one pass-long transaction across network I/O (WAL bloat + non-durable
partial progress) — with concurrency bounding only in-flight HTTP while writes go
synchronously through the single `node:sqlite` connection (FR-029); the **WAL is
checkpointed after the pass's bulk writes** via the same `runMaintenance()`
(`wal_checkpoint(PASSIVE)` + `optimize`) the index/sync already runs after bulk writes,
with the pass positioned so its writes are covered by that checkpoint (FR-030); and
because the pass runs inside the index lock (FR-015a) yet does network I/O, **reads stay
responsive** — WAL readers run concurrently with the single writer and the batch-commit
strategy holds no reader-blocking pass-long transaction — while lock-hold time is bounded
per batch by the per-request timeout (a fully-down endpoint aborts within one batch's
retry budget; a slow-but-responding endpoint on a huge index is the long-hold case
FR-015a's two-minute stale-reclaim limitation already accepts) (FR-031).

**Constraints**: dormant-when-unconfigured (neither activation variable set) is
byte-identical to today — zero network, zero `node_vectors` writes, zero new log lines
(FR-002/SC-002). A **half-configuration** (exactly one of URL/MODEL set) is a distinct
state (FR-001a/SC-009): the feature stays off (still zero network, zero writes) but the
config parse distinguishes exactly-one-set from neither-set and surfaces an **actionable
error naming the missing variable** rather than collapsing both to one dormant signal.
API key never persisted, logged, or echoed; the endpoint is rendered redacted to
scheme+host+port only — including in **error/log messages derived from transport
failures** (a raw `fetch`/network error can embed the URL), and an unparseable URL
renders as a safe placeholder, never the raw string (FR-023/SC-007). Endpoint failures
are handled per the retryable/non-retryable split: 5xx/429/timeout/network errors
consume the bounded-retry budget (per-request `AbortSignal.timeout` converts a **hang**
into a timeout — FR-019/FR-019a), while a non-retryable 4xx (400/404/422) and a
malformed/mismatched response abort the pass fast and advisorily without corrupting the
store (FR-021a). Symbol (node) and relationship (edge) counts identical with vs
without the feature (FR-024/SC-006). Deterministic input construction — identical
symbol content always yields the identical composed text and input hash (FR-007/FR-008),
made platform-independent by normalizing the composed input (line endings → LF, UTF-8)
before the SHA-256 so a CRLF-vs-LF checkout of the same code hashes identically and never
triggers a spurious re-embed. The Slice B reconciliation delete (FR-017) runs on **every
vector-preserving pass** — `sync()` and the library in-place `indexAll()` re-index — not
only the CLI sync, so no preserving path leaves a silent orphan; only the DB-recreating
full re-index is exempt (fresh table). The embed pass runs **inside the existing index/sync
mutual-exclusion** (FR-015a) — it adds no new lock — so a concurrent CLI sync and
daemon-watcher sync are serialized and never interleave `node_vectors` writes.

**Scale/Scope**: per-project index; scales to large repos via bounded batches and the
abort/resume design (a failed pass loses no prior progress — the next run re-selects
missing/stale rows). ~750 reviewable LOC total across two slices (see budget below).

**Reviewability Budget**: Two co-equal **primary surfaces** — schema/migration (the
`node_vectors` table + v8 migration) and scheduler/runtime (the inline advisory embed
pass + endpoint provider). Secondary surfaces: seed/config (env activation + dimension
inference) and CLI output (status coverage/model/dims). Projected ~750 reviewable LOC
(~500 Slice A / ~250 Slice B), ~10 production files (~8 Slice A / ~3-4 Slice B, several
being edits to existing files), ~20 total files including tests. **Budget result:
split required** — the whole feature exceeds the block thresholds (>8 production files
AND >1 primary surface), so it ships as two vertical slice-PRs under this one spec.
Slice A itself sits at the **warning tier** (two primary surfaces, ~500 LOC, ~8 files):
**warning accepted** — the migration, storage, provider, and pass form one indivisible
"produce and persist a vector" capability; splitting further would ship dead code (a
table with no writer, or a writer with no schema) and break independent-testability.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against CodeGraph Constitution v1.0.0 (Principles I–VII).

| Principle | Gate | Result |
|---|---|---|
| **I. Think Before Coding** | No unresolved clarification markers; competing interpretations surfaced with a recommendation. | **PASS** — three clarification sessions (node identity/vector lifecycle; endpoint client behavior; status surface/slice boundary) resolved every ambiguity in `spec.md`; Phase 0 `research.md` records the decisions and rejected alternatives. Zero markers remain. |
| **II. Simplicity First** | Minimum code; no speculative abstraction/flag/configurability. | **PASS** — one provider interface with a single implementation (endpoint), no plugin registry; no ANN/quantization (deferred until scale demands); character-based input cap avoids a tokenizer dependency; abort/resume needs **no** new checkpoint state (re-selection of missing/stale rows is the resume). Complexity Tracking table is empty. |
| **III. Surgical Changes** | New capability in a new module behind an opt-in flag; upstream-owned file diffs minimal. | **PASS** — all new logic lives in `src/embeddings/`; the feature is opt-in (dormant unless `URL`+`MODEL` set). Edits to shared files are additive and minimal: one union member (`IndexProgress.phase`), one `PHASE_NAMES` entry, one advisory call site each in `indexAll()`/`sync()`, a lockstep schema/migration pair, additive `queries.ts` helpers, and a status section. No refactor of unrelated code. |
| **IV. Goal-Driven Execution** | Verifiable success criteria; tests carry evidence. | **PASS** — SC-001…SC-008 are all measurable; `quickstart.md` maps each to a runnable probe (100% coverage, dormancy byte-identity, incremental re-embed count, backfill, resilience, node/edge stability, key redaction, zero-dependency). Real-SQLite + mock-endpoint tests, no mocking. |
| **V. Deterministic, LLM-Free Extraction** | Graph structure derives from AST only; no speculative edges; counts stable. | **PASS** — embeddings are a **derived side layer**, not graph structure: no node or edge is added or changed (FR-024/SC-006 assert count parity). Vectors are deterministic for identical input (FR-007). The embedding *input* is composed from already-extracted fields; nothing is imagined. |
| **VI. Retrieval Performance Is a Regression Surface** | No regression to the agent-facing retrieval/tool surface; success-shaped errors. | **PASS** — FR-026 forbids touching the retrieval surface; vectors are written, not consumed, until SPEC-003. The advisory pass never surfaces `isError` to an agent and never fails an index/sync. The explore/node budgets are untouched. |
| **VII. Local-First, Private, Zero Native Dependencies** | `node:sqlite` only; new deps pure-JS/WASM; no telemetry; assets wired into copy-assets. | **PASS** — no new runtime dependency (built-in `fetch`); no telemetry (FR-025/SC-008); all data local under `.codegraph/`; the API key never leaves memory (FR-023). The only new static asset is SQL inside `schema.sql`, which `copy-assets` already ships — **the new DDL is added to the existing `schema.sql` file, so no copy-assets wiring change is required** (verified: `copy-assets` copies `schema.sql` whole). |

**Fork & Ecosystem**: original work against the public OpenAI-compatible embeddings
API shape (Constitution "License hygiene"); all pushes/PRs target `origin`
(racecraft-lab) — never `upstream`; documentation is vendor-neutral (endpoint families
named only as illustrative examples of the standard shape).

**Reviewability governance** (constitution budget):

- **Primary review surface**: schema/migration (`node_vectors` + v8) **and**
  scheduler/runtime (advisory embed pass + endpoint provider) — two co-equal primaries.
- **Secondary surfaces**: seed/config (env activation + dimension inference); CLI
  output (status embedding section).
- **Within budget?** No — the whole feature crosses the **block** thresholds
  (>8 production files and >1 primary surface). A ratified split exists: two slice-PRs.
- **Split decision**: **one spec, two slice-PRs** — Slice A = User Story 1 (P1);
  Slice B = User Stories 2 + 3 (P2, P3). It stays one spec because the whole feature
  shares one migration and one provider/vector contract that downstream specs consume
  as a unit. Slice A sits at the warning tier — **warning accepted** (indivisible
  produce-and-persist capability). Deferred work names its follow-up: search-side
  consumption → **SPEC-003**; bundled local model → **SPEC-002**; ANN/quantization →
  deferred until scale demands.
- **PR review packet source** (both slice-PRs): what changed, why, non-goals, review
  order, scope budget, traceability (FR-005/FR-006 → symbol-selection + selection test;
  FR-024 → node/edge-count-stable test; FR-023 → key-redaction test; SC-001 →
  100%-coverage probe), verification evidence, known gaps, and the rollback/flag note
  (dormant-by-default — rollback is unsetting the two env vars; the additive migration
  leaves existing graph data untouched).

**Gate result: PASS** (pre-Phase 0). No Complexity Tracking rows required. Re-checked
post-design below — still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-embedding-infrastructure/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — decisions, rationale, rejected alternatives
├── data-model.md        # Phase 1 output — entities, schema, lifecycle, validation
├── quickstart.md        # Phase 1 output — runnable validation scenarios (SC-001..SC-008)
├── contracts/           # Phase 1 output
│   ├── embedding-config.md        # CODEGRAPH_EMBEDDING_* env-var contract
│   ├── embedding-provider.md      # EmbeddingProvider TS interface + OpenAI HTTP wire shape
│   ├── node-vectors-schema.md     # table + metadata scalars + f32 blob codec
│   └── status-embedding-json.md   # status --json `embedding` object shape
├── spec.md              # Feature spec (final through Clarify)
├── SPEC-MOC.md          # Spec map-of-content
├── checklists/          # Author checklists
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── embeddings/                 # NEW MODULE (Constitution III fork discipline)
│   ├── config.ts               # [Slice A] env parse CODEGRAPH_EMBEDDING_{URL,MODEL,DIMS,
│   │                           #           API_KEY,BATCH_SIZE,CONCURRENCY,TIMEOUT_MS};
│   │                           #           active iff URL+MODEL; positive-int validate+clamp
│   ├── provider.ts             # [Slice A] EmbeddingProvider interface:
│   │                           #           embed(texts)->Float32Array[], dims, id
│   ├── endpoint-provider.ts    # [Slice A] fetch client: batching, bounded concurrency,
│   │                           #           AbortSignal.timeout, backoff on 5xx/429
│   └── indexer-hook.ts         # [Slice A] embed pass: select eligible nodes missing/stale
│                               #           by input_hash+model, compose deterministic input
│                               #           (+~6000-char cap) & sha256 hash, f32 codec,
│                               #           batch/embed/persist, dims infer/enforce, abort;
│                               #  [Slice B] incremental selection + reconciliation delete
├── db/
│   ├── schema.sql              # EDIT [Slice A] append node_vectors (lockstep w/ migration)
│   ├── migrations.ts           # EDIT [Slice A] CURRENT_SCHEMA_VERSION 7->8; add v8 DDL
│   └── queries.ts              # EDIT [A] upsert vector, select eligible, getEmbeddingCoverage
│                               #      [B] anti-join reconciliation delete, select stale-by-hash
├── index.ts                    # EDIT [A] wire advisory embed pass into indexAll() post-resolve
│                               #      [B] wire into sync() (incremental + reconcile + heal)
├── extraction/index.ts         # EDIT [Slice A] add 'embedding' to IndexProgress.phase union
├── ui/shimmer-progress.ts      # EDIT [Slice A] add 'embedding' to PHASE_NAMES
└── bin/codegraph.ts            # EDIT [Slice A] status embedding section + --json parity

__tests__/
├── embeddings-config.test.ts       # [A] env parse/validate/clamp/activation
├── embeddings-input-hash.test.ts   # [A] deterministic input composition + hash stability + cap
├── embeddings-codec.test.ts        # [A] Float32Array <-> little-endian f32 blob round-trip
├── embeddings-endpoint.test.ts     # [A] mock server: success, dims infer, keyless/keyed,
│                                   #     5xx/429 retry+backoff, timeout, dims-conflict
├── embeddings-index.test.ts        # [A] full index -> 100% coverage; dormancy byte-identity;
│                                   #     node/edge count parity; key redaction; status+--json
├── embeddings-sync.test.ts         # [B] incremental re-embed count; delete removed; backfill
└── embeddings-resilience.test.ts   # [B] advisory abort keeps success; resume to 100%
```

**Structure Decision**: single-project layout. All net-new logic is isolated in
`src/embeddings/` (four files per the interview-decided layout — input composition,
hashing, and the f32 codec live as exported, unit-testable helpers **inside**
`indexer-hook.ts` rather than as separate files, honoring Simplicity First while
keeping them directly testable). Edits to shared files are additive and minimal, each
tracing to a specific FR. Tests mirror the module under `__tests__/`, real-SQLite +
mock-endpoint, no mocking.

## Complexity Tracking

> No Constitution violations — no justifications required.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                   |

## Post-Design Constitution Re-Check

Re-evaluated after Phase 1 (data-model, contracts, quickstart): **still PASS.** The
design introduces no new dependency, no telemetry, no graph-structure change, and no
retrieval-surface change; the schema addition is one additive no-FK table shipped via
the established lockstep migration mechanism; all new code is confined to the opt-in
`src/embeddings/` module with minimal, additive edits to shared files. The two-slice
split keeps each reviewable unit at or below the block threshold. No Complexity
Tracking rows were introduced by the design.
