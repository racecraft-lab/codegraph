---
name: embedding-indexall-wiring
description: SPEC-001 T019 — how the embed pass is wired into CodeGraph.indexAll (src/index.ts); dormancy contract + the non-obvious wiring decisions
metadata:
  type: project
---

`CodeGraph.indexAll` (src/index.ts) drives the [[embedding-pass]] via a private
`maybeRunEmbeddingPass(onProgress)` in the post-resolution advisory slot (T019).

**Why:** it is the caller-wiring the embed-pass seam was built for; several choices
are non-obvious and would otherwise be re-litigated by SPEC-002/003 or maintenance.

**How to apply — decisions that will bite a future edit:**
- **Placement + gate:** last step in `indexAll`'s try, gated `result.success &&
  result.filesIndexed > 0` (same gate as every other post-resolution step —
  resolution, maintenance, count recompute, version stamp) and the CALL is wrapped
  in its own `try/catch { /* advisory */ }` — belt-and-suspenders over the pass's
  own never-throw guarantee (FR-014/019).
- **Dormancy is byte-silent:** `loadEmbeddingConfig(process.env) === null` →
  return immediately, NO log line. Only the half-config (`'misconfigured' in
  config`) branch emits ONE `logWarn(...)` naming the missing variable. Idiom is
  `logWarn` from `./errors` (never `console.*`); index.ts had to add that import.
- **IndexResult was deliberately NOT extended** — no established pattern to carry
  embedding coverage on the result, so the pass result is awaited and discarded.
- **Seam construction:** `transaction`→`this.db.transaction`, `runMaintenance`→
  `this.db.runMaintenance`, `onProgress`→`{phase:'embedding',current:embedded,
  total:eligible}` (the `'embedding'` phase was already in `IndexProgress`).
  `refreshLock` recomputes the lock path (`getCodeGraphDir(root)+'codegraph.lock'`
  — FileLock keeps `lockPath` private) and `fs.utimesSync`es it, guarded; FileLock
  itself is untouched.
- **readSource** = a private `readNodeSource(node)` mirroring ContextBuilder's
  `extractNodeCode`: `validatePathWithinRoot(root, node.filePath)` (STRICT — this
  is the send-over-network path) + `readFileSync` + slice `startLine-1..endLine`,
  guarded → `undefined` on any failure (symlink-escape/missing/read error → symbol
  embeds from graph fields alone, never fails the pass).
- **Tests** (`__tests__/embeddings-index.test.ts`, T019 block): real temp project +
  `CodeGraph.init`/`indexAll` against a local `node:http` mock (same shape as
  embeddings-endpoint.test.ts). No backoff env exists (EndpointProvider overrides
  are constructor-only), so the endpoint-down case runs real production retry — keep
  its node count tiny + a ~20s test timeout.
