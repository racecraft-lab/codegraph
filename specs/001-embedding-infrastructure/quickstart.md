# Quickstart & Validation: Embedding Infrastructure (SPEC-001)

Runnable scenarios that prove the feature end-to-end and map each Success Criterion
(SC-001…SC-011) and acceptance scenario to an observable check. Design details live in
[`data-model.md`](./data-model.md) and [`contracts/`](./contracts/); this is the
run/validate guide.

## Prerequisites

- Node ≥ 22.5 (for `node:sqlite`); repo built: `npm run build`.
- **An OpenAI-compatible embeddings endpoint.** Two options:
  - **Real**: a local runner (Ollama / LM Studio / vLLM) or any hosted
    OpenAI-compatible API — set the env vars below.
  - **Automated tests**: a **local mock server** (`node:http`, ephemeral port)
    returning deterministic vectors — no external service. This is how the vitest
    suite runs (real SQLite + mock endpoint, no mocking).

## Verification commands

```bash
npm run typecheck                       # tsc --noEmit — strict types
npm test                                # full vitest suite (real files + real SQLite)
npx vitest run __tests__/embeddings-config.test.ts
npx vitest run __tests__/embeddings-input-hash.test.ts
npx vitest run __tests__/embeddings-codec.test.ts
npx vitest run __tests__/embeddings-endpoint.test.ts
npx vitest run __tests__/embeddings-index.test.ts        # Slice A
npx vitest run __tests__/embeddings-sync.test.ts         # Slice B
npx vitest run __tests__/embeddings-resilience.test.ts   # Slice B
```

---

## Slice A — configure + full-index embedding (User Story 1, P1)

**Deliverable and testable on its own before Slice B begins.**

### A1 — Configure and embed on a full index (SC-001, Acceptance US1-1/US1-4)

```bash
export CODEGRAPH_EMBEDDING_URL="http://localhost:11434/v1/embeddings"
export CODEGRAPH_EMBEDDING_MODEL="nomic-embed-text"
# (no API key — keyless local endpoint)

codegraph index                 # full index; embed pass runs inline after resolution
codegraph status                # human section: Endpoint / Model / Dims / Coverage
codegraph status --json | jq .embedding
```

**Expected**:

- `status --json` → `embedding.active === true`,
  `embedding.coverage.percent === 100`, and `embedding.model` / `embedding.dims`
  match the configuration/endpoint (dimension **inferred** from the first batch when
  `CODEGRAPH_EMBEDDING_DIMS` is unset — Acceptance US1-4).
- A spot-checked declaration symbol has a `node_vectors` row whose `vector` blob is
  `dims * 4` bytes (little-endian f32).
- The progress surface showed an **Embedding symbols** phase during the index.

### A2 — Dormant when unconfigured (SC-002, Acceptance US1-2)

```bash
unset CODEGRAPH_EMBEDDING_URL CODEGRAPH_EMBEDDING_MODEL
codegraph index
codegraph status --json | jq .embedding
```

**Expected**: results **byte-identical** to a build without the feature — zero
embedding network requests, zero `node_vectors` writes, zero new log lines.
`embedding.active === false` with `activationVars` naming the two variables; **no**
`endpoint` field; the human line is neutral (not a warning). Only one of URL/MODEL set
is the **half-config** state, *not* this neutral dormant line: the pass stays inactive
(no embedding, no writes) but surfaces the actionable missing-variable message of
SC-009/FR-001a.

### A3 — Keyless endpoint (Acceptance US1-3)

With only URL+MODEL set against a keyless endpoint, indexing embeds successfully with
**no** `Authorization` header sent and no API key required.

### A4 — Node/edge count parity (SC-006, FR-024)

```bash
# index with feature active vs inactive; compare graph counts
codegraph status --json | jq '{nodeCount, edgeCount}'
```

**Expected**: `nodeCount` and `edgeCount` are **identical** with vs without the feature
— embeddings add no graph structure (side table only).

### A5 — Credential safety (SC-007, FR-023)

With `CODEGRAPH_EMBEDDING_API_KEY` set and/or credentials embedded in the URL, the key
and URL credentials appear in **no** persisted file, log line, or error message; the
`endpoint` shown anywhere is redacted to **scheme+host+port only**.

### A6 — Zero new dependency, no telemetry (SC-008, FR-025)

