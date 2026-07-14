# Phase 1 Data Model: LLM Access Layer

The layer introduces **no** persistent schema — `node:sqlite` and `src/db/schema.sql` are untouched
(FR-023 / Constitution V/VII). The only durable state is the filesystem: a `manifest.json` (and the
sibling bundle files) per bundle under `.codegraph/tasks/<id>/`. Everything else is an in-memory type
crossing the `generate()` seam or the CLI. Types below map spec §Key Entities → concrete shapes; all
field-level rules trace to a functional requirement.

## 1. Prose Task — the seam input (`src/llm/generate.ts`)

The single input to `generate()`. Consumer-owned; the layer embeds its parts verbatim and never
enriches them (Q2 / FR-013; `src/llm` never imports `src/context`).

```ts
interface ProseTask {
  /** Task instructions — highest composition priority (D5). */
  instructions: string;
  /** Consumer-supplied opaque graph-context items, embedded verbatim; lowest priority, the only
   *  tier the token guard trims (D5 / FR-018). */
  graphContext: string[];
  /** Machine-checkable expected-output contract carried into the bundle (D10 / FR-021, FR-027). */
  outputContract: OutputContract;
  /** Consumer's precomputed heuristic fallback STRING (Q2 + Session 3 / FR-008). Widening to a lazy
   *  producer later is SemVer-additive (Assumptions). */
  fallback: string;
}
```

**Rules**: `fallback` is always present and is what every non-endpoint-success path returns
(FR-009/010/011). `graphContext` items are opaque strings; the layer does not parse or dedup them.
`instructions` and `outputContract` are never trimmed (D5 priority order).

## 2. LLM Configuration — discriminated result (`src/llm/config.ts`)

Exactly one of four states (FR-001), mirroring `EmbeddingConfigResult`. `null` IS the dormancy signal.

```ts
type LlmConfigResult = LlmEndpointConfig | LlmAgentConfig | LlmMisconfig | null;

interface LlmEndpointConfig {
  mode: 'endpoint';
  url: string;                 // required to activate
  model: string;               // required to activate
  apiKey?: string;             // memory-only; omitted entirely when keyless (FR-005)
  // retry/timeout/idle/max_tokens are internal constants, NOT config fields (FR-007)
}

interface LlmAgentConfig {
  mode: 'agent';               // reached ONLY by explicit CODEGRAPH_LLM_PROVIDER=agent (FR-003)
}

interface LlmMisconfig {
  misconfigured: true;
  missingVariable: string;         // the single missing activation var
  missingVariables?: string[];     // populated only when BOTH URL and MODEL are missing under provider=endpoint
  invalidValue?: string;           // set only for an unrecognized CODEGRAPH_LLM_PROVIDER value
  allowedValues?: string[];        // ['endpoint','agent'] — accompanies invalidValue
}
// null → fully dormant (default; FR-004)
```

**Activation variables**: `CODEGRAPH_LLM_URL` + `CODEGRAPH_LLM_MODEL`. `CODEGRAPH_LLM_API_KEY` is not
an activation variable (API-key-only → dormant `null`; the key is memory-only in every state — FR-005).
**Valid providers**: `{ endpoint, agent }` (no `local`/`off`). **State transitions**: none — config is
resolved fresh from `env` per call; the layer holds no cross-call state (Edge Case "Repeat generation";
FR-024a).

## 3. Task Bundle — the agent-mode work package (`.codegraph/tasks/<id>/`)

A self-describing directory (Q10 / FR-021, FR-022). Created only in agent mode; never in dormant/
endpoint mode (FR-004). Files:

| File | Content | Requirement |
|---|---|---|
| `instructions.md` | task instructions (prose) | FR-021, FR-022 |
| `graph-context.json` | consumer-supplied opaque items, verbatim | FR-021, FR-022 |
| `output-contract.json` | the `OutputContract` (§5) | FR-021, FR-027 |
| `manifest.json` | the `BundleManifest` (§4) | FR-021, FR-023 |
| `output.json` *(agent-written)* | the agent's answer; untrusted input to ingest (FR-029a) | FR-027 |
| `result.json` *(ingest-written)* | the validated canonical result | FR-028 |

**Identity**: `id = crypto.randomUUID()`, dir created with exclusive `mkdir` (EEXIST → regenerate) —
`jobs.ts` precedent (D8). Concurrent generations never collide (FR-024); no cross-call dedup (FR-024a).

## 4. Bundle Manifest (`manifest.json`) — filesystem-only state (`src/llm/agent-bundle.ts`)

```ts
interface BundleManifest {
  id: string;                        // = the directory name / opaque handle
  status: 'pending' | 'completed';   // EXACTLY these two (CRL 1); no 'ingested'/'failed'/'error'
  contract: string;                  // relative ref to output-contract.json inside the dir
  createdAt: string;                 // ISO-8601, for `tasks list` age
}
```

