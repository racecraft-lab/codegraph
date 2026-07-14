# Feature Specification: LLM Access Layer

**Feature Branch**: `018-llm-access-layer`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "SPEC-018 LLM Access Layer — one shared capability that lets upcoming Intelligence Platform features (cluster labels, wiki prose, PR narratives) ask for LLM-generated prose exactly one way, with two first-class paths (an OpenAI-compatible endpoint and a subscription-coding-agent task bundle) and guaranteed heuristic degradation when nothing is configured."

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are ordered by importance and delivery order. Each is an independently
  testable vertical slice. Slice 1 (endpoint path end-to-end) = US1 + US2.
  Slice 2 (agent-bundle path + companion skill + research note) = US3 + US4 + US5.
-->

### User Story 1 - Always-usable prose seam with guaranteed degradation (Priority: P1)

A feature consumer (the code behind cluster labels, wiki prose, or PR narratives) calls a single `generate(prose-task)` seam and passes its own heuristic fallback text. It always receives usable text back: endpoint-produced prose when an endpoint is configured, its own fallback (plus a handle to a pending bundle) in agent mode, or its own fallback when nothing is configured. The seam never raises an error just because configuration is absent or partial.

**Why this priority**: This is the foundational contract that makes the whole layer safe to depend on. Every future consumer relies on "ask once, always get usable text." Without this guarantee no downstream feature can adopt the layer. It is the MVP: even with no endpoint and no agent mode, a consumer can call the seam and safely receive its own fallback with zero side effects.

**Independent Test**: With nothing configured (dormant), call the seam with a fallback string and confirm the exact fallback is returned, no network call is made, and nothing is written to disk. This slice delivers value on its own — a consumer can integrate against the seam and ship, degrading cleanly, before either generative path exists.

**Acceptance Scenarios**:

1. **Given** no LLM configuration is present, **When** a consumer calls the seam with a fallback, **Then** the fallback is returned unchanged, no request is sent, and no file is written.
2. **Given** a valid endpoint is configured, **When** a consumer calls the seam and the endpoint call fails after retries, **Then** the consumer's fallback is returned rather than an error.
3. **Given** agent mode is configured, **When** a consumer calls the seam, **Then** the consumer's fallback is returned immediately together with a handle referencing the emitted pending bundle.
4. **Given** any mode, **When** the seam returns, **Then** the caller can tell which source produced the text (endpoint output, fallback, or pending-bundle handle).

---

### User Story 2 - Complete prose via an OpenAI-compatible endpoint (Priority: P2)

A user who runs a local or hosted OpenAI-compatible endpoint sets `CODEGRAPH_LLM_URL`, `CODEGRAPH_LLM_MODEL`, and `CODEGRAPH_LLM_API_KEY`. Prose tasks are then completed via chat completions, with bounded retry, a request timeout, streaming and non-streaming support, and a token-budget guard that deterministically trims oversized context and marks the truncation explicitly.

**Why this priority**: This is the first real generative capability and completes delivery slice 1. It turns the seam from "returns fallback" into "returns model prose," and it is the path most self-hosting users will exercise.

**Independent Test**: With `CODEGRAPH_LLM_{URL,MODEL,API_KEY}` pointed at a reachable OpenAI-compatible endpoint, submit a prose task and confirm chat-completion output is returned; submit an oversized task and confirm the context is trimmed deterministically with a visible truncation marker.

**Acceptance Scenarios**:

1. **Given** a reachable endpoint, **When** a prose task is submitted, **Then** the chat-completion result text is returned.
2. **Given** a prose task whose context exceeds the token budget, **When** it is submitted, **Then** the context is trimmed to fit, an explicit truncation marker is present, and the same input produces the same trimmed output every time.
3. **Given** a transient endpoint failure, **When** a prose task is submitted, **Then** the request is retried up to the internal limit before the seam degrades to the consumer fallback.
4. **Given** a prose task is submitted, **When** the endpoint supports streaming, **Then** the client internally uses a streaming chat-completions request and assembles the deltas into the returned text; **When** the endpoint does not support streaming, **Then** a non-streaming request is used instead — in either case the seam returns one final Generation Result, with no partial output surfaced to the caller.
5. **Given** a partial endpoint configuration (for example URL without model), **When** configuration is resolved, **Then** it is reported as a misconfiguration in status and no endpoint call is attempted.

---

### User Story 3 - Emit a self-describing task bundle for a subscription coding agent (Priority: P3)

A user who would rather route prose work through the subscription coding agent they already pay for (Claude Code, Codex, Gemini CLI, Copilot) sets `CODEGRAPH_LLM_PROVIDER=agent`. Each `generate()` call then emits a self-describing task bundle under `.codegraph/tasks/<id>/` — task instructions, the graph context as JSON, an expected-output contract, and a `manifest.json` carrying status — that any coding agent can complete just by reading the directory.

