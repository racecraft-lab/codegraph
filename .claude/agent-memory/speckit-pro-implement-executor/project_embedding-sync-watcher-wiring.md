---
name: embedding-sync-watcher-wiring
description: SPEC-001 T026/T027 — the embed pass wired into sync(); FR-018 heal semantics, the FR-015 watcher/daemon coverage-via-shared-sync argument, and the deterministic watcher test seam
metadata:
  type: project
---

SPEC-001 Slice B (T026 wiring / T027 coverage-proof) wired the [[embedding-pass]]
(now unified full+incremental — [[embedding-incremental-freshness]]) into
`CodeGraph.sync()` (src/index.ts), reusing the SAME private
`maybeRunEmbeddingPass(onProgress)` [[embedding-indexall-wiring]] built for indexAll.

**Why:** T028/T029 (backfill/resume) and SPEC-002/003 reuse the sync path; the
semantics below are non-obvious and would otherwise be re-litigated.

**How to apply — decisions that will bite a future edit:**
- **Placement + gate:** the embed call is the LAST step in `sync()`'s try, AFTER
  the `vocabWasEmpty` heal, in its own `try/catch { /* advisory */ }`. It is
  **UNCONDITIONAL** — NOT gated on `filesAdded/Modified/Removed`. That is the
  FR-018 heal: a zero-change `codegraph sync` still runs the pass and backfills
  missing vectors. The "gate" is structural — reaching the slot == sync succeeded
  (lock-acquire failure returns the zero-shape early at the top; `orchestrator.sync`
  throwing propagates through `finally`). No `success`/`nodes>0` guard needed —
  `maybeRunEmbeddingPass` self-gates (dormant when unconfigured; selects nothing on
  an empty graph). Mirrors the vocab heal, which also runs independent of changes.
- **The watcher + daemon needed ZERO new code (FR-015).** Both call this same
  `sync()` (watcher: `CodeGraph.watch`'s FileWatcher callback → `this.sync()`;
  daemon liveness-watchdog likewise), so they inherit the pass. T027 asserts
  **src/mcp/ and src/sync/ are untouched by the diff** — that IS the coverage
  argument. Total impl for both tasks = a 14-line additive block in src/index.ts.
- **Deterministic watcher test (no real OS events):** the repo has a synthetic seam
  — `cg.watch({ debounceMs, inertForTests: true })` + `await cg.waitUntilWatcherReady()`
  + `__emitWatchEventForTests(projectRoot, relPath)` (from `../src/sync/watcher`) +
  `await waitFor(() => cg.getPendingFiles().length === 0)`. `flush()` drains
  pendingFiles ONLY after `await syncFn()` (→ sync → embed) resolves, so empty-pending
  is a rock-solid "sync+embed finished" signal. `CodeGraph` uses `path.resolve`
  (NOT realpath), so a `fs.mkdtempSync` dir === `cg.projectRoot` === the seam's map
  key (`liveWatchersForTests`, set under `IS_TEST_RUNTIME`) — pass the raw dir.
- **sync change-detection differs from indexAll.** `orchestrator.sync` (src/extraction/
  index.ts ~1938) uses a `(size, mtime)` pre-filter THEN content-hash; indexAll is
  pure content-hash. Test edits made AFTER a full reindex advance mtime by tens of ms,
  so char-level (size-stable) edits are still detected on the sync path.
- **Harness reuse (embeddings-sync.test.ts):** T026/T027 tests are NESTED describes
  INSIDE the T024 parent describe (closures give them every helper; parent
  beforeEach/afterEach apply) — NOT duplicated, NOT hoisted to file scope. A
  `syncOnce(dir)` driver = open→sync→close (swap `reindex`'s indexAll for sync).
- **Redaction test technique (T027):** the API key rides ONLY the `authorization:
  Bearer` header, so assert it appears in NO recorded request body AND NO log line.
  `plaintextRemoteWarning` is loopback-EXEMPT (127.0.0.1 → null), so a happy
  loopback-mock path logs NOTHING — the request-BODY assertion carries the
  non-vacuous weight; install a recording logger over the suite's silent one.
</content>
