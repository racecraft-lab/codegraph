# Security Checklist: LLM Access Layer

**Purpose**: Validate the quality, clarity, and completeness of the security requirements — API-key hygiene (memory-only, never persisted/logged/echoed) and redaction-safe error reporting, the plaintext-remote transport warning, ingest's untrusted-agent-output hardening (path containment, symlink/size/depth ceilings, prototype-pollution defense, no path traversal via bundle ids or manifest fields), the "no secret leaks into bundle files or prompts" guarantee, and the Q11 boundary that no bundle field steers a file write — before implementation.
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)
**Domain**: security | **Depth**: Standard | **Audience**: Reviewer (PR)

<!--
  Unit tests for the REQUIREMENTS, not the implementation. Each item asks whether a
  security requirement is well-written (complete / clear / consistent / measurable /
  covered) for the feature's threat surface. A trailing gap tag marks an item where the
  requirement is genuinely missing or under-specified and must be closed in
  spec.md/plan.md (or a cited contract), then re-verified. Ratified security posture
  (FR-005 key hygiene, FR-029a CRL-1 hardening) may be strengthened/clarified directly;
  any fix that CHANGES or EXTENDS that posture is also escalated to consensus [security].
-->

## API key hygiene — memory-only, never persisted / logged / echoed (FR-005)

- [ ] CHK001 Is the API-key-in-memory-only requirement specified for EVERY resolution state (endpoint / agent / misconfiguration / dormant), never persisted to disk, written to logs, echoed to output, or copied into a bundle file — not only the endpoint state? [Completeness, Spec §FR-005; Edge Case "API key present but mode is dormant or agent"; Contract llm-config-resolution.md §API key]
- [ ] CHK002 Is it specified that `CODEGRAPH_LLM_API_KEY` is NOT an activation variable (API-key-only resolves to dormant), so a stray key can never trigger a network call or a bundle write on its own? [Coverage, Contract llm-config-resolution.md §API key; Spec §FR-004]
- [ ] CHK003 Is the key's presence in a request required to be confined to the `Authorization: Bearer` header and never placed in the request body / `messages`, consistent with the enumerated minimal body? [Consistency, Spec §FR-015; Contract endpoint-wire.md §Request]
- [ ] CHK004 Is "the API key never appears in status output, logs, or any emitted bundle file" stated as an objectively measurable success criterion? [Measurability, Spec §SC-004]

## Redaction-safe errors & endpoint reporting (FR-005 / FR-006 — the embeddings redactEndpoint bar)

- [ ] CHK005 Is the endpoint-URL redaction bar specified as scheme + host + port only (userinfo / path / query stripped), matching the cited embeddings `redactEndpoint` precedent? [Clarity, Spec §FR-006; Contract llm-config-resolution.md §Redaction, endpoint-wire.md §Redaction]
- [ ] CHK006 Is the redaction-safe error contract fully enumerated (endpoint reduced to scheme+host+port, status a bare integer, no response-body text surfaced, raw transport error not chained as `cause`)? [Completeness, Spec §FR-005; Contract endpoint-wire.md §Redaction]
- [ ] CHK007 Is it required that only one error type leaves the module (a single redaction-safe `LlmEndpointError`), so no raw fetch/URL error escapes carrying the endpoint or key? [Consistency, Contract endpoint-wire.md §Redaction; Research D4]
- [ ] CHK008 Is the unparseable-endpoint-URL case specified to render a safe placeholder rather than the raw URL (so credentials embedded in userinfo/query cannot leak through the redaction path)? [Edge Case, Contract llm-config-resolution.md §Redaction]
- [x] CHK009 Is it specified that the `Authorization: Bearer` key is transmitted only to the configured endpoint host and is NOT forwarded across a cross-origin redirect to a different host (a key-exfiltration vector under a hostile or compromised endpoint)? [Resolved, Spec §FR-005; Contract endpoint-wire.md §Request] — FR-005 now requires the key to be transmitted only to the configured endpoint and never forwarded on a cross-origin redirect (the `Authorization` header is dropped cross-origin per the WHATWG Fetch standard, which the platform HTTP client honors; a POSIX test asserts a cross-origin redirect target receives no key). **Escalated to consensus [security]** — a new key-hygiene assertion extending FR-005.

## Plaintext-remote transport warning (FR-006)

- [ ] CHK010 Is the plaintext-remote condition precisely defined (http scheme to a non-loopback host warrants the advisory; https and loopback-http do not)? [Clarity, Spec §FR-006; Contract llm-config-resolution.md §Redaction; Edge Case "Plaintext remote endpoint"]
- [ ] CHK011 Is the loopback definition anchored to the shared `isLoopbackHost` primitive (localhost / 127.0.0.0/8 / ::1) rather than re-defined ad hoc? [Consistency, Research D2; Contract llm-config-resolution.md §Redaction]
- [ ] CHK012 Is the warning required to be advisory-only (never blocks activation) and to embed the REDACTED endpoint, never the raw URL? [Consistency, Spec §FR-006; Contract llm-config-resolution.md §Redaction]
- [ ] CHK013 Is it specified that the plaintext advisory appears IN status output (the deliberate divergence from the embeddings pass-time-only warning), carried as a redaction-safe string? [Completeness, Spec §FR-006; Research D12]

