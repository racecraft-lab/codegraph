---
description: "Task list for SPEC-018 LLM Access Layer"
---

# Tasks: LLM Access Layer

**Input**: Design documents from `/specs/018-llm-access-layer/`

**Prerequisites**: plan.md, spec.md (5 user stories; FR-001–FR-031), research.md (D1–D14),
data-model.md (9 entities), contracts/ (6), quickstart.md (13 scenarios), 3 domain checklists.

**Tests**: TDD is REQUIRED for this feature (constitution IV + codegraph-project-overrides preset).
Every implementation task is preceded by a failing test task; the test MUST be written and MUST FAIL
before the implementation task begins.

**Delivery**: Two independently reviewable vertical slices off one branch = **two PRs**.
**Slice 1 (US1 + US2)** = endpoint path end-to-end → **PR 1**.
**Slice 2 (US3 + US4 + US5)** = agent-bundle path + companion skill + research note → **PR 2**.
No push/PR is performed by task execution — these are checkout-local commits only.

## Slice-boundary rule (BINDING — honors Q12 / plan §Summary)

ALL Slice-1 tasks (Phases 1–4, T001–T017) MUST complete before ANY Slice-2 task (Phases 5–7,
T018–T031). No Slice-1 task may import or depend on a Slice-2 file (`src/llm/agent-bundle.ts`,
`src/llm/ingest.ts`). Slice-1 `generate.ts` carries a **fallback stub** for agent mode (research D6);
Slice 2 makes ONE surgical edit (T020) to flip that branch — that edit is a Slice-2 task.

## Build-order note (US1/US2 priority inversion — intentional)

The workflow-pinned Slice-1 build order is **config → client → prompt → generate() → status →
dormancy**. This places `[US2]` (endpoint client, Phase 3) *before* `[US1]` (generate seam, Phase 4)
even though US1 is P1, because the US1 seam **orchestrates** the US2 client/prompt and cannot be built
first. Slice 1 as a whole (US1 + US2) ships as PR 1. Story labels give traceability; phase order gives
build order.

## Non-goals guardrails (from design-concept Non-goals — NO task may cross these)

- No new runtime dependency (FR-020 / Constitution VII) — built-in `fetch` + `crypto.randomUUID()` only.
- No change to `src/db/schema.sql` (FR-023) and no SQLite schema — bundle state is filesystem-only.
- No change to `src/mcp/tools.ts` — this spec exposes no MCP tool (Constitution VI untouched).
- No layer-owned heuristic registry (Q2/FR-013) — fallback is consumer-supplied per call.
- No watcher/daemon auto-ingestion (Q4/FR-029) — ingest is user-invoked only.
- No auto-chunk / map-reduce (Q6/FR-019) — deterministic trim + marker is the only oversize handling.
- No permanent `codegraph llm generate` CLI surface (Q8) — only `codegraph tasks list|ingest`.
- No ingest-driven consumer-artifact writes (Q11/FR-029) — ingest stops at the bundle directory.

## Test-env rule (carry into EVERY test run — quickstart §Test-env rule)

Unit tests pass a controlled `env` object (`loadLlmConfig(env)`, `resolveLlmStatus(env)`,
`generate(root, task, { env })`) and are hermetic. For any suite that touches the `process.env`
boundary (dormancy especially), run env-clean so the maintainer's live `.envrc.local` endpoint does
not leak in:

```bash
env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL -u CODEGRAPH_EMBEDDING_API_KEY \
    -u CODEGRAPH_LLM_URL -u CODEGRAPH_LLM_MODEL -u CODEGRAPH_LLM_API_KEY -u CODEGRAPH_LLM_PROVIDER \
    npm test
```

## Project commands

- BUILD: `npm run build` · TYPECHECK: `npx tsc --noEmit` · UNIT_TEST: `npm test` (vitest) · LINT: N/A.
- Endpoint tests drive a local fake HTTP server (`http.createServer`, `__tests__/embeddings-endpoint.test.ts` precedent) — never a live endpoint.
- Tests write real files in `fs.mkdtempSync` temp dirs and clean up in `afterEach` — no fs/DB mocking.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1–US5 (Setup / Foundational / Polish carry no story label).
- Every task names an exact file path and cites the FR(s) it satisfies.

---

## Phase 1: Setup (Slice 1 begins)

**Purpose**: Establish the new leaf module and confirm the two-slice reviewability budget.