**Why this priority**: This is the second first-class path and the core of delivery slice 2. It lets users with no server-side LLM budget still get generated prose, using tokens they already pay for. It is explicit-only and never an implicit fallback, so it ships after the endpoint path.

**Independent Test**: With `CODEGRAPH_LLM_PROVIDER=agent`, call `generate()` and confirm a new `.codegraph/tasks/<id>/` directory appears containing instructions, graph-context JSON, an output contract, and a `manifest.json` with status `pending`; confirm a reader given only that directory has everything needed to produce a conforming output.

**Acceptance Scenarios**:

1. **Given** agent mode is configured, **When** `generate()` is called, **Then** a bundle directory is created under `.codegraph/tasks/<id>/` with instructions, graph-context JSON, an expected-output contract, and a `manifest.json` marked `pending`.
2. **Given** two `generate()` calls happen close together, **When** both emit bundles, **Then** each receives a distinct identifier and neither overwrites the other.
3. **Given** an emitted bundle, **When** a coding agent reads only the bundle directory, **Then** it has sufficient instructions and context to produce output matching the contract with no external state.
4. **Given** agent mode is configured, **When** a bundle is emitted, **Then** no SQLite schema is created or modified — bundle state exists only in `manifest.json`.

---

### User Story 4 - Ingest a completed bundle via explicit CLI command (Priority: P4)

After the coding agent completes a bundle, the user runs an explicit CLI ingest command. It validates the agent's output against the bundle's expected-output contract, stores the canonical result inside the bundle directory, and stamps the manifest `completed`. Ingest never writes the consumer's own downstream artifacts, and it never runs on its own from the watcher or daemon.

**Why this priority**: Ingest closes the agent-bundle loop and is meaningless without US3, so it follows it. Keeping ingest explicit and artifact-free preserves the boundary between this shared layer and its consumers.

**Independent Test**: Given a bundle whose output area contains a conforming agent response, run the ingest command and confirm the result is validated, stored in the bundle directory, and the manifest flips to `completed`; given a non-conforming response, confirm ingest rejects it and writes no consumer artifacts.

**Acceptance Scenarios**:

1. **Given** a completed bundle with conforming output, **When** the user runs ingest for that bundle, **Then** the output is validated against the contract, the canonical result is stored in the bundle directory, and the manifest status becomes `completed`.
2. **Given** a bundle whose output violates the contract, **When** the user runs ingest, **Then** ingest rejects the output, leaves no consumer artifacts, and does not mark the bundle `completed` — the manifest status remains `pending` (re-runnable after the agent corrects its output).
3. **Given** any bundle, **When** no one runs the ingest command, **Then** the bundle is never ingested automatically by the watcher or daemon.
4. **Given** ingest of any bundle, **When** it completes, **Then** the only files written are inside the bundle directory — never the downstream feature's own output files.

---

### User Story 5 - Committed research note comparing the two paths (self-repo UAT) (Priority: P5)

The maintainer has a committed research note that compares the endpoint path and the agent-bundle path on cost, quality, and latency, using one wiki chapter and one PR narrative generated against this repository. The same exercise doubles as the spec's self-repo UAT step.

**Why this priority**: This is the evidence-and-validation deliverable of slice 2. It depends on both generative paths existing in the slice-2 implementation — not on prior merge to `main` — so it comes last within slice 2 and ships inside slice 2's own PR, satisfying the constitution's dogfooding requirement that every spec exercise its capability against this repository.

**Independent Test**: Confirm a committed note exists that reports cost, quality, and latency for both paths on one generated wiki chapter and one generated PR narrative produced against this repository, and that it contains no cloud-endpoint comparison arm.

**Acceptance Scenarios**:

1. **Given** both paths are implemented, **When** the maintainer generates one wiki chapter and one PR narrative against this repository via each path, **Then** the note records cost, quality, and latency for each path.
2. **Given** the research note, **When** it is reviewed, **Then** it serves as the recorded self-repo UAT outcome and includes no cloud-endpoint arm.

---

### Edge Cases

