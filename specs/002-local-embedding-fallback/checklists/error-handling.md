# Error-Handling Requirements Quality Checklist: Bundled Local Embedding Fallback

**Purpose**: Validate the completeness, clarity, consistency, and measurability of the
**error-handling / failure-degradation requirements** in the spec (unit tests for the
requirements, not the implementation). Domain focus: offline first-run degradation,
checksum-mismatch / partial-download rejection, model-fetch-must-not-abort-the-index,
the `InferenceSession.create()` hang-on-missing-`.wasm` timeout, actionable-message
content, and `codegraph status` surfacing the 0%-coverage reason.
**Created**: 2026-07-05
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md) · [contracts/model-fetch.md](../contracts/model-fetch.md) · [contracts/local-provider.md](../contracts/local-provider.md)

**Convention**: `[x]` = the requirement is present and well-specified (PASS); an unchecked box
carrying a Gap tag = the requirement is missing or under-specified (GAP, reported for serial
remediation by the parent — this executor does not edit spec.md/plan.md under the parallel-batch
constraint). Gap items carry the literal marker so the deterministic counter can tally them.

## Requirement Completeness (are all necessary failure-mode requirements documented?)

- [x] CHK001 - Is the offline / model-unobtainable degradation path specified end-to-end (structural index completes, embed pass skipped, actionable message)? [Completeness, Spec §FR-019, §US3, §SC-005]
- [x] CHK002 - Is the offline actionable-message CONTENT enumerated (names the resolved cache dir, the `CODEGRAPH_MODEL_BASE_URL` override, and the exact pre-seed filename)? [Completeness, Spec §FR-019]
- [x] CHK003 - Is it required that a model-fetch failure MUST NOT abort structural indexing (provider-failure-stops-the-embed-pass, not the index)? [Completeness, Spec §FR-019, §FR-007, §Assumptions]
- [x] CHK004 - Is the `misconfig` degradation path specified (structural index completes, embed skipped, actionable message, no crash)? [Completeness, Spec §FR-007, §Edge Cases "Misconfiguration"]
- [x] CHK005 - Is the unwritable/missing/rejected cache-directory failure required to degrade (actionable message, structural index still completes)? [Completeness, Spec §FR-017a, §Edge Cases "Unwritable or missing cache directory"]
- [x] CHK006 - Is there a requirement covering **ONNX session-initialization failure**, specifically the `InferenceSession.create()` infinite-hang on a missing/corrupt runtime `.wasm`, mandating a timeout so "model unavailable" degrades instead of freezing? This is a distinct runtime-integrity failure axis (model bytes present + verified, but the runtime `.wasm` is absent) that lives only in research.md OQ-1 / plan.md Constraints / contracts, never in a spec FR or edge case. (closed by FR-019b / Edge Case "Runtime/session-init unavailable") [Completeness — research.md OQ-1, plan.md §Constraints, contracts/local-provider.md §Lifecycle]
- [x] CHK007 - Are process **exit-code** semantics specified for the degraded run (embed pass skipped but structural index succeeded) so CI/automation can distinguish "index OK, embedding degraded" from a hard failure? (closed by FR-019 appended exit-code clause) [Completeness — Spec §US3, §SC-005 assert "completes successfully" / "exits with an actionable message" but never pin the exit code]
- [x] CHK008 - Is there a requirement that failure / abort / actionable messages MUST NOT echo source text or composed embedding input (redaction)? contracts/local-provider.md previously cited a redaction FR that did not exist in SPEC-002 — the reference dangled. (closed by FR-019c; contracts/local-provider.md now cites the correct SPEC-002 FR) [Completeness + Traceability — contracts/local-provider.md §Lifecycle]

## Requirement Clarity (are the failure requirements specific and unambiguous?)

