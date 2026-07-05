# Error-Handling Checklist: Embedding Infrastructure & Endpoint Provider (SPEC-001)

**Purpose**: Validate the *quality* (completeness, clarity, consistency, measurability, coverage) of the **error-handling requirements** in `spec.md` + `plan.md` + `contracts/` — the advisory-pass failure isolation, bounded-retry/abort/resume, config-error actionability, dormancy, timeout/hang, and credential-safety-on-error contracts. This is "unit tests for the requirements," not the implementation.
**Created**: 2026-07-04
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md) · [contracts/](../contracts/)
**Domain focus**: advisory pass never fails/hangs index/sync · bounded-retry-then-advisory-abort · resume by re-selection · actionable config errors naming the exact env var · dormant-when-unconfigured · per-request `AbortSignal.timeout` and the endpoint-hangs-rather-than-errors path · API key never in any error message
**Status**: Loop 2 — all 9 gaps surfaced in Loop 1 remediated in spec.md/plan.md (see resolution tags). CHK012 (URL-without-MODEL surfacing location) and CHK022 (error-path redaction, security) applied but escalated for consensus.

## Advisory Pass Failure Isolation (never fail / never hang the enclosing op)

- [ ] CHK001 Is it required that **no** failure mode of the embed pass can fail the enclosing index/sync (advisory — "never fail an index over it")? [Completeness, Spec §FR-014]
- [x] CHK002 Is a hanging endpoint (one that accepts the connection but never responds) required to be bounded by a **per-request `AbortSignal.timeout`** so the pass cannot stall the index/sync indefinitely — and is that timeout named as a requirement, not only as an overridable default in Assumptions? [Resolved →§FR-019/§FR-019a: added FR-019a making the independent per-request timeout (`AbortSignal.timeout`, 30,000 ms default) a normative requirement, and FR-019 now names timeouts as an endpoint-failure that bounds a hang; Edge Cases + plan Constraints mirror it]
- [x] CHK003 Is the pure-hang case (endpoint accepts but never responds) covered by a requirement/edge case **distinct from an unreachable endpoint** (connection refused), so the timeout→failure path is independently identifiable and testable? [Resolved →§Edge Cases "Endpoint slow, timing out, or hanging": the hang case is now explicit and explicitly distinguished from the unreachable case (US3 AS2), with the per-request timeout as the bounding mechanism (FR-019a)]
- [ ] CHK004 Is a swallowed advisory-pass failure required to stay **observable** (e.g., status coverage < 100% after an aborted pass), so a silent success is still discoverable? [Coverage, Spec §FR-022/FR-014] (covered: FR-022 coverage is the observability surface — an aborted pass leaves coverage < 100%; the silence on the index/sync path is the intended advisory design, D13)

## Bounded Retry / Backoff / Abort / Resume

- [ ] CHK005 Is bounded-retry-then-**clean-abort** on endpoint failure specified, leaving already-written vectors in place so the enclosing operation still succeeds? [Completeness, Spec §FR-019]
- [ ] CHK006 Are the backoff parameters fully specified as **fixed constants** (base 1,000 ms, ×2 growth, full jitter, ~8 s per-delay cap, 3 retries/batch, honoring `Retry-After` on 429 capped ~30 s)? [Clarity, Spec §Assumptions, research §D5, contract embedding-config]
- [ ] CHK007 Is resume-by-**re-selection** of missing/stale rows (no separate checkpoint/journal) specified, so an aborted or process-killed pass completes on the next run with no manual step? [Completeness, Spec §FR-020, §Edge Cases "Process killed mid-pass"]
- [x] CHK008 Is the retryable-error set explicitly enumerated (5xx / 429 / timeout / network, plus 401/403 per contract) **and** is the handling of a **non-retryable** response (a 4xx other than 429 — e.g., 400/404/422 from a malformed request or a wrong endpoint path) specified — retry-then-abort vs. immediate advisory abort? [Resolved →§FR-019 + §Edge Cases "Non-retryable endpoint response": retryable set = 5xx/429/timeout/network (consume the budget); a terminal 4xx (400/404/422) aborts fast **without** exhausting retries, still advisory. Grounded in the standard client-vs-server split (OpenAI error-codes doc + rate-limit cookbook). 401/403 retry-vs-fast-abort flagged for consensus]
- [x] CHK009 Is the handling of a malformed or unparseable **success** response (HTTP 200 whose body is not valid JSON, or is truncated / missing the expected embeddings array) specified as an endpoint failure rather than a crash or a silent skip? [Resolved →§FR-021a: non-JSON/truncated/missing-embeddings body is treated as an endpoint failure (retried then advisorily aborted), never persisted; Edge Cases mirror it]
- [x] CHK010 Is the handling of a response whose embedding **count** does not match the batch input size specified (detected, treated as a failure, and never silently misaligning vectors to the wrong symbols)? [Resolved →§FR-021a: a count that does not match the batch input size fails the batch; "never silently misaligned to the wrong symbol nor stored with a wrong shape" is now a stated requirement]
- [ ] CHK011 Is it required that **already-written vectors are preserved** on abort (partial progress is not rolled back), so resume is incremental rather than restarting the whole pass? [Completeness, Spec §FR-019/FR-020]

