# Contract: the `generate()` library seam

**Surface**: API (re-exported through `src/index.ts`). **Slice**: 1 (endpoint + dormant + fallback);
slice 2 flips the agent branch to emit + return a handle.

## Signature

```ts
function generate(
  root: string,               // project root; used only in agent mode to place .codegraph/tasks/<id>/
  task: ProseTask,            // data-model §1
  overrides?: GenerateOverrides, // test-only: { env?, client?: LlmEndpointClientOverrides }
): Promise<GenerationResult>; // data-model §6
```

`generate` is a free function. `env` defaults to `process.env`; tests pass a controlled env for
hermetic dormancy/mode assertions.

## Guarantees

| Given | generate returns | Requirements |
|---|---|---|
| dormant (no `CODEGRAPH_LLM_*`) or misconfig | `{ source:'fallback', text: task.fallback }`; **zero** network calls; **zero** filesystem writes | FR-004, FR-011, SC-002 |
| endpoint configured, call succeeds | `{ source:'endpoint', text }` | FR-009 |
| endpoint configured, call fails after retries + timeout | `{ source:'fallback', text: task.fallback }` — never throws | FR-009, US1 AS-2 |
| agent mode (slice 2) | `{ source:'pending-bundle', text: task.fallback, handle }` + a `pending` bundle emitted | FR-010 |
| agent mode, bundle emission fails (slice 2) | `{ source:'fallback', text: task.fallback }` — failure surfaced via status, not thrown | Edge Case; US1 |
| agent mode (slice 1, pre-emitter) | `{ source:'fallback', text: task.fallback }` (documented slice-1 limitation) | US1 |
| any mode | result's `source` lets the caller distinguish endpoint / fallback / pending-bundle | FR-012 |

**Invariants**: never throws for absent/partial config (FR-008); never writes LLM text into graph
structure (FR-014); over-budget context is trimmed deterministically with the marker before any
request (FR-018) — see `endpoint-wire.md`; holds no cross-call state (FR-024a).

## Redemption (FR-010a)

```ts
function redeemHandle(root: string, handle: string): RedeemResult; // data-model §7
```

The handle is first validated as a single contained segment resolving to a direct child of
`.codegraph/tasks/` (FR-029a anchor containment) before the bundle dir is opened; a handle carrying a
path separator or escaping the tasks root resolves as `{status:'missing'}` (no valid contained bundle),
without any read — never throws. Otherwise reads only the handle's own bundle dir:
`{status:'completed', text}` once the manifest is `completed`, `{status:'pending'}` while pending,
`{status:'missing'}` if the dir is gone. No new persistence. A present-but-unreadable manifest (fails the
D9 bounded safe-read) surfaces `{status:'pending'}` — never throws, never a false `completed` (FR-010a).