- [ ] T001 Verify baseline + record reviewability checkpoint: run `npm run build` and the env-clean `npm test` (unset `CODEGRAPH_EMBEDDING_*` + `CODEGRAPH_LLM_*`) to confirm a green starting point; record the ratified two-slice split (each slice its own PR under 800 reviewable LOC / 8 production files / 25 total files / 1 primary surface — spec §Reviewability Budget; slice 1 ≈ 500–700 LOC / 4 prod files, slice 2 ≈ 400–600 LOC / 2 prod files). No `src/` changes. (FR-031)
- [ ] T002 [P] Create the `src/llm/` leaf module and declare the stable Slice-1 public types in `src/llm/generate.ts` (types-first stub, no logic): `ProseTask` (data-model §1), `OutputContract` (data-model §5), and the three-kind `GenerationResult` union incl. the `pending-bundle` kind (defined now for a stable public type though only produced in Slice 2). This gives `prompt.ts`/`client.ts` and the Slice-1 tests a stable surface to import. (FR-008, FR-012, FR-018)

**Checkpoint**: Module scaffold + public types exist; Foundational work can begin.

---

## Phase 2: Foundational — Config resolution union + status snapshot (Slice 1)

**Purpose**: The discriminated-union config resolver and the network-free status snapshot that BOTH
the US2 client/status and the US1 seam depend on. No story label — this blocks US1 and US2.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

- [ ] T003 [P] Write failing tests in `__tests__/llm-config.test.ts` for `loadLlmConfig(env)` per `contracts/llm-config-resolution.md`: all four states (endpoint / agent / misconfig / dormant `null`); provider precedence; `endpoint` with one of URL/MODEL missing → `LlmMisconfig` naming the gap, both missing → `missingVariables:[URL,MODEL]`; unrecognized `CODEGRAPH_LLM_PROVIDER` → `invalidValue` + `allowedValues:['endpoint','agent']`; `CODEGRAPH_LLM_API_KEY`-only → dormant `null`; key attached in-memory only in endpoint mode and omitted when blank; `redactEndpoint`/`isPlaintextRemoteEndpoint`/`plaintextRemoteWarning`. Pass controlled `env` objects (hermetic); assert zero network + zero fs at resolution. Tests MUST FAIL. (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007)
- [ ] T004 Implement `src/llm/config.ts` `loadLlmConfig(env): LlmConfigResult` (4-state union, data-model §2) with its OWN `redactEndpoint` / `isPlaintextRemoteEndpoint` / `plaintextRemoteWarning` (import only `isLoopbackHost` from `../utils` — research D2), in-memory-only API-key attach (FR-005), and a positive-int parse+clamp helper kept as the pattern of record with no v1 call site (FR-007 clamp-vacuity). Make T003 green. (FR-001, FR-002, FR-003, FR-004, FR-005, FR-007)
- [ ] T005 [P] Write failing tests in `__tests__/llm-status.test.ts` for `resolveLlmStatus(env): LlmStatus` (data-model §8): endpoint-active (redacted `endpoint`, `model`, `plaintextWarning?` present ONLY for a plaintext-remote URL), agent stub, dormant (`activationVars`), misconfigured; assert computing status is network-free and the API key never appears in any field. Pass controlled `env`. Tests MUST FAIL. (FR-006, SC-004)
- [ ] T006 Implement `resolveLlmStatus(env)` in `src/llm/config.ts` returning the `LlmStatus` union, carrying the redaction-safe cleartext plaintext advisory IN status (FR-006 divergence from the embeddings pass-time-only warning; `contracts/status-llm-json.md`). Note: `T004` and `T006` both edit `config.ts` — run sequentially. Make T005 green. (FR-006)

**Checkpoint**: Config + status snapshot resolve hermetically with zero side effects.

---

## Phase 3: User Story 2 — Endpoint client + token guard (Slice 1) (Priority: P2)

**Goal**: Turn the seam's future endpoint branch into real model prose — an OpenAI-compatible
chat-completions client with retry/timeout/streaming/size-ceiling, plus the deterministic
prompt-composition + token-budget guard.

**Independent Test** (quickstart S1.3/S1.4/S1.5): against a local fake HTTP server, a prose task
returns chat-completion text; an over-budget task trims only graph context with a visible
`[context truncated: N of M]` marker, deterministically; the deadlines abort and degrade.

