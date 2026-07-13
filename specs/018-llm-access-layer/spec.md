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
4. **Given** a consumer requests streaming, **When** the endpoint supports it, **Then** output streams; **When** the endpoint does not, **Then** a non-streaming completion is used.
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
2. **Given** a bundle whose output violates the contract, **When** the user runs ingest, **Then** ingest rejects the output, leaves no consumer artifacts, and does not mark the bundle `completed`.
3. **Given** any bundle, **When** no one runs the ingest command, **Then** the bundle is never ingested automatically by the watcher or daemon.
4. **Given** ingest of any bundle, **When** it completes, **Then** the only files written are inside the bundle directory — never the downstream feature's own output files.

---

### User Story 5 - Committed research note comparing the two paths (self-repo UAT) (Priority: P5)

The maintainer has a committed research note that compares the endpoint path and the agent-bundle path on cost, quality, and latency, using one wiki chapter and one PR narrative generated against this repository. The same exercise doubles as the spec's self-repo UAT step.

**Why this priority**: This is the evidence-and-validation deliverable of slice 2. It depends on both generative paths existing, so it comes last, and it satisfies the constitution's dogfooding requirement that every spec exercise its capability against this repository.

**Independent Test**: Confirm a committed note exists that reports cost, quality, and latency for both paths on one generated wiki chapter and one generated PR narrative produced against this repository, and that it contains no cloud-endpoint comparison arm.

**Acceptance Scenarios**:

1. **Given** both paths are implemented, **When** the maintainer generates one wiki chapter and one PR narrative against this repository via each path, **Then** the note records cost, quality, and latency for each path.
2. **Given** the research note, **When** it is reviewed, **Then** it serves as the recorded self-repo UAT outcome and includes no cloud-endpoint arm.

---

### Edge Cases

- **Partial configuration**: Endpoint settings are only partially present (for example URL and API key but no model). The layer reports a status-visible misconfiguration and degrades to the consumer fallback rather than attempting a broken call.
- **Endpoint unreachable / timing out / erroring**: After the internal retry limit and timeout are exhausted, the seam returns the consumer fallback and never throws.
- **Plaintext remote endpoint**: A remote endpoint configured over an unencrypted connection surfaces a warning while remaining usable; a local loopback endpoint does not warrant the warning.
- **Oversized prose task**: Context that exceeds the token budget is trimmed deterministically with an explicit truncation marker — the layer never auto-chunks or map-reduces.
- **Bundle emission failure in agent mode**: If the bundle cannot be written (for example `.codegraph/tasks/` is not writable), the consumer still receives its fallback text; the failure is surfaced through the returned handle/status rather than thrown to the caller.
- **Ingest of a missing, already-completed, or malformed bundle**: Ingest reports the problem, writes no consumer artifacts, and does not falsely stamp the bundle `completed`.
- **API key present but mode is dormant or agent**: The key is still never persisted, logged, echoed, or copied into any emitted bundle file.
- **Concurrent generations in agent mode**: Each call produces a uniquely identified bundle so directories never collide.

## Requirements *(mandatory)*

### Functional Requirements

**Configuration and mode resolution (SPEC-001/002 embeddings posture)**

- **FR-001**: The layer MUST resolve LLM configuration into exactly one of four discriminated states — endpoint configuration, agent configuration, misconfiguration, or dormant (none) — where dormant is the default when nothing is configured.
- **FR-002**: The layer MUST treat a partial endpoint configuration (some but not all required endpoint settings present) as a status-visible misconfiguration and MUST NOT attempt an endpoint call in that state.
- **FR-003**: Agent-bundle mode MUST be entered only by explicit configuration (`CODEGRAPH_LLM_PROVIDER=agent`) and MUST NEVER be entered as an implicit fallback.
- **FR-004**: In the dormant state the layer MUST perform zero network calls and zero filesystem writes (including no bundle emission), keeping behavior byte-identical to an unconfigured install.
- **FR-005**: The API key MUST be held in memory only — never persisted to disk, written to logs, echoed to output, or included in any emitted bundle file.
- **FR-006**: Status output MUST report the resolved LLM mode and any misconfiguration with the endpoint URL redacted, and MUST warn when a remote endpoint is configured over an unencrypted connection.
- **FR-007**: Numeric configuration inputs MUST be clamped to positive integers; retry and timeout values MUST be internal constants with test-only overrides, not user-facing configuration knobs.

