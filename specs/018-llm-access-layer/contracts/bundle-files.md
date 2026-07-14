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
| `README.md` | emitter | fixed, deterministic bundle-local completion protocol (FR-022): read `instructions.md`, honor `output-contract.json`, write the answer as `output.json`, then `codegraph tasks ingest <id>` — so the bundle is completable with no external companion skill |
| `manifest.json` | emitter | `{ id, status:'pending', contract:'output-contract.json', createdAt }` — `status` ∈ `{pending, completed}` only (CRL 1) |

Emit is **atomic** (FR-024): all files are staged in a sibling `.tmp-<id>/` (outside the enumerated
bundle namespace) and `rename`d onto `<id>/` in one step; any mid-emit error removes the staging dir,
so a partial bundle is never visible under a bundle id.

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

**Anchor containment (before any bundle-file read)** — the bundle-selecting id/handle is untrusted where
it is input (`tasks ingest <id>`, `redeemHandle(handle)`): validate it as a **single path segment**
resolving via `validatePathWithinRoot(<.codegraph/tasks root>, id)` to a **direct child** of
`.codegraph/tasks/`. Reject any id/handle carrying a path separator or resolving outside the tasks root
**before** `bundleDir` is trusted as the anchor below — a crafted id (e.g. `../../src`) must not relocate
the anchor. The rejection **disposition is entry-point-specific** (spec FR-029a / FR-010a, CRL 8): at
`tasks ingest <id>` it is FR-028a-shaped (manifest untouched, reason → stderr, no consumer artifact); at
`redeemHandle` — which returns only its closed `RedeemResult` (no stderr/manifest channel) — it resolves
to `{status:'missing'}` with no read (see `generate-seam.md`). Emit-side ids (`crypto.randomUUID()`) are
inherently single-segment.

`readBundleFileSafely(root, bundleDir, relPath)` then enforces, before the read/parse completes — and is
the reader for EVERY named path, including `manifest.json`'s `contract` pointer (so a tampered
`contract` value cannot escape the bundle dir):

1. **Containment** — `validatePathWithinRoot(bundleDir, relPath)` (reused, not reimplemented); reject
   any path resolving outside the bundle dir, including via symlink realpath escape. This is the ONLY
   path-based operation.
2. **Single-descriptor bind** — `fs.openSync(addressed, O_RDONLY | O_NOFOLLOW)`; symlink rejection is
   `ELOOP` on the open (O_NOFOLLOW is a no-op on Windows, where the realpath containment above still
   rejects an escaping symlink). The type/size check and the read then use that SAME descriptor, never
   the path again — closing the read-side check-then-use file-system race (CodeQL js/file-system-race):
   no path-based stat can be followed by a path-based read of a swapped inode.
3. **Type + size bound** — `fs.fstatSync(fd)`; reject a non-regular file, or size >
   `MAX_BUNDLE_INPUT_BYTES` (1 MiB), before reading the content from the same fd.
4. **Depth bound** — bounded-depth JSON parse; reject if nesting depth > `MAX_JSON_DEPTH` (32).
5. **Read-expected-fields-only** — consume by reading only the contract's declared fields; never
   deep-merge/`Object.assign` the parsed object (prototype-pollution safe).

At the **ingest** entry point every rejection is **FR-028a-shaped**: manifest stays `pending`, reason →
stderr, no consumer artifact, never `isError`. At the **redeem** entry point the same safe-read failures
map into FR-010a's closed `RedeemResult` instead — a present-but-unreadable manifest → `{status:'pending'}`
(CRL 7), an anchor-containment failure → `{status:'missing'}` (CRL 8) — since `redeemHandle` has no
stderr/manifest channel. Same-user threat model; the read binds validation + read to one descriptor
(step 2 above), so residual same-process TOCTOU is confined to the write path (research D9).

## Identity / concurrency

`crypto.randomUUID()` id; exclusive `mkdir` (EEXIST → regenerate) — `jobs.ts` precedent. Concurrent
`generate()` calls never collide (FR-024); no cross-call dedup (FR-024a) — a repeat call for a
logically-identical task emits a new bundle with a fresh handle.
