# Tasks: Embedding Infrastructure & Endpoint Provider (SPEC-001)

**Input**: Design documents from `/specs/001-embedding-infrastructure/`

**Prerequisites**: plan.md (required), spec.md (user stories), research.md (D1–D16),
data-model.md (5 entities), contracts/ (4 contracts), quickstart.md (SC probes)

**Tests**: **Included — TDD explicitly requested** by the workflow prompt and mandated by
Constitution IV (real temp-dir SQLite + a local mock OpenAI-compatible HTTP server; **no
DB mocking**). Every behavior task starts with a failing test; emergent-invariant tasks
(dormancy byte-identity, node/edge parity) ARE the test — the property must already hold
with no new production code.

**Reviewability**: The whole feature exceeds the block thresholds (>8 production files AND
>1 primary surface), so it ships as **two ratified slice-PRs** (spec Reviewability Budget /
plan). This task list preserves that split: **Slice A = US1** (T001–T023) must be fully
implementable, testable, and shippable as its own PR **before** **Slice B = US2 + US3**
(T024–T032) begins. T011 is the mandatory reviewability checkpoint.

**Organization**: Tasks are grouped by user story; each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup / Foundational / Polish carry no story label)
- Every task names an exact file path

## Path Conventions

Single project rooted at `src/`; tests in `__tests__/` mirroring the module layout
(per plan.md Structure Decision). All net-new logic is confined to `src/embeddings/`
(Constitution III fork discipline); edits to shared files are additive and minimal.

## Non-Goals Guardrail (design-concept §Non-goals — no task may cross these)

No SPEC-002 (bundled local model) or SPEC-003 (search-side vector consumption) work; **no
new CLI command** (`codegraph embed` — backfill heals via plain `sync`); **no new
telemetry**; **no multi-model storage** (one active model); **no detached background
lifecycle** (inline pass only); **no `src/mcp/` changes** — the daemon-watcher path is
covered for free because the pass lives in `sync()`, which the watcher already calls
(T026/T027). Vectors are written, **never read** on the retrieval surface (FR-026).

---

## Phase 1: Setup

**Purpose**: Anchor the baseline the dormancy (SC-002) and parity (SC-006) regression
checks compare against — no new dependency is installed (FR-025 forbids it).

- [X] T001 Confirm the branch baseline is green (`npm run build` && `npm test`) and record a `codegraph status --json` `{nodeCount, edgeCount}` snapshot on a throwaway `fs.mkdtempSync` project, to anchor the FR-024/SC-006 node-edge parity and FR-002/SC-002 dormancy-byte-identity comparisons; create the empty `src/embeddings/` module directory.

**Checkpoint**: Baseline recorded — foundational work can begin.

---

## Phase 2: Foundational (Blocking Prerequisites — shared substrate for BOTH slices)

**Purpose**: The config surface, provider seam, pure codec + input-hash helpers, and the
lockstep schema/migration that every user story depends on.

**CRITICAL**: No user-story work (Phase 3+) begins until this phase is complete.

