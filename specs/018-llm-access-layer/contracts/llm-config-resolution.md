# Contract: LLM configuration resolution

**Surface**: harness/adapter (`src/llm/config.ts`, `loadLlmConfig(env): LlmConfigResult`). **Slice**: 1.
Mirrors `loadEmbeddingConfig`. Activation vars: `CODEGRAPH_LLM_URL` + `CODEGRAPH_LLM_MODEL`.

## Resolution table

| `CODEGRAPH_LLM_PROVIDER` | URL | MODEL | Result | Req |
|---|---|---|---|---|
| `agent` | any | any | `{ mode:'agent' }` | FR-003 |
| `endpoint` | set | set | `{ mode:'endpoint', url, model, apiKey? }` | FR-001 |
| `endpoint` | unset | set | `LlmMisconfig{ missingVariable:'CODEGRAPH_LLM_URL' }` | FR-002 |
| `endpoint` | set | unset | `LlmMisconfig{ missingVariable:'CODEGRAPH_LLM_MODEL' }` | FR-002 |
| `endpoint` | unset | unset | `LlmMisconfig{ missingVariable:'CODEGRAPH_LLM_URL', missingVariables:[URL,MODEL] }` | FR-002 |
| unrecognized (e.g. `foo`) | any | any | `LlmMisconfig{ invalidValue:'foo', allowedValues:['endpoint','agent'] }` | FR-002 |
| unset | set | set | `{ mode:'endpoint', url, model, apiKey? }` (auto-activate) | FR-001 |
| unset | set | unset | `LlmMisconfig{ missingVariable:'CODEGRAPH_LLM_MODEL' }` | FR-002 |
| unset | unset | set | `LlmMisconfig{ missingVariable:'CODEGRAPH_LLM_URL' }` | FR-002 |
| unset | unset | unset | `null` (dormant) | FR-004 |

**API key**: `CODEGRAPH_LLM_API_KEY` is never an activation variable. Set-only (no URL/MODEL/provider)
→ `null` dormant. When present in endpoint mode, it is attached to the config **in memory only** and
omitted entirely when blank; never persisted/logged/echoed/copied into a bundle (FR-005). API-key-only
in dormant/agent mode is still fully protected (Edge Case).

## Redaction + plaintext-remote (FR-006; own copies, not imported — research D2)

- `redactEndpoint(url)` → scheme+host+port only; unparseable → a safe placeholder (never the raw URL).
- `isPlaintextRemoteEndpoint(url)` → true for `http:` to a non-loopback host (uses `isLoopbackHost`
  from `../utils`); `https` and loopback `http` → false.
- `plaintextRemoteWarning(url)` → an LLM-worded one-line advisory embedding `redactEndpoint(url)`, or
  `null` when not warranted. Advisory only — never blocks activation.

## Numeric clamps (FR-007)

No user-facing numeric env tunables exist (url/model/apiKey only). Retry/timeout/idle/token-budget/
max_tokens are internal constants (test-only overridable). The positive-int parse+clamp helper is the
pattern of record for any future knob; it has no call site in v1 (CRL 2 clamp-vacuity note).
