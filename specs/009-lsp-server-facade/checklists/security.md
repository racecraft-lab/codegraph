# Security and Privacy Requirements Quality Checklist

**Purpose**: Review whether SPEC-009's local trust boundary, source exposure,
resource limits, privacy, and failure behavior are complete and unambiguous.
**Created**: 2026-07-16
**Audience**: Security-minded pull-request reviewer before Tasks
**Depth**: Standard release gate

## Repository and Upgrade Boundary

- [x] CHK001 Are prebound repository identity, all initialize-root signals, realpath equality, and no-rebind behavior explicit? [Completeness, Spec §FR-002–FR-004]
- [x] CHK002 Are handshake shape, exact path, Host, Origin, repo ID, daemon attach, and upgrade ordered to prevent state enumeration? [Clarity, Spec §FR-028–FR-029]
- [x] CHK003 Are same-origin comparison fields, non-equivalent loopback names, and null/multiple/malformed Origin rejection defined? [Completeness, Spec §FR-029]
- [x] CHK004 Is the absent-Origin exception constrained to otherwise-valid local scripted clients rather than all non-browser requests? [Clarity, Spec §FR-029]
- [x] CHK005 Are wrong perimeter inputs required to reveal no repository/daemon existence information? [Privacy, Spec §FR-029]
- [x] CHK006 Is bearer-token exclusion from WebSocket URLs consistent with existing server authentication and loopback-only startup? [Consistency, Spec §FR-030, Plan §Constitution Check]

## Source Containment and Snapshot Integrity

- [x] CHK007 Are URI scheme, decoding, canonical containment, symlink escape, index membership, regular-file, size, readability, and hash gates all documented? [Completeness, Spec §FR-018–FR-020]
- [x] CHK008 Is one trusted linearized operation required to own validation, stable handle read, exact-byte hash, and final revalidation? [Consistency, Spec §FR-018–FR-019]
- [x] CHK009 Are replacement, symlink swap, short/partial read, growth, metadata drift, and hash drift required to discard the entire result? [Coverage, Spec §FR-019]
- [x] CHK010 Are malformed, stale, and safe source-unavailable failures mapped to closed codes/reasons without path/hash/cause echo? [Clarity, Spec §FR-020]
- [x] CHK011 Are source, snapshot token, hash, URI, and absolute-path exclusions consistent across response, URL, and log requirements? [Consistency, Spec §FR-017, §FR-021, §FR-036]

## Read-Only and Resource Controls

- [x] CHK012 Is the explicit read allowlist complete and every mutation/indexing/diagnostic path excluded? [Completeness, Spec §FR-023–FR-024, §Out of Scope]
- [x] CHK013 Are unsupported requests and notifications specified so neither can reach write-capable behavior? [Coverage, Spec §FR-023–FR-024]
- [x] CHK014 Are message/source/header, in-flight, deadline, queued-byte, and drain limits quantified with no hidden queue? [Measurability, Plan §Frozen Operational Limits]
- [x] CHK015 Are overload/backpressure policies bounded without allowing one session to terminate pooled daemon resources owned by others? [Consistency, Spec §FR-031–FR-032]
- [x] CHK016 Is uninvoked dormancy defined as zero listener/socket/network/persisted-write activity? [Acceptance Criteria, Spec §FR-045, §SC-010]

## Redaction and Diagnostic Policy

- [x] CHK017 Does one redaction policy cover stderr, HTTP bodies, JSON-RPC errors, close reasons, send failures, daemon loss, and logs? [Completeness, Spec §FR-021]
- [x] CHK018 Are source, bodies/params, credentials/cookies, queries, raw Origin, paths, raw methods/IDs, exceptions, causes, and stacks explicitly excluded? [Coverage, Spec §FR-021]
- [x] CHK019 Are allowed diagnostic fields a closed bounded set rather than a vague “safe metadata” allowance? [Clarity, Spec §FR-021]
- [x] CHK020 Is protocol-required request-ID echo distinguished from the prohibition on logging raw IDs? [Consistency, Spec §FR-021]
- [x] CHK021 Are close-reason length and redaction requirements aligned with WebSocket protocol bounds? [Consistency, Spec §FR-027]

## Threat and Acceptance Coverage

- [x] CHK022 Are invalid root, path/symlink escape, stale hash, wrong origin, malformed/binary/oversize, overload, timeout, disconnect, and shutdown classes all measurable? [Acceptance Criteria, Spec §SC-006]
- [x] CHK023 Are resource-leak and cross-session isolation outcomes explicitly measurable after every termination path? [Acceptance Criteria, Spec §SC-007, Spec §FR-032]
- [x] CHK024 Are no-external-network/package-offline expectations traceable to the local-first constitution and viewer tests? [Dependency, Plan §Execution and Verification Flow]
- [x] CHK025 Are TLS, hosted deployment, cross-origin access, remote URI schemes, and automatic indexing explicitly excluded rather than silently unsupported? [Coverage, Spec §Out of Scope]

## Assessment

All 25 security/privacy requirements-quality items pass. The user already
completed mandatory human review for the Clarify security decisions; no new
`[Gap]` or human decision is introduced here.