## Config-Error Actionability

- [x] CHK012 Is the **URL-set-without-MODEL** case required to surface an **actionable config error that names the missing variable (`CODEGRAPH_EMBEDDING_MODEL`)**, with the feature staying off — rather than the silent dormancy the spec previously prescribed ("Status reflects dormant, not error")? [Resolved →§FR-001a + §SC-009 + §Edge Cases: added FR-001a (half-config → actionable error naming the missing var — `CODEGRAPH_EMBEDDING_MODEL` for URL-without-MODEL, `CODEGRAPH_EMBEDDING_URL` symmetrically — feature off, zero network/writes, index/sync still succeeds), SC-009, and refined FR-001/Edge Cases. NOTE: escalated to consensus — the surfacing location (status vs. index/sync advisory note) is deferred to planning]
- [x] CHK013 Is the **unconfigured** state (neither URL nor MODEL set) clearly distinguished from the **misconfigured** state (exactly one set), so the zero-behavior-change dormancy guarantee (FR-002/SC-002) is not conflated with the actionable-error half-config path? [Resolved →§FR-001/§FR-001a/§FR-002/§FR-022 + US1 AS2 + SC-002: neither-set = fully dormant/byte-identical; exactly-one-set = feature off + actionable error; AS2 and SC-002 re-scoped to the fully-unconfigured case so they no longer lump in half-config]
- [ ] CHK014 Is the dimension-drift error required to be **actionable and to name `CODEGRAPH_EMBEDDING_DIMS`**, treating the pass as failed advisorily while the enclosing operation still succeeds? [Completeness, Spec §FR-021]
- [ ] CHK015 Are the config-error paths (half-config, dims drift) consistently required to keep the enclosing index/sync **succeeding** (advisory) and to make **zero network requests / zero writes** while the feature is off? [Consistency, Spec §FR-001a/FR-002/FR-014/FR-021]
- [x] CHK016 Is the handling of a **malformed / unparseable `CODEGRAPH_EMBEDDING_URL`** specified — treated as a (redaction-safe) endpoint failure that never leaks the raw string, rather than an unhandled crash or a credential-leaking error? [Resolved →§FR-023: an unparseable URL renders as a safe non-credential placeholder (never the raw string) and is treated as an endpoint failure (advisory) rather than crashing the index]

## Dormancy & Zero-Behavior-Change on Error Paths

- [ ] CHK017 Is fully-unconfigured dormancy required to be **byte-identical to a build without the feature** — zero network, zero `node_vectors` writes, zero new log lines? [Completeness, Spec §FR-002/SC-002]
- [ ] CHK018 Is it required that the half-config / config-error path still performs **zero network requests and zero writes** (the feature stays off even while surfacing the actionable error)? [Coverage, Spec §FR-001a/FR-002] (now explicit in FR-001a: "makes zero embedding-endpoint network requests and zero `node_vectors` writes")

## Timeout / Hang (special attention)

