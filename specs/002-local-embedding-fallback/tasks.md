---
description: "Task list — Bundled Local Embedding Fallback (SPEC-002)"
---

# Tasks: Bundled Local Embedding Fallback (SPEC-002)

**Input**: Design documents from `/specs/002-local-embedding-fallback/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/local-provider.md, contracts/model-fetch.md, quickstart.md

**Tests**: INCLUDED — the workflow prompt requests TDD (red → green → refactor) throughout. Every test exercises **real SQLite + real files** (no DB mocking), mirroring the existing `__tests__/embeddings-*.test.ts` suites. Platform-divergent cache paths (POSIX XDG vs Windows `%LOCALAPPDATA%`) are `it.runIf`-gated and validated on the real platform.

**Reviewability**: Plan projects **~650–680 reviewable production LOC across 8 production files** (4 new + 4 modified) — over the soft warn thresholds (400 LOC / 6 files), **within** the hard block limits (800 LOC / 8 files / 25 total files / 1 primary surface). Greenfield allowance applies; **no split**. T006 is the explicit reviewability checkpoint required by this overage. Total files (production + BUNDLING.md + ~7 test suites) ≈ 16 — under the 25-file hard block.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. Phase sequencing follows the plan's **dependency/review order** (`config.ts` → `model-fetch.ts` → tokenizer → worker → provider → wiring → status → docs), so the shared acquisition module (US2/US3, a hard build-prerequisite of the US1 provider) is built before the US1 provider even though US1 is the highest-priority story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Single project — CodeGraph library + CLI + MCP server. New capability lives under the existing `src/embeddings/`; tests under `__tests__/`. All paths repo-relative.

---

## Phase 1: Setup & Dormancy Guard

**Purpose**: Establish the byte-identical-dormancy anchor FIRST (Constitution VII / SC-004), then add the runtime dependency.

- [x] T001 **[MANDATORY FIRST — dormancy guard, SC-004 / FR-005]** Create `__tests__/embeddings-dormancy.test.ts`: with NO embedding env at all (`CODEGRAPH_EMBEDDING_PROVIDER`, endpoint URL, and MODEL all unset), a full `codegraph index` over a real temp project performs **ZERO network calls** (assert via an injected/spied `fetch`/`undici` call-counter that stays at 0) and **ZERO `node_vectors` writes** (`select count(*) from node_vectors` === 0), observably byte-identical to a no-feature build. Write it RED (wire the counters/assertions), then confirm GREEN against current dormancy **before any provider code exists**. This suite MUST stay green after every later phase.
- [x] T002 Add `onnxruntime-web@1.27.0` (MIT, pure-JS/WASM) as a **production `dependency`** in `package.json` (NOT dev, NOT optional) so the bundle's `npm ci --omit=dev` ships it; run the repo package manager install; confirm the npm `engines` range `>=20 <25` is **unchanged** (FR-024); confirm the runtime `.wasm` self-resolves from `node_modules/onnxruntime-web/dist/` (no `copy-assets` change needed — research.md finding 2) (FR-011 / FR-024).

**Checkpoint**: Dormancy is pinned by a green guard; the pure-WASM runtime is installed with engines preserved.

---

## Phase 2: Foundational — Provider selection (BLOCKS all user stories)

**Purpose**: The `CODEGRAPH_EMBEDDING_PROVIDER` selector + `EmbeddingLocalConfig` union arm + FR-003 precedence. Every user story branches on this typed result, so it is foundational.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [x] T003 [P] Create `__tests__/embeddings-config-selection.test.ts` (RED): assert the FR-003 resolution table (data-model §1, all 7 rows) — `off`→`null` short-circuit (present URL/MODEL ignored); explicit `local`→`EmbeddingLocalConfig` (no URL required); explicit `endpoint` with complete URL+MODEL→`EmbeddingConfig`, with missing URL/MODEL→`EmbeddingMisconfig` (**never** downgraded to local); NO explicit selection falls through to SPEC-001 UNCHANGED (both set→endpoint, exactly one→misconfig naming the missing var, neither→`null` dormant). Assert `--embeddings` flag value overrides env for one invocation, and that a half-config is NEVER silently downgraded to `off`/local (FR-001, FR-002, FR-003, FR-004, FR-006).
- [x] T004 In `src/embeddings/config.ts`: add the `EmbeddingLocalConfig` interface arm (`provider:'local'`, `model`, `dims:384`, `batchSize`, `concurrency` with local-tuned clamp ceilings — NOT the endpoint's 2048/64) and grow `EmbeddingConfigResult` to the 4-arm union; read `CODEGRAPH_EMBEDDING_PROVIDER` (accepts exactly `endpoint`|`local`|`off`) and layer the FR-003 precedence ABOVE SPEC-001's unchanged endpoint resolution; PRESERVE the SPEC-001 `null`-dormancy and `EmbeddingMisconfig` half-config arms EXACTLY. Make T003 green (FR-001, FR-003, FR-004, FR-005, FR-006, FR-007). Keep the diff a minimal additive branch (Principle III).
- [x] T005 In `src/embeddings/indexer-hook.ts`: retype `RunEmbeddingPassOptions.config` to the structural subset `EmbedPassConfig { model; batchSize; concurrency; dims? }` (data-model §1) so both `EmbeddingConfig` and `EmbeddingLocalConfig` satisfy the pass without a `url`; no other `runEmbeddingPass` logic changes (~+8 LOC). Confirm the SPEC-001 endpoint suites (`embeddings-endpoint`, `embeddings-index`, `embeddings-sync`) stay green.
- [x] T006 **Reviewability checkpoint** (required by the budget overage): verify the planned task/file scope against the budget (~650–680 reviewable LOC / 8 production files / ~16 total files / 1 primary surface); confirm it stays within the hard block (800 LOC / 8 production files / 25 total files) and record the **no-split + greenfield-allowance** decision (plan.md Reviewability Budget) before implementation proceeds.

**Checkpoint**: Selection resolves to one of four typed outcomes; dormancy + half-config preserved; the pass accepts a local config. User stories can now begin.

---

## Phase 3: User Stories 2 & 3 — Model acquisition & graceful degradation (Priority: P2)

**Goal**: Lazily acquire the pinned model + tokenizer on first local use, verify every artifact against a source-pinned SHA-256 before use, cache machine-wide, and degrade gracefully (offline / checksum / cache) with distinct actionable messages. This module (`src/embeddings/model-fetch.ts`) is a hard build-prerequisite of the US1 provider.

**Independent Test (US2)**: empty cache + network → model+tokenizer downloaded once, each verified against its pin, then reused with zero further downloads on the next run; mismatched bytes rejected 0%-used.

**Independent Test (US3)**: no network + empty cache → `acquireLocalModel` returns a typed `{unavailable, message}` (never throws), and end-to-end the structural index completes, the embed pass is skipped, and `codegraph status` states the reason.

### Blocking gate + tests (write FIRST)

- [x] T007 **[BLOCKING — tokenizer SHA-256 pin, FR-013]** Fetch `tokenizer.json` (711,661 bytes) from the pinned commit `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer.json`, compute its SHA-256 from the real bytes, and pin BOTH digests as source constants in `src/embeddings/model-fetch.ts` — model `model_quantized.onnx` (22,972,370 bytes, sha256 **already known** `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`) and the newly-computed `tokenizer.json` digest. FR-013's per-artifact verification has no trust anchor for the tokenizer until this digest is recorded, so this gates T010 and the local provider shipping.
- [x] T008 [P] [US2] Create `__tests__/embeddings-model-fetch.test.ts` (RED, real files): cache-dir resolution 4-case formula (FR-016 — `it.runIf`-gate the POSIX/XDG vs Windows `%LOCALAPPDATA%` rows); reuse-if-present-and-verified with no re-download (FR-018 / SC-002); download-then-verify success; **checksum mismatch → temp discarded, never promoted, never used** (FR-014 / SC-003); atomic verify-before-rename (partial temp treated as absent); download size + wall-clock bounds abort → unavailability (FR-013a); `CODEGRAPH_MODEL_BASE_URL` override applies the SAME pin and is redacted to scheme+host+port in messages (FR-015 / FR-019); the three `unavailable` reasons carry DISTINCT actionable messages (FR-019/019a); `acquireLocalModel` never throws.

### Implementation (US2 — acquisition)

- [x] T009 [US2] In `src/embeddings/model-fetch.ts`: resolve the machine-wide cache dir via the FR-016 4-case platform formula (POSIX `~/.codegraph/models` / `$XDG_CACHE_HOME/codegraph/models`; Windows `%LOCALAPPDATA%\codegraph\models` / `<home>/AppData/Local/codegraph/models`), honoring `CODEGRAPH_MODEL_CACHE_DIR` (FR-017), and validate it with a **purpose-built** cache-path guard (FR-017a): reject `../` traversal and PREFIX-match against `SENSITIVE_PATHS` (the cache is a write sink — prefix, not exact), evaluated AFTER `realpath` symlink resolution; do NOT reuse `validateProjectPath` verbatim (it false-rejects a legit `~/.config` XDG cache — research.md finding 1). Never inside any project `.codegraph/`.
- [x] T010 [US2] In `src/embeddings/model-fetch.ts`: implement lazy download of BOTH `onnx/model_quantized.onnx` AND `tokenizer.json` (base URL + repo-relative path appended); per-artifact SHA-256 **verify-before-use** against the T007 pins; atomic promote — write to a temp file created **exclusively** (`O_EXCL`, fail-if-exists, no-clobber), **not following a pre-existing symlink**, with an **unpredictable name** (FR-017a), verify its SHA-256, then `rename` temp→final only on match (FR-014); reuse-if-cached-and-verified without downloading (FR-018). Verified bytes are the only bytes ever loaded/parsed/persisted (FR-012/013/014). Depends on T007.
- [x] T011 [US2] In `src/embeddings/model-fetch.ts`: bound each artifact download by (a) a max byte budget derived from the pinned exact size (abort once bytes exceed the pinned length) and (b) a download wall-clock timeout — exceeding either aborts and degrades as unavailability (FR-013a, distinct from FR-019b's session-init timeout); wire the `CODEGRAPH_MODEL_BASE_URL` override constrained to an **`http`/`https` scheme only** (reject `file:`/`ftp:`/`data:` → invalid config) and read ONLY from the process environment (never project-local config), plus `CODEGRAPH_MODEL_CACHE_DIR` (FR-015 / FR-017).

### Implementation (US3 — degradation)

- [x] T012 [US3] In `src/embeddings/model-fetch.ts`: return the typed `LocalModelUnavailable { unavailable: 'offline'|'checksum'|'cache'; message }` outcomes with DISTINCT actionable messages — `offline` names the resolved cache dir + `CODEGRAPH_MODEL_BASE_URL` + the exact filename to pre-seed; `checksum` is tamper-aware (bytes failed SHA-256, discarded, advise retry / check the override); `cache` names the resolved dir + `CODEGRAPH_MODEL_CACHE_DIR`; a mid-download I/O failure resolves to `cache` (not `offline`). Redact any `CODEGRAPH_MODEL_BASE_URL` echo to scheme+host+port via SPEC-001's `redactEndpoint` (FR-019 credential-leak guard), and NEVER echo source text / composed embedding input (FR-019c). `acquireLocalModel` NEVER throws — the outcome is an advisory the pass/provider treats as a skip (FR-007 / FR-019 / FR-019a). Make T008 green.

> US3's end-to-end degrade ("embed pass skipped, structural index still completes") can only be shown once the pass is wired — it is validated by **T020** in Phase 4 (after T018).

**Checkpoint**: Model acquisition verifies-before-use, reuses the shared cache, and degrades to a typed advisory skip with distinct messages. The provider can now consume verified paths.

---

## Phase 4: User Story 1 — Embed locally with no endpoint (Priority: P1) 🎯 MVP

**Goal**: With the local provider active, `codegraph index` embeds every symbol locally, in-process, off the main thread, using the acquired+verified model. This is the core capability (the MVP; demonstrable on a machine with the model cached).

**Independent Test**: on a machine with the model already cached, set `CODEGRAPH_EMBEDDING_PROVIDER=local`, index a small project, confirm every symbol carries a 384-dim embedding and no endpoint was configured or contacted.

### Tests for User Story 1 (write FIRST) ⚠️

- [x] T013 [P] [US1] Create `__tests__/embeddings-local-tokenizer.test.ts` (RED): pure BERT WordPiece `encode(text)` emits `{ inputIds, attentionMask, tokenTypeIds }` as `BigInt64Array`s of shape `[1, seqLen]` — `[CLS]`/`[SEP]` framing, `[PAD]` handling, attention mask (1 for real tokens / 0 for pad), all-zero token-type ids, truncation at max sequence length. Unit-testable without loading ONNX (FR-009).
- [x] T014 [P] [US1] Create `__tests__/embeddings-local-provider.test.ts` (RED): `LocalProvider` reports `dims === 384` up front (never the `0` sentinel); `embed(texts)` is order-preserving (one `Float32Array(384)` per input, index i→vector i); the session is initialized **at most once per pass** (FR-010a); a missing/corrupt runtime `.wasm` (or a stubbed hanging `create()`) is converted by the FR-019b timeout into an **advisory reject** — the provider rejects within the timeout rather than hanging, and the reason echoes no source text (FR-019c). Failure is advisory (never thrown at the index) (FR-008/010a/011/019b).

### Implementation for User Story 1

- [x] T015 [US1] Create `src/embeddings/local-tokenizer.ts` — a pure module: BERT WordPiece tokenization producing the 3 int64 `BigInt64Array` tensors (`input_ids`/`attention_mask`/`token_type_ids`) from the verified `tokenizer.json` vocab. No ONNX import. Make T013 green (FR-009).
- [x] T016 [US1] Create `src/embeddings/local-embed-worker.ts` — a `worker_threads` entry (mirroring `src/extraction/parse-worker.ts`) with a `parentPort` message protocol (`init` → `ready`/`init-error`; `embed` → `embed-result`/`embed-error`; `shutdown` → `shutdown-ack`). On `init`: wrap `InferenceSession.create()` in a **timeout** (default ~30 s, an internal constant — not operator-tunable) so a missing/corrupt `.wasm` HANG degrades to model-unavailable instead of freezing (FR-019b, research.md OQ-1), and **bound `ort.env.wasm.numThreads`** so the WASM pool leaves ≥1 core free (single-threaded or cores−1, exact bound pinned here — mirrors the parse pool's core-leaving clamp; **the exact value pinned here is the one T029 validates against SC-010**) so an embed pass doesn't starve the daemon/watcher (FR-010b). This per-pass clamp plus the existing per-project file lock (which already serializes `index`/`sync` around the embed pass, reused unchanged) is the concurrent-pass bound for the spec Edge Case "Multi-project concurrent passes"; cross-process arbitration across independent per-project daemons matches the parse pool's posture (per-process core-leaving + OS scheduling — no machine-wide coordinator added). On `embed`: per text tokenize → `session.run` → **mean-pool over `attention_mask`** → **L2-normalize** → `Float32Array(384)` (FR-010).
- [x] T017 [US1] Create `src/embeddings/local-provider.ts` — `LocalProvider implements EmbeddingProvider` (`src/embeddings/provider.ts`): `dims: 384` statically up front; lazy init on first `embed()` — call `acquireLocalModel` (model-fetch), spawn the worker, initialize the session ONCE per pass and reuse for every batch (FR-010a); order-preserving `embed()` marshals texts to the worker and reassembles vectors by index; `close()` terminates the worker at end of pass; acquisition/session-init failure becomes a **redacted, actionable reject** that `runEmbeddingPass` catches as `{ aborted, abortReason }` — advisory, never thrown at the index, no source echoed (FR-008/010/010a/011/019b/019c). Make T014 green.
- [x] T018 [US1] In `src/index.ts` `maybeRunEmbeddingPass`: add the `config.provider === 'local'` branch that builds a `LocalProvider` and drives the EXISTING `runEmbeddingPass` over `node_vectors` — reusing SPEC-001's model-column-mismatch re-embed with **no new mechanism** (FR-022); emit an FR-021a first-run status signal for model acquisition (~22 MB download) and session cold-load (both precede the first per-batch progress ping) via SPEC-001's `onProgress` hook (e.g. "downloading model…", "loading model…"). Keep the diff a minimal additive branch (FR-008/021a/022).
- [x] T019 [US1] Create `__tests__/embeddings-local-index.test.ts` (real SQLite + a pre-seeded/verified cached model or an injected acquire): end-to-end with `CODEGRAPH_EMBEDDING_PROVIDER=local`, index a small project → **100% of embeddable symbols carry a vector**, `node_vectors.model` is the checkpoint id, `node_vectors.dims === 384`, no endpoint configured or contacted (SC-001); a re-embed of identical source leaves **node and edge counts unchanged** (FR-023 / SC-007); switching a previously endpoint-embedded project to local re-selects+re-embeds ALL symbols via the model-column mismatch with no manual migration (FR-022 / SC-008).
- [x] T020 [US3] Extend `__tests__/embeddings-local-index.test.ts`: assert the offline/unavailable **end-to-end degrade** — with acquisition returning unavailable (empty cache + unreachable base URL), the **structural index completes fully**, the embed pass is **skipped**, the process exits **0** (non-zero is reserved for a failed structural index), an actionable message is surfaced, and `codegraph status` reports coverage 0% with the reason (FR-007 / FR-019 / SC-005). Depends on T018 wiring.

**Checkpoint**: User Story 1 is fully functional — local, in-process, off-thread embedding with a cached model; re-embed leaves the graph unchanged; and (T020) the offline case degrades gracefully end-to-end.

---

## Phase 5: User Story 4 — Status shows the active local provider (Priority: P3)

**Goal**: `codegraph status` shows the active provider (`local`), the model, the vector dimensions, live coverage, and — when the pass was skipped — the distinct 0%-coverage reason.

**Independent Test**: with the local provider active and the model available, run `codegraph status` and confirm the output names provider `local`, model `Xenova/all-MiniLM-L6-v2`, dims `384`, and coverage.

- [x] T021 [P] [US4] Create `__tests__/embeddings-local-status.test.ts` (RED): with the local provider active, `codegraph status` reports provider `local`, the model, dims `384`, and `embedded/embeddable (percent)` coverage (FR-021 / SC-006); when the pass was skipped, status reports the DISTINCT 0%-coverage reason — one of offline / checksum-mismatch / unwritable-or-invalid cache / misconfig / session-init timeout — best-effort where determinable at status time (FR-020).
- [x] T022 [US4] In `src/index.ts` `getEmbeddingStatus`: add the `local` arm to the observability snapshot (provider `local`, model, dims `384`, coverage) and surface the distinct skip reason where determinable (FR-020 / FR-021).
- [x] T023 [US4] In `src/bin/codegraph.ts` status render: display provider `local` / model / dims / coverage and the distinct 0%-reason in the Embeddings block, plus the FR-021a acquisition/cold-load status signal. Make T021 green (FR-020/021/021a / SC-006).

**Checkpoint**: The active local configuration and any skip reason are legible via `codegraph status`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The remaining selection input, delivery/bundling documentation, dogfood + performance validation, and the PR packet.

- [x] T024 [US1] [US2] In `src/bin/codegraph.ts`: add the `--embeddings <local|endpoint|off>` option to the `index` command that overrides `CODEGRAPH_EMBEDDING_PROVIDER` for that single invocation, threading the value into the config resolution (FR-002 — resolution semantics already covered by T004/T003).
- [x] T025 Verify `scripts/build-bundle.sh` preserves `node_modules/onnxruntime-web/dist/*.wasm` in the bundled runtime tree — specifically that the `.wasm` variants **survive `build-bundle.sh`'s `npm ci --omit=dev --ignore-scripts`** (they ship inside the published `onnxruntime-web` tarball, so no postinstall/build step is required to materialize them — confirm the `.wasm` files are actually PRESENT, not merely that `node_modules/onnxruntime-web` exists). The ORT `.wasm` self-resolves from `node_modules` like tree-sitter (research.md finding 2 / follow-up); record the result (FR-024 delivery).
- [x] T026 [P] Create `BUNDLING.md` documenting the `onnxruntime-web` runtime footprint (~131 MB unpacked in `node_modules`, ships web+node+7 `.wasm` variants; all transitive deps pure-JS), that it MUST be a production `dependency` so the bundle's `npm ci --omit=dev` ships it, that the `.wasm` needs NO `copy-assets` (self-resolves from `node_modules`), and that model weights are **lazy-downloaded, not bundled** (FR-024).
- [x] T027 Add a user-facing CHANGELOG.md entry under `## [Unreleased]` for the explicit-opt-in local embedding provider (keep it plain-language; `CODEGRAPH_EMBEDDING_PROVIDER=local` / `--embeddings local` are user-typed and retained per house rules).
- [x] T028 **Self-repo dogfood UAT** (binding — Dogfooding Protocol): switch THIS repo from the HAL endpoint to `CODEGRAPH_EMBEDDING_PROVIDER=local`, `npm run build`, `codegraph sync` to re-embed locally, and confirm `codegraph status` is healthy (provider `local`, model, dims `384`, coverage); record provider/model/dims/coverage before-after and node/edge stability in the spec's UAT runbook + retrospective (SC-008 / quickstart self-repo UAT).
- [x] T029 Performance probe (SC-009 / SC-010): on the self-repo (or a large real repo) assert warmed per-symbol embedding is single-digit ms (target ≤8 ms/text median), session cold-load ≤~300 ms once per worker, memory bounded by SPEC-001 per-super-chunk streaming, and — with the exact FR-010b `numThreads` bound **that T016 pinned** applied — the daemon event loop is not stalled for long stretches during a full local embed pass (this is the SC-010 validation, run against the value T016 pinned). Additionally record **single-session WASM-heap evidence** — the worker's own RSS/heap sampled across a full long pass — to discharge the spec Edge Case "Long-pass worker heap" via its measured-evidence escape hatch: if the single-session heap does NOT stay bounded, add a parse-pool-style recycle-after-threshold (`src/extraction/parse-pool.ts` precedent); otherwise record the bounded measurement and add no recycle (Principle II — one long-lived session per pass per FR-010a). Record the numbers (Constitution VI methodology).
- [x] T030 Retrieval non-regression A/B (SC-011): confirm enabling the local provider leaves the retrieval/tool surface unchanged — `codegraph_explore` call-count + output budgets identical — and a control-repo A/B shows no retrieval regression while a local embed pass runs (≥2 runs/arm, Sonnet floor model). This VALIDATES the SPEC-003 boundary is not crossed.
- [x] T031 Generate the PR review packet: what changed, why, non-goals (retrieval quality → SPEC-003; GPU; fine-tuning; bundled/optional-dep weights; auto-activation; first-party mirror), review order (`config.ts` → `model-fetch.ts` → `local-tokenizer.ts` → `local-embed-worker.ts` → `local-provider.ts` → `index.ts`/`bin/codegraph.ts` → `BUNDLING.md`), scope budget (~650–680 LOC / 8 files, advisory WARN within block), traceability (FR/SC ↔ files ↔ tests), verification evidence, known gaps, and rollback/flag notes (unset config = byte-identical dormant).
- [x] T032 Run quickstart.md Scenarios 1–7 + the self-repo dogfood, then `npm run build` && `npm test` green (including the 7 new `embeddings-*` suites: dormancy, config-selection, model-fetch, local-tokenizer, local-provider, local-index, local-status).

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup & Dormancy)**: no dependencies — start immediately. T001 is the mandatory first gate; it MUST stay green after every later phase.
- **Phase 2 (Foundational selection)**: depends on Phase 1 — **BLOCKS all user stories** (every story branches on the typed config result). T006 reviewability checkpoint closes the phase.
- **Phase 3 (US2 & US3 — model-fetch)**: depends on Phase 2. T007 (SHA pin) BLOCKS T010. This module is a hard build-prerequisite of the US1 provider (T017 consumes `acquireLocalModel`). US3's unit-level typed outcomes/messages land here (T012); its end-to-end degrade (T020) is deferred to Phase 4 because it needs the T018 wiring.
- **Phase 4 (US1 — provider)**: depends on Phase 2 (config) + Phase 3 (acquisition). Within: T015 → T016 (worker imports tokenizer) → T017 (provider spawns worker + consumes model-fetch) → T018 (wiring) → T019 (integration).
- **Phase 5 (US4 — status)**: depends on T018 wiring + T004 config.
- **Phase 6 (Polish)**: T024 depends on T004; T025/T026 depend on T002; T028–T030 depend on the full pass (through Phase 4/5); T031/T032 last.

### Within each user story

- Tests are written and FAIL before implementation (T003→T004; T008→T009/T010/T011/T012; T013→T015; T014→T017; T021→T022/T023).
- Tokenizer before worker before provider before wiring; core implementation before integration.

### Parallel opportunities

- **[P] test-authoring / doc tasks** (distinct new files, no shared-state write): T003, T008, T013, T014, T021, T026.
- T013 and T014 can be authored together (different test files). Implementation tasks touching the same file are sequential: T009/T010/T011/T012 all edit `model-fetch.ts`; T022/T023 the status render path.

### Parallel example (Phase 4 tests)

```bash
# Author the two US1 test suites together (both RED before implementation):
Task: "Create __tests__/embeddings-local-tokenizer.test.ts (T013)"
Task: "Create __tests__/embeddings-local-provider.test.ts (T014)"
```

---

## Implementation Strategy

### MVP (User Story 1)

1. Phase 1 (Setup & dormancy guard) → Phase 2 (Foundational selection).
2. Phase 3 acquisition (at minimum the resolve+reuse-if-verified path so a **pre-seeded cached model** loads; full lazy download completes US2).
3. Phase 4 (US1 provider + wiring + integration) → **STOP and VALIDATE** SC-001/SC-007/SC-008 on a machine with the model cached.

The spec's US1 independent test is defined on a pre-seeded cache, so US1 is demonstrable without the download path — US2 (lazy download) removes the pre-seed requirement, US3 adds graceful degradation.

### Incremental delivery

Setup+Foundational → US2/US3 acquisition (fresh-machine + offline-safe) → US1 (embed, MVP) → US4 (status) → polish (flag, BUNDLING.md, dogfood, perf, A/B, PR packet). Each phase is an independently testable increment; unset config stays byte-identical dormant throughout (T001 guards it).

---

## Non-Goals Guard (flag any task that crosses these)

No task in this list crosses a Non-goal. Explicitly bounded away from: **GPU execution paths**, **model fine-tuning**, **retrieval/search behavior or quality (SPEC-003)**, **auto-activation on an unconfigured repo** (T001/T004 actively preserve dormancy), and **bundling weights / shipping them as an optional dependency** (T002/T026 make onnxruntime-web a normal production dep; T010 keeps weights lazy-download-only). T030 *validates* the retrieval surface is unchanged — it guards the SPEC-003 boundary rather than crossing it.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks.
- [Story] label maps each task to US1/US2/US3/US4 for traceability; Setup/Foundational/Polish carry no story label.
- All tests write real files and exercise real SQLite — no DB mocking (Constitution / CLAUDE.md house rule). Platform-divergent cache paths are `it.runIf`-gated and validated on the real platform.
- Every changed line traces to an FR/SC (surgical, Principle III); new capability lives in `src/embeddings/` behind the explicit `CODEGRAPH_EMBEDDING_PROVIDER=local` opt-in; diffs to `config.ts`/`indexer-hook.ts`/`index.ts`/`bin/codegraph.ts` stay minimal additive branches.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