- [X] T002 [P] Write failing unit tests in `__tests__/embeddings-config.test.ts` — `loadEmbeddingConfig(env)`: active iff `CODEGRAPH_EMBEDDING_URL` **and** `CODEGRAPH_EMBEDDING_MODEL` both non-empty (FR-001); returns `null` (dormant) when **neither** set (FR-002); returns a distinct half-config descriptor naming the missing variable when **exactly one** set (FR-001a/SC-009); `BATCH_SIZE`/`CONCURRENCY`/`TIMEOUT_MS` positive-int parse+clamp with invalid/blank→default 16/4/30000 (D4); endpoint-redaction helper strips userinfo/path/query to scheme+host+port and renders an unparseable URL as a safe placeholder (FR-023/D16); `isPlaintextRemoteEndpoint(url)` true for `http` non-loopback, false for loopback/`https` (Assumptions transport bullet).
- [X] T003 Implement `src/embeddings/config.ts` — `EmbeddingConfig` interface + `loadEmbeddingConfig(env): EmbeddingConfig | null` (null-return IS the dormancy signal) + a half-config descriptor (`missingVariable`) per FR-001a; positive-int parse+clamp following the `resolveParsePoolSize` precedent (`src/extraction/parse-pool.ts`); `redactEndpoint(url)` (scheme+host+port only, unparseable→placeholder) and `isPlaintextRemoteEndpoint(url)`; makes T002 pass (FR-001/FR-001a/FR-002/FR-003 key-optional/FR-004 dims-optional/FR-023/D3/D4/D16).
- [X] T004 [P] Implement `src/embeddings/provider.ts` — the `EmbeddingProvider` interface (`readonly id: string; readonly dims: number; embed(texts: string[]): Promise<Float32Array[]>`) per `contracts/embedding-provider.md` §1 (D2). Interface only — the seam SPEC-002/003 consume; no implementation, so no behavior test.
- [X] T005 [P] Write failing unit tests in `__tests__/embeddings-codec.test.ts` — `encodeVector(Float32Array)→Buffer` with `byteLength === dims*4`; `decodeVector(blob, dims)→Float32Array` round-trip identity element-for-element; endianness fixed little-endian regardless of host (FR-011/D7).
- [X] T006 Implement the little-endian f32 codec (`encodeVector`/`decodeVector`) as exported helpers in `src/embeddings/indexer-hook.ts`; makes T005 pass (FR-011/D7).
- [X] T007 [P] Write failing unit tests in `__tests__/embeddings-input-hash.test.ts` — `composeEmbeddingInput(symbol)`: fixed field order kind/name/signature/docstring/source per `contracts/embedding-provider.md` §3; ~6,000-char cap trims the **snippet last** and never drops other fields; **LF normalization + UTF-8** so a CRLF vs LF checkout of identical code composes byte-identically (FR-007); `computeInputHash` = `sha256` hex over the normalized bytes, stable across runs/platforms and identical content → identical hash (FR-008).
- [X] T008 Implement `composeEmbeddingInput(symbol)` + `computeInputHash(composed)` as exported helpers in `src/embeddings/indexer-hook.ts` — deterministic fixed-order join, LF/UTF-8 normalization, ~6000-char cap, `node:crypto` `createHash('sha256')`; makes T007 pass (FR-007/FR-008/D11).
- [X] T009 [P] Write failing tests in `__tests__/embeddings-index.test.ts` (schema-convergence section) — a freshly-created DB (from `schema.sql`) and a DB **upgraded from schema v7** yield an **identical `node_vectors` table shape** (assert `PRAGMA table_info` equality across both paths); the v8 migration is **DDL-only** and **idempotent** (re-open is a safe no-op) and applies atomically (FR-012/D8).
- [X] T010 Add `CREATE TABLE IF NOT EXISTS node_vectors (node_id TEXT PRIMARY KEY, model TEXT NOT NULL, dims INTEGER NOT NULL, vector BLOB NOT NULL, input_hash TEXT NOT NULL)` — **no foreign key** (D6/FR-016a) — to `src/db/schema.sql`, and add the **identical** DDL as a v8 migration `up` in `src/db/migrations.ts` (bump `CURRENT_SCHEMA_VERSION` 7→8), in lockstep; makes T009 pass. `copy-assets` needs no change (DDL lives inside the already-shipped `schema.sql`) (FR-012/D8; Constitution VII).
- [X] T011 Verify the reviewability budget against the planned two-slice file/LOC scope and record the ratified split (Slice A = US1 ~500 LOC/~8 files; Slice B = US2+US3 ~250 LOC) before implementation; confirm each slice stays at/below the block threshold (spec Reviewability Budget / plan). No code — a gate.

**Checkpoint**: Config, provider seam, codec, input-hash, and the v8 table exist and are
unit-green — user-story implementation can begin.

---

## Phase 3: User Story 1 - Configure and embed on index (Slice A) (Priority: P1) 🎯 MVP

