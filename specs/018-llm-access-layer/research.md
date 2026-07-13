# Phase 0 Research: LLM Access Layer

All spec-level ambiguity was resolved upstream (12 design-concept questions Q1–Q12, 3 Clarify
sessions, 6 consensus resolutions CRL 1–6); spec.md carries zero `[NEEDS CLARIFICATION]` markers.
This document records the **plan-time detail** decisions the spec explicitly deferred here, each
with rationale and rejected alternatives, plus the concrete values for the clarify-pinned
constants. Nothing below contradicts spec.md, the design concept, or CRL 1–6.

## D1 — Module shape and public seam

**Decision**: `src/llm/` is a leaf module of six production files: `config.ts`, `client.ts`,
`prompt.ts`, `generate.ts` (slice 1); `agent-bundle.ts`, `ingest.ts` (slice 2). `generate()` is a
**free function** exported from `generate.ts` and re-exported through `src/index.ts` (the public
surface). `getLlmStatus()` is a thin `CodeGraph` method delegating to the pure
`resolveLlmStatus(env)` in `config.ts`.

**Rationale**: One-for-one mirror of `src/embeddings/` (Constitution III fork discipline; the
principle names `src/llm` explicitly). `generate()` needs no DB/`CodeGraph` instance — graph
context arrives as consumer-supplied opaque items (Q2, Session 3), so `src/llm` never imports
`src/context`. Keeping resolution/status as pure `(env) => …` functions (mirroring
`loadEmbeddingConfig(env)`) makes dormancy/mode tests hermetic against the ambient dogfood shell.
`getLlmStatus()` as a `CodeGraph` method (not a free function) is the minimal-diff CLI mirror of
`getEmbeddingStatus()` — the status command already holds a `cg` instance.

**Alternatives rejected**: (a) `generate()` as a `CodeGraph` method — would couple the layer to the
DB it doesn't need and fight the "graph context is consumer-supplied" contract. (b) Splitting the
token guard into `client.ts` — a standalone `prompt.ts` keeps deterministic-trim tests isolated
from HTTP.

## D2 — Redaction / plaintext-remote helpers: parallel, not imported

**Decision**: `src/llm/config.ts` imports only `isLoopbackHost` from `../utils` (the already-shared
primitive) and defines its **own** `redactEndpoint`, `isPlaintextRemoteEndpoint`, and an
LLM-worded `plaintextRemoteWarning` analog.