- [ ] T007 [P] [US2] Write failing tests in `__tests__/llm-prompt.test.ts`: `estimateTokens(s)=ceil(len/4)`; `composePrompt` fixed priority order (instructions > output contract > graph context); ONLY graph-context trimmed to `GRAPH_CONTEXT_CHAR_BUDGET` (8000), instructions + contract NEVER truncated; whole trailing graph-context items dropped, marker `[context truncated: N of M]` appended; identical input → identical trimmed output; no auto-chunk. Tests MUST FAIL. (FR-018, FR-019, SC-003)
- [ ] T008 [P] [US2] Implement `src/llm/prompt.ts` — `composePrompt`, `estimateTokens`, `trimToBudget`, and the token constants (`CHARS_PER_TOKEN=4`, `GRAPH_CONTEXT_TOKEN_BUDGET=2000` → `GRAPH_CONTEXT_CHAR_BUDGET=8000`, marker string) per research D5. Make T007 green. (FR-018, FR-019, SC-003)
- [ ] T009 [P] [US2] Write failing tests in `__tests__/llm-client.test.ts` driving a local `http.createServer` fake: request body carries `model` / composed `messages` / per-call `stream` / `max_tokens`, no `temperature`, `authorization: Bearer` only when keyed (FR-015); vendor-neutral — depends only on OpenAI-standard fields, tolerant of absent proprietary fields (FR-015a); streaming assembles `choices[].delta.content` and terminates on `data: [DONE]` OR clean EOF without it (FR-016/FR-016a); non-streaming reads `choices[0].message.content` (FR-016); empty/whitespace assembled completion → failure (FR-009a); a stream aborted before clean close discards the partial and fails (FR-016a); flat total deadline (non-streaming) and inter-chunk idle deadline (streaming) via ms overrides (FR-017); hard total-response-size ceiling aborts an oversize body and fails (FR-017); retry 5xx/429/timeout/network with backoff+jitter honoring `Retry-After`, fast-abort 4xx (FR-017); error leaving the module is a redaction-safe `LlmEndpointError` with no key/body text and no `cause` chain (FR-005); a cross-origin redirect target receives NO `Authorization` key (POSIX-gated) (FR-005). Tests MUST FAIL. (FR-005, FR-009a, FR-015, FR-015a, FR-016, FR-016a, FR-017, FR-020)
- [ ] T010 [US2] Implement `src/llm/client.ts` `LlmEndpointClient.complete(promptParts, { stream })` on global `fetch` + `AbortSignal` (no new dependency — FR-020) per `contracts/endpoint-wire.md` / research D4: minimal chat-completions body; streaming SSE assembly (internal transport only — no `onChunk`); non-streaming JSON read; FR-009a empty-completion rejection; flat vs inter-chunk-idle deadlines; streamed byte-counting response-size ceiling (`MAX_RESPONSE_BYTES≈33_554_432`, model-fetch download-budget precedent) with abort-on-exceed; retry/backoff mirroring `EndpointProvider`; redaction-safe `LlmEndpointError`; `LlmEndpointClientOverrides { maxRetries?, baseDelayMs?, maxDelayMs?, retryAfterCapMs?, totalTimeoutMs?, idleTimeoutMs?, maxOutputTokens?, maxResponseBytes? }`. Make T009 green. (FR-005, FR-009a, FR-015, FR-015a, FR-016, FR-016a, FR-017, FR-020)

**Checkpoint**: The endpoint client + token guard are green against the fake server, independently of the seam.

---

## Phase 4: User Story 1 — generate() seam + status block + dormancy gate (Slice 1) (Priority: P1) 🎯 MVP → PR 1

**Goal**: The single always-usable `generate()` seam with guaranteed degradation and a source
discriminator, the CLI `LLM:` status block, and the slice-level dormancy gate — completing Slice 1.

**Independent Test** (quickstart S1.1/S1.2/S1.6): dormant → exact fallback, zero network, zero fs;
endpoint failure after retries → fallback (never throws); `result.source` always readable; `codegraph
status` shows an `LLM:` block with a redacted endpoint and (for plaintext-remote) an advisory.

