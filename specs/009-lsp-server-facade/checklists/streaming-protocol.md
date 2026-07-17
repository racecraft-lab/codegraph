# Streaming Protocol Requirements Quality Checklist

**Purpose**: Review whether stdio and WebSocket streaming/lifecycle requirements
are bounded, deterministic, and complete.
**Created**: 2026-07-16
**Audience**: Pull-request reviewer before Tasks
**Depth**: Standard release gate

## Stdio Framing Completeness

- [x] CHK001 Are byte-counted Content-Length framing, fragmented/coalesced input, and protocol-only stdout requirements explicit? [Completeness, Spec §FR-025]
- [x] CHK002 Are header byte/line caps, one decimal length, companion-header handling, and the 1 MiB inbound-body cap quantified? [Clarity, Plan §Frozen Operational Limits]
- [x] CHK003 Are every framing-loss class and the no-resynchronization/nonzero-exit policy documented? [Coverage, Spec §FR-025]
- [x] CHK004 Is malformed JSON within a trustworthy frame clearly separated from fatal framing loss? [Consistency, Spec §FR-025, Contract §Error Vocabulary]
- [x] CHK005 Are stdout isolation and bounded redacted stderr diagnostics required for parse, stream, and shutdown failures? [Coverage, Spec §FR-021, §FR-025]
- [x] CHK006 Are EOF, stream error, exit, SIGINT, and SIGTERM cleanup expectations measurable and consistent? [Acceptance Criteria, Spec §FR-026]

## WebSocket Message Semantics

- [x] CHK007 Is one JSON-RPC object per reassembled text message distinguished from physical RFC frames? [Clarity, Spec §FR-027]
- [x] CHK008 Are malformed JSON, invalid envelope, binary, invalid UTF-8, oversized, policy, internal, shutdown, clean, and pressure cases mapped to exact responses/codes? [Completeness, Contract §Message Contract]
- [x] CHK009 Are reserved close codes prohibited and close-reason byte/redaction bounds specified? [Coverage, Spec §FR-027]
- [x] CHK010 Are pre-upgrade HTTP rejection semantics separated from post-upgrade WebSocket close semantics? [Consistency, Contract §Upgrade Endpoint, §Message Contract]

## Concurrency and Deadline Clarity

- [x] CHK011 Is the in-flight definition restricted to accepted ID-bearing requests and reservation-before-dispatch? [Clarity, Spec §FR-031]
- [x] CHK012 Are request 17, no-queue behavior, exact overload code/reason, and socket survival specified together? [Completeness, Plan §Frozen Operational Limits]
- [x] CHK013 Is the five-second deadline start point, exact timeout code/reason, slot release, and late-result discard defined? [Measurability, Spec §FR-031]
- [x] CHK014 Are out-of-order correlated responses allowed without weakening exact-once settlement? [Consistency, Contract §Request Limits]
- [x] CHK015 Are notification accounting and no-mutation behavior consistent with request-slot rules? [Consistency, Spec §FR-024, Contract §Request Limits]

## Backpressure and Cleanup Coverage

- [x] CHK016 Is the 2 MiB queued-byte high-water threshold quantified and tied to stop-dispatch behavior? [Clarity, Plan §Frozen Operational Limits]
- [x] CHK017 Is the five-second drain deadline and 1013 terminal behavior specified when pressure persists? [Completeness, Spec §FR-032]
- [x] CHK018 Are send callback, error, close, timeout, and daemon-loss paths required to converge on one idempotent teardown? [Consistency, Contract §Liveness and Cleanup]
- [x] CHK019 Are timer, listener, pending-slot, and repository-lease ownership/release requirements explicit? [Completeness, Spec §FR-032]
- [x] CHK020 Is shared-daemon isolation specified so one session cannot terminate an unaffected session/client? [Coverage, Spec §FR-032]
- [x] CHK021 Are ping/pong and bounded liveness requirements documented without introducing a second unbounded timer loop? [Coverage, Contract §Liveness and Cleanup]

## Scenario and Acceptance Quality

- [x] CHK022 Are fragmented/coalesced input, premature EOF, legal WebSocket fragmentation, and cross-message object misuse all represented as edge cases? [Coverage, Spec §Edge Cases]
- [x] CHK023 Are malformed/oversized/disconnect/daemon-loss/shutdown outcomes independently measurable in black-box success criteria? [Acceptance Criteria, Spec §SC-006–SC-007, §SC-011]
- [x] CHK024 Are source-response envelope overhead and inbound message caps distinguished to avoid contradictory 1 MiB requirements? [Consistency, Spec §FR-025, §FR-031]
- [x] CHK025 Are transport limits and error semantics shared enough to prevent stdio/WebSocket protocol-shape drift? [Consistency, Spec §FR-022, §SC-002]

## Assessment

All 25 streaming requirements-quality items pass. No `[Gap]` marker is required.