**Goal**: A configured user runs a full index, every declaration-kind symbol gets a
persisted vector, and `status` shows endpoint/model/dims and 100% coverage. The complete
observable MVP; nothing downstream (SPEC-003/011/019) can start until this exists.

**Independent Test**: Configure URL+MODEL, run a full index against a real project, and
verify via `status --json` that coverage over embeddable symbols is 100%, model+dims match,
and a spot-checked symbol has a `dims*4`-byte vector blob (quickstart A1). No dependency on
Slice B.

### Tests for User Story 1 (write first — must FAIL before implementation) ⚠️

- [X] T012 [P] [US1] Write failing tests in `__tests__/embeddings-index.test.ts` (query-helper section) — `upsertNodeVector` inserts then **replaces on conflict** (FR-009/FR-010); `selectEmbeddableNodesMissingVector(activeModel)` returns only live **declaration-kind** nodes (FR-005) and never noise kinds `parameter/import/export/enum_member/field/property/file` (FR-006) that lack a current-model vector; `getEmbeddingCoverage(activeModel)` joins **FROM live nodes** so orphan vector rows are excluded and `embeddable===0 ⇒ percent 100` (FR-022); model match is **exact, case-sensitive** (FR-010).
- [X] T013 [US1] Implement the additive Slice-A query helpers in `src/db/queries.ts` — `upsertNodeVector(node_id, model, dims, vector, input_hash)` (`INSERT … ON CONFLICT(node_id) DO UPDATE`), `selectEmbeddableNodesMissingVector(activeModel)` (declaration-kind + no current-model vector), `getEmbeddingCoverage(activeModel)` (join-from-live-nodes, active-model filter); makes T012 pass (FR-005/FR-006/FR-009/FR-010/FR-016/FR-018/FR-022).
- [X] T014 [P] [US1] Write failing integration tests in `__tests__/embeddings-endpoint.test.ts` against a local `node:http` mock endpoint (ephemeral port, deterministic vectors) — success + **dimension inference** from the first batch; **keyless** vs `Authorization: Bearer` path (FR-003); 5xx/429 **retry+backoff** honoring `Retry-After`, then success and then retry→exhaustion→reject (FR-019); per-request **timeout** on a hanging endpoint (FR-019a); **401/403 fast-abort** without consuming the retry budget (FR-003/FR-019); **non-retryable 4xx** (400/404/422) fast-abort (FR-019); **response validation** — non-JSON/truncated body, missing embeddings, or an embedding **count ≠ batch size** fails the batch and persists nothing (FR-021a); **dimension conflict** raises an error naming `CODEGRAPH_EMBEDDING_DIMS` (FR-021); **recursive redaction** — a raw transport error's message, `cause` chain, and `.input` own-property, plus response-body text, never leak the key or URL creds; output order matches input order.
- [X] T015 [US1] Implement `src/embeddings/endpoint-provider.ts` — a `fetch`-based `EndpointProvider` (built-in global `fetch` + `AbortSignal.timeout`, **no new dependency**, FR-025): batching (default 16), bounded concurrency (default 4) over in-flight HTTP only, OpenAI `{model, input}` wire shape (`contracts/embedding-provider.md` §2), exponential backoff + full jitter (base 1000ms, ×2, ~8s cap, 3 retries) on 5xx/429/timeout/network (D5), **fast-abort** on 401/403 and other non-retryable 4xx (FR-003/FR-019), strict response validation with count-match (FR-021a), and **full replacement** of any transport/endpoint error with a new redacted error before it leaves the provider — recursively through `cause`/own-properties, response-body redacted too (FR-023); makes T014 pass (FR-003/FR-019/FR-019a/FR-021/FR-021a/FR-023/FR-025/D1/D5).
- [X] T016 [US1] Implement the **full-index embed pass** in `src/embeddings/indexer-hook.ts` — **stream/batched selection** of missing symbols (never materialize all symbols + composed inputs at once, FR-028), compose (T008) → embed (T015) → persist via `encodeVector` (T006) + `upsertNodeVector` (T013) in **batch-sized transactions** (one `db.transaction()` per completed batch — never per-row nor one pass-long tx, writes synchronous through the single `node:sqlite` connection, FR-029); **dimension infer→persist→enforce** via `project_metadata` scalars `embedding_dims`/`embedding_model` (`setMetadata`/`getMetadata`, D9/FR-004) with a conflict naming `CODEGRAPH_EMBEDDING_DIMS` (FR-021); **WAL checkpoint** the pass's bulk writes via the same `runMaintenance()` the index already runs, positioned so its writes are covered (FR-030); **advisory abort** on retry exhaustion leaving written vectors in place (FR-014/FR-019); runs **inside the existing index lock**, adds **no new lock**, and refreshes the held lock-file mtime at batch boundaries (FR-015a/FR-031). Failures identify a symbol by **node id, never by echoing its source** (FR-025a).
- [X] T017 [P] [US1] Add `'embedding'` to the `IndexProgress.phase` union in `src/extraction/index.ts` and a matching `embedding: 'Embedding symbols'` label to `PHASE_NAMES` in `src/ui/shimmer-progress.ts` — the two one-line additions beside the existing `scanning|parsing|storing|resolving` entries (D15/FR-022).
- [X] T018 [P] [US1] Implement the plaintext-`http`-remote **advisory warning** helper in `src/embeddings/config.ts` (message for `isPlaintextRemoteEndpoint(url)` — "source code and any bearer key would cross the network in cleartext"), warn-style, advisory-only, loopback stays warning-free; unit test in `__tests__/embeddings-config.test.ts` (Assumptions transport bullet — SHOULD).
- [X] T019 [US1] Wire the advisory embed pass into `indexAll()` **after reference resolution** in `src/index.ts` (the established "advisory — never fail an index over it" slot): construct the pass only when config is active (else fully dormant — zero network/writes/log-lines), emit the `'embedding'` progress phase (embedded ÷ eligible), and print the **one-line half-config advisory** (T003 descriptor) and the **plaintext-remote warning** (T018) to the command's own stdout — non-fatal, never a non-zero exit (FR-001a/FR-013/FR-014/FR-015a/Assumptions transport).
- [X] T020 [US1] Add the `status` **embedding section + `--json` parity** in `src/bin/codegraph.ts` (after the Index Statistics block) backed by a new `getEmbeddingStatus()` library method on the `CodeGraph` class in `src/index.ts` (sibling to `indexAll`/`sync`) over `getEmbeddingCoverage` + the metadata scalars — active (`endpoint` redacted to scheme+host+port, model, dims, `embedded/embeddable (NN%)`), neutral **dormant** line naming the two activation vars (+ `previousRun` read from disk only when prior-run vectors exist), and a distinct **misconfigured** line + `--json` `misconfigured`/`missingVariable` for the half-config state — per `contracts/status-embedding-json.md` (FR-022/FR-001a/FR-023).

