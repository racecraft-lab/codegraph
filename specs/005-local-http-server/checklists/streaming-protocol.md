# Streaming Protocol Checklist: Local HTTP Server & REST API

**Purpose**: Unit-test the *requirements quality* of the re-index job Server-Sent Events (SSE) contract — framing, event model, progress mapping from the library `IndexProgress`, reconnect/disconnect semantics, keep-alive/backpressure, and job↔stream correlation — for completeness, clarity, and cross-artifact consistency across `spec.md`, `data-model.md`, and `contracts/openapi.yaml`. Tests the requirements, not the implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · [data-model.md](../data-model.md) · [openapi.yaml](../contracts/openapi.yaml)

**Scope note**: The Clarify S2 SSE decisions are SETTLED and are NOT reopened here — items covering them VERIFY cross-artifact consistency only: FR-023 (per-repo `GET /api/reindex/:repo/events`; named events snapshot/progress/done|error; snapshot on every connect; single terminal event closes the stream; no Last-Event-ID; `text/event-stream` + comment heartbeats; disconnect never cancels; shutdown-abort with `aborted`), FR-021a (`lock_unavailable`; watcher-restore duty), FR-024 (latest-job state; no-job → 404 `resource:repo`), and the Key Entities job/`IndexProgress`/per-mode-result model. A standalone Gap marker denotes a genuine requirement-quality problem to remediate; non-marked items are verified consistent on the current artifacts.

## SSE Framing & Event Model (FR-023, Q8)

- [x] CHK001 Is the SSE media type `Content-Type: text/event-stream` pinned consistently across the spec, data-model, and contract? [Consistency, Spec §FR-023, data-model, openapi events]
- [x] CHK002 Are the named events (`snapshot`, `progress`, terminal `done`/`error`) specified with the same names and roles across spec FR-023, Key Entities, data-model, and openapi? [Consistency, Spec §FR-023]
- [x] CHK003 Is snapshot-on-every-connect specified, including the mid-job reconnect re-snapshot and the already-finished case (terminal snapshot then the stream closes immediately)? [Completeness, Spec §FR-023, data-model]
- [x] CHK004 Is the `progress` payload shape `{ phase, current, total, currentFile? }` specified consistently between FR-023, Key Entities, data-model, and openapi? [Consistency, Spec §FR-023]
- [x] CHK005 Is it specified that a single terminal `done`/`error` event ends the stream (exactly one terminal event, no further frames)? [Completeness, Spec §FR-023]
- [x] CHK006 Are the event `data:` payloads documented as the concrete JSON descriptors (snapshot/terminal = full job descriptor; `progress` = the progress object)? [Clarity, Spec §FR-023, data-model]

## Progress Mapping from IndexProgress (Key Entities, data-model)

- [x] CHK007 Does the `progress.phase` enum mirror the library `IndexProgress` verbatim — `scanning | parsing | storing | resolving | embedding`, with `embedding` present only when embeddings are configured? [Consistency, Spec §Key Entities, data-model]
- [x] CHK008 Is there a requirement bounding server memory when `IndexProgress` fires faster than a subscriber can drain (the callback fires per-file during `scanning`), so the progress→SSE mapping never buffers the whole stream in memory? [Completeness, Edge Case] [Resolved → FR-023 backpressure clause (per-subscriber writes, coalesce-to-latest, no unbounded backlog); data-model "Backpressure & fan-out"; openapi events 200]
- [x] CHK009 Is progress-event delivery ordering specified, and whether intermediate `progress` frames may be coalesced/dropped versus every callback being delivered, under rapid `IndexProgress` callbacks? [Clarity] [Resolved → FR-023 (delivery order of sent frames preserved; intermediate frames coalesce to latest under backpressure since each carries absolute current/total); data-model "Backpressure & fan-out"]

## Reconnect & Disconnect Semantics (Q8)

- [x] CHK010 Is the no-`id:`-field / no-Last-Event-ID-replay rule specified, with a reconnect re-snapshotting current state rather than replaying missed frames? [Consistency, Spec §FR-023, Edge Cases]
- [x] CHK011 Is it specified that a client disconnect stops writes to that response but MUST NOT cancel the running job? [Consistency, Spec §FR-023, data-model]
- [x] CHK012 Is the interaction between EventSource's default auto-reconnect and the terminal-event-closes-stream rule specified (settled: re-snapshot-then-close is acceptable; the client closes on the terminal event; the server emits no retry-suppression signal — consistent with MDN, where a client `.close()` is the only client-agnostic stopper and no server status code suppresses reconnect)? [Coverage, Spec §FR-023/024]

## Keep-Alive, Backpressure & Transport Headers (Non-Functional)

- [x] CHK013 Are both the heartbeat cadence (interval) and the heartbeat frame format (an SSE comment `:`-prefixed line, ignored by EventSource) specified — the spec currently says only "periodic comment heartbeats" without quantifying either? [Clarity] [Resolved → FR-023 (~15s `:`-prefixed comment frame, below the common 30–60s idle timeout); data-model "Transport headers"; openapi events 200]
- [x] CHK014 Are the SSE response headers beyond `Content-Type` specified — `Cache-Control: no-cache`, `X-Accel-Buffering: no` (defeat reverse-proxy response buffering that would otherwise batch/withhold the stream and its heartbeats), and `Connection: keep-alive` — so the anti-timeout/keep-alive goal actually survives an intermediary proxy? [Completeness] [Resolved → FR-023 (Cache-Control:no-cache, Connection:keep-alive, X-Accel-Buffering:no); openapi events 200 `headers:` block; data-model "Transport headers"]
- [x] CHK015 Are multiple concurrent subscribers to one job's stream addressed — that N subscribers are supported, each independently snapshotted on connect, and that a slow or disconnected subscriber is isolated (never stalls the running job or the other subscribers)? [Coverage] [Resolved → FR-023 (concurrent subscribers; independent per-connect snapshot; slow/disconnected isolation); data-model "Backpressure & fan-out"; openapi events 200]

## Job ↔ Stream Correlation & Terminal Outcomes (FR-021a/024)

- [x] CHK016 Is the 202 job descriptor `{ id, repo, mode, status, startedAt }` specified as the correlation handle to the per-repo stream (one active job per repo making the correlation unambiguous)? [Consistency, Spec §FR-023]
- [x] CHK017 Is the `lock_unavailable` terminal error specified as delivered over the job's SSE stream and reflected in the latest-job-state read? [Consistency, Spec §FR-021a/024]
- [x] CHK018 Is shutdown-abort specified — an in-flight job aborted via its AbortSignal, a terminal `aborted` outcome (`error` with reason `aborted`) emitted over SSE within a bounded grace period? [Completeness, Spec §FR-023/026]
- [x] CHK019 Is the registered-repo-with-no-job case specified as 404 `not_found` (`details.resource: "repo"`) on both `GET /api/reindex/:repo` and `.../events`, deliberately indistinguishable from an unknown repo? [Consistency, Spec §FR-024]

## Notes

- A standalone Gap marker on an item denotes a requirement-quality problem to remediate (missing, ambiguous, or inconsistent requirement). Non-marked items are verified consistent on the current artifacts.
- Traceability: every item carries a spec §, data-model, or openapi reference.
- Remediation flips a resolved item's checkbox to `[x]` and replaces its Gap marker with `[Resolved → <artifact ref>]`.
