# Implementation Plan: LLM Access Layer

**Branch**: `018-llm-access-layer` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-llm-access-layer/spec.md`

## Summary

One shared `src/llm/` capability lets future Intelligence Platform features (SPEC-011
cluster labels, SPEC-019 wiki prose, SPEC-020 PR narratives) request LLM prose exactly
one way — `generate(root, proseTask)` — and always receive usable text: endpoint prose
when an OpenAI-compatible endpoint is configured, the consumer's own precomputed fallback
(plus a redeemable pending-bundle handle) in agent mode, or the fallback verbatim when
nothing is configured. The layer mirrors the proven SPEC-001/002 embeddings posture
(discriminated-union config resolution, redaction, plaintext-remote warning, internal-constant
retry/timeout with test-only overrides, byte-identical dormancy) and adds a second first-class
path: a self-describing task bundle under `.codegraph/tasks/<id>/` that any subscription coding
agent completes by reading the directory, finalized by an explicit `codegraph tasks ingest <id>`.

Delivered as **two independently reviewable vertical slices**, two PRs off this one branch:
- **Slice 1 — endpoint path end-to-end**: `config.ts` + `client.ts` + `prompt.ts` (token guard)
  + `generate.ts` seam with fallback degradation + `getLlmStatus()` + the status `LLM:` block.
  Complete and reviewable with no slice-2 file present.
- **Slice 2 — agent-bundle path**: `agent-bundle.ts` emitter/manifest/list/redeem +
  `ingest.ts` (structural validation + FR-029a hardening) + `tasks` CLI + companion skill +
  the committed research note (US5), all inside slice 2's own PR.

## Technical Context

**Language/Version**: TypeScript (strict mode), compiled with `tsc` via `npm run build`
(which also runs `copy-assets` — this spec adds no SQL/wasm/static asset, so `copy-assets`
is untouched).

**Primary Dependencies**: NONE new (Constitution VII). HTTP via the platform's built-in
global `fetch` + `AbortSignal.timeout`, exactly as `src/embeddings/endpoint-provider.ts`.
Bundle ids via `crypto.randomUUID()`. Path safety via the existing `validatePathWithinRoot`
(`src/utils.ts`).

**Storage**: NONE for this spec. Bundle lifecycle state is filesystem-only — a `manifest.json`
per bundle under `.codegraph/tasks/<id>/` (Q5). The graph DB (`node:sqlite`) is never opened,
and `src/db/schema.sql` is never modified.

**Testing**: vitest; `__tests__/` mirrors the module layout. Tests write real files in
`fs.mkdtempSync` temp dirs, clean up in `afterEach`, and never mock the filesystem. Endpoint
tests drive a local fake HTTP server (`http.createServer`, `embeddings-endpoint.test.ts`
precedent). Config resolution and status take an explicit `env` argument (mirroring
`loadEmbeddingConfig(env)`), so dormancy/mode tests are hermetic regardless of the ambient
dogfood shell. **Test-env rule (carried forward): the CODEGRAPH_LLM_* dormancy suites unset
the ambient LLM env** — `env -u CODEGRAPH_LLM_URL -u CODEGRAPH_LLM_MODEL -u CODEGRAPH_LLM_API_KEY
-u CODEGRAPH_LLM_PROVIDER npm test` — because the maintainer's `.envrc.local` may configure a
live LLM endpoint for the US5 research note, and the byte-identical-dormancy assertions must
see an unconfigured environment.

**Target Platform**: Node `>=20 <25` engines range (effective from-source floor 22.5, per
Constitution VII); same cross-platform surface as the rest of the CLI/library. Symlink-rejection
security tests are POSIX-gated (`it.runIf(process.platform !== 'win32')`) where symlink creation
needs privilege on Windows, mirroring the known `security.test.ts` caveat.

**Project Type**: Single-project library + CLI (Option 1). New leaf module `src/llm/` plus
minimal wiring into two upstream-owned files (`src/index.ts`, `src/bin/codegraph.ts`).

**Performance Goals**: Not a hot path. Endpoint generation latency is bounded by a flat
non-streaming total-request deadline (~300 s, 120–600 s band) or, for streaming, an inter-chunk
idle deadline (~45 s of silence). Token-budget trimming is O(n) over consumer-supplied context
items and fully deterministic.

**Constraints**:
- Dormancy discipline (Constitution VII + FR-004): with no `CODEGRAPH_LLM_*` set → zero network
  calls, zero filesystem writes, byte-identical to an unconfigured install.
- API-key hygiene (FR-005): the key lives in memory only — never persisted, logged, echoed, or
  copied into any bundle file. Every error leaving the client is a redaction-safe
  `LlmEndpointError` (scheme+host+port only), built exactly like `EmbeddingEndpointError`.
- No new runtime dependency (FR-020 / Constitution VII).
- No `src/mcp/tools.ts` changes — this spec exposes no MCP tool, so the retrieval surface
  (Constitution VI, explore budgets) is untouched.
- LLM prose is confined to the seam's return value and bundle files — NEVER written into graph
  structure (FR-014 / Constitution V).

**Scale/Scope**: ~900–1300 production LOC across both slices (excluding tests and the prose
research note); ~6 new `src/llm/*.ts` production files + 3 minimally-modified upstream files;
~10 test files; 1 companion skill; 1 research note. See Reviewability Budget below.

**Clarify-pinned constants carried into implementation** (all internal constants, test-only
overridable via an `LlmEndpointClientOverrides` interface mirroring `EndpointProviderOverrides`;
none are user-facing env knobs, per FR-007). Exact magnitudes are confirmable at implement time;
these are the planned values grounded in the Clarify consensus (CRL 2–4) and Assumptions:

| Constant | Planned value | Source |
|---|---|---|
| `CHARS_PER_TOKEN` | 4 | FR-018 chars-per-token heuristic (no tokenizer) |
| `GRAPH_CONTEXT_TOKEN_BUDGET` | 2000 tokens → `GRAPH_CONTEXT_CHAR_BUDGET` = 8000 chars | FR-018 + Assumptions (~2,000-token graph-context portion of the ~4,096-token operative window; CRL 3) |
| Truncation marker | `[context truncated: N of M]` (N graph-context items kept of M total) | FR-018 / design-concept Q6 |
| `DEFAULT_MAX_OUTPUT_TOKENS` (`max_tokens`) | 1024 | FR-015 (internal constant bounding worst-case output; coherent with the 4,096 window after context+instructions) |
| `DEFAULT_TOTAL_TIMEOUT_MS` (non-streaming flat deadline) | 300_000 | FR-017 + Assumptions (120–600 s band, ~300 s start; CRL 4) |
| `MAX_TOTAL_TIMEOUT_MS` (clamp ceiling) | 600_000 | mirrors embeddings `MAX_TIMEOUT_MS` |
| `DEFAULT_IDLE_TIMEOUT_MS` (streaming inter-chunk deadline) | 45_000 | FR-017 + Assumptions (30–60 s silence; CRL 4) |
| `DEFAULT_MAX_RETRIES` / `BASE_DELAY_MS` / `MAX_DELAY_MS` / `RETRY_AFTER_CAP_MS` | 3 / 1000 / 8000 / 30_000 | mirror `EndpointProviderOverrides` exactly (Assumptions: retry/backoff mirror embeddings) |
| `MAX_RESPONSE_BYTES` (endpoint hard total-response-size ceiling) | 33_554_432 (32 MiB) | FR-017 + Assumptions (streamed byte-counting read, abort-on-exceed → consumer fallback; maintainer security-consensus decision CRL 9, 2026-07-13; model-fetch download-budget precedent; test-overridable via `maxResponseBytes?`, never user-facing per FR-007) |
| `MAX_BUNDLE_INPUT_BYTES` (ingest size ceiling) | 1_048_576 (1 MiB) | FR-029a (stat-then-cap before read; adapts the `MAX_HELLO_LINE_BYTES` stream precedent to a file read) |
| `MAX_JSON_DEPTH` (ingest nesting-depth ceiling) | 32 | FR-029a (Node stack-exhaustion guidance; a manifest/output is shallow) |

**Reviewability Budget**:
- **Primary surface**: harness/adapter — the LLM config resolver, the OpenAI-compatible endpoint
  client, and the agent-bundle filesystem I/O. **One** primary surface.
- **Secondary surfaces**: API (the single `generate()` seam re-exported through `src/index.ts`);
  scheduler/runtime (the `codegraph tasks list|ingest` subcommand); docs/process (the companion
  skill and the committed research note).
- **Projected reviewable LOC**: ~900–1300 across both slices (slice 1 ~500–700; slice 2 ~400–600),
  excluding tests and the prose note.
- **Projected production files**: ~8–12; **Projected total files**: ~16–24 including tests, skill,
  and note.
- **Budget result**: within budget, enforced by the two-slice split — each slice is its own PR,
  each under the constitution's per-PR block thresholds (800 reviewable LOC, 8 production files,
  25 total files, 1 primary surface). Split ratified in spec §Reviewability Budget + design-concept
  Q12.

## Constitution Check

*GATE: evaluated before Phase 0 and re-affirmed after Phase 1 design. Result: PASS — no violations,
Complexity Tracking table empty.*

| Principle | Verdict | Evidence |
|---|---|---|
| **I. Think Before Coding** | PASS | Every ambiguity resolved before plan: 12 design-concept questions (Q1–Q12), 3 Clarify sessions, 6 consensus resolutions (CRL 1–6) — this table records the plan-phase state; the later Checklist phase added CRL 7–9 (FR-009a/FR-015a plus the FR-017 response-size ceiling, the FR-029a id/handle anchor-containment amendment, and the FR-010a corrupt-manifest/invalid-handle clarifications), all still PASS and reflected in this plan's constants table and file map. Zero `[NEEDS CLARIFICATION]` remain in spec.md; research.md records each plan-time decision with rationale + rejected alternatives. |
| **II. Simplicity First** | PASS | Minimum surface: filesystem manifest not a DB table (Q5); no auto-chunk/map-reduce (Q6/FR-019); no layer-owned heuristic registry (Q2/FR-013); no permanent `codegraph llm generate` surface (Q8); consumer-supplied fallback is a plain string, not a producer (Assumptions, SemVer-additive later). Streaming is kept (Q7) — a recorded maintainer deviation per the roadmap, not speculative scope. |
| **III. Surgical Changes** | PASS | New capability in a new opt-in module `src/llm/` behind `CODEGRAPH_LLM_*` (the fork-discipline corollary explicitly lists `src/llm`). Upstream-owned diffs are minimal and additive: `src/index.ts` gains re-exports + `getLlmStatus()`; `src/bin/codegraph.ts` gains an `LLM:` status block (Embeddings block untouched) + a `tasks` command; no other upstream file changes. |
| **IV. Goal-Driven Execution** | PASS | Verifiable goals per FR with TDD (codegraph-project-overrides preset: bug fixes start from a failing test). Determinism (SC-003), dormancy (SC-002), rejection/hardening (SC-006/FR-029a) each have explicit failing-test-first goals; quickstart.md is the runnable evidence guide. |
| **V. Deterministic, LLM-Free Extraction** | PASS | FR-014: LLM prose is confined to the seam return value + bundle files and is NEVER written into nodes/edges. `generate()` never touches the graph DB; agent-mode state is filesystem-only (FR-023). |
| **VI. Retrieval Performance Is a Regression Surface** | PASS | No `src/mcp/tools.ts` change, no explore-budget change, no new MCP tool. The retrieval do-not-regress surface is entirely untouched. |
| **VII. Local-First, Private, Zero Native Deps** | PASS | No new runtime dependency (built-in `fetch`); `node:sqlite` untouched; no new SQL/wasm/static asset (so `copy-assets` is untouched); network calls only to the user-configured `CODEGRAPH_LLM_URL`; dormancy byte-identical (FR-004); telemetry unaffected. The companion skill is repo dogfooding config under `.claude/skills/`, not a shipped asset — plugin-channel distribution stays SPEC-026's job (Q10). |

**PR Review Packet source** (per spec §PR Review Packet Requirements): each slice PR carries what
changed / why / non-goals / review order / scope budget / traceability (FR → files → evidence) /
verification (test output, dormancy probe, US5 note for slice 2) / known gaps / rollback (the
feature is dormant unless `CODEGRAPH_LLM_*` is set — rollback is "unset the env"). Deferred work is
named: plugin-channel packaging of the companion skill → SPEC-026; an optional streaming
partial-output `onChunk` API → a future consumer spec (SemVer-additive).

## Project Structure

### Documentation (this feature)

```text
specs/018-llm-access-layer/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — plan-time decisions + rationale
├── data-model.md        # Phase 1 — entities (ProseTask, LlmConfigResult, Bundle, Manifest, GenerationResult, LlmStatus)
├── quickstart.md        # Phase 1 — runnable validation scenarios (dormancy, endpoint, agent, ingest, hardening)
├── contracts/           # Phase 1 — the seam, CLI, endpoint-wire, and bundle-file contracts
│   ├── generate-seam.md
│   ├── llm-config-resolution.md
│   ├── endpoint-wire.md
│   ├── tasks-cli.md
│   ├── bundle-files.md
│   └── status-llm-json.md
├── spec.md              # Feature specification (input)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/llm/                         # NEW leaf module (Constitution III lists src/llm explicitly)
├── config.ts                    # [S1 NEW] loadLlmConfig(env) → LlmConfigResult union; redaction + plaintext-remote warning (LLM-worded); resolveLlmStatus(env)
├── client.ts                    # [S1 NEW] LlmEndpointClient: streaming + non-streaming complete(); vendor-neutral OpenAI-standard fields only (FR-015a); stream assembled on [DONE] OR clean EOF (FR-016a); empty/whitespace completion → fail (FR-009a); retry/timeout; hard total-response-size ceiling via a streamed byte-counting read that aborts on exceed → fallback (`MAX_RESPONSE_BYTES`, FR-017); LlmEndpointClientOverrides (incl. `maxResponseBytes?`); LlmEndpointError (redaction-safe)
├── prompt.ts                    # [S1 NEW] composePrompt (priority order: instructions > output contract > graph context; only graph-context trimmed, instructions + contract never truncated — FR-018); estimateTokens (chars/4); trimToBudget + "[context truncated: N of M]"; token constants
├── generate.ts                  # [S1 NEW] generate(root, task) seam; ProseTask / GenerationResult; endpoint + dormant + fallback in S1; agent branch = fallback stub in S1
├── agent-bundle.ts              # [S2 NEW] emitBundle (randomUUID + exclusive dir create); manifest read/write; listBundles; redeemHandle (FR-010a); bounded safe-read helper
└── ingest.ts                    # [S2 NEW] ingestBundle: structural contract validation (FR-027); store result + stamp completed (FR-028); rejection semantics (FR-028a); FR-029a hardening

src/index.ts                     # [S1 MODIFIED] re-export generate + ProseTask/GenerationResult/OutputContract types; add getLlmStatus() method (delegates to resolveLlmStatus)
                                 # [S2 MODIFIED] re-export listBundles/ingestBundle/redeemHandle + bundle types; extend getLlmStatus for agent-active state
src/bin/codegraph.ts             # [S1 MODIFIED] status: LLM: block after Embeddings: (+ llm in --json); [S2 MODIFIED] register `tasks [action] [id]`; flip LLM: agent stub → full
CHANGELOG.md                     # [S1 MODIFIED] New Features entry; [S2 MODIFIED] second New Features entry (one per slice PR)

.claude/skills/codegraph-tasks/  # [S2 NEW] companion skill — thin discovery wrapper (find pending bundles, complete, run `codegraph tasks ingest <id>`)
└── SKILL.md
docs/design/llm-paths-note.md    # [S2 NEW] the committed research note (US5 / FR-030); self-repo UAT record

__tests__/                       # mirror the module; write real files; local fake HTTP server; hermetic env
├── llm-config.test.ts           # [S1] union resolution, provider precedence, redaction, plaintext-remote warning
├── llm-client.test.ts           # [S1] fake server: success / retry-then-degrade / streaming assembly / non-streaming / flat timeout / idle deadline / redaction-safe error / minimal body
├── llm-prompt.test.ts           # [S1] token estimate; deterministic trim + marker; priority-order composition; identical-in→identical-out
├── llm-generate.test.ts         # [S1] seam: dormant fallback (no net/no fs); endpoint success/failure; source discriminator; agent-in-S1 = fallback stub
├── llm-dormancy.test.ts         # [S1] zero network, zero fs writes, byte-identical (embeddings-dormancy precedent)
├── llm-status.test.ts           # [S1] resolveLlmStatus union; network-free; redacted URL; plaintext advisory IN status; CLI LLM: block render
├── llm-agent-bundle.test.ts     # [S2] self-describing emit; unique ids / no collision; no SQLite; emit-failure degrades to fallback; redeem completed/pending/missing
├── llm-ingest.test.ts           # [S2] structural validate pass/reject; store + stamp completed; reject leaves pending + stderr + no consumer artifacts; writes only inside bundle dir
├── llm-ingest-security.test.ts  # [S2, FR-029a] path-escape reject; symlink reject (POSIX-gated); oversize reject; deep-JSON reject; prototype-pollution key ignored — all FR-028a-shaped
└── llm-tasks-cli.test.ts        # [S2] tasks list (id/status/age); tasks ingest success + reject exit codes; unknown action
```

**Structure Decision**: Single-project Option 1. The capability is a self-contained leaf module
`src/llm/` (six production files), wired into the public library surface (`src/index.ts`) and the
CLI (`src/bin/codegraph.ts`) with additive, surgical diffs. `generate()` is a **free function**
re-exported through `src/index.ts` (it needs no `CodeGraph`/DB instance — graph context is
consumer-supplied opaque items, so `src/llm` never imports `src/context`); `getLlmStatus()` is a
thin `CodeGraph` method for CLI symmetry with `getEmbeddingStatus()`, delegating to the pure
`resolveLlmStatus(env)`. This mirrors the SPEC-001/002 `src/embeddings/` layout one-for-one.

## Complexity Tracking

> No Constitution Check violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