### Slice A security & behavior invariant suites (extend `embeddings-index.test.ts`)

- [X] T021 [US1] Add the Slice-A **security-invariant** suite to `__tests__/embeddings-index.test.ts` — with `CODEGRAPH_EMBEDDING_API_KEY` set and creds embedded in the URL, the key and URL creds appear in **no** persisted file (neither `node_vectors` nor `project_metadata`), log line, or error message across success/timeout/network/4xx/5xx/dimension-conflict/malformed paths incl. the `cause` chain and `.input` (SC-007/FR-023); **code-egress**: a network capture during a pass shows requests to **exactly one** host (the configured endpoint), each body exactly `{model, input}` with no added metadata, and the composed input appears in no local sink — only `input_hash` persisted (SC-011/FR-025a); `package.json` gains **no runtime dependency** and no telemetry event fires (SC-008/FR-025).
- [X] T022 [US1] Add the Slice-A **behavior** suite to `__tests__/embeddings-index.test.ts` — full index → `embedding.coverage.percent === 100` with correct model+dims incl. **inferred** dims when `CODEGRAPH_EMBEDDING_DIMS` unset (SC-001, US1-AS1/AS4); **dormant byte-identity** (neither var set) → zero embedding requests, zero `node_vectors` writes, zero new log lines, results identical to a no-feature build (SC-002, US1-AS2); **keyless** endpoint embeds with no `Authorization` header (US1-AS3); **node/edge counts identical** with vs without the feature vs the T001 baseline (SC-006/FR-024); `status`/`--json` active + dormant + misconfigured shapes render correctly.
- [X] T023 [US1] **Slice A checkpoint** — run quickstart A1–A6 to green, add the Slice A user-facing `## [Unreleased]` entry to `CHANGELOG.md` (endpoint embeddings on full index; `status` coverage; the `CODEGRAPH_EMBEDDING_*` vars), and assemble the Slice A PR review packet (what changed, why, non-goals, review order, scope budget, traceability FR-005/FR-006→selection, FR-024→parity, FR-023→redaction, SC-001→coverage probe, verification evidence, known gaps, rollback = unset the two env vars). `npm run typecheck` + `npm test` green.