- [ ] CHK019 Is the per-request timeout applied **independently per request** (default 30,000 ms, override `CODEGRAPH_EMBEDDING_TIMEOUT_MS`, positive-int validated + clamped), so a slow endpoint cannot accumulate unbounded wall-clock across a batch or pass? [Clarity, Spec §FR-019a, §Assumptions, contract embedding-config] (elevated to FR-019a during Loop-1 remediation of CHK002)
- [ ] CHK020 Is a timeout required to be treated as an **endpoint failure** that feeds the bounded-retry-then-advisory-abort path, consistent with the handling of 5xx / 429 / network errors? [Consistency, Spec §FR-019, §Edge Cases, contract embedding-provider error table]

## Security on Error Paths

- [ ] CHK021 Is it required that the API key **never appears in any error message** across all failure paths (auth failure, 5xx body echo, timeout, dimension conflict)? [Completeness, Spec §FR-023/SC-007]
- [x] CHK022 Is it required that error/log messages **derived from underlying transport failures** (fetch/network error objects, endpoint response bodies) are sanitized/re-rendered redacted (scheme+host+port), so a passed-through raw error carrying URL userinfo or the key cannot leak — not only the status output? [Resolved →§FR-023: redaction now MUST apply to error/log messages derived from transport failures on **any** failure path (timeout, network, 4xx/5xx, dims conflict, malformed response), re-rendered redacted rather than surfaced verbatim; plan Constraints mirror it. NOTE: escalated to consensus — security-keyword item (credential/key leakage)]

## Auth & Endpoint-Failure Semantics

- [ ] CHK023 Is a required-but-missing/wrong API key (HTTP 401/403) required to be handled as an **endpoint failure** (bounded retries → advisory abort), never a fatal index error? [Completeness, Spec §FR-003, contract embedding-provider]
- [ ] CHK024 Is the concurrent-pass **lock-loss** error handling specified (fail-fast no-op leaving `node_vectors` untouched; the next attempt re-converges via backfill/resume), so a losing acquisition never corrupts, double-writes, or hangs? [Consistency, Spec §FR-015a]

## Scenario Coverage (error / recovery classes)

- [ ] CHK025 Are both the **exception-flow** requirement (endpoint down mid-pass → advisory abort, enclosing op succeeds) and the **recovery-flow** requirement (resume to 100% after the endpoint is restored) present and mutually consistent? [Coverage, Spec §US3 AS2/AS3, §FR-019/FR-020]

## Notes

- Marker legend: a "Gap" tag (used in Loop 1) marked an error-handling requirement that was missing, under-specified, or — for CHK012/CHK013 — **contradicted** in `spec.md`/`plan.md`/`contracts/`; items citing `[Spec §…]`/`[contract …]`/`[research §…]` reference an existing, adequately-specified requirement whose quality this item audits. A `[Resolved →§…]` tag with a checked box marks a Loop-1 gap now closed by a spec/plan edit.
- Loop-1 gaps (9): CHK002, CHK003, CHK008, CHK009, CHK010, CHK012, CHK013, CHK016, CHK022 — all remediated in spec.md (added FR-001a, FR-019a, FR-021a, SC-009; extended FR-019, FR-022, FR-023; refined FR-001, US1 AS2, SC-002, Edge Cases) and mirrored in plan.md Constraints. CHK012 and CHK022 are applied but escalated for consensus (URL-without-MODEL surfacing location; error-path credential redaction — security keyword).
- Grounding: the retryable/non-retryable HTTP split (CHK008) is grounded in the OpenAI Error Codes doc + rate-limit cookbook (429/5xx retryable; 400/401/403/404 non-retryable client errors). The advisory-swallow and success-shaped-guidance patterns follow existing precedents (`src/index.ts:443/513/636`; `NotIndexedError` in `src/mcp/tools.ts`). No URL-redaction helper exists in `src/` today, so FR-023's error-path redaction is net-new and must be specified rather than inherited.
- Overlap with `data-integrity.md` is deliberately avoided: this checklist audits the *failure/error* contracts (advisory isolation, retry/abort/resume, config errors, timeout/hang, credential-safety-on-error); the persistence/hashing/reconciliation integrity contracts live there.
- Downstream contract reconciliation (not spec.md/plan.md, deferred to planning): `contracts/embedding-config.md` ("Setting only one of URL/MODEL stays dormant") and `contracts/status-embedding-json.md` (all-inactive-states-neutral) predate FR-001a and will need to reflect the half-config actionable error once the surfacing location is chosen at consensus.
- Check items off as completed: `[x]`.
