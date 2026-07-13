# Contract: `LLM:` status block + `llm` JSON

**Surface**: harness/adapter + CLI (`src/llm/config.ts` `resolveLlmStatus(env)`,
`CodeGraph.getLlmStatus()`, `src/bin/codegraph.ts`). **Slice**: 1 (endpoint/misconfig/dormant); slice
2 fills the agent-active branch. Network-free — computing status never opens a socket or writes a file
(SC-002/SC-004). Mirrors `getEmbeddingStatus` / `EmbeddingStatus`.

## Snapshot union (`LlmStatus`)

```ts
type LlmStatus =
  | { active: true;  mode: 'endpoint'; endpoint: string; model: string; plaintextWarning?: string }
  | { active: true;  mode: 'agent'; pendingBundles?: number }       // pendingBundles: slice 2
  | { active: false; activationVars: string[] }                     // dormant
  | { active: false; misconfigured: true; missingVariable: string;
      missingVariables?: string[]; invalidValue?: string; allowedValues?: string[] };
```

- `endpoint` = `redactEndpoint(url)` (scheme+host+port; FR-006). Raw URL never appears.
- `plaintextWarning` is present iff the endpoint is plaintext-remote — the cleartext advisory lives
  **in status** (FR-006's deliberate divergence from the embeddings pass-time-only warning), built
  from `plaintextRemoteWarning(url)` and redaction-safe.
- The API key never appears in any status field or in `--json` (FR-005 / SC-004).

## Human render (`codegraph status`)

An `LLM:` block **after** the `Embeddings:` block, without modifying the embeddings block:

- **endpoint active** → `Provider: endpoint`, `Endpoint: <redacted>`, `Model: <model>`; if
  `plaintextWarning`, a warn-styled advisory line.
- **agent active** → `Provider: agent` (slice 1: bare stub; slice 2: `+ N pending bundle(s)`).
- **misconfigured** → a warn-styled advisory naming the missing variable(s), or, for an unrecognized
  provider, `must be one of: endpoint, agent` (embeddings render precedent).
- **dormant** → neutral (never warn-styled — dormancy is not an error), or omitted, matching the
  embeddings dormant treatment.

## JSON render (`codegraph status --json`)

Add a top-level `llm: <LlmStatus>` field parallel to the existing `embedding` field; automated probes
read this machine shape. Derived from the same snapshot the human block renders (no second probe).