**Checkpoint**: **SLICE A COMPLETE — shippable, reviewable PR.** User Story 1 is fully
functional and independently testable. STOP and VALIDATE before starting Slice B.

---

## Phase 4: User Story 2 - Incremental freshness on edit (Slice B) (Priority: P2)

**Goal**: Each sync — CLI or the daemon watcher's automatic sync — re-embeds only symbols
whose embedding input genuinely changed and removes vectors for deleted symbols, keeping
the vector layer current at negligible endpoint cost.

**Independent Test**: From a fully-embedded project, edit one symbol's body, delete another,
run a sync; exactly the edited symbol re-embeds, the deleted symbol's vector is gone, and
untouched symbols are not re-embedded (mock endpoint request count == changed set) —
quickstart B1.

### Tests for User Story 2 (write first — must FAIL before implementation) ⚠️

- [X] T024 [P] [US2] Write failing tests in `__tests__/embeddings-sync.test.ts` — from 100% coverage: editing one symbol's body/signature re-embeds **only** that symbol (input_hash changed) and leaves all others untouched (FR-016); a **rename/move that doesn't change the input** does **not** re-embed (FR-016); deleting a symbol removes its vector via the **anti-join over the complete live node set** (FR-017), never falsely deleting vectors for files untouched by the incremental pass; the vector **survives** its file's node delete-and-reinsert cycle (no cascade, FR-016a); the re-embed **count == changed inputs (+ any previously missing)**, not repo total, and the per-sync staleness scan/anti-join issue zero embedding requests for unchanged symbols (FR-027/SC-003).
- [X] T025 [US2] Implement the incremental branch in `src/embeddings/indexer-hook.ts` + additive helpers in `src/db/queries.ts` — `selectStaleVectors(activeModel)` (rows whose `model ≠ activeModel`, FR-010) and in-pass `input_hash` staleness comparison against freshly-composed input over the `O(embeddable-symbols)` network-free scan (FR-016/FR-027), plus `deleteRemovedVectors()` = `DELETE FROM node_vectors WHERE node_id NOT IN (SELECT id FROM nodes)` evaluated against the whole live node set (FR-017); makes T024 pass.
- [X] T026 [US2] Wire the pass into `sync()` in `src/index.ts` — incremental missing/stale selection + reconciliation **delete on every vector-preserving pass** (both `sync()` and the library in-place `indexAll()` re-index; the DB-recreating full re-index is exempt), inside the existing index lock (no new lock), with the same half-config/plaintext advisories; this **automatically covers the daemon-watcher path** because the watcher already calls `sync()` — **no `src/mcp/` change** (FR-013/FR-015/FR-015a/FR-016/FR-016a/FR-017).
- [X] T027 [US2] Add a test in `__tests__/embeddings-sync.test.ts` asserting a watcher-triggered `sync()` runs the embed pass identically to a CLI sync (library-level; no real daemon spawned — src/mcp untouched) and that key/URL redaction holds on that path (FR-015/FR-023, US2-AS4).

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Late configuration and endpoint resilience (Slice B) (Priority: P3)