**Rationale**: This is exactly how `src/embeddings/config.ts` is structured — it borrows
`isLoopbackHost` from `../utils` and defines its own redaction + warning. Mirroring that keeps the
two opt-in modules independent (no new `src/llm → src/embeddings` edge) and lets the warning message
say "LLM endpoint" rather than "embedding endpoint". The redaction logic is ~15 trivial pure lines;
paralleling it is the faithful mirror the spec asks for ("redactEndpoint-style redaction,
plaintextRemoteWarning analog").

**Alternatives rejected**: importing `redactEndpoint`/`isPlaintextRemoteEndpoint` from
`src/embeddings/config` — saves ~15 lines but creates a cross-module dependency between two
independent opt-in features and forces an embeddings-worded warning into the LLM path.

## D3 — Config resolution: the four-state discriminated union

**Decision**: `loadLlmConfig(env): LlmConfigResult = LlmEndpointConfig | LlmAgentConfig | LlmMisconfig | null`.
Resolution order mirrors embeddings (Q3):
1. Explicit `CODEGRAPH_LLM_PROVIDER`:
   - `agent` → `LlmAgentConfig` (explicit-only; never an implicit fallback — FR-003).
   - `endpoint` → resolve `CODEGRAPH_LLM_URL` + `CODEGRAPH_LLM_MODEL` strictly; a missing one is a
     `LlmMisconfig` naming the gap (both missing → name both), never a silent downgrade.
   - unrecognized value → `LlmMisconfig` with `invalidValue` + `allowedValues = ['endpoint','agent']`.
2. No explicit provider: URL+MODEL both set → `LlmEndpointConfig`; exactly one set → `LlmMisconfig`;
   neither → `null` (dormant, the default — FR-001/FR-004).

Activation variables are `CODEGRAPH_LLM_URL` + `CODEGRAPH_LLM_MODEL`. `CODEGRAPH_LLM_API_KEY` is
**not** an activation variable: API-key-only (no URL/MODEL, no provider) resolves to `null` dormant,
and the key is held in memory only in every state (FR-005; Edge Case "API key present but mode is
dormant or agent").

**Rationale**: Direct mirror of `loadEmbeddingConfig`. The valid-provider set is `{endpoint, agent}`
(there is no embeddings-style `local`/`off` — LLM has no bundled local provider, and dormant is the
unset default). Treating an unrecognized provider as a named misconfig (not a crash) reuses the
embeddings `invalidValue`/`allowedValues` shape verbatim.

**Alternatives rejected**: a per-call mode argument with no env selector (Q3 alt) — spreads mode
plumbing into every consumer spec; auto-cascade endpoint→bundle→heuristic (Q3 alt) — violates
dormancy discipline by writing unrequested bundle files.

**FR-007 clamp note**: the LLM endpoint config exposes **no** user-facing numeric env tunables
(url/model/apiKey only). Retry, timeout, idle deadline, token budget, and `max_tokens` are all
internal constants (test-only overridable). The positive-int parse+clamp helper is therefore carried
as the pattern of record for any *future* numeric knob, but no such knob ships in v1 — so there is no
`parsePositiveInt` call site in slice 1 unless a future knob is added. (This matches CRL 2's
"clamp-vacuity" note.)

## D4 — Endpoint client: request shape, streaming, timeouts, retry

**Decision**: `LlmEndpointClient.complete(promptParts, { stream }): Promise<string>`, built on global
`fetch` + `AbortSignal` exactly like `EndpointProvider`.
- **Request body** (FR-015, minimal): `{ model, messages, stream }` + `max_tokens` from
  `DEFAULT_MAX_OUTPUT_TOKENS` (1024). `temperature` is omitted (endpoint default). `messages` is the
  composed prompt (see D5). POST to the configured chat-completions URL with
  `content-type: application/json` and, when a key is present, `authorization: Bearer <key>`.
- **Streaming** (FR-016/FR-016a): when `stream:true`, parse the SSE `data:` lines, concatenate
  `choices[].delta.content`, stop on `data: [DONE]`. Streaming is an **internal transport detail** —
  `complete()` still returns one final assembled string; no `onChunk`/iterator is exposed on the
  seam or the prose task. Non-streaming reads one JSON body and takes `choices[0].message.content`.
- **Deadlines** (FR-017): non-streaming enforces a flat total-request deadline
  (`DEFAULT_TOTAL_TIMEOUT_MS` = 300_000, `AbortSignal.timeout`). Streaming enforces an **inter-chunk
  idle deadline** (`DEFAULT_IDLE_TIMEOUT_MS` = 45_000) — a timer reset on every received chunk,
  aborting only on sustained silence, never a single flat cap over the whole stream.
- **Retry** mirrors `EndpointProvider` exactly: retry 5xx/429/timeout/network with exponential
  backoff + full jitter honoring `Retry-After`; fast-abort 4xx; `DEFAULT_MAX_RETRIES` = 3.
- **Errors**: the only error type leaving the module is `LlmEndpointError` — message + own props are
  redaction-safe (endpoint reduced to scheme+host+port via D2's `redactEndpoint`, status a bare
  integer). The raw transport error is read for `.name` only, never chained as `cause`; no response
  body text is ever surfaced (FR-005, `EmbeddingEndpointError` precedent).
- **Test seams**: `LlmEndpointClientOverrides { maxRetries?, baseDelayMs?, maxDelayMs?,
  retryAfterCapMs?, totalTimeoutMs?, idleTimeoutMs?, maxOutputTokens? }` — mirrors
  `EndpointProviderOverrides`, so retry/timeout paths run in milliseconds under test.

**Rationale**: The endpoint arm is deliberately the embeddings client re-shaped from "batch embed"
to "one chat completion." CRL 4 grounds the larger timeout (embeddings' 30 s is generation-inadequate;
120–600 s band, ~300 s start; undici's per-chunk-reset body timeout is the streaming-idle precedent).
CRL 2 grounds the internal-transport-only streaming shape (Principle II; an `onChunk` path stays
SemVer-additive for a future UX spec).

**Alternatives rejected**: exposing streaming as an `onChunk`/async-iterator on the seam (CRL 2
option B/C — unprecedented in-repo, forward-compat case moot under SemVer); a single flat cap over a
whole stream (FR-017 forbids — a slow-but-alive stream would be killed mid-generation).

## D5 — Prompt composition + deterministic token-budget guard

**Decision**: `prompt.ts` composes the chat `messages` in strict priority order —
**instructions > output contract > graph context** — and the guard trims only the lowest-priority
tier (graph-context items) to fit `GRAPH_CONTEXT_CHAR_BUDGET` (2000 tokens × `CHARS_PER_TOKEN` 4 =
8000 chars). Trimming drops whole trailing graph-context items (they are discrete opaque strings),
then appends the marker `[context truncated: N of M]` where N is items kept and M is the total item
count. `estimateTokens(s) = ceil(s.length / 4)`. Identical input → identical trimmed output (no
randomness, no time/locale dependence). No auto-chunk/map-reduce (FR-019).

**Rationale**: design-concept Q6 + FR-018. Item-granular trimming (not mid-item byte truncation)
keeps each surviving context item well-formed and the marker count meaningful. The budget is a fixed
conservative constant sized for the modal ~4,096-token local-model operative window (CRL 3 evidence:
Ollama's default context tier + the silent-truncation failure mode + the absence of any portable
`/v1/models` context-length signal) — never derived from `CODEGRAPH_LLM_MODEL`, which the layer has
no channel to introspect.

**Alternatives rejected**: over-budget → immediate fallback (Q6 alt — discards a viable call over
one large input); auto-chunk/map-reduce (Q6 alt / FR-019 — machinery no first consumer needs);
deriving the budget from the model name (impossible portably, and CRL 3 supersedes the executor's
initial 8K guess with the evidence-grounded ~4,096 anchor).

## D6 — `generate()` seam: the three-kind Generation Result + the slice seam

**Decision**: `GenerationResult` is a three-kind discriminated union (FR-012), **defined in full in
slice 1** so the public type is stable across slices:
```
type GenerationResult =
  | { source: 'endpoint'; text: string }                    // endpoint-produced prose
  | { source: 'pending-bundle'; text: string; handle: string } // fallback text now + redeemable handle
  | { source: 'fallback'; text: string };                   // consumer fallback verbatim
```
`generate(root, task, overrides?)` resolves config once and dispatches:
- **dormant / misconfig** → `{ source:'fallback', text: task.fallback }`; zero network, zero fs writes.
- **endpoint** → try `client.complete`; on success `{ source:'endpoint', text }`; on ultimate failure
  after retries/timeout `{ source:'fallback', text: task.fallback }` (never throws — FR-009).
- **agent**:
  - **Slice 1**: returns `{ source:'fallback', text: task.fallback }` (a documented slice-1
    limitation — the bundle emitter is a slice-2 file; agent mode is not "done" until slice 2, and
    slice 1 still honors US1 "always usable text"). The status `LLM:` block shows a `Provider: agent`
    stub (spec Assumptions).
  - **Slice 2**: one surgical edit flips this branch to call `emitBundle` and return
    `{ source:'pending-bundle', text: task.fallback, handle }`; if emission itself fails, it degrades
    to `{ source:'fallback', text: task.fallback }` (Edge Case "Bundle emission failure"; US1
    preserved).

**Rationale**: Q1's heuristic-now-upgrade-later contract. Defining the `pending-bundle` kind in
slice 1 (even though slice 1 never produces it) keeps `GenerationResult` a stable public type; slice
2's single-branch edit is "building on slice 1's seam," and slice 1 remains complete and reviewable
without any slice-2 file. `root` is a required parameter from slice 1 (stable signature); slice 1's
agent branch simply ignores it.

**Alternatives rejected**: injecting the bundle emitter as a registered module-level hook to avoid
editing `generate.ts` in slice 2 — more machinery (Principle II) for no reviewability gain, since a
one-branch surgical edit is already trivially reviewable. Blocking on the agent (Q1 alt) — couples
call latency to human/agent behavior inside a daemon.

## D7 — FR-010a redemption lookup

**Decision**: `redeemHandle(root, handle): RedeemResult` in `agent-bundle.ts` (slice 2), where
```
type RedeemResult =
  | { status: 'completed'; text: string }   // manifest completed → read canonical result inside the bundle dir
  | { status: 'pending' }                   // manifest still pending
  | { status: 'missing' };                  // bundle dir no longer exists (documented manual cleanup)
```
The handle IS the opaque bundle id. The lookup reads **only** the handle's own bundle directory,
introduces **no** persistence beyond the existing filesystem manifest (FR-023), and reuses D9's
bounded safe-read for the manifest + canonical result. Every path it opens is validated with
`validatePathWithinRoot` (FR-029a applies to redemption too).

**Rationale**: CRL 5 (2/3 consensus, incl. a domain round) — an async-handle contract is incomplete
without its redemption accessor; SPEC-011/019 structurally require retrieving finalized text. The
signature/result-type were explicitly left to plan time by FR-010a.

**Alternatives rejected**: defer the lookup to a consumer spec (CRL 5 option C, carried as recorded
dissent — "consumers read our storage directly" is the anti-pattern the accessor exists to prevent);
adding any index/DB of handles (violates FR-023 filesystem-only).

## D8 — Bundle identity, layout, and manifest

**Decision**: bundle id = `crypto.randomUUID()`; the bundle directory is created with an **exclusive**
`fs.mkdirSync(dir, { recursive: false })` (EEXIST → regenerate the id and retry), the `jobs.ts`
`randomUUID` + exclusive-create discipline. A bundle dir `.codegraph/tasks/<id>/` is self-describing
(Q10) and contains exactly:
- `instructions.md` — the task instructions (prose).
- `graph-context.json` — the consumer-supplied opaque items, embedded verbatim.
- `output-contract.json` — the machine-checkable expected-output contract (D10).
- `manifest.json` — `{ id, status, contract, createdAt }` where `status` is **exactly**
  `'pending' | 'completed'` (CRL 1). No SQLite representation (FR-023).
The agent writes its answer into a well-known output file inside the dir (e.g. `output.json`);
ingest stores the validated canonical result inside the dir (e.g. `result.json`) and stamps the
manifest `completed`.

**Rationale**: Q5/Q10. `randomUUID` gives collision-free unique ids for concurrent generations
(FR-024/FR-024a — no dedup, every call emits its own bundle); the exclusive create is defense in
depth against the astronomically-unlikely collision. Self-describing contents satisfy FR-022 (any
agent completes it from the directory alone).

**Alternatives rejected**: a SQLite bundle table (Q5 alt — a migration + DB coupling for a handful
of small-N directories); a monotonic/timestamp id (collides under concurrency).

## D9 — FR-029a untrusted-input hardening (ingest + redeem)

**Decision**: treat every file the layer reads from a bundle dir — the agent's output, any path the
contract or output itself names, and `manifest.json` — as untrusted, same-user, no-privilege-boundary
input. A shared `readBundleFileSafely(root, bundleDir, relPath)` helper in `agent-bundle.ts` enforces,
in order, **before** the read completes or a parse begins:
1. **Containment**: resolve the path with `validatePathWithinRoot(bundleDir, relPath)` (reused, not
   reimplemented) — reject (`null`) any path resolving outside the bundle dir, including via a symlink
   whose realpath escapes.
2. **Symlink rejection**: `fs.lstatSync` the path and reject if it is a symlink (an opened path must
   be a regular file), independent of where it points.
3. **Size bound**: `fs.statSync` and reject if size > `MAX_BUNDLE_INPUT_BYTES` (1 MiB) **before**
   reading — the stat-then-cap adaptation of the `MAX_HELLO_LINE_BYTES` stream precedent to a file
   read.
4. **Depth bound**: parse JSON and reject if nesting depth > `MAX_JSON_DEPTH` (32) — a bounded-depth
   parse (a small recursive descent or a depth-counting reviver), never unbounded `JSON.parse` on
   attacker-controlled input.
5. **Read-expected-fields-only**: consume the parsed object by reading only the contract's declared
   fields; never deep-merge/`Object.assign` attacker JSON into a live object, so `__proto__`/
   `constructor`/`prototype` keys cannot pollute a prototype.
Every rejection here is **FR-028a-shaped**: the manifest stays `pending`, the reason goes to stderr,
no consumer artifact is written, and it is never surfaced as `isError`. Residual same-process TOCTOU
between check and use is out of scope (consistent with the project's same-user write-sink precedent).

**Rationale**: CRL 1 — 3/3 unanimous security consensus, maintainer-APPROVED 2026-07-13. Precedent
verified in-repo (SPEC-010 FR-017, SPEC-005 FR-017b, SPEC-002 FR-017a); domain additions: depth-bound
(Node stack-exhaustion guidance), no-deep-merge (prototype-pollution guidance), CWE-59 zip-slip
generalized to contract-named paths. Exact ceilings were left to plan time (values in D-constants).

**Alternatives rejected**: reimplementing containment (FR-029a mandates reusing
`validatePathWithinRoot`); unbounded `JSON.parse` (stack-exhaustion + pollution risk);
deep-merging output into a result object (pollution vector).

## D10 — Output contract schema (FR-027, machine-checkable, structural-only)

**Decision**: `output-contract.json` is a minimal structural descriptor:
```
interface OutputContract {
  requiredFields: Array<{ name: string; type: 'string' | 'string[]'; nonEmpty?: boolean }>;
}
```
Ingest validation (FR-027) checks, for the agent's parsed output object: each `requiredField` is
present, is the declared `type`, and is non-empty when `nonEmpty` is set. This is a deterministic
structural check — never a semantic/quality judgment. A failure rejects the output (FR-028a). The
first-consumer prose shape is a single required non-empty `prose: string` field; the schema is
deliberately small and extensible per consumer without layer changes.

**Rationale**: FR-027 pins STRUCTURAL machine-checking only and left the concrete schema to plan
time (CRL 1). A closed `type` enum keeps validation total and deterministic. Types beyond
string/string[] are deferred until a consumer needs them (Principle II).

**Alternatives rejected**: JSON-Schema/ajv (a new dependency — Constitution VII); any semantic or
LLM-judged validation (FR-027 forbids).

## D11 — `codegraph tasks` CLI surface

**Decision**: register `program.command('tasks [action] [id]')` in `src/bin/codegraph.ts` (slice 2),
the flat positional shape mirroring the existing `telemetry [action]` precedent. Verbs:
- `tasks list` — enumerate bundles under `.codegraph/tasks/` with each bundle's id, status, and age
  (FR-026); no id argument.
- `tasks ingest <id>` — validate + finalize one bundle (FR-026/FR-028); success prints confirmation,
  a rejection prints the reason to stderr and exits non-zero (FR-028a) while leaving the manifest
  `pending`.
- unknown action → error + non-zero exit (telemetry precedent).
Ingest is **user-invoked only** — never auto-run from the watcher or daemon (FR-029). No permanent
`codegraph llm generate` surface (Q8).

**Rationale**: design-concept Open Questions resolved in Clarify Session 1 — noun `tasks` (matches
the `.codegraph/tasks/` dir), verbs `list` + `ingest <id>`, flat `[action] [id]` shape. Mirrors the
in-repo `telemetry [action]` command exactly, minimizing the upstream-owned `codegraph.ts` diff.

**Alternatives rejected**: a `bundles` noun or nested sub-subcommands (Clarify chose `tasks` + flat
shape); a `tasks prune` verb (deferred — manual deletion documented, no prune in v1; `list` surfaces
age so stale bundles are findable).

## D12 — Status `LLM:` block

**Decision**: `resolveLlmStatus(env): LlmStatus` (pure, network-free) returns a discriminated union
mirroring `EmbeddingStatus`: `LlmStatusActive (endpoint; redacted url; plaintextWarning?)` /
`LlmStatusAgent` / `LlmStatusDormant` / `LlmStatusMisconfigured`. `CodeGraph.getLlmStatus()` returns
`resolveLlmStatus(process.env)`. The CLI renders an `LLM:` block **after** the `Embeddings:` block,
without touching the embeddings block, and adds `llm: llmStatus` to `--json`. Because the
plaintext-remote warning must appear **in status** (a deliberate divergence from the embeddings
pass-time-only warning — FR-006), `LlmStatusActive` carries the redaction-safe cleartext advisory
string, computed from `plaintextRemoteWarning(url)`. Slice 1 renders endpoint-active / misconfigured
/ dormant; the agent-active branch is a `Provider: agent` stub in slice 1 and gains the pending-bundle
count in slice 2 (spec Assumptions).

**Rationale**: FR-006 + CRL 2 pinned the dedicated `LLM:` block, the new snapshot method mirroring
the embeddings union, and the cleartext advisory living in status. The status path is network-free so
computing it never breaks dormancy (SC-002/SC-004).

**Alternatives rejected**: folding LLM state into the embeddings block (FR-006 mandates a dedicated
block); a pass-time-only warning like embeddings (FR-006 explicitly diverges — the warning belongs in
status).

## D13 — US5 research note (self-repo UAT) — inside slice 2's PR

**Decision**: `docs/design/llm-paths-note.md` is authored and committed **inside slice 2's own PR**
(FR-031 / CRL 6), produced by a timeboxed spike (Q9) that runs both paths against the slice-2
worktree's own build and this repository's live index — no prior merge to `main` required:
- **Endpoint arm**: the already-configured hal endpoint from `.envrc.local` (dogfood env).
- **Agent arm**: a bundle completed by Claude Code using the companion skill, then ingested.
- **Artifacts**: one wiki chapter + one PR narrative through each path; record cost (local $0 vs
  subscription-amortized), maintainer-judged quality, and latency. **No cloud-endpoint arm** (Q9 /
  FR-030). The note records which inputs were used and is the recorded self-repo UAT outcome.

**Rationale**: CRL 6 (high-confidence) — the constitution's self-repo UAT step is NOT merge-gated
(only the rebuild→sync loop is); worktree preflight provides a real-scale index pre-merge; uniform
in-PR precedent (SPEC-005/008/010/025); the note's prose is already LOC-excluded, so the diff-size
deferral reason is moot.

**Alternatives rejected**: a separate docs-only follow-up PR/commit (CRL 6 reverses this — never a
follow-up); adding a cloud arm (Q9 — API spend + key handling beyond the spike's advisory purpose).

## D14 — Companion skill shape

**Decision**: `.claude/skills/codegraph-tasks/SKILL.md` — a thin discovery wrapper (Q10) that tells
an agent to find pending bundles under `.codegraph/tasks/`, read the self-describing bundle directory
(instructions + graph-context + output-contract), produce conforming output, and — as its **final
step** — run `codegraph tasks ingest <id>` (FR-025). It is repo dogfooding config, **not** a shipped
asset; plugin-channel distribution is out of scope and owned by SPEC-026.

**Rationale**: Q10 + FR-025. The bundle carries everything; the skill only makes discovery reliable.
Not wired into `copy-assets` (it ships nowhere from this spec — Constitution VII/III).

**Alternatives rejected**: a doc-only entry with no skill file (the roadmap names a companion skill;
discovery is what a skill makes reliable); a full skill inside the SPEC-026 plugin (couples this spec
to distribution scaffolding that hasn't started).

## Constants summary (test-only overridable; none user-facing — FR-007)

See plan.md §Technical Context for the table. Values: `CHARS_PER_TOKEN=4`;
`GRAPH_CONTEXT_TOKEN_BUDGET=2000` (→ 8000 chars); marker `[context truncated: N of M]`;
`DEFAULT_MAX_OUTPUT_TOKENS=1024`; `DEFAULT_TOTAL_TIMEOUT_MS=300_000` (ceiling 600_000);
`DEFAULT_IDLE_TIMEOUT_MS=45_000`; retry `3 / 1000 / 8000 / 30_000`;
`MAX_BUNDLE_INPUT_BYTES=1_048_576`; `MAX_JSON_DEPTH=32`. Each is confirmable at implement time and
overridable only through the test-only override interface.

## Open items carried into implementation

None block planning. The constant magnitudes above are the planned values; any implement-time
adjustment stays within the clarify-pinned bands (timeout 120–600 s; idle 30–60 s; budget anchored to
the ~4,096-token window) and is made only through the internal-constant / test-only-override posture.