- **Partial configuration**: Endpoint settings are only partially present (for example URL and API key but no model). The layer reports a status-visible misconfiguration and degrades to the consumer fallback rather than attempting a broken call.
- **Endpoint unreachable / timing out / erroring**: After the internal retry limit and timeout are exhausted, the seam returns the consumer fallback and never throws.
- **Empty successful completion**: An endpoint returns a successful (2xx) response whose assembled completion is empty or whitespace-only. The layer treats it as a failed generation and returns the consumer fallback rather than surfacing empty text as endpoint output (FR-009a) — an empty completion is not "usable text" (SC-001).
- **Streaming terminates without `[DONE]`**: A streaming endpoint closes the connection cleanly at end-of-stream without emitting the terminal `data: [DONE]` sentinel (a known variation across OpenAI-compatible servers). The client returns the deltas assembled so far rather than treating the missing sentinel as an error (FR-016a); sustained mid-stream silence remains bounded by the FR-017 idle deadline.
- **Plaintext remote endpoint**: A remote endpoint configured over an unencrypted connection surfaces a warning while remaining usable; a local loopback endpoint does not warrant the warning.
- **Oversized prose task**: Context that exceeds the token budget is trimmed deterministically with an explicit truncation marker — the layer never auto-chunks or map-reduces.
- **Bundle emission failure in agent mode**: If the bundle cannot be written (for example `.codegraph/tasks/` is not writable), the consumer still receives its fallback text; the failure is surfaced through the returned handle/status rather than thrown to the caller.
- **Ingest of a missing, already-completed, or malformed bundle** (including an output or contract path that resolves outside the bundle directory, a symlink at a path Ingest opens, or output exceeding the size or nesting-depth ceiling — FR-029a): Ingest reports the problem, writes no consumer artifacts, and does not falsely stamp the bundle `completed`.
- **Ingest before the agent produced output**: The bundle directory exists and is `pending` but the agent's expected output file is absent, empty, or unreadable (the user ran ingest too early). Ingest treats this as an FR-028a-shaped rejection (FR-027) — the manifest stays `pending`, the reason goes to stderr, no consumer artifact is written, and the bundle is re-ingestable once the agent writes conforming output.
- **`tasks list` over a corrupt or empty task directory**: When a bundle under `.codegraph/tasks/` has a missing/malformed/unreadable `manifest.json`, `codegraph tasks list` surfaces that bundle with an unreadable/unknown status rather than aborting the listing (FR-026); an empty or absent `.codegraph/tasks/` directory yields an empty listing with a success exit, never an error.
- **Redeeming a handle whose manifest is corrupt**: The bundle directory still exists but its `manifest.json` fails the FR-029a safe-read. The redemption lookup surfaces `pending` (not an error, not a false `completed`), consistent with the never-throw seam guarantee (FR-010a).
- **API key present but mode is dormant or agent**: The key is still never persisted, logged, echoed, or copied into any emitted bundle file.
- **Concurrent generations in agent mode**: Each call produces a uniquely identified bundle so directories never collide.
- **Repeat generation of the same task**: A `generate()` call for a prose-task whose prior bundle is still `pending` emits a new, independently-identified bundle and returns a fresh pending handle — the layer performs no task-identity dedup and holds no cross-call state.

## Requirements *(mandatory)*

### Functional Requirements

**Configuration and mode resolution (SPEC-001/002 embeddings posture)**

- **FR-001**: The layer MUST resolve LLM configuration into exactly one of four discriminated states — endpoint configuration, agent configuration, misconfiguration, or dormant (none) — where dormant is the default when nothing is configured.
- **FR-002**: The layer MUST treat a partial endpoint configuration (some but not all required endpoint settings present) as a status-visible misconfiguration and MUST NOT attempt an endpoint call in that state. A misconfiguration — whether a partial endpoint configuration or an unrecognized `CODEGRAPH_LLM_PROVIDER` value — MUST be behaviorally dormant: like the dormant state (FR-004) it performs zero network calls and zero filesystem writes, and the `generate()` seam returns the consumer's fallback (FR-008). The ONLY observable difference from dormant is that status renders the misconfiguration (FR-006) instead of silence — behavior, network, and filesystem are byte-identical to an unconfigured install (this realizes the ratified Q3 "status-visible, feature dormant" posture).
- **FR-003**: Agent-bundle mode MUST be entered only by explicit configuration (`CODEGRAPH_LLM_PROVIDER=agent`) and MUST NEVER be entered as an implicit fallback.
- **FR-004**: In the dormant state the layer MUST perform zero network calls and zero filesystem writes (including no bundle emission), keeping behavior byte-identical to an unconfigured install.
- **FR-005**: The API key MUST be held in memory only — never persisted to disk, written to logs, echoed to output, or included in any emitted bundle file. The key MUST also be transmitted ONLY to the configured endpoint (as the `Authorization: Bearer` request header) and MUST NOT be forwarded to any other host when the endpoint answers with a redirect: the `Authorization` header is dropped on a cross-origin redirect (per the WHATWG Fetch standard, which the platform HTTP client honors), so a hostile or compromised endpoint cannot exfiltrate the key by redirecting the request to an attacker-controlled host. This is a testable requirement (a cross-origin redirect target MUST NOT receive the key).
- **FR-006**: Status output MUST report the resolved LLM mode and any misconfiguration with the endpoint URL redacted, and MUST warn when a remote endpoint is configured over an unencrypted connection. Status surfaces the LLM state through a dedicated `LLM:` block, backed by a new status snapshot method mirroring the embeddings status union, rendered without modifying the embeddings status block. Because the plaintext-remote warning must appear in status (unlike the embeddings pass-time-only warning), the LLM status snapshot carries the redaction-safe cleartext advisory.
- **FR-007**: Numeric configuration inputs MUST be clamped to positive integers; retry and timeout values MUST be internal constants with test-only overrides, not user-facing configuration knobs. The LLM endpoint config exposes no user-facing numeric env tunables (url/model/apiKey only); retry, timeout, token budget, and max-output are internal constants — so the positive-integer clamp requirement governs only any future numeric knob.