**Goal**: A repo indexed before configuring an endpoint backfills every missing vector via a
plain sync (no special command); if the endpoint fails mid-pass, the index/sync still
succeeds and the pass resumes from where it stopped on the next run.

**Independent Test**: (a) Index with no endpoint (zero vectors), configure, run one plain
sync → 100% coverage, no new command (quickstart B3). (b) Make the endpoint unreachable
mid-pass → operation still reports success with partial vectors; restore + rerun → 100%
(quickstart B4).

### Tests for User Story 3 (write first — must FAIL before implementation) ⚠️

- [X] T028 [P] [US3] Write a failing test in `__tests__/embeddings-sync.test.ts` — index with **no endpoint configured** (zero vectors), then configure the endpoint and run a **single plain `sync`**: coverage reaches 100% via the heal/backfill path with **no new or special command** (SC-004/FR-018, US3-AS1).
- [X] T029 [US3] Implement the late-config **backfill/heal** path in `src/embeddings/indexer-hook.ts` / `src/index.ts` — a plain sync selects every embeddable symbol missing a current vector and batch-embeds it, following the `vocabWasEmpty` end-of-sync heal precedent; makes T028 pass (FR-018/D14).
- [X] T030 [P] [US3] Write failing tests in `__tests__/embeddings-resilience.test.ts` (mock endpoint) — endpoint unreachable partway → bounded retries → **clean advisory abort** with already-written vectors intact and the enclosing index/sync **exit code 0** (SC-005/FR-014/FR-019); a subsequent run with the endpoint restored **resumes** and reaches 100% with **no manual intervention and no resume command** (progress derived from missing/stale rows — no checkpoint, FR-020); a dimension conflict on a later batch names `CODEGRAPH_EMBEDDING_DIMS` and fails the pass advisorily (FR-021).
- [X] T031 [US3] Implement/confirm **abort-then-resume** semantics in `src/embeddings/indexer-hook.ts` — missing/stale re-selection **is** the resume (no separate checkpoint state to corrupt), and per-batch lock-hold stays bounded by per-request-timeout × concurrency × retries so a fully-down endpoint aborts within one batch's budget (FR-020/FR-031); makes T030 pass.
- [X] T032 [US3] **Slice B checkpoint** — run quickstart B1–B5 to green; confirm US2 + US3 acceptance scenarios pass independently on a Slice-A-embedded project.

**Checkpoint**: All user stories independently functional; Slice B feature-complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize Slice B for its own PR and prove the whole feature is dormant-clean.

- [X] T033 [P] Add the Slice B user-facing `## [Unreleased]` entry to `CHANGELOG.md` — incremental freshness on edit, late-config backfill via plain `sync`, and endpoint-outage resilience (advisory abort + automatic resume). Plain-language, no internal paths/symbols/benchmarks.
- [X] T034 [P] Documentation touch-ups referencing the `CODEGRAPH_EMBEDDING_*` variables and the dormant-by-default behavior (vendor-neutral, no third-party endorsements; no README image bytes change, so no `?v=N` bump needed).
- [X] T035 **Dormancy + retrieval-surface regression proof** — run the full `npm test` suite with the feature **unconfigured** and confirm it is byte-identical-behavior green (FR-002/SC-002), the node/edge parity from T001 still holds (FR-024/SC-006), and **no change was made to the retrieval/MCP surface** — vectors are written but never read on the agent-facing path (FR-026); `src/mcp/` diff is empty.
- [X] T036 Assemble the Slice B PR review packet (what changed, why, non-goals, review order, scope budget, traceability SC-003→incremental-count probe, SC-004→backfill probe, SC-005→abort/resume probe, verification evidence, known gaps incl. the accepted FR-015a two-minute stale-reclaim limitation, rollback = unset the two env vars).
- [X] T037 Run full `quickstart.md` validation (A1–A6 + B1–B5) + `npm run typecheck` + `npm test` for both slices; record evidence (Constitution IV — evidence, not vibes).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)**: no dependency — start immediately.
- **Foundational (T002–T011)**: depends on Setup — **BLOCKS all user stories**. T011 (reviewability gate) must pass before any Phase 3 implementation.
- **US1 / Slice A (T012–T023)**: depends on Foundational. **Must fully complete and ship before Slice B** (workflow Scope Budget).
- **US2 / Slice B (T024–T027)**: depends on Slice A (there must be vectors to keep fresh).
- **US3 / Slice B (T028–T032)**: depends on US2's incremental/reconcile machinery (backfill + resume are "embed only what's missing/stale").
- **Polish (T033–T037)**: depends on Slice B being feature-complete.