`package.json` gains no runtime dependency; the feature emits no telemetry event
(the client uses the built-in global `fetch`).

---

## Slice B — incremental freshness, backfill, resilience (User Stories 2 + 3, P2/P3)

**Builds on a fully-embedded Slice-A project.**

### B1 — Incremental re-embed on edit (SC-003, Acceptance US2-1/US2-2/US2-3)

```bash
# starting from 100% coverage:
#  - edit one symbol's body/signature
#  - delete another symbol
codegraph sync
```

**Expected** (observed via the mock endpoint's request count in tests): exactly the
symbols whose composed **input_hash** changed are re-embedded (plus any previously
missing); untouched symbols are **not** re-embedded; the deleted symbol's vector is
gone (reconciliation delete); a rename/move that does not change a symbol's input does
**not** re-embed it.

### B2 — Daemon-watcher sync embeds too (Acceptance US2-4)

A file change that triggers an **automatic** sync via the background daemon's watcher
runs the embed pass exactly as a CLI `codegraph sync` does (the pass lives in `sync()`,
which the watcher already calls — no separate wiring).

### B3 — Late configuration backfill (SC-004, Acceptance US3-1)

```bash
# 1) index with NO endpoint configured  → zero vectors
# 2) configure the endpoint, then:
codegraph sync                  # plain sync — no new/special command
codegraph status --json | jq .embedding.coverage.percent
```

**Expected**: coverage reaches **100%** from a single plain sync (heal/backfill path) —
no `codegraph embed` command exists or is needed.

### B4 — Endpoint outage: advisory abort + resume (SC-005, Acceptance US3-2/US3-3)

```bash
# make the endpoint unreachable partway through a pass:
codegraph index                 # or sync
echo "exit code: $?"            # → 0 (operation still succeeds)
codegraph status --json | jq .embedding.coverage.percent   # partial (<100)
# restore the endpoint:
codegraph sync
codegraph status --json | jq .embedding.coverage.percent   # → 100
```

**Expected**: the enclosing index/sync **still reports success** with partial vectors
written (bounded retries then clean advisory abort); a subsequent run resumes and
reaches 100% with **no manual intervention** and no resume command (progress is derived
from missing/stale rows — no checkpoint to corrupt).

### B5 — Dimension conflict (Acceptance US3-4, FR-021)

When the endpoint returns a vector whose dimension conflicts with the enforced value,
the pass surfaces an actionable error **naming `CODEGRAPH_EMBEDDING_DIMS`**, treats the
pass as failed, and the enclosing operation still succeeds.

---

## Success-criteria traceability

| SC | Scenario | Check |
|---|---|---|
| SC-001 | A1 | `embedding.coverage.percent === 100`; model+dims correct |
| SC-002 | A2 | byte-identical dormant behavior; zero requests/writes/log-lines |
| SC-003 | B1 | re-embed count == changed inputs (+missing); removed vector deleted |
| SC-004 | B3 | single plain sync → 100% from a zero-vector start |
| SC-005 | B4 | success exit on outage; resume to 100% after restore |
| SC-006 | A4 | node/edge counts identical with vs without |
| SC-007 | A5 | key/URL-credential absent from all files/logs/errors; endpoint redacted |
| SC-008 | A6 | no new runtime dependency; no telemetry event |
| SC-009 | A2 · T019/T020 | half-config → actionable missing-variable message; zero requests/writes; success exit; distinct from neutral dormant (`misconfigured`/`missingVariable`) |
| SC-010 | A1/B4 · T016/T024/T031 | no wall-clock target — bounded batch/concurrency/timeout/retries, batched commit + WAL checkpoint, responsive reads, observable `embedding` phase; unreachable endpoint aborts within one batch's retry budget |
| SC-011 | T016/T021 | one network destination (the configured endpoint); each body exactly `{model, input}`; composed input in no local sink — only `input_hash` persisted |

SC-009 / SC-010 / SC-011 have no standalone CLI probe above; they are verified by the
referenced unit/integration test tasks (the mock-endpoint suite captures each request's
destination and body, asserts the half-config `misconfigured` message, and measures the
bounded-resource behavior) — so all eleven criteria trace to observable checks.

**Definition of done (per slice)**: `npm run typecheck` + `npm test` green, and every
scenario for that slice observably passes (Constitution IV — evidence, not vibes).