**The generate() seam and guaranteed degradation (US1)**

- **FR-008**: The layer MUST expose a single `generate(prose-task)` seam that accepts a consumer-supplied heuristic fallback and MUST return usable text in every mode, never raising an error because configuration is absent or partial.
- **FR-009**: When an endpoint is configured, the seam MUST return endpoint-produced text on success and MUST return the consumer's fallback when the endpoint call ultimately fails after retries and timeout.
- **FR-010**: When agent mode is configured, the seam MUST return the consumer's fallback immediately together with a handle to the pending bundle it emits.
- **FR-011**: When dormant, the seam MUST return the consumer's fallback unchanged.
- **FR-012**: The seam's result MUST let the caller distinguish which source produced the text (endpoint output, consumer fallback, or pending-bundle handle).
- **FR-013**: The layer MUST NOT own or maintain any heuristic registry — the heuristic fallback is always supplied by the consumer on each call.
- **FR-014**: LLM-produced text MUST be confined to prose outputs and MUST NEVER be written into graph structure (nodes or edges).

**Endpoint path (US2)**

- **FR-015**: The endpoint client MUST complete prose tasks via an OpenAI-compatible chat-completions request.
- **FR-016**: The endpoint client MUST support both streaming and non-streaming completion, selectable per call.
- **FR-017**: The endpoint client MUST apply a bounded retry policy and a request timeout (internal constants).
- **FR-018**: The layer MUST estimate token usage with a characters-per-token heuristic (no external tokenizer) and, when a prose task's context exceeds the token budget, MUST trim the context deterministically and insert an explicit truncation marker, such that identical input yields identical trimmed output.
- **FR-019**: The layer MUST NOT auto-chunk or map-reduce oversized prompts — deterministic trimming with a marker is the only oversize handling.
- **FR-020**: The layer MUST NOT add any new runtime dependency for endpoint access — it MUST use the built-in HTTP capability.

**Agent-bundle path (US3)**

- **FR-021**: In agent mode, the seam MUST emit a self-describing task bundle under `.codegraph/tasks/<id>/` containing at least: task instructions, the graph context as JSON, an expected-output contract, and a `manifest.json` carrying the bundle's status.
- **FR-022**: A task bundle MUST be completable by a subscription coding agent using only the contents of the bundle directory, with no external state required.
- **FR-023**: Bundle state MUST live entirely in the filesystem (`manifest.json`) — the layer MUST NOT introduce or modify any SQLite schema.
- **FR-024**: Each emitted bundle MUST receive a unique identifier so concurrent generations do not collide or overwrite one another.
- **FR-025**: The feature MUST include a companion skill describing how a coding agent completes and returns a task bundle; distributing that skill through the plugin channel is out of scope and owned by SPEC-026.

**CLI ingest (US4)**