### Key within-phase dependencies

- T003 ← T002; T006 ← T005; T008 ← T007 (T006/T008 share `indexer-hook.ts` — sequential); T010 ← T009.
- T013 ← T010, T012. T015 ← T004, T014. T016 ← T006, T008, T013, T015. T019 ← T016, T017, T018. T020 ← T013. T021/T022 ← T015–T020. T023 ← all US1.
- T025 ← T016, T024. T026 ← T025. T027 ← T026.
- T029 ← T026, T028. T031 ← T029, T030. T032 ← all Slice B.
- T035/T037 ← all implementation.

### Incremental Delivery

1. Complete Foundation: Setup + Foundational substrate (T001-T011) — config, provider seam, codec, input-hash, v8 migration.
2. Complete User Story 1: configure + full-index embedding, dims, status, progress (T012-T023) — Slice A, first PR.
3. Complete User Story 2: incremental freshness on edit via sync/watcher (T024-T027) — Slice B.
4. Complete User Story 3: late-config backfill + endpoint resilience (T028-T032) — Slice B.
5. Complete Polish: CHANGELOG, docs, dormancy proof, packets, validation evidence (T033-T037).

### Slice A / Slice B boundary

- **Slice A = T001–T023** (Setup + Foundational + US1) → **first PR**.
- **Slice B = T024–T032** (US2 + US3) → **second PR**; **T033–T037** finalize Slice B / cross-cutting.

---

## Parallel Opportunities

- **Foundational** — T002, T004, T005, T007, T009 are all `[P]` (five distinct files: `embeddings-config.test.ts`, `provider.ts`, `embeddings-codec.test.ts`, `embeddings-input-hash.test.ts`, `embeddings-index.test.ts`).
- **US1** — T012 (query test) ∥ T014 (endpoint test) ∥ T017 (progress union) ∥ T018 (plaintext helper) are `[P]` (distinct files). T021/T022 extend `embeddings-index.test.ts` sequentially (same file — not `[P]`).
- **US2/US3** — T024 `[P]`; T028 (`embeddings-sync.test.ts`) ∥ T030 (`embeddings-resilience.test.ts`) `[P]`.
- **Polish** — T033 (CHANGELOG) ∥ T034 (docs) `[P]`.

### Parallel example — Foundational

```bash
# Launch the four independent unit-test files together (TDD, write-to-fail):
Task: "T002 embeddings-config.test.ts"      # config parse/activation/redaction
Task: "T005 embeddings-codec.test.ts"       # f32 blob round-trip
Task: "T007 embeddings-input-hash.test.ts"  # deterministic input + hash
Task: "T009 embeddings-index.test.ts"       # schema-convergence fresh-vs-upgraded
# In parallel, implement the interface-only file:
Task: "T004 src/embeddings/provider.ts"     # EmbeddingProvider interface
```

---

## Implementation Strategy

### MVP first (Slice A = User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational (T011 gate) → 3. Phase 3 US1 →
4. **STOP and VALIDATE** (T023 quickstart A1–A6) → 5. Ship Slice A PR.