**State machine** (the only transition):

```
pending ──(successful ingest: output validates against contract)──▶ completed
   ▲                                                                    │
   └───────────── rejected ingest leaves status UNCHANGED ──────────────┘
                  (FR-028a: reason→stderr, no failure state persisted, re-runnable)
```

`completed` is set **only** by a successful ingest (FR-028). A rejected ingest — contract violation
(FR-028a) or any FR-029a hardening rejection — leaves `pending`. No SQLite representation (FR-023).

## 5. Output Contract (`output-contract.json`) — structural, machine-checkable (D10 / FR-027)

```ts
interface OutputContract {
  requiredFields: Array<{
    name: string;
    type: 'string' | 'string[]';
    nonEmpty?: boolean;
  }>;
}
```

**Validation** (deterministic, structural-only — never semantic/quality): for the agent's parsed
`output.json`, each `requiredField` must be present, match `type`, and be non-empty when `nonEmpty`.
Any failure → reject (FR-028a). First-consumer shape: `{ requiredFields: [{ name:'prose',
type:'string', nonEmpty:true }] }`.

## 6. Generation Result — the seam output (`src/llm/generate.ts`)

Three-kind discriminated union; the caller can always tell which source produced the text (FR-012).
Defined in full in slice 1 (stable public type); the `pending-bundle` kind is produced only in slice 2.

```ts
type GenerationResult =
  | { source: 'endpoint'; text: string }                       // FR-009 success
  | { source: 'pending-bundle'; text: string; handle: string } // FR-010: fallback text now + redeemable handle
  | { source: 'fallback'; text: string };                      // FR-009 failure / FR-011 dormant / emit-failure
```

`handle` is the opaque bundle id, redeemable via `redeemHandle` (§7).

## 7. Redeem Result — FR-010a handle redemption (`src/llm/agent-bundle.ts`)

```ts
type RedeemResult =
  | { status: 'completed'; text: string }  // manifest completed → canonical result read from the bundle dir
  | { status: 'pending' }                  // manifest still pending
  | { status: 'missing' };                 // bundle dir gone (documented manual cleanup)
```

Reads only the handle's own bundle directory; no persistence beyond the manifest (FR-023); every path
opened is FR-029a-guarded (D9).

## 8. LLM Status — network-free observability snapshot (`src/llm/config.ts` → `CodeGraph.getLlmStatus()`)

Mirrors `EmbeddingStatus`; computing it never opens a socket or writes a file (SC-002/SC-004).

```ts
type LlmStatus = LlmStatusActive | LlmStatusAgent | LlmStatusDormant | LlmStatusMisconfigured;

interface LlmStatusActive {           // endpoint configured
  active: true;
  mode: 'endpoint';
  endpoint: string;                   // redactEndpoint(url) — scheme+host+port only (FR-006)
  model: string;
  plaintextWarning?: string;          // cleartext advisory IN status (FR-006 divergence); redaction-safe
}
interface LlmStatusAgent {            // CODEGRAPH_LLM_PROVIDER=agent
  active: true;
  mode: 'agent';
  pendingBundles?: number;            // slice 2 (count under .codegraph/tasks/); a bare stub in slice 1
}
interface LlmStatusDormant { active: false; activationVars: string[]; }  // ['CODEGRAPH_LLM_URL','CODEGRAPH_LLM_MODEL']
interface LlmStatusMisconfigured {
  active: false;
  misconfigured: true;
  missingVariable: string;
  missingVariables?: string[];
  invalidValue?: string;
  allowedValues?: string[];
}
```

## 9. Research Note — committed comparison + self-repo UAT record (`docs/design/llm-paths-note.md`)

Not a runtime type. A committed markdown document (D13 / FR-030) recording cost, quality, and latency
for the endpoint and agent-bundle paths on one wiki chapter + one PR narrative generated against this
repository; no cloud-endpoint arm; records which inputs were used; is the recorded self-repo UAT
outcome. Ships inside slice 2's PR.

## Entity → requirement traceability

| Entity | Primary requirements |
|---|---|
| Prose Task (§1) | FR-008, FR-013, FR-018 |
| LLM Configuration (§2) | FR-001, FR-002, FR-003, FR-004, FR-005, FR-007 |
| Task Bundle (§3) | FR-021, FR-022, FR-023, FR-024, FR-024a |
| Bundle Manifest (§4) | FR-023, FR-028, FR-028a |
| Output Contract (§5) | FR-027 |
| Generation Result (§6) | FR-009, FR-010, FR-011, FR-012 |
| Redeem Result (§7) | FR-010a, FR-029a |
| LLM Status (§8) | FR-006 |
| Research Note (§9) | FR-030, FR-031 |
