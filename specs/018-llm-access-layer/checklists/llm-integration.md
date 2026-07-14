# LLM Integration Checklist: LLM Access Layer

**Purpose**: Validate the quality, clarity, and completeness of the LLM-integration requirements (OpenAI-compatible chat-completions contract, prompt composition + token-budget guard, and the agent task-bundle path) before implementation.
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)
**Domain**: llm-integration | **Depth**: Standard | **Audience**: Reviewer (PR)

<!--
  Unit tests for the REQUIREMENTS, not the implementation. Each item asks whether a
  requirement is well-written (complete / clear / consistent / measurable / covered).
  A bracketed gap marker flags an item where the requirement is genuinely missing or under-specified.
-->

## OpenAI-compatible chat-completions contract — request/response shape

- [ ] CHK001 Are the chat-completions request-body fields fully specified (model, composed messages, per-call stream flag, internal-constant max_tokens, temperature omitted)? [Completeness, Spec §FR-015]
- [ ] CHK002 Is per-call selection between streaming and non-streaming completion specified? [Completeness, Spec §FR-016]
- [ ] CHK003 Is the non-streaming response-extraction point specified (which field of the response carries the completion text)? [Completeness, Contract endpoint-wire.md §Response]
- [ ] CHK004 Is the streaming response-assembly rule specified (concatenate incremental deltas; terminate on the sentinel line)? [Completeness, Contract endpoint-wire.md §Response]
- [x] CHK005 Is the requirement specified for a streaming response that closes cleanly (end-of-stream) WITHOUT a terminal `[DONE]` sentinel — return the assembled text or error? [Resolved, Spec §FR-016a; Edge Case "Streaming terminates without `[DONE]`"] — client returns deltas assembled so far; a missing sentinel at a clean close is not an error; FR-017 idle deadline governs only sustained silence.
- [ ] CHK006 Is the authorization header requirement specified (Bearer key sent only when a key is configured)? [Completeness, Contract endpoint-wire.md §Request]
- [x] CHK007 Is behavior specified for a successful endpoint response whose completion content is empty or whitespace-only — return it as endpoint output or degrade to the consumer fallback? [Resolved, Spec §FR-009a; Edge Case "Empty successful completion"] — empty/whitespace completion is treated as a failed generation and degrades to the consumer fallback (mirrors the embeddings empty-response validation), preserving SC-001.

## Vendor-neutrality & requirement clarity

- [x] CHK008 Does the spec require, as a testable requirement (not only a contract note), that the client depend ONLY on OpenAI-standard chat-completions fields and no provider-proprietary request parameter or response field? [Resolved, Spec §FR-015a] — vendor-neutrality is now a testable FR: depend only on `model`/`messages`/`stream`/`max_tokens` and `choices[].message.content` / `choices[].delta.content`; no vendor extension is a dependency (llama.cpp/vLLM/Ollama interchangeable).
- [ ] CHK009 Is the max_tokens value unambiguously specified as an internal constant bounding worst-case output (not a user-facing knob)? [Clarity, Spec §FR-015, §FR-007]
- [ ] CHK010 Is "temperature is left to the endpoint default" unambiguous (temperature omitted from the request body)? [Clarity, Spec §FR-015]
- [ ] CHK011 Is "OpenAI-compatible" defined as the chat-completions wire shape rather than a specific vendor's product? [Clarity, Spec §FR-015; Contract endpoint-wire.md]
- [ ] CHK012 Are the streaming requirements consistent with the seam's single-result guarantee (streaming is internal transport; one final Generation Result; no partial/onChunk channel)? [Consistency, Spec §FR-016a]

## Model / env configuration precedence (Q3)