**The generate() seam and guaranteed degradation (US1)**

- **FR-008**: The layer MUST expose a single `generate(prose-task)` seam that accepts a consumer-supplied precomputed heuristic fallback string and MUST return usable text in every mode, never raising an error because configuration is absent or partial.
- **FR-009**: When an endpoint is configured, the seam MUST return endpoint-produced text on success and MUST return the consumer's fallback when the endpoint call ultimately fails after retries and timeout.
- **FR-009a**: A successful endpoint response (streaming or non-streaming) whose assembled completion text is empty or whitespace-only MUST be treated as a failed generation — never returned as endpoint output — and MUST degrade to the consumer's fallback, preserving the SC-001 usable-text guarantee. This mirrors the embeddings client's empty-response validation posture (`src/embeddings/endpoint-provider.ts` rejects an empty response entry as a non-retryable failure).
- **FR-010**: When agent mode is configured, the seam MUST return the consumer's fallback immediately together with a handle to the pending bundle it emits.
- **FR-010a**: The layer MUST expose a redemption lookup for the pending-bundle handle FR-010 returns. Given that handle, it MUST return exactly one of: the finalized text once the bundle's manifest is `completed` (read from the canonical result FR-028 stores inside the bundle directory), a `pending` indicator while the manifest remains `pending`, or a `missing` indicator if the bundle directory no longer exists (for example, after the documented manual cleanup of a stale bundle). This lookup MUST read only the handle's own bundle directory and MUST NOT introduce any persistence beyond the existing filesystem manifest (FR-023). If the bundle directory still exists but its `manifest.json` cannot be safely read — it fails the FR-029a bounded safe-read (malformed, oversize, depth-exceeded, or symlinked) — the lookup MUST NOT throw; it surfaces the `pending` indicator (the handle is simply not yet redeemable to text, and a transient partial write during an ingest status stamp heals on a subsequent lookup), while `codegraph tasks list` (FR-026) surfaces the same bundle with an unreadable status so a persistently-corrupt manifest is findable for the documented manual cleanup. The lookup MUST NOT report `missing` in this case: `missing` is defined strictly by the bundle directory's absence, which this case's own premise (the directory exists) contradicts, whereas `pending` asserts only that completion is not yet confirmed — true regardless of why the manifest is unreadable. The same directory-absence definition of `missing` also resolves a handle that fails FR-029a's identifier containment check (a path separator, or any resolution outside `.codegraph/tasks/`): such a handle never designates a location under the tasks root, so — from this lookup's jurisdiction — no bundle directory exists there, and the lookup resolves it to `missing` without evaluating anything outside the root. This is a distinct premise from the present-but-unreadable-manifest case above (a valid identifier whose resolved directory is confirmed to exist), so it does not reopen that ruling. The choice is deliberate, not a default: folding to `missing` risks the asymmetric failure of reporting a bundle gone on a torn read that in fact completed, letting a consumer durably and silently give up while `codegraph tasks list` (FR-026) shows `completed` with nothing to flag the mistake, whereas folding to `pending` costs at most one harmless extra read per polling cycle and remains discoverable through the same `tasks list` unreadable status until the documented manual cleanup makes `missing` true; this three-way return is a closed enumeration, and the unreadable case does not introduce a fourth lookup-level state — that diagnostic distinction belongs at the `tasks list` surface (FR-026), not at this redemption seam. The lookup's exact function signature and result-type shape are a plan-time detail.
- **FR-011**: When dormant, the seam MUST return the consumer's fallback unchanged.
- **FR-012**: The seam's result MUST let the caller distinguish which source produced the text (endpoint output, consumer fallback, or pending-bundle handle).
- **FR-013**: The layer MUST NOT own or maintain any heuristic registry — the heuristic fallback is always supplied by the consumer on each call.
- **FR-014**: LLM-produced text MUST be confined to prose outputs and MUST NEVER be written into graph structure (nodes or edges).

**Endpoint path (US2)**