- [ ] T011 [P] [US1] Write failing tests in `__tests__/llm-generate.test.ts`: dormant/misconfig → `{source:'fallback', text:task.fallback}` with zero network + zero fs; endpoint success → `{source:'endpoint', text}`; endpoint ultimate failure (retries+timeout exhausted) → `{source:'fallback'}` and NEVER throws (US1 AS-2); empty completion → fallback (FR-009a); agent mode in Slice 1 → `{source:'fallback'}` (documented stub); `result.source` distinguishes every source; `generate()` never opens the graph DB (FR-014); holds no cross-call state (FR-024a). Use controlled `env` + `client` overrides. Tests MUST FAIL. (FR-008, FR-009, FR-009a, FR-011, FR-012, FR-013, FR-014, FR-024a, SC-001)
- [ ] T012 [US1] Implement the `generate(root, task, overrides?)` function body in `src/llm/generate.ts` per `contracts/generate-seam.md` / research D6: resolve config once; dormant/misconfig → fallback; endpoint → `client.complete` with prompt-composition, success → endpoint result, ultimate failure → fallback (catches `LlmEndpointError`, never throws); agent → fallback stub (Slice-1 limitation; MUST NOT import `agent-bundle.ts`). Fallback is the consumer-supplied string (no heuristic registry — FR-013). Make T011 green. (FR-008, FR-009, FR-009a, FR-011, FR-012, FR-013, FR-014, FR-024a, SC-001)
- [ ] T013 [US1] Re-export the seam through the public surface in `src/index.ts`: `generate`, `ProseTask`, `GenerationResult`, `OutputContract`, and a thin `getLlmStatus()` `CodeGraph` method delegating to `resolveLlmStatus(process.env)` (CLI symmetry with `getEmbeddingStatus()`). Additive, surgical diff only. (FR-006, FR-008, FR-012)
- [ ] T014 [P] [US2] Add the CLI `LLM:` status block in `src/bin/codegraph.ts` AFTER the `Embeddings:` block (embeddings block untouched) rendering endpoint-active (`Provider: endpoint`, redacted `Endpoint:`, `Model:`, plaintext advisory when present) / misconfigured (names missing var, or `must be one of: endpoint, agent`) / dormant (neutral); Slice-1 agent state is a `Provider: agent` stub; add a top-level `llm: <LlmStatus>` field to `status --json` (`contracts/status-llm-json.md`). Different file from T013 → parallel-safe. (FR-006, SC-004)
- [ ] T015 [US1] Write the slice-level dormancy gate in `__tests__/llm-dormancy.test.ts`: with a clean env, any number of `generate(root, task)` calls return the exact fallback with ZERO outbound requests and ZERO filesystem writes (byte-identical to an unconfigured install), and `resolveLlmStatus` stays neutral. Run env-clean (unset `CODEGRAPH_EMBEDDING_*` + `CODEGRAPH_LLM_*`), embeddings-dormancy-suite precedent. This is the final Slice-1 acceptance gate. (FR-004, FR-011, SC-002)
- [ ] T016 [US1] Add the Slice-1 `### New Features` entry under `## [Unreleased]` in `CHANGELOG.md` (user-facing: the opt-in LLM endpoint path + `codegraph status` `LLM:` block; no internal paths/symbols). (FR-031)
- [ ] T017 [US1] Assemble the PR-1 review packet (what changed / why / non-goals / review order / scope budget / traceability FR→files→evidence / verification incl. dormancy probe / known gaps / rollback = "unset `CODEGRAPH_LLM_*`"; name deferred work: companion-skill plugin packaging → SPEC-026, optional `onChunk` → future spec) and run the quickstart Slice-1 scenarios (S1.1–S1.6). Reference `specs/018-llm-access-layer/quickstart.md`. (FR-031, spec §PR Review Packet Requirements)

**Checkpoint**: Slice 1 is complete, dormant-safe, and reviewable with NO Slice-2 file present → **PR 1**.

---

## Phase 5: User Story 3 — Agent-bundle emitter + redemption + companion skill (Slice 2) (Priority: P3)

**Goal**: Emit self-describing task bundles under `.codegraph/tasks/<id>/`, redeem their handles, and
ship the companion skill — the second first-class path.

**Independent Test** (quickstart S2.1/S2.2): with `CODEGRAPH_LLM_PROVIDER=agent`, `generate()` creates
a `.codegraph/tasks/<id>/` with instructions/graph-context/output-contract/manifest(`pending`) and
returns `{source:'pending-bundle', text:fallback, handle}`; two near-concurrent calls get distinct ids;
no SQLite; a reader with only the directory can produce conforming output; `redeemHandle` returns
pending → completed → missing.

