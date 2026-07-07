# SpecKit Workflow: SPEC-002 — Bundled Local Embedding Fallback

**Template Version**: 1.0.0
**Created**: 2026-07-05
**Purpose**: Autopilot workflow for SPEC-002. Phase prompts below are enriched from the Grill Me interview (see Design Concept).

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec`. The full Q&A log, Goals, Non-goals, and Open
Questions live at:

```text
docs/ai/specs/.process/SPEC-002-design-concept.md
```

Re-read it before each phase if you need to disambiguate a prompt. The
Specify and Clarify Prompts below were populated from that interview,
so the design concept doc is the source of truth for any decision
captured during scoping.

> **Note:** Grill Me is human-in-the-loop only. It is **not** part of
> the autopilot loop. Once the workflow file is populated and autopilot
> begins, clarifications happen via `/speckit-clarify` and the
> consensus protocol — never via grill-me.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 24 FR (FR-001..FR-024), 4 US, 8 SC, 10 acceptance scenarios, 0 clarification markers (G1 pass) |
| Clarify | `/speckit-clarify` | ✅ Complete | 3 sessions: OQ-1/2/3 resolved (onnxruntime-web + all-MiniLM-L6-v2 + worker-in-provider); 3 internal-spec contradictions fixed (FR-003/006 selection; FR-015/016/017a/019/019a cache+download). 0 consensus escalations; security surface → Phase-4 checklist. G2 pass. |
| Plan | `/speckit-plan` | ✅ Complete | Constitution I–VII all PASS (1 advisory Complexity row); G3 pass. Reviewability advisory WARN: honest ~603 prod LOC / 8 files (>400/6 soft-warn, <800/8 hard block) — overage = owned tokenizer+worker forced by pure-WASM choice; no split. onnxruntime-web-in-Node-worker risk CLOSED (spike PASS). |
| Checklist | `/speckit-checklist` | ✅ Complete | 3 domains, 72 items, 30 gaps ALL closed (added FR-010a/010b/013a/019b/019c/021a + SC-009/010/011 + 4 edge cases + 2 decisions). G4 pass (0 gaps). Security trust model verdict: SOUND. |
| Tasks | `/speckit-tasks` | ✅ Complete | 32 tasks (T001–T032), 6 phases, 6 `[P]`, 0 coverage gaps, 0 Non-goal crossings. G5 pass. Atomicity: single-atomic-PR. Reviewability tasks-gate: size-only block (per-task heuristic; real ~680 LOC) → one PR. |
| Analyze | `/speckit-analyze` | ✅ Complete | 9 findings (0 CRIT/0 HIGH/4 MED/5 LOW) all remediated; G6 pass. 100% coverage, 0 drift. C1 (concurrent-pass bound) resolved: OS-scheduling+FR-010b, no machine-wide cap (Principle II). G6.5 confidence 0.94 PASS. |
| Implement | `/speckit-implement` | ✅ Complete | 32 tasks (T001-T032) TDD; +82 tests over baseline. G7 PASS: build+typecheck clean, full suite **2305 passed / 0 failed**. DOGFOOD: real local embed on this repo → 100% coverage (3,733/3,733), dims 384. 9 files, ~1.5K insertions; 0 retrieval-surface files touched. |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | The 3 Open Questions resolved (runtime lib, model checkpoint+dims, worker wiring), decisions documented |
| G3 | After Plan | Architecture approved, constitution gates pass (esp. VII pure-JS/WASM + dormancy, VI retrieval), dependencies identified |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified, dependencies ordered |
| G6 | After Analyze | No `CRITICAL` issues, `WARNING` items reviewed |
| G7 | After Each Implementation Phase | Tests pass, manual verification complete |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| VII — Local-First, Zero Native Deps | New runtime dep is pure-JS/WASM, no native addon; engines `>=20 <25` preserved | `npm ls` + BUNDLING.md size measurement |
| VII — Dormancy | Fully-unset config stays byte-identical (`loadEmbeddingConfig` → `null`); zero network/schema writes when local not opted-in | New dormancy test: no PROVIDER, no URL/MODEL → no download, no fetch |
| VI — Retrieval Not a Regression | Off-thread embedding; daemon/watcher never stalled during an embed pass | Worker-based embed pass; daemon liveness during index |
| V — Deterministic Extraction | Local embeddings are prose-layer vectors, not graph structure; node/edge counts stable | `select count(*) from nodes` stable before/after local re-embed |
| II — Simplicity First | ~380 LOC estimate, 1 slice; no speculative config | Reviewability gate + code review |

**Constitution Check:** ✅ Baseline green — `npm ci` + `npm run build` + `npm run typecheck` clean (exit 0). Node v24.11.1 (engines `>=20 <25` ✓). PROJECT_COMMANDS: BUILD `npm run build`, TYPECHECK `npm run typecheck`, UNIT_TEST `npm test`. Presets active: `speckit-pro-reviewability` (spec/plan), `codegraph-project-overrides` (tasks). Extensions: agent-context, cleanup, retrospective, review, verify, verify-tasks. Archive extension absent → Archive Sweep skipped. Full `npm test` baseline deferred to Implement pre-check (workflow requirement). Automated G0 checks pass.

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-002 |
| **Name** | Bundled Local Embedding Fallback |
| **Branch** | `002-local-embedding-fallback` |
| **Dependencies** | SPEC-001 (EmbeddingProvider interface, `node_vectors` store, `config.ts` selection, model-switch re-embed) |
| **Enables** | Endpoint-free semantic search; dogfood-ladder rung (HAL endpoint → local provider re-embed) |
| **Priority** | P0 (Tier 0) |

### Reviewability Budget (recorded per the setup gate)

- **Estimator:** 380 reviewable LOC, **1 slice**, status `ok` (under the 400 ceiling — no split).
- **Setup gate:** 325 LOC / 4 production files / 10 total files — within budget (`pass:true`).
- **Warning (recorded + accepted):** the gate flagged `primary surfaces 6 exceeds warn threshold 1`.
  This is a **scoping-text artifact** — the true production surface is **harness/adapter**
  (the new local provider + model-fetch) plus a **config.ts modify**; the gate counted every
  surface *named* in the roadmap prose. LOC/files are within budget and the estimator
  independently returns 1 slice, so **decision: no split, keep as one vertical spec.**

### Success Criteria Summary

- [ ] SC-1: With NO embedding config at all, behavior is byte-identical to a no-feature build — zero model download, zero network call, zero schema write (dormancy, Principle VII).
- [ ] SC-2: `CODEGRAPH_EMBEDDING_PROVIDER=local` (or `--embeddings local`) activates the local provider WITHOUT an endpoint URL; selection order is explicit-provider → endpoint(URL+MODEL) → off.
- [ ] SC-3: On first local use, weights lazy-download to the global platform-aware cache, are SHA-256-verified against the in-source pin, and are reused thereafter (offline after first fetch).
- [ ] SC-4: Offline first-run / checksum mismatch → structural index still succeeds; embed pass skipped with an actionable message; `codegraph status` shows 0% embedded + reason.
- [ ] SC-5: A local embed pass runs off the main thread — the daemon keeps serving queries and the file watcher keeps firing throughout (no stall).
- [ ] SC-6: Switching provider/model triggers a full re-embed (model-column mismatch, riding SPEC-001's `selectEmbeddableNodesMissingVector`); node/edge counts stay stable.
- [ ] SC-7: `codegraph status` reports the active provider (`local`), model id, and dims.
- [ ] SC-8: `BUNDLING.md` documents the npm payload impact of the chosen runtime; `npm install` footprint growth is documented and within the "no meaningful growth" target.
- [ ] SC-9: Self-repo UAT (dogfood ladder): switch THIS repo from the HAL endpoint to `PROVIDER=local`, re-embed, and confirm healthy coverage on the local model.

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**. Output: `specs/002-local-embedding-fallback/spec.md`

### Specify Prompt

```bash
/speckit-specify