- **FR-015**: The endpoint client MUST complete prose tasks via an OpenAI-compatible chat-completions request. The request body carries `model`, the composed `messages`, and the per-call `stream` flag; `max_tokens` is set from an internal constant bounding worst-case output; `temperature` is left to the endpoint default.
- **FR-015a**: The endpoint client MUST remain vendor-neutral: it MUST depend ONLY on the OpenAI-standard chat-completions fields — request `model`/`messages`/`stream`/`max_tokens`, and response `choices[0].message.content` (non-streaming) / `choices[].delta.content` (streaming) — and MUST NOT require, or fail in the absence of, any provider-proprietary request parameter or response field. Any endpoint that speaks the OpenAI-compatible chat-completions shape (for example llama.cpp, vLLM, or Ollama's compatibility layer) is therefore interchangeable, and no single vendor's API extension is a dependency. This is a testable requirement, not merely a contract-doc note.
- **FR-016**: The endpoint client MUST support both streaming and non-streaming completion, selectable per call.
- **FR-016a**: Streaming, where used, is an internal request-transport detail of the endpoint client only. The `generate()` seam MUST return exactly one final Generation Result in both streaming and non-streaming request modes; this spec defines no partial-output delivery mechanism (no `onChunk`/delta callback, no streaming return channel) on the prose task or the seam's return type. The client assembles the streamed `choices[].delta.content` deltas and MUST return the assembled text when the stream terminates — either on the OpenAI-standard `data: [DONE]` sentinel OR on a clean end-of-stream that arrives without it (a documented variation across OpenAI-compatible servers); a missing sentinel at a clean close MUST NOT be treated as an error. The FR-017 inter-chunk idle deadline governs only sustained mid-stream silence, never a clean end-of-stream; an assembled-empty stream is handled by FR-009a. A stream that is aborted BEFORE a clean end-of-stream — whether by the FR-017 idle deadline or by any mid-stream transport error — is an ultimate failure, NOT a clean end-of-stream: any deltas assembled before the abort MUST be discarded and the seam MUST degrade to the consumer fallback per FR-009 (mirroring the embeddings client, which raises its redaction-safe endpoint error on retry-exhaustion for `generate()` to catch). A partial assembly MUST NEVER be returned as an `endpoint`-sourced success — only a clean end-of-stream (with or without `[DONE]`) yields endpoint output.
- **FR-017**: The endpoint client MUST apply a bounded retry policy and a request timeout (internal constants). Non-streaming completions MUST enforce a flat total-request deadline; streaming completions MUST instead enforce an inter-chunk idle deadline — elapsed time since the last received chunk, reset on every chunk — rather than a single flat cap over the whole stream. In both modes the client MUST additionally enforce a hard total-response-size ceiling — a generous internal constant (test-overridable, never user-facing per FR-007) — by reading the response body as a stream, counting bytes, and aborting once the ceiling is crossed; a ceiling-exceeded response is an ultimate failure that degrades to the consumer fallback (FR-009). This deliberately hardens beyond the embeddings client's unbounded body read (maintainer decision at the security consensus gate, 2026-07-13): `max_tokens` is only a request-side hint an endpoint may ignore, and neither deadline bounds volume; the exact ceiling magnitude is a plan-time detail (tens of MB — far above any legitimate completion).
- **FR-018**: The layer MUST estimate token usage with a characters-per-token heuristic (no external tokenizer) and, when a prose task's context exceeds the token budget, MUST trim the context deterministically and insert an explicit truncation marker, such that identical input yields identical trimmed output. Composition follows a fixed priority order — task instructions > expected-output contract > graph context — and ONLY the lowest-priority graph-context tier is trimmed; the task instructions and the expected-output contract MUST NEVER be truncated, so the model (endpoint path) and the coding agent (bundle path) always receive them intact. Per FR-007, the token budget itself is a fixed conservative internal constant — sized for small-context local models rather than derived from the configured `CODEGRAPH_LLM_MODEL`, which the layer has no channel to introspect — with its exact magnitude a plan-time detail.
- **FR-019**: The layer MUST NOT auto-chunk or map-reduce oversized prompts — deterministic trimming with a marker is the only oversize handling.
- **FR-020**: The layer MUST NOT add any new runtime dependency for endpoint access — it MUST use the built-in HTTP capability.

**Agent-bundle path (US3)**

- **FR-021**: In agent mode, the seam MUST emit a self-describing task bundle under `.codegraph/tasks/<id>/` containing at least: task instructions, the graph context as JSON, an expected-output contract, and a `manifest.json` carrying the bundle's status.
- **FR-022**: A task bundle MUST be completable by a subscription coding agent using only the contents of the bundle directory, with no external state required.
- **FR-023**: Bundle state MUST live entirely in the filesystem (`manifest.json`) — the layer MUST NOT introduce or modify any SQLite schema.
- **FR-024**: Each emitted bundle MUST receive a unique identifier so concurrent generations do not collide or overwrite one another.
- **FR-024a**: The layer MUST NOT deduplicate or coalesce bundles across `generate()` calls; every agent-mode call emits its own uniquely-identified bundle regardless of prior pending bundles for a logically-identical task.
- **FR-025**: The feature MUST include a companion skill describing how a coding agent completes and returns a task bundle, whose final step instructs the agent to run `codegraph tasks ingest <id>`; distributing that skill through the plugin channel is out of scope and owned by SPEC-026.

**CLI ingest (US4)**

- **FR-026**: The layer MUST provide an explicit `codegraph tasks` CLI command with two user-invoked verbs — `list` (enumerate bundles under `.codegraph/tasks/` with each bundle's id, status, and age) and `ingest <id>` (validate and finalize one completed bundle) — that a user runs after their agent completes a bundle. `list` MUST enumerate resiliently (mirroring the daemon-registry enumeration precedent, `src/mcp/daemon-registry.ts`): a bundle whose `manifest.json` is missing, malformed, or unreadable MUST be surfaced with an unreadable/unknown status rather than aborting the whole listing, and a zero-bundle or absent `.codegraph/tasks/` directory MUST produce an empty listing with a success (zero) exit — never an error.
- **FR-027**: Ingest MUST validate the agent's output STRUCTURALLY against the bundle's machine-checkable expected-output contract (required fields present, correct types, non-empty where the contract requires) — a deterministic check, never a semantic or quality judgment — and MUST reject output that fails it. An agent output file that is absent, empty, or unreadable at ingest time (for example, the user ran ingest before the agent produced output) MUST be treated as a validation failure and rejected in the same FR-028a-shaped way (it cannot satisfy the contract), never a crash and never a false `completed` stamp — the bundle stays `pending` and is re-ingestable once the agent writes conforming output. The contract's concrete schema is a plan-time detail.
- **FR-028**: On successful validation, ingest MUST store the canonical result inside the bundle directory and stamp the `manifest.json` status as `completed`.
- **FR-028a**: A rejected ingest MUST leave the manifest status unchanged (`pending`) and MUST report the rejection reason to stderr without persisting a failure state.
- **FR-029**: Ingest MUST NEVER write consumer artifacts (a downstream feature's own output files) and MUST NOT auto-run from the watcher or daemon — it is user-invoked only.
- **FR-029a**: Ingest MUST treat the bundle directory's contents — the agent's output file(s), any additional file path that ANY bundle file names (including `manifest.json`'s `contract` pointer, and any path the contract or output itself names), and `manifest.json` — as untrusted input under a same-user, no-privilege-boundary threat model. Every path Ingest reads or writes MUST resolve, via the project's existing realpath-based containment check (`validatePathWithinRoot`, reused rather than reimplemented), to a location within the bundle directory; Ingest MUST reject any path resolving outside it (including through a symlink), any input over a bounded size ceiling, and any JSON over a bounded nesting-depth ceiling — each checked before the read completes or the parse begins. Parsed output MUST be consumed by reading only the contract's expected fields, never deep-merged into a live object, so attacker-controlled keys cannot pollute a prototype. Every rejection here is FR-028a-shaped (manifest stays `pending`, reason to stderr, never `isError`); residual same-process TOCTOU between check and use is out of scope, consistent with the project's existing same-user write-sink precedent. The bundle-selecting identifier itself is untrusted wherever it arrives as input — the `codegraph tasks ingest <id>` argument (FR-026) and the redemption handle (FR-010/FR-010a): before the resolved bundle directory is used as the containment anchor for the per-path checks above, the identifier MUST be validated as a single path segment that resolves, via the same `validatePathWithinRoot` check anchored at the `.codegraph/tasks/` root, to a direct child of that root; an identifier containing a path separator or otherwise resolving outside `.codegraph/tasks/` MUST be rejected before any bundle directory is opened for it, so a crafted id/handle cannot relocate the anchor and thereby escape the per-path containment (a write into, e.g., `src/` would otherwise still pass the per-path check against a relocated anchor). The rejection disposition is entry-point-specific: at the `codegraph tasks ingest <id>` CLI (FR-026) it is FR-028a-shaped (manifest untouched, reason to stderr, no consumer artifact); at the FR-010a redemption lookup — which has no ingest-style rejection channel and returns only its closed three-way result — it instead resolves to FR-010a's `missing` result. This is distinct from CRL-7's present-but-unreadable-manifest ruling (FR-010a's `pending` case): here the identifier never resolves to a location under `.codegraph/tasks/` in the first place, so no bundle directory's existence is ever evaluated at the escaped path, and CRL-7's asymmetric-harm rationale — protecting a real, possibly-completed bundle from a false negative — does not apply to an identifier that could never have been legitimately emitted. Emit-side ids are opaque single-segment identifiers (never consumer- or agent-authored), so this guard governs the read/ingest/redeem side, where the id/handle is input. Exact ceilings and call sites are plan-time detail.

**Research note and delivery (US5, cross-cutting)**

- **FR-030**: The feature MUST include a committed research note comparing the two paths (endpoint versus agent bundle) on cost, quality, and latency, generated from one wiki chapter and one PR narrative produced against this repository; the note MUST serve as the self-repo UAT record and MUST NOT include a cloud-endpoint comparison arm.
- **FR-031**: The capability MUST live in a new opt-in module and MUST NOT alter behavior for users who have not configured an LLM, and it MUST be delivered as two independently reviewable vertical slices — slice 1 the endpoint path end-to-end; slice 2 the agent-bundle path, companion skill, and research note. The research note MUST be committed inside slice 2's own PR — never as a separate follow-up PR or post-merge commit — produced by exercising both paths against the slice-2 worktree's own build and this repository's live index; neither slice needs to be merged to `main` first.

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter — the LLM configuration resolver, the OpenAI-compatible endpoint client, and the agent-bundle filesystem I/O.
- **Secondary surfaces, if any**: API (the single `generate()` library seam re-exported through the public surface), scheduler/runtime (the explicit `codegraph tasks list|ingest` subcommand), docs/process (the companion skill and the committed research note).
- **Projected reviewable LOC**: ~900–1300 production LOC across both slices (slice 1 config + endpoint client + seam ≈ 500–700; slice 2 bundle emitter + manifest + CLI ingest ≈ 400–600), excluding tests and the prose research note. Tests are additional and exercise real files and real HTTP behavior (no mocking of the store).
- **Projected production files**: ~8–12 (config, endpoint client, token-budget guard, seam/orchestration, bundle emitter, manifest handling, CLI ingest command, plus public re-export wiring).
- **Projected total files**: ~16–24 including test files, the companion skill, and the research note.
- **Budget result**: within budget — enforced by the two-slice split, so each slice ships as its own PR sized to a normal review surface.
- **Split decision**: Remains one spec because both paths share the discriminated-union configuration resolver and the single `generate()` seam; splitting the spec would duplicate that shared core across two specs. It is delivered as two vertical slices (Q12): slice 1 is the endpoint path end-to-end (US1 + US2); slice 2 is the agent-bundle path, companion skill, and research note (US3 + US4 + US5). If either slice's implementation materially exceeds its projected surface, the overflow becomes a named follow-up rather than a larger single PR.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue (for example, plugin-channel packaging of the companion skill → SPEC-026).

### Key Entities *(include if feature involves data)*

- **Prose Task**: A consumer's request for generated prose. Carries task instructions, the graph context (supplied by the consumer as opaque items the layer embeds verbatim), an expected-output contract, and a consumer-supplied precomputed heuristic fallback string. It is the single input to the `generate()` seam.
- **LLM Configuration (discriminated result)**: Exactly one of — Endpoint Configuration (endpoint URL, model, in-memory API key, internal retry/timeout constants), Agent Configuration (explicit agent-provider selection), Misconfiguration (partial/invalid settings surfaced in status), or Dormant (nothing configured; the default).
- **Task Bundle**: The agent-mode work package, a directory under `.codegraph/tasks/<id>/` containing task instructions, graph-context JSON, an expected-output contract, and a manifest.
- **Bundle Manifest (`manifest.json`)**: The filesystem-only state record for a bundle — its unique identifier, status — exactly one of `pending` or `completed` (`completed` is set only by a successful ingest; a rejected ingest leaves the bundle `pending`) — and the reference to its expected-output contract. There is no SQLite representation.
- **Generation Result**: What the seam returns — the produced or fallback text plus a source indicator (endpoint output, consumer fallback, or a handle to a pending bundle). The handle is redeemable through the layer's lookup (FR-010a) once the bundle is ingested.
- **Research Note**: The committed comparison of the two paths (cost, quality, latency) that also records the self-repo UAT outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across dormant, endpoint, and agent modes, 100% of seam calls made with a fallback return usable text and none raise an error caused by absent or partial configuration.
- **SC-002**: With nothing configured, behavior is byte-identical to an unconfigured install — zero outbound requests and zero filesystem writes are observable for any number of seam calls.
- **SC-003**: When a prose task exceeds the token budget, the trimmed output is identical for identical input on every run, and an explicit truncation marker is present 100% of the time trimming occurs.
- **SC-004**: A partial or invalid configuration is always visible in status output, never silently produces a wrong-mode call, produces zero outbound requests and zero filesystem writes (behaviorally identical to dormant, per FR-002), and the API key never appears in status output, logs, or any emitted bundle file.
- **SC-005**: In agent mode, every seam call produces a uniquely identified bundle that a coding agent can complete using only the directory contents; a reviewer who follows only the bundle files can produce a conforming output.
- **SC-006**: 100% of non-conforming agent outputs are rejected by ingest, and in no ingest run (successful or rejected) is any file written outside the bundle directory.
- **SC-007**: The committed research note reports cost, quality, and latency for both paths on one wiki chapter and one PR narrative generated against this repository, and contains no cloud-endpoint arm.

## Assumptions

- Environment variable names follow the SPEC-001/002 embeddings precedent: `CODEGRAPH_LLM_URL`, `CODEGRAPH_LLM_MODEL`, `CODEGRAPH_LLM_API_KEY`, and `CODEGRAPH_LLM_PROVIDER`; resolution, redaction, plaintext-remote warning, and positive-integer clamps mirror the established embeddings configuration posture.
- The characters-per-token estimate is a fixed conservative internal constant; approximate token accounting (no exact tokenizer) is acceptable for the budget guard.
- The token budget's sizing anchor is evidence-grounded, not derived: no OpenAI-compatible endpoint exposes a portable context-length signal (the `/v1/models` response carries none), so the internal constant assumes a conservative ~4,096-token total operative window — the modal default context size for local model deployments — and budgets the graph-context portion at roughly 2,000 tokens within it; the exact final constant is confirmed at plan time.
- Bundle identifiers are opaque unique strings; their exact format is an implementation detail decided at plan time.
- The consumer-supplied fallback is a precomputed string in v1; widening the seam later to also accept a lazy fallback producer would be a non-breaking, additive change (the same SemVer posture as the deferred `onChunk` callback).
- The expected-output contract is a machine-checkable description carried inside the bundle; its exact schema is an implementation detail decided at plan time.
- "Consumer artifacts" means a downstream feature's own output files (for example, SPEC-019 wiki pages or SPEC-020 PR narratives); ingest deliberately stops at the bundle directory and leaves artifact writing to the consumer.
- If bundle emission itself fails in agent mode, the consumer still receives its fallback text and the failure is surfaced through the returned handle/status rather than thrown — preserving the US1 guarantee.
- Retry count and backoff constants mirror the embeddings client; the request timeout is deliberately larger, sized for generation latency rather than the embeddings client's shorter deadline. Non-streaming requests use a generous flat internal-constant timeout; streaming requests are governed by an inter-chunk idle deadline (fails on sustained silence, not on total elapsed time) per FR-017. The exact durations (total timeout, idle window) are an implementation detail decided at plan time, consistent with FR-007's internal-constants, test-only-override posture.
- The research note is a committed design/research document under the repository's docs area, consistent with prior specs' decision documents.
- Stale or abandoned `pending` bundles are removed by documented manual deletion (remove the `.codegraph/tasks/<id>/` directory); v1 ships no `prune` command. `codegraph tasks list` surfaces pending bundles (with age) so they are findable; a pruning verb is deferred to a named follow-up if a consumer demonstrates accumulation pain.
- The pending-bundle handle returned by FR-010 is the same opaque bundle identifier redeemable via FR-010a's lookup — the mechanism Q1's "upgrade-later" decision and downstream consumers (SPEC-011 cluster-label enrichment, SPEC-019 incremental chapter re-render) use to obtain finalized text once ingest completes a bundle. SPEC-020's optional narrative path is unaffected, since its roadmap scope uses endpoint mode only.
- Streaming is an internal request-transport detail of the endpoint client, selected per call; when an endpoint does not support streaming, the client uses a non-streaming completion instead. Neither mode is exposed to the caller — the seam returns one final Generation Result either way. This keeps the door open for a future spec (for example SPEC-019 terminal UX) to add a partial-output API — such as an optional `onChunk` chunk-sink callback — against a concrete consumer need, without reworking the endpoint client; per SemVer, adding such an optional callback later would be a non-breaking, additive change.
- For slice 1 the status `LLM:` block renders endpoint-active / misconfigured / dormant; the agent active state's status rendering lands with slice 2 (a `Provider: agent` stub in slice 1 is acceptable).
- An endpoint response is bounded three ways: the FR-017 deadlines (flat total-request deadline non-streaming; inter-chunk idle deadline streaming), the requested `max_tokens` output hint, and — per the maintainer's security-consensus decision (2026-07-13) — a hard total-response-size ceiling enforced by a streamed, byte-counting read that aborts on exceed and degrades to the consumer fallback (FR-017/FR-009). This deliberately diverges from the embeddings endpoint client's unbounded body read: `max_tokens` is a hint a hostile or non-compliant endpoint can ignore, Node's built-in fetch has no size cap of its own, and the repo already ships the streamed-read-with-budget mechanism (the model-fetch download budget). The ceiling is a generous internal constant (tens of MB), test-overridable, never user-facing; exact magnitude is plan-time. Backporting the same ceiling to the embeddings client is a candidate follow-up, not part of this spec.

## Dependencies

- Mirrors the configuration and client posture established by SPEC-001/002 (the embeddings module) — this spec reuses that shape rather than inventing a new one.
- The graph context embedded in prose tasks and bundles originates with the consumer (via the existing graph/context capability); the layer receives it as opaque items and embeds it verbatim — it never invokes the graph/context capability itself.
- Ships the shared seam consumed by future features SPEC-011 (cluster labels), SPEC-019 (wiki prose), and SPEC-020 (PR narratives); those consumers are out of scope here.
- Plugin-channel packaging of the companion skill is owned by SPEC-026 and is out of scope for this spec.