- [x] CHK009 - Are the offline message and the checksum-mismatch message required to be DISTINCT (offline is not conflated with a tamper/integrity event)? [Clarity, Spec §FR-019 vs §FR-019a, §Edge Cases "Checksum mismatch"]
- [x] CHK010 - Does FR-020 specify whether `codegraph status` surfaces the **distinct** reason (offline vs checksum vs unwritable-cache vs misconfig vs session-init failure), or only a single generic "coverage 0% because embedding was skipped"? The spec said "the reason" (singular/generic) while model-fetch.md defines three distinct reasons plus misconfig. (closed by FR-020 rewrite naming the distinct reasons) [Clarity — Spec §FR-020, §FR-019a vs contracts/model-fetch.md §Messages]
- [x] CHK011 - Is FR-014 worded strongly enough? It required failed-checksum bytes "MUST NOT be used for embedding," but the stronger property the contract relies on — that a failed artifact is **never persisted to the verified/final cache path** (atomic verify-then-rename) — was not stated at the requirement level ("not used" ≠ "not persisted"). (closed by FR-014 rewrite adding "MUST NOT be... persisted to the verified cache path") [Clarity — Spec §FR-014 vs data-model.md §3 / contracts/model-fetch.md step 4-5]

## Requirement Consistency (do the failure requirements align without conflict?)

- [x] CHK012 - The contract/data-model define **three** distinct unavailability messages (offline / checksum / cache) plus misconfig, but the spec formalized only **two** with specified content (FR-019, FR-019a); the `cache` (unwritable/invalid dir) failure's message content — name the dir + `CODEGRAPH_MODEL_CACHE_DIR` — was not first-classed with FR-019-level rigor. Also: is a **mid-download I/O failure** (disk-full / permission race AFTER cache-dir validation) mapped to a defined reason, or left ambiguous between `offline` and `cache`? (closed by FR-017a rewrite — names the cache dir + override, and maps mid-download I/O failure to the `cache` reason) [Consistency + Coverage — Spec §FR-017a, §FR-019, §FR-019a vs contracts/model-fetch.md §Messages, data-model.md §3]
- [x] CHK013 - Are the endpoint `misconfig` path and the local-provider acquisition failures kept disjoint by the typed discriminated union (so a local failure is never mislabeled a misconfig, and vice versa)? [Consistency, Spec §FR-004, data-model.md §1]
- [x] CHK014 - Is "both cases degrade identically (index completes, embed skipped, status reports the reason)" stated consistently for the offline and checksum branches? [Consistency, Spec §FR-019a, contracts/model-fetch.md §Messages]

## Acceptance Criteria & Measurability (are the degradation outcomes objectively verifiable?)

- [x] CHK015 - Is the checksum-reject outcome measurable (mismatched bytes used for embedding 0% of the time)? [Measurability, Spec §SC-003]
- [x] CHK016 - Is the offline-degradation outcome measurable (structural index completes 100% of the time + actionable message + status states the reason)? [Measurability, Spec §SC-005]
- [x] CHK017 - Is the "never abort the index" posture tied to a measurable criterion (structural index completes successfully regardless of embed outcome)? [Measurability, Spec §SC-005, §FR-007]

## Scenario & Edge-Case Coverage (are all failure/recovery flows addressed in requirements?)

- [x] CHK018 - Is a partial/interrupted download required to be treated as absent and re-acquired (never used as if complete)? [Coverage/Edge, Spec §Edge Cases "Partial or interrupted download", data-model.md §3 state machine]
- [x] CHK019 - Is the air-gapped/mirror wrong-bytes scenario covered by the same pinned checksum verification (a bad mirror routes to the checksum-mismatch failure path, not silent acceptance)? [Coverage/Edge, Spec §FR-015, §Edge Cases "Air-gapped / mirrored source"]
- [x] CHK021 - Does any requirement specify **how the skip reason survives the process boundary** so that a later, separate `codegraph status` invocation can report it (persisted in `.codegraph/` vs re-derived at status time)? A checksum-mismatch reason is not re-derivable without re-downloading, so FR-020's "report the reason" had an unspecified mechanism. (closed by FR-020 rewrite — "best-effort where determinable at status time... MAY be surfaced generically if not persisted") [Coverage — Spec §FR-020, §US3-AS3]
- [x] CHK022 - Under shared-cache concurrency the edge case asserts the outcome ("without corrupting it") but no requirement specified the concurrency-safe acquisition mechanism (per-process unique temp file and/or a lock) that guarantees two simultaneous first-run downloads don't clobber a shared temp. (closed by FR-017a rewrite — exclusive-create, non-symlink-following, unpredictable temp-file names) [Coverage/Edge — Spec §Edge Cases "Shared cache under concurrency" vs data-model.md §3 (temp file uniqueness unstated)]
- [x] CHK024 - Is a download **resource/time bound** required (max expected bytes / download timeout) so a hung or endless/oversized response stream from an untrusted host degrades (freeze-avoidance, parallel to the session-create timeout) rather than filling the disk or hanging before the checksum is ever evaluated? (closed by FR-013a) [Edge — Spec §FR-013/§FR-015 (checksum is post-download only); overlaps the Phase-4 security surface]
- [x] CHK025 - Is the local provider's `embed()` failure required to be advisory (caught by the pass → `{aborted, abortReason}`, structural index/sync completes regardless)? [Coverage, contracts/local-provider.md §Lifecycle, Spec §FR-007, §FR-019]