### Incremental delivery (Slice B)

Slice A merged → add US2 (incremental + reconcile) → add US3 (backfill + resilience) →
T032 validate → Polish (T033–T037) → ship Slice B PR. Each slice adds value without
breaking the previous.

---

## Requirement → Task Traceability (for G5 cross-reference)

| FR / SC | Task(s) |
|---|---|
| FR-001 / FR-002 (activation / dormancy) | T003, T019, T022, T035 |
| FR-001a / SC-009 (half-config error, both surfaces) | T002, T003, T019, T020 |
| FR-003 (key optional; 401/403 non-retryable) | T014, T015 |
| FR-004 (dims optional → infer/persist/enforce) | T003, T016 |
| FR-005 / FR-006 (declaration-only selection) | T012, T013 |
| FR-007 (deterministic input + LF/UTF-8 normalization) | T007, T008 |
| FR-008 (SHA-256 input hash) | T007, T008 |
| FR-009 / FR-010 (one vector/symbol; exact single-model match) | T012, T013, T016, T025 |
| FR-011 (little-endian f32 blob) | T005, T006 |
| FR-012 (lockstep migration + convergence assertion) | T009, T010 |
| FR-013 / FR-014 (inline post-resolution; advisory) | T016, T019, T026 |
| FR-015 (everywhere sync runs, incl. daemon watcher) | T026, T027 |
| FR-015a (index-lock inheritance + fail-fast, no new lock) | T016, T019, T026 |
| FR-016 / FR-016a (incremental; no cascade delete) | T024, T025 |
| FR-017 (anti-join reconciliation over full live set) | T024, T025 |
| FR-018 (plain-sync backfill) | T028, T029 |
| FR-019 / FR-019a (bounded retry/abort; per-request timeout) | T014, T015, T030, T031 |
| FR-020 (resume after abort, no checkpoint) | T030, T031 |
| FR-021 / FR-021a (dims conflict; response validation/count) | T014, T015, T030 |
| FR-022 (status coverage/model/dims, --json parity) | T012, T013, T020 |
| FR-023 (key/URL-cred redaction, recursive) | T002, T003, T015, T021 |
| FR-024 / SC-006 (node/edge parity) | T001, T022 |
| FR-025 / SC-008 (no new dep; no telemetry) | T015, T021 |
| FR-025a / SC-011 (code-egress invariant; input never logged) | T016, T021 |
| FR-026 (retrieval surface untouched) | T035 |
| FR-027 (endpoint-work proportionality) | T024, T025 |
| FR-028 (bounded memory / streaming) | T016 |
| FR-029 (batch-transaction commits) | T016 |
| FR-030 (WAL checkpoint via runMaintenance) | T016 |
| FR-031 (read responsiveness + bounded lock-hold + freshness refresh) | T016, T031 |
| Plaintext-http-remote advisory (SHOULD) | T002, T018, T019 |
| SC-001 (100% coverage) | T022, T023 |
| SC-002 (dormancy byte-identity) | T022, T035 |
| SC-003 (incremental re-embed count) | T024 |
| SC-004 (single-sync backfill) | T028 |
| SC-005 (outage abort + resume) | T030 |
| SC-007 (key never leaks) | T021 |
| SC-010 (measurable codegraph-side bounds) | T016, T024, T031 |

---

## Notes

- `[P]` = different files, no incomplete dependency. `[Story]` maps each task to US1/US2/US3.
- TDD: verify each test FAILS before implementing; commit after each task or logical group.
- Tests use `fs.mkdtempSync` temp dirs + a local `node:http` mock endpoint; cleanup in `afterEach`; **no DB mocking** (Constitution / plan).
- Stop at either slice checkpoint (T023, T032) to validate independently.
- Non-goals guardrail (top of file) is binding — flag any task drift into SPEC-002/003, a new CLI command, telemetry, multi-model storage, background lifecycle, or `src/mcp/`.