- [ ] CHK013 Is the four-state configuration resolution (endpoint / agent / misconfiguration / dormant) completely specified? [Completeness, Spec §FR-001]
- [ ] CHK014 Are the environment variable names and the activation variables (URL + MODEL) explicitly documented? [Completeness, Spec §Assumptions; Contract llm-config-resolution.md]
- [ ] CHK015 Is the provider precedence unambiguous (explicit CODEGRAPH_LLM_PROVIDER vs. auto-activate on URL+MODEL, and how API-key-only resolves)? [Clarity, Contract llm-config-resolution.md §Resolution table]
- [ ] CHK016 Is a partial endpoint configuration required to surface as a status-visible misconfiguration with no endpoint call attempted? [Completeness, Spec §FR-002]
- [ ] CHK017 Is an unrecognized CODEGRAPH_LLM_PROVIDER value's handling specified (named misconfiguration with allowed values, not a crash or silent downgrade)? [Coverage, Contract llm-config-resolution.md]

## Prompt-template composition & token-budget guard (Q6)

- [ ] CHK018 Is the prompt-composition priority order specified (instructions > output contract > graph context)? [Completeness, Plan §prompt.ts; Research D5]
- [x] CHK019 Does FR-018 specify that ONLY the graph-context tier is trimmed and that task instructions and the output contract are never truncated? [Resolved, Spec §FR-018] — FR-018 now pins the composition priority (instructions > output contract > graph context) and states only the graph-context tier is trimmed; instructions and the output contract are never truncated.
- [ ] CHK020 Is the truncation determinism requirement objectively verifiable (identical input yields identical trimmed output)? [Measurability, Spec §FR-018, §SC-003]
- [ ] CHK021 Is the explicit truncation marker required whenever trimming occurs? [Completeness, Spec §FR-018; Plan marker `[context truncated: N of M]`]
- [ ] CHK022 Is the token-estimation approach specified (characters-per-token heuristic, no external tokenizer)? [Clarity, Spec §FR-018, §Assumptions]
- [ ] CHK023 Is the token-budget magnitude anchored with rationale rather than left arbitrary (conservative constant sized to the ~4,096-token operative window, ~2,000-token graph-context portion)? [Clarity, Spec §Assumptions; Research D5; CRL 3]
- [ ] CHK024 Is the no-auto-chunk / no-map-reduce boundary stated consistently (deterministic trimming is the only oversize handling)? [Consistency, Spec §FR-019]

## Task-bundle path as an LLM integration (Q10 self-describing bar)

- [ ] CHK025 Are the required bundle contents enumerated (task instructions, graph-context JSON, expected-output contract, manifest)? [Completeness, Spec §FR-021]
- [ ] CHK026 Is the self-describing bar stated (a coding agent can complete the bundle using only the directory contents, no external state)? [Completeness, Spec §FR-022]
- [ ] CHK027 Is the expected-output contract specified as a structural, machine-checkable descriptor (not a semantic/quality judgment)? [Completeness, Spec §FR-027; Research D10]
- [ ] CHK028 Is it consistent that the graph context is embedded verbatim as consumer-supplied opaque items (the layer never invokes the graph/context capability)? [Consistency, Spec §FR-021, §Key Entities, §Dependencies]
- [ ] CHK029 Is the companion skill's terminal step specified (instruct the agent to run `codegraph tasks ingest <id>`)? [Completeness, Spec §FR-025]
- [ ] CHK030 Is the manifest status enum pinned to exactly {pending, completed}? [Clarity, Spec §Key Entities; CRL 1]

## Notes

- Check items off as resolved: `[x]`; cite the resolving requirement inline.
- Gap-marked items denote a genuinely missing or under-specified requirement to be closed in spec.md/plan.md, then re-verified.

## Verification (Loop 1)

- Initial pass: 30 items, 4 gap-marked (CHK005, CHK007, CHK008, CHK019).
- Remediation added FR-009a (empty completion → fallback), FR-015a (vendor-neutral OpenAI-standard fields), extended FR-016a (stream returns assembled text on `[DONE]` or clean EOF), and extended FR-018 (only the graph-context tier is trimmed; instructions + output contract never truncated), plus two Edge Cases; plan.md client.ts/prompt.ts bullets aligned.
- Re-assessment against the updated spec: all 4 items resolved; no new requirement gap, ambiguity, or inconsistency introduced (deterministic marker count = 0 across spec.md, plan.md, and this checklist).
