# Error-Handling Checklist: LLM Access Layer

**Purpose**: Validate the quality, clarity, and completeness of the error-handling requirements — the three-kind `generate()` result and its guaranteed non-throwing degradation, endpoint failure classification (retry vs immediate degrade, timeouts), bundle-path failures (emission, ingest, malformed/missing manifest, double-ingest, pending-forever), half-config / invalid-provider misconfiguration, and the byte-identical dormant path — before implementation.
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)
**Domain**: error-handling | **Depth**: Standard | **Audience**: Reviewer (PR)

<!--
  Unit tests for the REQUIREMENTS, not the implementation. Each item asks whether a
  requirement is well-written (complete / clear / consistent / measurable / covered)
  for a failure or degraded-mode path. A trailing gap tag marks an item where the
  requirement is genuinely missing or under-specified and must be closed in
  spec.md/plan.md (or a cited contract), then re-verified.
-->

## Three-kind Generation Result & guaranteed non-throwing degradation (Q1 / AC-18.3)

- [ ] CHK001 Is the three-kind Generation Result union completely enumerated (endpoint / pending-bundle / fallback), each carrying a source discriminator? [Completeness, Spec §FR-012; Research D6]
- [ ] CHK002 Is every configuration state (endpoint / agent / misconfiguration / dormant) mapped to a specified seam outcome, with no unmapped state? [Completeness, Spec §FR-008–FR-011; Contract generate-seam.md §Guarantees]
- [ ] CHK003 Is the never-throw guarantee stated as a testable requirement for BOTH absent AND partial configuration (not only "absent")? [Clarity, Spec §FR-008, §SC-001]
- [ ] CHK004 Is the endpoint ultimate-failure outcome specified as "consumer fallback, never an error" after retries and timeout are exhausted? [Completeness, Spec §FR-009; US1 AS-2]
- [ ] CHK005 Can a caller deterministically distinguish endpoint vs fallback vs pending-bundle from the result's source field (objectively verifiable)? [Measurability, Spec §FR-012, §SC-001]
- [x] CHK006 Is behavior specified when a streaming response delivers some deltas and is then aborted by the FR-017 inter-chunk idle deadline (or any mid-stream transport error) — are the partial deltas discarded and the call degraded to the consumer fallback, rather than the partial assembly being returned as an `endpoint` success like a clean end-of-stream? [Resolved, Spec §FR-016a; Edge Case "Streaming terminates without [DONE]"; Contract endpoint-wire.md §Response] — FR-016a now states a stream aborted before a clean end-of-stream (idle deadline or mid-stream transport error) is an ultimate failure: partial deltas are discarded and the seam degrades to the consumer fallback (FR-009), never returned as an `endpoint` success (mirrors the embeddings client's throw-on-retry-exhaustion).

## Endpoint failure classification: retry vs immediate degrade, Retry-After, timeouts

- [ ] CHK007 Is the retryable-vs-terminal status classification specified (5xx / 429 / timeout / network retried; 4xx such as 400/401/403/404/422 fast-aborted to fallback)? [Completeness, Contract endpoint-wire.md §Retry]
- [ ] CHK008 Is bounded backoff specified as internal constants (max retries, base/max delay, full jitter) rather than left arbitrary? [Clarity, Spec §FR-017; Plan §Constants; Contract endpoint-wire.md §Retry]
- [ ] CHK009 Is `Retry-After` honoring specified, including an upper cap so a hostile or oversized value cannot stall the seam unbounded? [Completeness, Contract endpoint-wire.md §Retry; Plan `RETRY_AFTER_CAP_MS`]
- [ ] CHK010 Are the two timeout modes distinguished and each defined (non-streaming flat total-request deadline vs streaming inter-chunk idle deadline, reset per chunk)? [Clarity, Spec §FR-017; Contract endpoint-wire.md §Deadlines]
- [ ] CHK011 Is a timeout classified as a retryable failure whose ultimate exhaustion maps to the consumer fallback (consistent with FR-009)? [Consistency, Spec §FR-009, §FR-017]
- [ ] CHK012 Is an empty or whitespace-only successful (2xx) completion specified as a failed generation that degrades to the consumer fallback (never surfaced as endpoint output)? [Completeness, Spec §FR-009a; Edge Case "Empty successful completion"]
- [ ] CHK013 Is a streaming response that closes cleanly WITHOUT the terminal `data: [DONE]` sentinel specified as a non-error (return the deltas assembled so far)? [Completeness, Spec §FR-016a; Edge Case "Streaming terminates without [DONE]"]
- [ ] CHK014 Is the only error type leaving the client required to be redaction-safe (endpoint reduced to scheme+host+port, status a bare integer, no response-body text surfaced, raw error not chained as `cause`)? [Completeness, Spec §FR-005; Contract endpoint-wire.md §Redaction]

## Half-config / invalid provider → status-visible misconfiguration, behaviorally dormant (Q3)

- [ ] CHK015 Is the full four-state resolution table specified, covering every URL / MODEL / PROVIDER combination (including API-key-only)? [Completeness, Contract llm-config-resolution.md §Resolution table]
- [ ] CHK016 Is a partial endpoint configuration required to surface as a status-visible misconfiguration with no endpoint call attempted? [Completeness, Spec §FR-002]
- [ ] CHK017 Is an unrecognized `CODEGRAPH_LLM_PROVIDER` value's outcome specified (a named misconfiguration carrying the invalid value and allowed values — not a crash or silent downgrade)? [Coverage, Contract llm-config-resolution.md §Resolution table]
- [x] CHK018 Is the misconfiguration state required to be behaviorally dormant — zero network calls AND zero filesystem writes, with the seam returning the consumer fallback — as a testable requirement, rather than only "MUST NOT attempt an endpoint call" (FR-002)? [Resolved, Spec §FR-002, §SC-004] — FR-002 now requires a misconfiguration (partial config or unrecognized provider) to be behaviorally dormant (zero network, zero filesystem writes, seam returns the fallback; the only difference from dormant is status rendering the misconfig), and SC-004 now measures zero outbound requests and zero filesystem writes for misconfig. This elevates the generate-seam.md guarantee and the ratified Q3 "status-visible, feature dormant" posture to a testable requirement.
- [ ] CHK019 Is it required that a partial/invalid configuration is always visible in status and never silently produces a wrong-mode call? [Consistency, Spec §SC-004]

## Dormant path — zero network, zero writes, byte-identical

- [ ] CHK020 Is dormant defined as the default state and required to perform zero network calls and zero filesystem writes (including no bundle emission)? [Completeness, Spec §FR-004]
- [ ] CHK021 Is byte-identical dormancy stated as a measurable success criterion holding across any number of seam calls? [Measurability, Spec §SC-002]
- [ ] CHK022 Is the API-key-only case (key set, no URL/MODEL/provider) specified as dormant — with the key still fully protected — rather than a partial misconfiguration? [Coverage, Contract llm-config-resolution.md §API key; Edge Case "API key present but mode is dormant or agent"]

## Bundle-path failures: emission, ingest validation, malformed / missing / double-ingest, pending-forever

- [ ] CHK023 Is bundle-emission failure in agent mode specified to still return the consumer fallback, with the failure surfaced via the returned handle/status rather than thrown? [Completeness, Spec §Edge Cases "Bundle emission failure"; Contract generate-seam.md §Guarantees]
- [ ] CHK024 Is ingest's structural validation specified (required fields present, correct types, non-empty where required; deterministic; never a semantic/quality judgment) with rejection on failure? [Completeness, Spec §FR-027; Research D10]
- [ ] CHK025 Is a rejected ingest's post-state specified (manifest stays `pending`, rejection reason to stderr, no failure state persisted, re-runnable after the agent corrects output)? [Completeness, Spec §FR-028a; US4 AS-2]
- [ ] CHK026 Is the outcome for a missing / already-`completed` (double-ingest) / malformed-manifest bundle specified (report the problem, write no consumer artifacts, do not falsely stamp `completed`, non-zero exit)? [Coverage, Spec §Edge Cases; Contract tasks-cli.md §ingest]
- [x] CHK027 Is ingest behavior specified when the bundle exists and is `pending` but the agent's output file is absent or unreadable (i.e. the user ran ingest before the agent produced output)? [Resolved, Spec §FR-027; Edge Case "Ingest before the agent produced output"; Contract tasks-cli.md §ingest] — FR-027 now treats an absent/empty/unreadable output file as a validation failure rejected in the FR-028a shape (manifest stays `pending`, reason to stderr, no consumer artifact, re-ingestable), and a new Edge Case plus a tasks-cli ingest-table row pin it.
- [ ] CHK028 Are ALL FR-029a hardening rejections (path-escape, symlink, oversize, deep-JSON, prototype-pollution key) required to be FR-028a-shaped (manifest stays `pending`, reason to stderr, no consumer artifact, never `isError`)? [Consistency, Spec §FR-029a; Research D9]
- [ ] CHK029 Is "no file written outside the bundle directory on any ingest outcome (success or rejection)" objectively measurable? [Measurability, Spec §FR-029, §SC-006]
- [x] CHK030 Is `codegraph tasks list` resilience specified when one bundle among many has a missing or malformed `manifest.json` (the listing must not abort — that bundle is surfaced with an unreadable/unknown status), and for the zero-bundle / absent-`.codegraph/tasks/` case (empty listing, exit 0, never an error)? [Resolved, Spec §FR-026; Edge Case "tasks list over a corrupt or empty task directory"; Contract tasks-cli.md §list] — FR-026 now requires resilient enumeration (daemon-registry precedent): a missing/malformed/unreadable manifest is surfaced with an unreadable/unknown status without aborting the listing, and an empty or absent tasks directory yields an empty listing with a zero exit.
- [ ] CHK031 Is pending-forever / abandoned-bundle handling specified (findable via `tasks list` with age; removed by documented manual deletion; no auto-prune verb in v1)? [Completeness, Spec §Assumptions; Contract tasks-cli.md §list]

## Redemption of the pending-bundle handle (degraded / error states)

- [ ] CHK032 Are the redemption-lookup result states completely enumerated (`completed` / `pending` / `missing`) and each mapped to a defined condition, reading only the handle's own bundle directory? [Completeness, Spec §FR-010a; Research D7]
- [x] CHK033 Is `redeemHandle`'s result specified when the bundle directory still exists but its `manifest.json` cannot be safely read (malformed, oversize, depth-exceeded, or symlinked — i.e. the D9 bounded safe-read rejects it)? [Resolved (RESOLVED by consensus 2026-07-13: `pending` ratified (2/3 — codebase+spec-context; domain dissent for a distinct `unreadable` state recorded)), Spec §FR-010a; Edge Case "Redeeming a handle whose manifest is corrupt"; Contract generate-seam.md §Redemption] — FR-010a now maps a present-but-unreadable manifest to `pending` (never throws, never a false `completed`; transient partial-writes heal on re-lookup; persistent corruption is findable via `tasks list` + manual cleanup). The conservative `pending`-vs-`missing` choice is genuinely two-valid-approaches and is escalated to consensus [spec, domain].
- [ ] CHK034 Is repeat generation of the same task specified (a new, independently-identified bundle and a fresh pending handle; no task-identity dedup; no cross-call state)? [Consistency, Spec §FR-024a; Edge Case "Repeat generation of the same task"]

## Notes

- Check items off as resolved: `[x]`; cite the resolving requirement inline.
- Gap-tagged items denote a genuinely missing or under-specified requirement to be closed in spec.md/plan.md (or the cited contract), then re-verified.

## Verification (Loop 1)

- Initial pass: 34 items, 5 gap-tagged (CHK006, CHK018, CHK027, CHK030, CHK033).
- Remediation (spec.md + contracts): extended FR-016a (streaming abort before a clean close discards the partial assembly and degrades to the fallback — CHK006); extended FR-002 + SC-004 (misconfiguration is behaviorally dormant: zero network, zero filesystem writes — CHK018); extended FR-027 (absent/empty/unreadable output → FR-028a-shaped rejection — CHK027); extended FR-026 (resilient `tasks list` enumeration + empty/absent directory — CHK030); extended FR-010a (present-but-unreadable manifest → `pending`, provisional — CHK033). Added four Edge Cases (ingest-before-output, tasks-list-over-corrupt/empty, redeem-corrupt-manifest, and the streaming-abort clause folds into the existing streaming edge case). Synced contracts: endpoint-wire.md §Response, tasks-cli.md §list + §ingest, generate-seam.md §Redemption.
- Re-assessment against the updated spec: all 5 items resolved; deterministic marker count = 0 across spec.md, plan.md, and this checklist. CHK033's fix is provisional (conservative `pending` mapping) and is escalated to consensus [spec, domain] — the marker is closed but the missing-vs-pending decision is recorded as unresolved for the orchestrator.
</content>