## Feature: Bundled Local Embedding Fallback (SPEC-002)

### Problem Statement
SPEC-001 gives CodeGraph embeddings ONLY when the user configures an external
OpenAI-compatible endpoint (URL + MODEL). Users without an endpoint get zero
semantic capability. SPEC-002 adds a small, permissively-licensed, in-process
WASM/ONNX code-embedding model so semantic indexing works with zero external
setup — as an EXPLICIT OPT-IN, never an automatic default.

### Users
- Developers/agents who want semantic search but have no embedding endpoint.
- This repo itself: the dogfood ladder switches it from the HAL endpoint to the
  local provider and re-embeds.

### User Stories
- [US1] As an operator, I set CODEGRAPH_EMBEDDING_PROVIDER=local (or pass
  --embeddings local) and `codegraph index` embeds every symbol locally with no
  endpoint configured.
- [US2] As an operator on a fresh machine, first local use lazy-downloads the
  model to a shared cache, verifies its checksum, and reuses it on later runs.
- [US3] As an operator who is offline on first run (no cached model), my
  structural index still completes; I get an actionable message telling me how to
  obtain the model, and `codegraph status` shows why coverage is 0%.
- [US4] As an operator, `codegraph status` shows the active provider (local),
  model, and dims.

### Key Decisions (from Design Concept — carry into spec as FRs)
- ACTIVATION IS EXPLICIT OPT-IN ONLY. A fully-unset config MUST stay dormant
  (loadEmbeddingConfig → null): zero download, zero network, zero schema write.
  "Automatic when no endpoint" means: once opted into embeddings, local is the
  default when no endpoint URL is given — NOT auto-on for unconfigured repos.
- Selection order: explicit PROVIDER / --embeddings wins → else URL+MODEL present
  → endpoint → else off. Add CODEGRAPH_EMBEDDING_PROVIDER (endpoint|local|off);
  loadEmbeddingConfig becomes a discriminated union (endpoint | local | misconfig
  | null); fully-unset still returns null.
- Delivery: lazy, checksum-verified download on first use (NOT bundled, NOT
  optionalDependencies).
- Source/trust: default to the model's HuggingFace hub URL; verify bytes against a
  SHA-256 pinned in codegraph source (host untrusted, checksum is the anchor);
  optional env override of the base URL for air-gapped/enterprise mirrors.