## Dependencies, Assumptions & Traceability

- [x] CHK026 - Is the reused SPEC-001 posture ("provider failure stops the embed pass, not the index") named as an assumption the degradation requirements depend on? [Assumption, Spec §Assumptions]
- [x] CHK027 - Is the checksum (SHA-256 pinned in source) documented as the trust anchor whose failure drives the reject-and-degrade path (host untrusted)? [Traceability/Assumption, Spec §FR-013, §Assumptions]

## Notes

- PASS (`[x]`) vs GAP (unchecked, Gap-tagged) counts and per-gap proposed remediations are
  reported to the parent for serial application to spec.md/plan.md (this executor writes only
  this file under the parallel-batch constraint).
- Several gaps overlap the Phase-4 `security` checklist surface (redaction CHK008, never-persist
  CHK011, download bound CHK024) and are routed to consensus with a `[security]` tag; they are
  raised here for their **error-handling / degrade-not-freeze** angle, not to duplicate the
  security pass.

## Gap remediation notes (proposed spec/plan edits — for the parent to apply serially)

- **CHK006** → spec.md, add **FR-019b** under "Offline & failure resilience" + an Edge Case:
  "Local inference session initialization MUST be time-bounded: `InferenceSession.create()`
  can hang indefinitely on a missing/corrupt runtime `.wasm`, so session init MUST be wrapped
  in a timeout; on timeout the run degrades exactly like the offline case (structural index
  completes, embed pass skipped, actionable message, `codegraph status` reports the reason)."
  Add Edge Case "Runtime unavailable / session-init hang". Cross-reference research.md OQ-1.
- **CHK007** → spec.md FR-019 (and FR-007): add "the index command exits **0** on a degraded
  run — a skipped embed pass is not a failure; a non-zero exit is reserved for a failed
  structural index." (Confirm intended exit semantics.)
- **CHK008** → spec.md, add a redaction FR (e.g., **FR-019c**): "Actionable/abort messages MUST
  NOT echo source text or composed embedding input." Fix contracts/local-provider.md to
  reference the new SPEC-002 FR instead of the previously-dangling reference.
- **CHK010** → spec.md FR-020: specify that status surfaces the **distinct** reason
  (offline / checksum / unwritable-cache / misconfig / session-init), aligning with the three
  distinct messages in contracts/model-fetch.md.
- **CHK011** → spec.md FR-014: strengthen to "MUST NOT be used for embedding **and MUST NOT be
  persisted to the verified cache path** (discarded before promotion)."
- **CHK012** → spec.md, give the `cache` unwritable/invalid failure a first-class message-content
  clause (name the resolved dir + `CODEGRAPH_MODEL_CACHE_DIR`) parallel to FR-019/FR-019a, and
  state which reason a mid-download I/O failure (disk-full/permission race) maps to.
- **CHK021** → spec.md FR-020: specify the mechanism by which the skip reason is available to a
  later `codegraph status` process (persisted vs re-derived), noting checksum-mismatch is not
  re-derivable without re-download.
- **CHK022** → spec.md Edge Case "Shared cache under concurrency" (or FR-018): require a
  concurrency-safe acquisition mechanism (unique per-process temp file and/or lock) — state the
  mechanism, not just the no-corruption outcome.
- **CHK024** → spec.md FR-013/FR-015: require a download size/time bound (fail-fast when the
  stream exceeds the pinned artifact size or a timeout) so an untrusted host cannot freeze or
  disk-fill before the checksum runs. Coordinate with the `security` checklist.
