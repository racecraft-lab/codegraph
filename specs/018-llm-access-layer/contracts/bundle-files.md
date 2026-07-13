# Contract: task-bundle directory files

**Surface**: harness/adapter (`src/llm/agent-bundle.ts`, `src/llm/ingest.ts`). **Slice**: 2.
Location: `.codegraph/tasks/<id>/`, `id = crypto.randomUUID()`. Self-describing (Q10): a coding agent
completes the bundle using only these files (FR-022). No SQLite (FR-023).

## Files (emit-time)

| File | Writer | Shape |
|---|---|---|
| `instructions.md` | emitter | prose task instructions |
| `graph-context.json` | emitter | the consumer-supplied opaque items, verbatim |
| `output-contract.json` | emitter | `OutputContract` (below) |
| `manifest.json` | emitter | `{ id, status:'pending', contract:'output-contract.json', createdAt }` — `status` ∈ `{pending, completed}` only (CRL 1) |

## Files (agent + ingest)

| File | Writer | Shape |
|---|---|---|
| `output.json` | the coding agent | its answer; **untrusted input** to ingest (FR-029a) |
| `result.json` | ingest (on success) | the validated canonical result stored inside the dir (FR-028) |

## `OutputContract` (FR-027 — structural, machine-checkable only)

```ts
interface OutputContract {
  requiredFields: Array<{ name: string; type: 'string' | 'string[]'; nonEmpty?: boolean }>;
}
```

Ingest checks each `requiredField` is present, matches `type`, and is non-empty when `nonEmpty` —
deterministic, never a semantic/quality judgment. First-consumer shape:
`{ requiredFields: [{ name:'prose', type:'string', nonEmpty:true }] }`.

## FR-029a hardening (every bundle-file read, by ingest AND redeem)

`readBundleFileSafely(root, bundleDir, relPath)` enforces, before the read/parse completes:

1. **Containment** — `validatePathWithinRoot(bundleDir, relPath)` (reused, not reimplemented); reject
   any path resolving outside the bundle dir, including via symlink realpath escape.
2. **Symlink rejection** — `fs.lstatSync`; reject if the path is a symlink.
3. **Size bound** — `fs.statSync`; reject if size > `MAX_BUNDLE_INPUT_BYTES` (1 MiB) before reading.
4. **Depth bound** — bounded-depth JSON parse; reject if nesting depth > `MAX_JSON_DEPTH` (32).
5. **Read-expected-fields-only** — consume by reading only the contract's declared fields; never
   deep-merge/`Object.assign` the parsed object (prototype-pollution safe).

Every rejection is **FR-028a-shaped**: manifest stays `pending`, reason → stderr, no consumer
artifact, never `isError`. Same-user threat model; residual same-process TOCTOU accepted (research D9).

## Identity / concurrency

`crypto.randomUUID()` id; exclusive `mkdir` (EEXIST → regenerate) — `jobs.ts` precedent. Concurrent
`generate()` calls never collide (FR-024); no cross-call dedup (FR-024a) — a repeat call for a
logically-identical task emits a new bundle with a fresh handle.