- [ ] T018 [P] [US3] Write failing tests in `__tests__/llm-agent-bundle.test.ts`: `emitBundle` creates the four emit-time files and a `manifest.json` with `status:'pending'` (data-model §3/§4, `contracts/bundle-files.md`); unique ids, two near-concurrent emits never collide/overwrite (FR-024/FR-024a); NO SQLite schema created (FR-023); emit failure (unwritable `.codegraph/tasks/`) surfaces via handle/status, not thrown (Edge Case); `listBundles` enumerates resiliently — a missing/malformed/unreadable `manifest.json` → unreadable/unknown status, empty/absent dir → empty list (FR-026); `redeemHandle` → `{status:'pending'}` before, `{status:'completed', text}` after a completed bundle is constructed, `{status:'missing'}` after the dir is removed, `{status:'pending'}` on a present-but-unreadable manifest (never throws, never false `completed`), and `{status:'missing'}` for a handle carrying a path separator / escaping the tasks root (anchor containment, no read) (FR-010a, FR-029a). Tests MUST FAIL. (FR-010a, FR-021, FR-022, FR-023, FR-024, FR-024a, FR-026, SC-005)
- [ ] T019 [US3] Implement `src/llm/agent-bundle.ts` per research D8/D9: `emitBundle` (`crypto.randomUUID()` + exclusive `mkdirSync(dir,{recursive:false})`, EEXIST → regenerate; writes `instructions.md`, `graph-context.json`, `output-contract.json`, `manifest.json`); manifest read/write; `listBundles` (resilient, `daemon-registry.ts` precedent); `redeemHandle(root, handle): RedeemResult` (data-model §7, reads only the handle's own dir, no new persistence — FR-023); and the shared `readBundleFileSafely(root, bundleDir, relPath)` + single-segment anchor-containment helper (both reused from `validatePathWithinRoot` — FR-029a: containment, symlink reject, `MAX_BUNDLE_INPUT_BYTES=1_048_576`, `MAX_JSON_DEPTH=32`, read-expected-fields-only). Filesystem-only — MUST NOT touch `src/db/schema.sql`/SQLite. Make T018 green. (FR-010a, FR-021, FR-022, FR-023, FR-024, FR-024a, FR-026, FR-029a, SC-005)
- [ ] T020 [US3] Slice-2 surgical edit to `src/llm/generate.ts`: flip the agent branch from the Slice-1 fallback stub to call `emitBundle` and return `{source:'pending-bundle', text:task.fallback, handle}`; if emission itself fails, degrade to `{source:'fallback', text:task.fallback}` (Edge Case; US1 preserved). Extend `__tests__/llm-generate.test.ts` with the agent-active case. Now `generate.ts` may import `agent-bundle.ts` (Slice 2). (FR-010, FR-010a, US1 AS-3)
- [ ] T021 [US3] Extend agent-active observability: `resolveLlmStatus`/`getLlmStatus` agent branch gains `pendingBundles` (count under `.codegraph/tasks/`, still network-free) and the CLI `LLM:` block renders `Provider: agent + N pending bundle(s)` (data-model §8, research D12); re-export `listBundles`, `redeemHandle`, and the bundle/`RedeemResult` types through `src/index.ts`. (FR-006, FR-010a)
- [ ] T022 [P] [US3] Author the companion skill `.claude/skills/codegraph-tasks/SKILL.md` — a thin discovery wrapper: find pending bundles under `.codegraph/tasks/`, complete a bundle using ONLY its directory contents, and as the FINAL step run `codegraph tasks ingest <id>` (research D14). Repo dogfooding config, NOT wired into `copy-assets` (ships nowhere — SPEC-026 owns plugin distribution). Independent doc → parallel-safe. (FR-025)

**Checkpoint**: Agent mode emits, redeems, and is discoverable; no SQLite; US1 guarantee preserved.

---

## Phase 6: User Story 4 — Ingest validation + FR-029a hardening + tasks CLI (Slice 2) (Priority: P4)

**Goal**: The explicit `codegraph tasks list|ingest` CLI that validates an agent's output structurally,
stores the canonical result, stamps `completed`, and hardens every untrusted read.

**Independent Test** (quickstart S2.3/S2.4/S2.5): conforming output → validated, `result.json` stored,
manifest `completed`; non-conforming / early / malformed / path-escaping / symlink / oversize / deep-JSON
output → rejected, reason to stderr, manifest stays `pending`, NO file written outside the bundle dir;
`tasks list` shows id/status/age; unknown action exits non-zero.

- [ ] T023 [P] [US4] Write failing tests in `__tests__/llm-ingest.test.ts`: conforming `output.json` → structural validation passes, canonical `result.json` stored INSIDE the bundle dir, manifest → `completed` (FR-027/FR-028); non-conforming → rejected, reason to stderr, manifest stays `pending` (re-runnable), NO consumer artifact and NO file outside the bundle dir (FR-028a/FR-029); absent/empty/unreadable `output.json` (ingested too early) → FR-028a-shaped rejection, never a crash or false `completed` (FR-027); ingest never auto-runs from watcher/daemon (FR-029); end-to-end emit→ingest→`redeemHandle`=`{completed,text}` (FR-010a). Tests MUST FAIL. (FR-010a, FR-027, FR-028, FR-028a, FR-029, SC-006)
- [ ] T024 [US4] Implement `src/llm/ingest.ts` `ingestBundle` per `contracts/bundle-files.md` / research D10: read `output.json` via `readBundleFileSafely` (T019); validate against the `OutputContract` (`requiredFields` present, correct `type`, non-empty where `nonEmpty` — deterministic/structural only, never semantic); on pass store `result.json` inside the dir + stamp manifest `completed` (FR-028); on fail leave `pending`, reason → stderr, never `isError`, no consumer artifact (FR-028a/FR-029). Make T023 green. (FR-027, FR-028, FR-028a, FR-029)
- [ ] T025 [P] [US4] Write failing tests in `__tests__/llm-ingest-security.test.ts` (FR-029a, all FR-028a-shaped — manifest stays `pending`, reason to stderr, never `isError`): a `contract`- or `output`-named path resolving outside the bundle dir; a symlink at a path ingest opens (POSIX-gated, `it.runIf(process.platform!=='win32')`); output over the 1 MiB ceiling; JSON past `MAX_JSON_DEPTH`; a `__proto__`/`constructor` key leaves no prototype pollution (read-expected-fields-only); and a `tasks ingest <id>` where `<id>` is not a single contained segment (e.g. `../../src`) rejected BEFORE the bundle dir is opened (anchor containment). Tests MUST FAIL. (FR-029a, SC-006)
- [ ] T026 [US4] Complete FR-029a hardening on the ingest path in `src/llm/ingest.ts`: route EVERY named path (agent output, the `manifest.contract` pointer, any contract/output-named path) through `readBundleFileSafely`; validate the `<id>`/handle as a single contained segment (anchor containment) before trusting the bundle dir as the per-path anchor; consume parsed output by reading only the contract's declared fields (never deep-merge/`Object.assign`). Make T025 green. (FR-029a, SC-006)
- [ ] T027 [P] [US4] Write failing tests in `__tests__/llm-tasks-cli.test.ts` (`contracts/tasks-cli.md`): `tasks list` prints id/status/age per bundle and exits 0 on empty/absent/corrupt dirs (FR-026); `tasks ingest <id>` exits 0 on success and non-zero with the reason on stderr for a contract violation / early output / anchor-containment or FR-029a rejection / missing / already-completed / malformed manifest (FR-026/FR-028a/FR-029a); unknown action → error + non-zero exit (telemetry precedent). Tests MUST FAIL. (FR-026, FR-028a, FR-029a)
- [ ] T028 [US4] Register `program.command('tasks [action] [id]')` in `src/bin/codegraph.ts` (flat positional shape, `telemetry [action]` precedent, research D11): `list` → resilient enumeration; `ingest <id>` → `ingestBundle` with the exit-code/stderr contract; unknown action → non-zero. User-invoked only — NOT wired into watcher/daemon (FR-029). Re-export `ingestBundle` through `src/index.ts`. Make T027 green. (FR-026, FR-028, FR-028a, FR-029, FR-029a)

**Checkpoint**: The agent-bundle loop closes end-to-end; all hardening green; ingest writes nothing outside the bundle dir.

---

## Phase 7: User Story 5 — Research note (self-repo UAT) (Slice 2) (Priority: P5) → PR 2

**Goal**: The committed comparison of the two paths that doubles as the self-repo UAT record, inside
Slice 2's own PR.

**Independent Test** (quickstart S2.7): a committed note reports cost, quality, and latency for BOTH
paths on one wiki chapter + one PR narrative generated against THIS repository, naming which inputs
were used, with NO cloud-endpoint arm.

- [ ] T029 [US5] Run the timeboxed spike (Q9 — timeboxed, NOT LOC-budgeted) against the Slice-2 worktree's own build and this repo's live index (no prior merge to `main` — preflight per CLAUDE.md: `npm install && npm run build`, `codegraph init .`, `codegraph status`): endpoint arm via the `.envrc.local` hal endpoint, agent arm via a bundle completed by Claude Code using the companion skill then `codegraph tasks ingest <id>` + `redeemHandle`; produce one wiki chapter + one PR narrative through EACH path; record cost (local $0 vs subscription-amortized), maintainer-judged quality, and latency. Commit `docs/design/llm-paths-note.md` INSIDE Slice 2's PR — no cloud-endpoint arm; it IS the recorded self-repo UAT outcome (research D13). (FR-030, FR-031, SC-007)
- [ ] T030 [US5] Add the Slice-2 `### New Features` entry under `## [Unreleased]` in `CHANGELOG.md` (user-facing: the opt-in agent task-bundle path + `codegraph tasks list|ingest` + companion skill; no internal paths/symbols). (FR-031)
- [ ] T031 [US5] Assemble the PR-2 review packet (what changed / why / non-goals / review order / scope budget / traceability FR→files→evidence / verification incl. the US5 note + FR-029a security evidence + dormancy re-probe / known gaps / rollback; deferred: companion-skill plugin packaging → SPEC-026) and run the quickstart Slice-2 scenarios (S2.1–S2.7). Reference `specs/018-llm-access-layer/quickstart.md`. (FR-031, spec §PR Review Packet Requirements)

**Checkpoint**: Slice 2 is complete with the committed research note → **PR 2**.

---

## Phase 8: Cross-cutting guardrails (apply to BOTH PRs)

**Purpose**: Constitution/Non-goals verification each slice PR must pass before review claim.

- [ ] T032 [P] Non-goals guardrail verification: confirm `git diff` for the slice touches NO `src/db/schema.sql`, NO `src/mcp/tools.ts`, NO new entry in `package.json` dependencies; and that no code implements a heuristic registry, watcher/daemon auto-ingestion, auto-chunk/map-reduce, a `codegraph llm generate` command, or an ingest-driven consumer-artifact write. (FR-013, FR-014, FR-019, FR-020, FR-023, FR-029; Constitution V/VI/VII)
- [ ] T033 Full gate (per slice, before its PR): `npm run build`, then the env-clean `npm test` (unset `CODEGRAPH_EMBEDDING_*` + `CODEGRAPH_LLM_*`) with the LLM suites green, then `npx tsc --noEmit` clean. (Constitution Quality Gates; FR-004 dormancy)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; BLOCKS all user stories (config + status underpin the seam, client, and CLI).
- **Slice 1 (Phases 3–4)**: US2 (Phase 3) depends on Foundational; US1 (Phase 4) depends on Foundational + US2 (the seam orchestrates the client/prompt). PR 1 at end of Phase 4.
- **Slice 2 (Phases 5–7)**: MUST NOT start until ALL of Phases 1–4 (T001–T017) are complete (slice-boundary rule). US3 (Phase 5) → US4 (Phase 6) depends on US3 (ingest/redeem/CLI need the emitter + `readBundleFileSafely`) → US5 (Phase 7) depends on both paths existing. PR 2 at end of Phase 7.
- **Cross-cutting (Phase 8)**: run per slice, before that slice's PR.

### Critical intra-slice dependencies

- T004 → T006 (same file `config.ts`, sequential).
- T008 + T010 (prompt.ts, client.ts) → T012 (generate orchestrates both) → T013/T014 → T015 (dormancy gate needs the assembled seam + status).
- T019 (emitter + `readBundleFileSafely` + `redeemHandle`) → T020 (generate wiring) and → T024/T026 (ingest reuses the safe-read) and → T028 (CLI uses `listBundles`/`ingestBundle`).
- T024 → T026 (same file `ingest.ts`, sequential).
- Everything in Slices 1 & 2 → T029 (research note exercises both paths).

### Parallel opportunities ([P])

- **Setup**: T002 [P] (independent of the T001 verification).
- **Foundational**: T003 [P] and T005 [P] (distinct test files) run together; T004 then T006 are sequential (shared `config.ts`).
- **Slice 1 US2**: T007 [P] and T009 [P] together (prompt vs client tests — the workflow's named [P] example); T008 [P] and T010 [P] together (distinct files `prompt.ts` vs `client.ts`).
- **Slice 1 US1**: T011 [P] (test) alone in its phase; T013 (index.ts) and T014 [P] (bin/codegraph.ts) touch distinct files and run together.
- **Slice 2 US3**: T018 [P] (test) and T022 [P] (SKILL.md doc) are independent of each other and of the T019 impl.
- **Slice 2 US4**: T023 [P], T025 [P], T027 [P] (three distinct test files) run together; their impls T024/T026 (ingest.ts) and T028 (bin) are sequential where they share a file.
- **Cross-cutting**: T032 [P] (diff inspection) runs alongside T033 within a slice's finalization.

---

## Implementation Strategy

### MVP (Slice 1 → PR 1)

1. Phase 1 Setup → Phase 2 Foundational (config + status).
2. Phase 3 US2 (client + prompt) → Phase 4 US1 (generate + status block + dormancy gate).
3. STOP and VALIDATE: quickstart S1.1–S1.6 green, dormancy byte-identical, `tsc` clean. Ship **PR 1**.
   Slice 1 delivers a usable, dormant-safe seam with the endpoint path — value on its own, no Slice-2 file present.

### Incremental (Slice 2 → PR 2)

4. Only after Slice 1 is complete: Phase 5 US3 (emitter + redeem + skill) → Phase 6 US4 (ingest + hardening + CLI).
5. Phase 7 US5 (research-note spike) committed INSIDE Slice 2's PR.
6. STOP and VALIDATE: quickstart S2.1–S2.7 green, FR-029a security suite green, note committed. Ship **PR 2**.

### Notes

- [P] = different files, no incomplete-task dependency. Verify each test FAILS before its implementation task.
- Each slice ships as its own PR with a `## [Unreleased]` `### New Features` entry; never pre-create a version block.
- Every changed line traces to an FR (Constitution III); keep upstream-owned diffs (`src/index.ts`, `src/bin/codegraph.ts`, `CHANGELOG.md`) minimal and additive.

---

## Requirements coverage (every FR mapped)

| FR | Task(s) | | FR | Task(s) |
|---|---|---|---|---|
| FR-001 | T003, T004 | | FR-016a | T009, T010 |
| FR-002 | T003, T004 | | FR-017 | T009, T010 |
| FR-003 | T003, T004 | | FR-018 | T002, T007, T008 |
| FR-004 | T003, T004, T015, T033 | | FR-019 | T007, T008, T032 |
| FR-005 | T003, T004, T009, T010 | | FR-020 | T009, T010, T032 |
| FR-006 | T005, T006, T013, T014, T021 | | FR-021 | T018, T019 |
| FR-007 | T003, T004 | | FR-022 | T018, T019 |
| FR-008 | T002, T011, T012, T013 | | FR-023 | T018, T019, T032 |
| FR-009 | T011, T012 | | FR-024 | T018, T019 |
| FR-009a | T009, T010, T011, T012 | | FR-024a | T011, T012, T018, T019 |
| FR-010 | T020 | | FR-025 | T022 |
| FR-010a | T018, T019, T020, T023 | | FR-026 | T018, T019, T027, T028 |
| FR-011 | T011, T012, T015 | | FR-027 | T023, T024, T026 |
| FR-012 | T002, T011, T012, T013 | | FR-028 | T023, T024, T028 |
| FR-013 | T011, T012, T032 | | FR-028a | T023, T024, T025, T026, T027 |
| FR-014 | T011, T012, T032 | | FR-029 | T023, T024, T028, T032 |
| FR-015 | T009, T010 | | FR-029a | T018, T019, T025, T026, T027, T028 |
| FR-015a | T009, T010 | | FR-030 | T029 |
| FR-016 | T009, T010 | | FR-031 | T001, T016, T017, T029, T030, T031 |

**User-story coverage**: US1 → T011–T017 (+ foundational T002–T006); US2 → T007–T010, T014;
US3 → T018–T022; US4 → T023–T028; US5 → T029–T031. Every US has failing-test-first + implementation
+ an independent test criterion.

**Success criteria**: SC-001 → T011/T012/T015; SC-002 → T015/T033; SC-003 → T007/T008; SC-004 →
T005/T006/T014; SC-005 → T018/T019; SC-006 → T023/T024/T025/T026; SC-007 → T029.