- **FR-026**: The layer MUST provide an explicit CLI ingest command that a user runs after their agent completes a bundle.
- **FR-027**: Ingest MUST validate the agent's output against the bundle's expected-output contract and MUST reject non-conforming output.
- **FR-028**: On successful validation, ingest MUST store the canonical result inside the bundle directory and stamp the `manifest.json` status as `completed`.
- **FR-029**: Ingest MUST NEVER write consumer artifacts (a downstream feature's own output files) and MUST NOT auto-run from the watcher or daemon — it is user-invoked only.

**Research note and delivery (US5, cross-cutting)**

- **FR-030**: The feature MUST include a committed research note comparing the two paths (endpoint versus agent bundle) on cost, quality, and latency, generated from one wiki chapter and one PR narrative produced against this repository; the note MUST serve as the self-repo UAT record and MUST NOT include a cloud-endpoint comparison arm.
- **FR-031**: The capability MUST live in a new opt-in module and MUST NOT alter behavior for users who have not configured an LLM, and it MUST be delivered as two independently reviewable vertical slices — slice 1 the endpoint path end-to-end; slice 2 the agent-bundle path, companion skill, and research note.

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter — the LLM configuration resolver, the OpenAI-compatible endpoint client, and the agent-bundle filesystem I/O.
- **Secondary surfaces, if any**: API (the single `generate()` library seam re-exported through the public surface), scheduler/runtime (the explicit CLI ingest subcommand), docs/process (the companion skill and the committed research note).
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

- **Prose Task**: A consumer's request for generated prose. Carries task instructions, the graph context, an expected-output contract, and the consumer-supplied heuristic fallback. It is the single input to the `generate()` seam.
- **LLM Configuration (discriminated result)**: Exactly one of — Endpoint Configuration (endpoint URL, model, in-memory API key, internal retry/timeout constants), Agent Configuration (explicit agent-provider selection), Misconfiguration (partial/invalid settings surfaced in status), or Dormant (nothing configured; the default).
- **Task Bundle**: The agent-mode work package, a directory under `.codegraph/tasks/<id>/` containing task instructions, graph-context JSON, an expected-output contract, and a manifest.
- **Bundle Manifest (`manifest.json`)**: The filesystem-only state record for a bundle — its unique identifier, status (`pending` → `completed`), and the reference to its expected-output contract. There is no SQLite representation.
- **Generation Result**: What the seam returns — the produced or fallback text plus a source indicator (endpoint output, consumer fallback, or a handle to a pending bundle).
- **Research Note**: The committed comparison of the two paths (cost, quality, latency) that also records the self-repo UAT outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across dormant, endpoint, and agent modes, 100% of seam calls made with a fallback return usable text and none raise an error caused by absent or partial configuration.
- **SC-002**: With nothing configured, behavior is byte-identical to an unconfigured install — zero outbound requests and zero filesystem writes are observable for any number of seam calls.
- **SC-003**: When a prose task exceeds the token budget, the trimmed output is identical for identical input on every run, and an explicit truncation marker is present 100% of the time trimming occurs.
- **SC-004**: A partial or invalid configuration is always visible in status output, never silently produces a wrong-mode call, and the API key never appears in status output, logs, or any emitted bundle file.
- **SC-005**: In agent mode, every seam call produces a uniquely identified bundle that a coding agent can complete using only the directory contents; a reviewer who follows only the bundle files can produce a conforming output.
- **SC-006**: 100% of non-conforming agent outputs are rejected by ingest, and in no ingest run (successful or rejected) is any file written outside the bundle directory.
- **SC-007**: The committed research note reports cost, quality, and latency for both paths on one wiki chapter and one PR narrative generated against this repository, and contains no cloud-endpoint arm.

## Assumptions

- Environment variable names follow the SPEC-001/002 embeddings precedent: `CODEGRAPH_LLM_URL`, `CODEGRAPH_LLM_MODEL`, `CODEGRAPH_LLM_API_KEY`, and `CODEGRAPH_LLM_PROVIDER`; resolution, redaction, plaintext-remote warning, and positive-integer clamps mirror the established embeddings configuration posture.
- The characters-per-token estimate is a fixed conservative internal constant; approximate token accounting (no exact tokenizer) is acceptable for the budget guard.
- Bundle identifiers are opaque unique strings; their exact format is an implementation detail decided at plan time.
- The expected-output contract is a machine-checkable description carried inside the bundle; its exact schema is an implementation detail decided at plan time.
- "Consumer artifacts" means a downstream feature's own output files (for example, SPEC-019 wiki pages or SPEC-020 PR narratives); ingest deliberately stops at the bundle directory and leaves artifact writing to the consumer.
- If bundle emission itself fails in agent mode, the consumer still receives its fallback text and the failure is surfaced through the returned handle/status rather than thrown — preserving the US1 guarantee.
- Retry count and request timeout default to values consistent with the embeddings client and are overridable only in tests.
- The research note is a committed design/research document under the repository's docs area, consistent with prior specs' decision documents.
- Streaming is offered per call; when an endpoint does not support streaming, the client uses a non-streaming completion.

## Dependencies

- Mirrors the configuration and client posture established by SPEC-001/002 (the embeddings module) — this spec reuses that shape rather than inventing a new one.
- Relies on the existing graph/context capability to supply the graph context embedded in prose tasks and bundles.
- Ships the shared seam consumed by future features SPEC-011 (cluster labels), SPEC-019 (wiki prose), and SPEC-020 (PR narratives); those consumers are out of scope here.
- Plugin-channel packaging of the companion skill is owned by SPEC-026 and is out of scope for this spec.