## Ingest of untrusted agent output — threat model & path containment (FR-029a, CRL 1)

- [ ] CHK014 Is the untrusted-input threat model explicitly stated (same-user, no-privilege-boundary; the agent's output treated as untrusted) and traceable to the ratified maintainer-approved consensus? [Traceability, Spec §FR-029a; CRL 1]
- [ ] CHK015 Are ALL five hardening checks enumerated and ordered (realpath containment, symlink rejection, size ceiling, JSON nesting-depth ceiling, read-expected-fields-only / no-deep-merge)? [Completeness, Spec §FR-029a; Contract bundle-files.md §FR-029a hardening]
- [ ] CHK016 Is containment required to REUSE the existing `validatePathWithinRoot` check rather than reimplement it? [Clarity, Spec §FR-029a; Research D9]
- [ ] CHK017 Is the containment scoped to BOTH reads and writes ("every path Ingest reads or writes MUST resolve … within the bundle directory")? [Completeness, Spec §FR-029a]
- [ ] CHK018 Are the size and nesting-depth ceilings quantified (`MAX_BUNDLE_INPUT_BYTES` = 1 MiB; `MAX_JSON_DEPTH` = 32) rather than left arbitrary? [Clarity, Plan §Constants; Research D9]
- [ ] CHK019 Is the check timing specified (size checked before the read completes; depth before the parse begins — a bounded-depth parse, never unbounded `JSON.parse` on attacker-controlled input)? [Clarity, Spec §FR-029a; Contract bundle-files.md §FR-029a hardening]
- [ ] CHK020 Is prototype-pollution defense specified (consume only the contract's declared fields; never deep-merge / `Object.assign` attacker JSON, so `__proto__`/`constructor`/`prototype` keys cannot pollute)? [Coverage, Spec §FR-029a; Research D9]
- [ ] CHK021 Is the same bounded safe-read hardening required for the redemption lookup (`redeemHandle`), not only ingest? [Consistency, Spec §FR-010a; Contract bundle-files.md §FR-029a hardening]
- [x] CHK022 Is the CLI `tasks ingest <id>` argument AND the redemption handle required to be validated as a contained single path-segment (resolving directly under `.codegraph/tasks/`) BEFORE the bundle directory is trusted as the containment anchor — so a crafted id/handle (e.g. `../../`) cannot relocate the anchor and defeat the per-file containment? [Resolved, Spec §FR-029a, §FR-026, §FR-010a; Contracts bundle-files.md, tasks-cli.md, generate-seam.md] — FR-029a now requires the `tasks ingest <id>` argument and the redemption handle to be validated as a single contained segment resolving to a direct child of `.codegraph/tasks/` (via `validatePathWithinRoot` anchored at the tasks root, rejecting any separator-bearing or escaping id FR-028a-shaped) BEFORE the bundle dir is used as the per-path containment anchor; the three contracts mirror it. **Escalated to consensus [security]** — extends the maintainer-approved CRL-1 hardening surface.
- [x] CHK023 Does FR-029a's untrusted-path enumeration explicitly include a path that a bundle file NAMES beyond "the contract or output" — specifically `manifest.json`'s `contract` pointer — so a tampered manifest cannot steer a read outside the bundle directory? [Resolved, Spec §FR-029a; Contract bundle-files.md] — FR-029a's untrusted-path enumeration now explicitly covers any path ANY bundle file names, including `manifest.json`'s `contract` pointer; bundle-files.md pins that `readBundleFileSafely` is the reader for that pointer, so a tampered `contract` value cannot escape the bundle dir. **Escalated to consensus [security]** — extends the CRL-1 enumeration.

## Ingest writes only inside the bundle directory; no install actions (Q11 / FR-027–FR-029)

- [ ] CHK024 Is structural-only validation specified as the sole finalize gate (required fields present, correct types, non-empty where required; deterministic; never a semantic/quality judgment)? [Completeness, Spec §FR-027; Research D10]
- [ ] CHK025 Is "ingest writes only inside the bundle directory, never a consumer artifact" stated and objectively measurable across EVERY ingest outcome (success or rejection)? [Measurability, Spec §FR-029, §SC-006]
- [ ] CHK026 Is it consistent across the requirements that NO `manifest.json` or `output-contract.json` field is interpreted as a write destination or install target (Q11 forbids contract-driven writes to consumer artifacts — verify no requirement reintroduces them)? [Consistency, Spec §FR-027, §FR-028, §FR-029; CRL 1 / Design Q11]
- [ ] CHK027 Is the output-contract schema closed to structural descriptors only (`requiredFields`: name / type / nonEmpty) with no path / destination / action field that could steer a write? [Coverage, Contract bundle-files.md §OutputContract; Research D10]
- [ ] CHK028 Is every FR-029a rejection required to be FR-028a-shaped (manifest stays `pending`, reason to stderr, no consumer artifact, never `isError`)? [Consistency, Spec §FR-029a, §FR-028a]

## No secret leakage into bundle files or prompts (FR-005 generalization)

- [ ] CHK029 Is it specified that bundle files (instructions / graph-context / output-contract / manifest) and the composed prompt are built ONLY from the ProseTask's own fields plus non-secret layer metadata (id / status / contract / createdAt) — with no resolved-config or `process.env` value serialized into any bundle file or prompt? [Completeness, Spec §FR-005, §Key Entities; Contract bundle-files.md]
- [ ] CHK030 Is the graph context required to be embedded verbatim as consumer-supplied opaque items (the layer never invokes the graph/context capability), so the layer injects no repo/env content the consumer did not itself supply? [Consistency, Spec §FR-021, §Dependencies, §Key Entities]
- [ ] CHK031 Is the manifest schema closed and enumerated (`{ id, status, contract, createdAt }`) so it structurally cannot carry a secret or a write-steering field? [Coverage, Spec §Key Entities; Research D8]

## Dormancy & misconfiguration as security properties

- [ ] CHK032 Is byte-identical dormancy (zero outbound requests, zero filesystem writes) specified and measurable across any number of seam calls, so an unconfigured install performs no network I/O or disk writes? [Measurability, Spec §FR-004, §SC-002]
- [ ] CHK033 Is a partial or invalid configuration required to be behaviorally dormant (zero network, zero filesystem writes), so a crafted half-config cannot trigger a wrong-mode call or an unexpected write? [Consistency, Spec §FR-002, §SC-004]

## Endpoint response trust boundary

- [x] CHK034 Is the total size of an endpoint response (a non-streaming body or an assembled stream) bounded, or is unbounded-response memory exhaustion from a hostile/compromised endpoint explicitly accepted as residual under the user-configured-endpoint trust model — as the FR-029a ingest-size ceiling is stated for untrusted bundle input? [Resolved, Spec §Assumptions; Contract endpoint-wire.md §Deadlines] — a new Assumption + endpoint-wire note document the posture: the response is bounded by the FR-017 deadlines and `max_tokens` but its total size is not separately capped (matching the embeddings client's unbounded body read), an accepted residual under the user-configured-endpoint trust model. **Escalated to consensus [security]** — whether to add a hard size ceiling is a posture change for the human gate.

## Notes

- Check items off as resolved: `[x]`; cite the resolving requirement inline.
- Gap-marked items denote a genuinely missing or under-specified requirement to be closed in spec.md/plan.md (or the cited contract), then re-verified.
- Security-domain rule: a fix that merely STATES already-ratified posture (FR-005, FR-029a) is applied directly; a fix that CHANGES or EXTENDS a security posture is applied AND escalated to consensus [security] for the human gate.

## Verification (Loop 1)

- Initial pass: 34 items, 4 gap-marked (CHK009, CHK022, CHK023, CHK034); deterministic `count-markers gaps` = 4 in the checklist (spec 0, plan 0).
- Grounding: verbatim in-repo precedents (`redactEndpoint`, `validatePathWithinRoot`, `isLoopbackHost`, `EmbeddingEndpointError`, `EndpointProvider.attemptBatch`) via codegraph_explore; domain source for the cross-origin `Authorization`-stripping behavior (WHATWG Fetch PR #1544 / Node undici) via web research; project context (constitution VII, CRL 1 / design Q11, embeddings posture).
- Remediation (spec.md + contracts): FR-005 extended with the cross-origin-redirect key clause (CHK009); FR-029a extended with untrusted-id/handle **anchor containment** under `.codegraph/tasks/` (CHK022) and a broadened untrusted-path enumeration covering any path a bundle file names incl. `manifest.json`'s `contract` pointer (CHK023); a new Assumption documents the endpoint-response-size accepted residual (CHK034). Contracts synced: endpoint-wire.md §Request + §Deadlines, bundle-files.md §FR-029a hardening, tasks-cli.md §ingest, generate-seam.md §Redemption.
- Re-assessment against the updated artifacts: all 4 items resolved; deterministic `count-markers gaps` = 0 across spec.md, plan.md, and all checklists.
- **All 4 resolved items are ESCALATED to consensus [security]** — each either extends the maintainer-approved CRL-1 hardening surface (CHK022/CHK023), adds a new key-hygiene assertion to FR-005 (CHK009), or defers a posture change (CHK034). Per the security-domain rule they route to all 3 analysts and the human gate; the marker is closed (artifact text is defensible now) but the extension awaits ratification.