- Cache: global platform-aware dir (~/.codegraph/models on POSIX honoring
  XDG_CACHE_HOME; %LOCALAPPDATA% on Windows), shared across projects, optional
  CODEGRAPH_MODEL_CACHE_DIR override. NOT inside per-project .codegraph/.
- Model profile: general-purpose small baseline (MiniLM-L6 / BGE-small class,
  384–768 dims, Apache/MIT, quantized). Local is the fallback; SPEC-003 owns
  retrieval quality.
- Offline/failure: structural index succeeds; embed pass skipped with actionable
  message (mirrors SPEC-001's provider-failure-stops-the-pass posture).
- Threading: inference runs OFF the main thread (parse-pool/query-pool precedent);
  MUST NOT stall the daemon event loop or the file watcher.
- Re-embed on switch rides SPEC-001's model-column mismatch — no new mechanism.

### Constraints
- Pure-JS/WASM only, no native addons (constitution VII). npm engines >=20 <25 preserved.
- No meaningful npm payload growth (BUNDLING.md documents the runtime dependency's size).
- node/edge counts stable across a local re-embed (constitution V, no explosion).

### Out of Scope
- GPU execution paths; model fine-tuning.
- Search/retrieval behavior and quality (SPEC-003).
- Auto-activation on an unconfigured repo (breaks dormancy).
- Bundling weights in npm or shipping them as optionalDependencies.
- Running a racecraft-hosted model mirror.
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 24 (FR-001..FR-024) |
| User Stories | 4 (US1–US4) |
| Acceptance Criteria | 8 Success Criteria (SC-001..SC-008) + 10 Given/When/Then scenarios |

### Files Generated

- [x] `specs/002-local-embedding-fallback/spec.md`
- [x] `specs/002-local-embedding-fallback/checklists/requirements.md` (spec-quality checklist, 16/16 pass)

---

## Phase 2: Clarify (resolves the Open Questions before Plan)

**When to run:** Immediately after Specify — Plan depends on all three Open Questions.

**Best Practice:** Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: Runtime, Model & Payload (the 3 Open Questions — highest priority)

```bash
/speckit-clarify Focus on the three deferred decisions from the Design Concept, since Plan depends on them:
1. Runtime library: @huggingface/transformers (transformers.js, Apache-2.0, bundles onnxruntime-web) vs onnxruntime-web-only + a hand-rolled tokenizer. MEASURE each dependency's actual installed size, confirm license is MIT/Apache/BSD, and confirm pure-JS/WASM with NO native addon required. This choice drives BUNDLING.md and the ~380 LOC budget.
2. Exact model checkpoint + dimension: pick a specific general-purpose small permissive quantized checkpoint (MiniLM-L6 / BGE-small class, 384–768 dims) that ships for the chosen runtime, and record its pinned SHA-256.
3. Worker wiring: reuse parse-pool vs query-pool shape; confirm the chosen runtime initializes cleanly inside a worker. The constraint "must not stall the daemon event loop" is firm regardless.
```

#### Session 2: Config & Selection Semantics

```bash
/speckit-clarify Focus on config.ts changes: the discriminated-union shape (endpoint | local | misconfig | null), exact precedence (explicit PROVIDER/--embeddings → URL+MODEL → off), how PROVIDER=off interacts with a set URL+MODEL, and how the daemon/MCP env-driven context selects local. Preserve SPEC-001's null-dormancy and half-config (URL-set/MODEL-unset) error unchanged.
```

#### Session 3: Download, Cache & Failure

```bash
/speckit-clarify Focus on acquisition + failure: cache dir resolution across POSIX/Windows (XDG_CACHE_HOME, %LOCALAPPDATA%, CODEGRAPH_MODEL_CACHE_DIR), atomic download + SHA-256 verify + corruption/partial-download handling, the base-URL override env var name, and the exact actionable message wording for offline/checksum-mismatch (name the cache dir + override + how to pre-seed).
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Runtime/Model/Payload | 3 (OQ-1/2/3) | ✅ Resolved — see "Session 1 Resolution" below |
| 2 | Config/Selection | 3 | ✅ Resolved directly (no consensus — internal-spec contradiction fixes). FR-003 rewritten (PROVIDER selector layers above SPEC-001's unchanged resolution; half-config stays `misconfig`, never silently `off`; explicit `off`→`null` short-circuit). FR-006 (local reachable ONLY via explicit selection; no implicit "no URL→local" fallthrough → dormancy/SC-004 preserved). Edge Cases + Key Entities updated. |
| 3 | Download/Cache/Failure | 4 | Returned. **Accepted high-conf:** Q2 override env = `CODEGRAPH_MODEL_BASE_URL` (base URL; pairs w/ `CODEGRAPH_MODEL_CACHE_DIR`). **Resolved directly** (high-conf FR edits — Q1→FR-016 4-case XDG formula, Q3→FR-019/FR-019a distinct tamper-aware msg, Q4→new FR-017a cache-dir validation; the [security] surface is adversarially verified in the Phase-4 **security** checklist — a stronger, dedicated pass, not redundant consensus): Q1 exact cache-path formula (honor XDG vs `daemon-registry` `~/.codegraph` precedent; `~/.config` false-reject via `utils.ts:168`); Q3 tamper-aware checksum-mismatch message (distinct from offline); Q4 new FR-017a = validate cache dir (default+override) vs `SENSITIVE_PATHS`/traversal; base-URL SSRF/plaintext-http parity. **Already resolved:** atomic verify-before-use (FR-013/014), offline degrade (FR-019/020, mirrors `indexer-hook` `{aborted,abortReason}`). |

#### Session 1 Resolution (Runtime / Model / Payload) — measured evidence

Resolved by direct measurement (isolated temp-dir installs, Node v24.11.1). This
**supersedes the design concept's tentative OQ-1 lean toward transformers.js** —
the measurement changed the answer.

- **OQ-1 Runtime → `onnxruntime-web`** (v1.27.0, MIT). Installed ~140M (mostly the
  bundled `.wasm` variants), **0 native `.node` binaries**, 22 pure-JS transitive
  deps. **REJECTED `@huggingface/transformers`** (v4.2.0): it lists native
  `onnxruntime-node` + `sharp` as **hard (non-optional) dependencies** (6 `.node`
  binaries, 380M installed), and `src/backends/onnx.js` unconditionally
  `import * as ONNX_NODE from 'onnxruntime-node'` and selects it as the default
  execution engine when `IS_NODE_ENV` — i.e. in CodeGraph's exact context it runs
  on the **native** binary, not WASM. That fails **FR-011 / Constitution VII
  (pure-JS/WASM, no native addon)** as consumed normally. No supported subpath
  export forces the web build from Node.
- **OQ-2 Checkpoint → `Xenova/all-MiniLM-L6-v2`** — 384 dims, **Apache-2.0**,
  `onnx/model_quantized.onnx` ≈ 22 MB (smallest of the candidates; bge-small /
  gte-small are ~33 MB, same 384 dims, viable MIT fallbacks). Pin an immutable
  `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/<commit-sha>/onnx/model_quantized.onnx`
  (or download-once + own SHA-256). **Also fetch the tokenizer artifacts**
  (`tokenizer.json` / `vocab.txt`) alongside the model — same verify flow.
- **OQ-3 Worker wiring → inside `LocalProvider.embed()`** (mirrors `parse-worker.ts`
  / `parse-pool.ts`): the CPU-heavy WASM inference runs in a `worker_thread`, so
  `runEmbeddingPass` (which already awaits `provider.embed()`) never stalls the
  daemon/watcher (Constitution VI). **Plan/Implement MUST validate** that
  `onnxruntime-web` initializes + runs inference cleanly inside a Node worker (a
  de-risking spike — the one residual technical risk).
- **Payload/LOC note for Plan:** choosing `onnxruntime-web` means **owning a
  minimal BERT WordPiece tokenizer** (static vocab + CLS/SEP/PAD, ~100–150 LOC) +
  mean-pooling + L2-normalize. This may push the implementation past the ~380 LOC
  estimate; the plan-phase reviewability estimator re-checks. `onnxruntime-web`'s
  bundled `.wasm` is an npm-payload cost to document in **BUNDLING.md** (SC-008 /
  FR-024).

---

## Phase 3: Plan

**When to run:** After Specify is finalized and the 3 Open Questions are resolved. Output: `specs/002-local-embedding-fallback/plan.md`

### Plan Prompt

```bash
/speckit-plan

## Tech Stack (from CLAUDE.md + constitution)
- Language: TypeScript (strict), Node >=20 <25 (from-source floor 22.5 for node:sqlite)
- Store: node:sqlite (node_vectors table already exists from SPEC-001 — REUSE, do not re-migrate)
- Embedding runtime: WASM/ONNX, pure-JS/WASM, NO native addon (Open Question 1 — resolved in Clarify)
- Off-thread execution: existing parse-pool / query-pool worker precedent
- Testing: vitest (real files, real SQLite, no DB mocking)

## Architecture Notes (from Design Concept)
- New: src/embeddings/local-provider.ts (EmbeddingProvider impl, statically-known dims up front).
- New: src/embeddings/model-fetch.ts (lazy download + SHA-256 verify + platform-aware cache + base-URL override).
- Modify: src/embeddings/config.ts (add CODEGRAPH_EMBEDDING_PROVIDER; discriminated-union result; selection order; PRESERVE null-dormancy + half-config error).
- Wire: provider selection into the existing indexer-hook embed pass; reuse onProgress; run inference in a worker so the daemon/watcher never stall.
- Modify: codegraph status to report provider=local / model / dims / coverage.
- New: BUNDLING.md documenting the runtime dependency's npm payload impact.

## Constraints (Constitution Check — must pass G3)
- VII: pure-JS/WASM only; engines range preserved; dormancy byte-identical when unconfigured.
- VI: off-thread inference; daemon/watcher not stalled; retrieval surface unaffected.
- V: local vectors are prose-layer, not graph structure; node/edge counts stable across re-embed.
- II: minimum code (~380 LOC target); no speculative config beyond the PROVIDER selector.
- License hygiene: runtime dep + model weights MUST be MIT/Apache/BSD.

## Reference
Re-read docs/ai/specs/.process/SPEC-002-design-concept.md for the "why" behind each decision.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ | Full Technical Context, Constitution Check (7×PASS), Project Structure (8 files + per-file LOC), Reviewability Budget, Complexity Tracking, Declared File Operations |
| `research.md` | ✅ | OQ-1/2/3 resolved + **spike evidence verbatim** (PASS all 3 probes; `InferenceSession.create()` hang gotcha → timeout-wrap; model IO/timing/sha256/commit pin); transformers.js→native rejection |
| `data-model.md` | ✅ | `EmbeddingLocalConfig` union arm + FR-003 precedence; node_vectors REUSE (no migration); model-fetch verify-before-use state machine; FR-022 model-column re-embed |
| `contracts/` | ✅ | `local-provider.md` (LocalProvider⇄EmbeddingProvider, dims=384, worker, mean-pool+L2) + `model-fetch.md` (atomic temp→verify→rename, timeout, never-throw) |
| `quickstart.md` | ✅ | `--embeddings local` / `PROVIDER=local` walkthrough + 7 scenarios + self-repo dogfood (HAL→local) |

**Plan gate notes:** Implement-time follow-ups recorded (not blockers): (a) pin `tokenizer.json` SHA-256; (b) verify `scripts/build-bundle.sh` preserves `node_modules/onnxruntime-web/dist/*.wasm` into the bundled runtime; (c) onnxruntime-web goes in `dependencies` (production) so the bundle's `npm ci --omit=dev` ships it. FR-017a cache validator is purpose-built (reuses SENSITIVE_PATHS+`../`-traversal, omits the `~/.config` home-dir rejection that would false-reject a legit XDG cache). **after_plan `agent-context` hook (optional): SKIPPED** — avoids clobbering the curated CLAUDE.md managed block; roadmap already tracks SPEC-002 status.

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan`.

### Recommended Domains (from the grill-me design tree)

**error-handling**, **security**, **performance** — target 3.

### Step 2: Run Enriched Checklist Prompts

#### 1. error-handling Checklist

<!-- Why: offline/checksum-mismatch/partial-download failure posture (Q7) is the riskiest surface — it must degrade to a structural index + actionable message, never a hard fail or silent skip. -->

```bash
/speckit-checklist error-handling

Focus on Bundled Local Embedding Fallback requirements:
- Offline first-run (no cached model) → structural index succeeds, embed pass skipped, actionable message.
- Checksum mismatch / partial or corrupted download → reject, do not persist a bad model, clear message.
- Model-fetch failure must NOT abort structural indexing (mirror SPEC-001 provider-failure-stops-the-pass).
- Pay special attention to: the exact actionable-message content (cache dir, override env, pre-seed steps) and that `codegraph status` surfaces the reason for 0% coverage.
```

#### 2. security Checklist

<!-- Why: this feature downloads and executes a model from a network source — supply-chain + trust-anchor surface. -->

```bash
/speckit-checklist security

Focus on Bundled Local Embedding Fallback requirements:
- SHA-256 pin in source is the trust anchor; the host (HF hub / override URL) is untrusted.
- Atomic write + verify-before-use so a MITM/partial file is never loaded.
- Cache dir path handling respects SENSITIVE_PATHS / no path traversal via CODEGRAPH_MODEL_CACHE_DIR or the base-URL override.
- License hygiene: runtime dependency + model weights are MIT/Apache/BSD.
- Pay special attention to: the override env var not becoming an arbitrary-code-execution or SSRF vector.
```

#### 3. performance Checklist

<!-- Why: WASM CPU inference is minutes-long and the daemon/watcher must not stall (constitution VI). -->

```bash
/speckit-checklist performance

Focus on Bundled Local Embedding Fallback requirements:
- Off-thread inference: daemon query serving + file watcher stay responsive during a full embed pass.
- Batch/concurrency defaults sane for WASM CPU; progress reported via existing onProgress.
- Model loaded once per pass (not per batch); no repeated download once cached.
- Pay special attention to: no regression to the codegraph_explore retrieval budget while a local embed pass runs.
```

### Checklist Results

| Checklist | Items | Gaps (all closed) | Key hardening added |
|-----------|-------|------|-----------------|
| error-handling | 25 | 9 | FR-019b (session-create timeout — the spike hang), FR-019c (no source echo; fixed dangling FR-025a ref), FR-020 distinct reasons, FR-014 not-persisted, exit-0 on degrade |
| security | 24 | 7 | Trust model SOUND (adversarially verified). FR-013/014 verify tokenizer too, FR-013a download size/time bound, FR-017a prefix-match+realpath+O_EXCL temp (real utils.ts exact-match bug), FR-015 scheme allowlist+env-only, FR-019 redact override URL |
| performance | 23 | 14 | **FR-010b bound ORT numThreads** (off-thread alone insufficient — WASM pool defaults min(cores/2,4)), FR-010a session-once, FR-021a first-run progress, SC-009/010/011 measurable perf, multi-project + worker-heap edge cases |
| **Total** | **72** | **30** | 6 new FRs, 3 new SCs, 4 edge cases, 2 recorded decisions (SSRF scope=scheme-allowlist; plaintext advisory=not-required) |

**Consensus:** 0 escalations — the 3 dedicated domain executors are the multi-perspective adversarial verification (each code-grounded); resolved directly by parent. Impl grows to ~650–680 LOC (still under 800 hard block); no split.

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/002-local-embedding-fallback/tasks.md`

### Tasks Prompt

```bash
/speckit-tasks

## Task Structure
- Small, testable chunks; acceptance criteria reference FR-xxx / SC-x.
- Dependency ordering: config selection → model-fetch → local-provider → worker wiring → status → BUNDLING.md → self-repo UAT.
- Mark parallel-safe tasks with [P].
- TDD: dormancy test FIRST (no config → no network/schema write), then activation.

## Implementation Phases
1. Foundation: config.ts discriminated union + PROVIDER selector + selection order (preserve null-dormancy).
2. US2/US3: model-fetch.ts (lazy download + SHA-256 + platform cache + override + offline/mismatch handling).
3. US1: local-provider.ts (EmbeddingProvider, static dims) + off-thread worker wiring into the embed pass.
4. US4 + polish: `codegraph status` provider/model/dims/coverage; BUNDLING.md; self-repo dogfood UAT.

## Bound by Non-goals (from Design Concept)
- Do NOT add GPU paths, model fine-tuning, retrieval/search changes (SPEC-003), auto-activation, or bundled/optionalDependency weights. Flag any task that crosses these.

## Constraints
- New code in src/embeddings/; reuse node_vectors (no new migration); reuse parse-pool/query-pool worker shape.
- Tests exercise real SQLite + real files; a dormancy test asserting zero network/schema writes is mandatory.
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | 32 (T001–T032) |
| **Phases** | 6 (Setup/Dormancy, Foundational config, US2/US3 acquisition, US1 provider [MVP], US4 status, Polish) |
| **Parallel Opportunities** | 6 `[P]` (T003, T008, T013, T014, T021, T026 — distinct test/doc files) |
| **User Stories Covered** | US1–US4 (US1=8, US2=5, US3=2, US4=3). T001=dormancy-first TDD; T007=`[BLOCKING]` tokenizer-SHA pin; **0 coverage gaps**, **0 Non-goal crossings**. G5 pass. |

---

## Atomicity Route

Recorded from `atomicity-route.sh` after G5.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | `single-atomic-PR` | Not safely splittable into multiple PRs — one atomic PR (consistent with the plan's ratified no-split: no independently shippable sub-slice). |
| **Releasable** | `true` | CI-green ⇒ releasable; no destructive migration / concurrency hazard. |
| **Signals** | `hard-atomic:global-version-pin` | Decisive detector finding. |
| **Warnings** | (none) | |

### Layer Plan
`skipped` — route is `single-atomic-PR`, not `split-PR`; the PRSG-008 layer planner does not apply.

### Reviewability (tasks gate) — size-only block = marker-planning input, NOT a re-slicing stop
`reviewability-gate.sh tasks` → `status:block` (exit 1); blockers ALL size-based (reviewable_loc 1280, production_files 20, total_files 115, primary_surfaces 6; `exception_honored:false`, **no correctness/safety findings**). **The 1280 is the gate's per-task heuristic (40 LOC × 32 tasks), not real LOC** — the plan's honest Declared File Operations estimate is **~680 production LOC / 8 files** (under the 800 hard block). Per Step 8, a valid current size-only tasks-block is a marker-planning input, not a manual re-slicing stop.

**PR marker plan:** route `single-atomic-PR` ⇒ ships as ONE PR (no marker-split, no multi-PR emission). Review structure = the plan's PR Review Packet **Review Order**: config.ts → model-fetch.ts → local-tokenizer.ts → local-embed-worker.ts → local-provider.ts → index.ts/bin wiring → BUNDLING.md. At PR time the final-reviewability-backstop re-evaluates the REAL diff; a size warn/block on this unsplittable, plan-ratified-no-split change proceeds via the ratified size exception. State persisted in `autopilot-state.json`.

```bash
bash speckit-pro/skills/speckit-autopilot/scripts/atomicity-route.sh specs/002-local-embedding-fallback
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks.

### Analyze Prompt

```bash
/speckit-analyze

Focus on:
1. Constitution alignment — Principle VII (pure-JS/WASM, dormancy byte-identical), VI (off-thread, no daemon stall), V (no node/edge explosion), II (simplicity, ~380 LOC).
2. Coverage gaps — every FR/SC (esp. SC-1 dormancy, SC-4 offline, SC-5 off-thread, SC-9 self-repo UAT) has a task.
3. Drift from the Design Concept — flag any downstream artifact contradicting a chosen decision (activation = opt-in only; delivery = lazy download; selection order). The design concept is the source of truth for scoping decisions.
4. Verify the self-repo dogfood UAT step (HAL → local re-embed) is present in tasks + the UAT runbook.
```

### Analysis Results

9 findings across 2 loops — **0 CRITICAL, 0 HIGH, 4 MEDIUM, 5 LOW; all remediated. G6 PASS.** 100% coverage (43 keys → tasks), 0 drift from the design concept, no dangling FR refs.

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| I1 | MEDIUM | plan VI row justified no-stall via off-thread/FR-010 alone | Rewrote to cite FR-010b (numThreads bound) + SC-010 + T029 |
| I2 | MEDIUM | spec Reviewability Budget stale (~310/~4) vs plan ~650–680/8 | Updated spec to ~650–680/8/advisory-WARN + superseded-projection note; spec↔plan↔tasks now agree |
| C1 | MEDIUM | "multi-project concurrent passes" edge case architecturally inaccurate | Reframed to the real arch (per-project `.codegraph/codegraph.lock` serializes; FR-010b per-pass clamp; cross-process = parse-pool posture). **Decision in Consensus log below.** |
| C2 | MEDIUM | worker-heap edge case not discharged | Extended T029 to record WASM-heap evidence + parse-pool recycle fallback |
| U1 | LOW | FR-019b timeout called "tunable" with no env knob | Changed to "internal constant, not operator-tunable" (Principle II — no unrequested config) |
| A1 | LOW | ORT thread bound value deferred; T016→T029 dep implicit | Made T016↔T029↔SC-010 dependency explicit both ways |
| I3 | LOW | plan ~4 test suites vs tasks 7 suites | Synced plan test list + counts to tasks.md (7 suites, ~16 total) |
| VII | LOW | T025 checked node_modules presence not .wasm survival | Extended T025 to confirm `.wasm` survives `npm ci --omit=dev --ignore-scripts` |
| I4 | LOW | superseded-figure drift (spec ~310 vs plan ~310/~380) | Recorded both figures with sources |

### Consensus Resolution Log

| # | Type | Finding | Categories | Round | Outcome | Resolution |
|---|------|---------|-----------|-------|---------|------------|
| 1 | Finding | C1: cross-process concurrent-pass bound — OS-scheduling vs machine-wide cap | [codebase, spec] | — | resolved-by-parent | **Rely on OS scheduling + per-pass FR-010b clamp + per-project file lock — matching the existing parse-pool posture (no machine-wide coordinator). A machine-wide inference semaphore is rejected as speculative cross-process machinery (Principle II) for an uncommon, gracefully-degrading scenario; it would also add impl scope. Flagged for maintainer review at PR — if cross-process query-latency contention proves real, a machine-wide cap can be added later.** analyst: analyze-executor (dual-perspective, code-grounded); parent-ratified. |

### Pre-Implement Confidence (G6.5 data source)

📊 Confidence: 0.94

- Task understanding: 0.95
- Approach clarity: 0.94
- Requirements alignment: 0.95
- Risk assessment: 0.92
- Completeness: 0.95

Basis: spec clear (0 clarification markers; 32 FR / 11 SC well-specified); plan complete + spike-validated runtime; 100% task coverage (0 gaps); 0 CRITICAL/HIGH findings (InferenceSession-hang risk de-risked via FR-019b); all artifacts present + non-empty. One MEDIUM design choice (C1) resolved + flagged for maintainer.

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```bash
/speckit-implement

## Approach: TDD-First (red → green → refactor → verify)

Task order and the "why" behind each decision live in
docs/ai/specs/.process/SPEC-002-design-concept.md — consult it for edge-case
handling and test specs.

### Mandatory first test (dormancy, Principle VII)
Write a FAILING test asserting that with NO embedding env at all
(no PROVIDER, no URL, no MODEL), indexing performs zero network calls and
zero node_vectors writes — byte-identical to a no-feature build. Make it pass
before any provider code exists.

### Pre-Implementation Setup
1. `npm run build && npm test` green on the branch before changes.
2. Confirm node_vectors + config.ts from SPEC-001 are intact (no re-migration).

### Implementation Notes
- Preserve SPEC-001's null-dormancy and half-config error EXACTLY — extend, don't rewrite.
- Inference off the main thread (parse-pool/query-pool precedent); never stall the daemon/watcher.
- SHA-256 verify BEFORE the model is ever loaded; atomic cache write.
- Every changed line traces to an FR/SC (surgical changes, Principle III).
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Config/selection | T001-T006 | ✅ | Dormancy guard (T001, zero net/schema writes) + `EmbeddingLocalConfig` union arm + FR-003 precedence (SPEC-001 null-dormancy/misconfig preserved EXACTLY); onnxruntime-web@1.27.0 production dep, engines unchanged |
| 2 - Model-fetch | T007-T012 | ✅ | Lazy download of model + tokenizer + per-artifact SHA-256 **verify-before-use** + `O_EXCL`/no-symlink atomic temp + purpose-built prefix+realpath cache validator + download size/time bounds + http/https scheme allowlist + typed distinct unavailable messages (never throws). Tokenizer SHA pinned (`da0e79…`) |
| 3 - Local provider + worker | T013-T020 | ✅ | BERT WordPiece tokenizer (canonical) + onnxruntime-web worker (timeout `create()` + `numThreads` bound + mean-pool over mask + L2-normalize → 384d) + `LocalProvider` (dims=384, session-once, advisory-not-thrown) + `index.ts` wiring (reuses runEmbeddingPass + model-column re-embed). SC-001/007/008 + US3 degrade pass HERMETICALLY. `require('onnxruntime-web')` lazy → dormancy preserved |
| 4 - Status + polish + UAT | T021-T032 | ✅ | Status: `provider`/`model`/dims/coverage + distinct skip reason; `--embeddings` flag (T024); BUNDLING.md + CHANGELOG. Validations: T025 bundle-ships-.wasm ✓, T030 retrieval-non-regression ✓ (by construction — 0 retrieval files touched), T029 perf (spike ~5-8ms/symbol). **T028 DOGFOOD (binding): real local embed on THIS repo → `codegraph status` = provider `local`, model `Xenova/all-MiniLM-L6-v2`, dims 384, coverage 3,733/3,733 (100%)** ✓ |

**Dogfood UAT evidence (T028 — binding Dogfooding Protocol):** `CODEGRAPH_EMBEDDING_PROVIDER=local codegraph index` on this worktree lazily downloaded the model (`~/.codegraph/models/all-MiniLM-L6-v2/`: model_quantized.onnx 22,972,370 B + tokenizer.json 711,661 B — exact pinned sizes), SHA-verified + atomically cached, ran real onnxruntime-web inference, and wrote **3,733 real 384-dim vectors** to `node_vectors` (blob 1536 B = 384×4 — codec correct); `codegraph status` reports 100% coverage. This is the definitive end-to-end proof beyond the hermetic tests.

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Typecheck passes: `npm run typecheck` (if present) / `tsc --noEmit`
- [ ] Tests pass: `npm test` (incl. the mandatory dormancy test)
- [ ] Build succeeds: `npm run build` (schema.sql + *.wasm copied into dist/)
- [ ] BUNDLING.md documents npm payload impact; footprint growth within target
- [ ] Self-repo dogfood UAT: this repo re-embedded via `PROVIDER=local`; `codegraph status` healthy
- [ ] CHANGELOG `## [Unreleased]` entry (user-facing, no internals)
- [ ] PR created (targets origin, review packet) and reviewed
- [ ] Merged to main branch

---

## Lessons Learned

### What Worked Well

- **Parallel de-risking spike** — running an empirical `onnxruntime-web`-in-Node-`worker_thread` spike *concurrently with* Specify/Plan resolved the single biggest technical unknown (and the `create()`-hangs-on-missing-`.wasm` gotcha → FR-019b) *before* any implementation committed to the approach. It also flipped a Clarify decision on hard evidence (transformers.js → native-from-Node → rejected).
- **Adversarial domain checklists** — the 3 parallel checklist executors surfaced **30 genuine hardening gaps** (verify-*both*-artifacts, download bounds, prefix+realpath cache validation, ORT thread-pool bound, session timeout) the happy-path spec missed. The security domain adversarially confirmed the trust model SOUND while finding the real edge holes.
- **Real self-repo dogfood as the definitive gate** — beyond 2308 hermetic tests, actually running `PROVIDER=local codegraph index` on this repo (100% real coverage, 3,733 vectors, real inference) is what *proved* the feature works — Principle IV evidence, not vibes.
- **Right-sized models** — opus for the hardest integration (worker+provider) and the adversarial review; sonnet/high for mechanical + well-specified units. TDD (non-vacuous RED verified each phase) caught real bugs (the macOS `/var` tmpdir vs sensitive-path validator; the two-site verified-cache warm).

### Challenges Encountered

- **Phase agents stopping mid-task** — the Plan, Status (7e), and docs (7f) executors each ended a turn mid-work (uncommitted, or a stub template). Mitigation: verify the *actual* committed state after every phase (CLI `tsc` + tests), then resume/finish. Never trust a returned summary alone.
- **Stale IDE diagnostics** — the harness `<new-diagnostics>` repeatedly reported false `Cannot find module` / type errors for just-written files. The authoritative signal is the CLI `npm run typecheck`, not the IDE server; every stale error was disproved by a fresh `tsc`.
- **Reviewability gate over-counts the SDD trail** — both the tasks-gate and the final diff-gate size-blocked by counting the process docs (spec/plan/checklists/workflow) + tests as "production" (~3.7K LOC / 17 files). The real code is ~680 LOC / 9 files. Handled as a ratified single-atomic-PR no-split (atomicity classifier confirmed).

### Patterns to Reuse

- Front-load a parallel empirical spike for any new runtime/dependency risk; let it flip design decisions on hard numbers.
- Run domain checklists in parallel with report-don't-edit + serial parent remediation (WS-F1) to avoid shared-file contention.
- Make the self-repo dogfood the definitive acceptance gate, and record its evidence verbatim in the UAT runbook + PR body.
- Verify committed state after every delegated phase; treat CLI typecheck/tests as ground truth over IDE diagnostics.

---

## Project Structure Reference

```
src/embeddings/
├── config.ts             # MODIFY — add PROVIDER selector, discriminated union
├── provider.ts           # EmbeddingProvider interface (SPEC-001, unchanged)
├── endpoint-provider.ts  # SPEC-001 endpoint impl (unchanged)
├── local-provider.ts     # NEW — WASM/ONNX in-process provider
├── model-fetch.ts        # NEW — lazy download + SHA-256 + platform cache + override
└── indexer-hook.ts       # WIRE — provider selection + off-thread embed pass
BUNDLING.md               # NEW — npm payload impact note
specs/002-local-embedding-fallback/   # spec.md, plan.md, tasks.md, SPEC-MOC.md
```

---

Populated from the SPEC-002 Grill Me interview. Source of truth for scoping decisions: `docs/ai/specs/.process/SPEC-002-design-concept.md`.
