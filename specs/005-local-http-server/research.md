# Phase 0 Research: Local HTTP Server & REST API

All "how" decisions were fixed upstream by the design concept
(`docs/ai/specs/.process/SPEC-005-design-concept.md`, Q1–Q13) and the binding
SPEC-004 handoff (`docs/design/web-framework-decision.md`). This document (a)
records those decisions with their Q-number rationale, and (b) resolves the
**three plan-time decisions the Clarify phase explicitly delegated to plan** —
FR-012, FR-021a, FR-023/024 — each grounded in the current source.

There are **no open `NEEDS CLARIFICATION` items**; the spec carries zero markers.

---

## Part A — Delegated plan-time decisions (grounded in source)

### D1. FR-012 — the shared loopback predicate

**Decision**: Extract the existing `isLoopbackHost` predicate
(`src/embeddings/config.ts:201–207`) verbatim into the neutral shared util
**`src/utils.ts`**, exported. `src/embeddings/config.ts` deletes its private copy
and imports the shared one; `src/server/auth.ts` imports the **same** shared one.
The server never imports from `src/embeddings/`.

**Rationale**:
- The predicate already implements exactly FR-012's loopback set —
  `localhost`, `::1`, and `127.0.0.0/8` (with IPv6-bracket stripping), and
  returns `false` for the wildcards `0.0.0.0` / `::` (FR-012: wildcards are NOT
  loopback). It is a drop-in for the server's no-auth gate. Verbatim source:

  ```ts
  // src/embeddings/config.ts:201–207 (to move to src/utils.ts)
  function isLoopbackHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h === '::1') return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
  }
  ```
- `src/utils.ts` already exists as the repo's neutral catch-all util (22 KB) — no
  new module, smallest diff (Constitution III). It is the location the workflow
  prompt offered first.
- One definition, two security gates (embeddings plaintext-remote gate + the
  server bind/Host gate) — FR-012's stated intent ("evaluated by one shared
  loopback predicate").

**Alternatives considered**:
- New dedicated `src/net/loopback.ts`: crisper home, but adds a module/dir for a
  7-line function — heavier than reusing the existing neutral util. Rejected on
  Principle II / minimal-diff.
- Server imports `isLoopbackHost` from `src/embeddings/`: **explicitly forbidden**
  by the workflow prompt (couples the server to the embeddings module). Rejected.

**Downstream**: `src/server/auth.ts` composes the predicate into (1) the
fail-closed **bind** gate (FR-013 — non-loopback host + no `CODEGRAPH_SERVER_TOKEN`
→ refuse startup) and (2) the **Host-header allowlist** (FR-012 — `localhost`,
`127.0.0.1`, `[::1]`, and the bound host, each with the bound port; a
non-allowlisted `Host` → 400 `invalid_request`, DNS-rebinding defense).

---

### D2. FR-021a — restoring the daemon watcher after a long lock-holding job

**Problem (codebase-verified)**: The daemon owns the `FileWatcher` (daemon →
`MCPEngine` → `CodeGraph.watch()`, `src/index.ts:1488`). A re-index job runs in
the **serve process** (a separate daemon *client*, FR-002) and holds the
cross-process file lock for the whole `?full=true` rebuild. The daemon's watcher,
unable to acquire that lock, retries `MAX_LOCK_RETRIES = 5` times
(`src/sync/watcher.ts:48`) then calls `degrade()` (`:622`), which sets a
**one-way `degradedReason` latch** and `stop()`s the OS watches. The latch is
"cleared only by a fresh `start()`" (`:273`) — so a full rebuild silently kills
auto-sync for **every MCP session sharing that daemon** until the daemon
restarts.

**Decision**: The re-index job's completion/abort (`finally`) path — after it
releases the index lock — sends a **narrow daemon control message** over the
per-repo daemon socket the serve process already holds as a client. The daemon
maps it to a new, additive `MCPEngine.rearmWatcher()` that, **only when
`cg.isDegraded()`**, calls `CodeGraph.unwatch()` then `CodeGraph.watch()` to
install a fresh `FileWatcher` (clearing the latch). Idempotent and a no-op on a
healthy watcher.

**Why this is the right mechanism (grounded)**:
- `CodeGraph.watch()` (`src/index.ts:1488`) assigns `this.watcher = new
  FileWatcher(...)` on every call — a fresh watcher with a cleared latch — and
  `unwatch()` (`:1522`) stops the old one. So `unwatch()+watch()` is the exact,
  already-existing primitive that "a fresh `start()`" requires. `CodeGraph.isDegraded()`
  (`:1545`) already exposes the state to gate on.
- `MCPEngine.startWatching()` (`src/mcp/engine.ts:231`) guards on
  `this.watcherStarted`, which stays `true` after a degrade — so simply re-calling
  it is a **no-op**. The re-arm therefore needs a distinct additive method
  (`rearmWatcher`) rather than reusing `startWatching`. This is one small additive
  engine method + a one-line daemon request-handler case.
- **Literal FR compliance**: FR-021a says "the job's completion or abort path MUST
  ensure the watcher's sync capability is restored." An active control message
  from the job's `finally` path satisfies this verbatim (the job restores it),
  vs. a passive self-heal that would not.
- **Fork discipline (Constitution III)**: leaves the delicate, heavily-issue-
  tracked `src/sync/watcher.ts` **untouched**. The change is confined to the new
  `src/server/jobs.ts` + one additive `src/mcp/engine.ts` method + a daemon
  handler case.
- **FR-021 compliance**: this is a **control** op (re-arm the watcher), not an
  **indexing** RPC — the daemon still never indexes; its no-indexing invariant
  holds. (Q7's "zero new daemon protocol" was specifically about *progress
  streaming*, which genuinely adds none — progress is in-process in the serve
  process. A one-message watcher-rearm control op is the minimal, justified
  exception, documented here.)

**Alternatives considered**:
- **Make the watcher's lock-contention degrade recoverable** (self-heal via a new
  re-arm probe timer inside `watcher.ts`): would auto-restore, but (1) rewrites
  the degrade semantics of an upstream-owned, delicate core file (broad blast
  radius — it also changes behavior for CLI `codegraph index/sync` external
  writers, out of SPEC-005's remit), and (2) is *passive*, not the "job's
  completion/abort path" the FR names. Rejected on fork discipline + FR wording.
- **Daemon restart after the job**: forbidden — the serve process "MUST NOT stop
  or kill a daemon" (FR-026), and it would drop the warm index other sessions use.
  Rejected.
- **A new indexing RPC in the daemon**: violates FR-021 / Q7 (daemon no-indexing
  invariant). Rejected.

**Concurrency note**: the re-arm is triggered on **every** job terminal path
(done / error / `lock_unavailable` / aborted), gated by `isDegraded()` so it is a
cheap no-op when the watcher never degraded (the common short-sync case). On
shutdown-abort (FR-023/FR-026), the abort path releases the lock in its cleanup,
then the same re-arm fires before the client socket closes.

---

### D3. FR-023 / FR-024 — the terminal `result` union (per mode)

**Problem**: the library's two re-index operations return **different** shapes
(`src/extraction/index.ts`), and FR-023 requires the terminal `result` be
"documented per mode."

```ts
// src/extraction/index.ts:107–115
interface SyncResult {   // incremental sync (mode: "sync")
  filesChecked; filesAdded; filesModified; filesRemoved;
  nodesUpdated; durationMs; changedFilePaths?;
}
// src/extraction/index.ts:85–102
interface IndexResult {  // full rebuild (mode: "full")
  success; filesIndexed; filesSkipped; filesErrored;
  filesDiscovered?; nodesCreated; edgesCreated;
  errors: ExtractionError[]; durationMs;
}
```

**Decision**: The job's terminal `result` is a **discriminated union keyed on the
job's `mode`** field (already in the job descriptor `{ id, repo, mode, status,
startedAt }`), documented in `openapi.yaml` and `data-model.md`:

- `mode: "sync"` → `result: { filesChecked, filesAdded, filesModified,
  filesRemoved, nodesUpdated, durationMs }`.
- `mode: "full"` → `result: { success, filesIndexed, filesSkipped, filesErrored,
  filesDiscovered?, nodesCreated, edgesCreated, durationMs }`.

**FR-015a whitelist applied** (never leak raw exception text / absolute paths):
- Drop `SyncResult.changedFilePaths` from the API result — a raw path array that
  can leak absolute/host paths. Counts (`filesAdded/Modified/Removed`) already
  convey the outcome; SPEC-006 can add a paths endpoint later if it needs one.
- Drop `IndexResult.errors: ExtractionError[]` — it carries messages/paths/stack-
  shaped data. The bounded `filesErrored` count is the API signal; a **partial**
  index is signaled by `success: false` and/or `filesDiscovered >
  filesIndexed + filesSkipped + filesErrored` (the shortfall the field documents).

**Rationale**: one documented schema per mode, discriminated by a field the client
already has; every exposed field is a whitelisted scalar (FR-015a); the contract
test (FR-025) pins both shapes. The `mode` discriminator keeps the client's
correlation unambiguous (one active job per repo, FR-022).

---

## Part B — Design-concept decisions carried into the plan (Q1–Q13)

| # | Decision | Rationale (Q-ref) |
|---|----------|-------------------|
| Q1 | Serve process is a **daemon client**; no in-process index copy | Reuses the MCP proxy's attach-or-spawn; shares one warm index (FR-002). |
| Q2 | **Multi-repo via the daemon registry**, lazy attach | `/api/repos` from `src/mcp/daemon-registry.ts` (`listDaemons()`); non-default repos attach on first touch, not at startup (FR-009/010). |
| Q3 | Command is **`codegraph serve --web`** | Keeps one `serve` umbrella (`--mcp` hidden/agents, `--web` documented/humans); dormant by default (FR-001). |
| Q4 | **Zero-dep `node:http`** router + SSE + static | Community-direction + `toml.ts` precedent; `sirv` is the deferred escape hatch (FR-003). |
| Q5 | **Fail-closed** non-loopback bind + Bearer on `/api/*` | Alternative is an unauthenticated code index on the LAN (FR-013/014). |
| Q6 | `POST /api/reindex/:repo` = **sync default, `?full=true`** rebuild | UI-refresh default; full is the corrupt/partial recovery path (FR-020). |
| Q7 | Jobs run **in the serve process** via `sync()`/`indexAll()` | Existing cross-process file lock arbitrates vs the daemon watcher; daemon keeps no-indexing invariant (FR-021). |
| Q8 | **In-memory latest-job-per-repo**; one active job (409); SSE snapshot→progress→terminal, no Last-Event-ID | No history/persistence surface (FR-022/023/024). |
| Q9 | **No `/api/v1`**; version in `/api/status`; one error envelope | In-package client can't skew (FR-005/015/016). |
| Q10 | Hand-written `openapi.yaml` + **contract test** | Drift caught in CI; zero new deps (FR-025). |
| Q11 | **Placeholder page** + strict fallback; same-origin, no CORS | `/api/*` and asset-extension 404s never fall back; only extensionless routes hit the shell (FR-017/018/019). |
| Q12 | **Offset paging + hard caps** | `limit` 100/500, depth 1/3, node cap 2000 + `truncated` (FR-006/007). |
| Q13 | **2 vertical slices, one branch** | 620 LOC trips the greenfield warn line; split, don't oversize (Reviewability Budget). |

### Tech-choice best-practice notes (from the SPEC-004 research + Q4 deep-research)
- **`node:http` for a loopback CLI UI + small REST API** is the community norm for
  dependency-averse tools (Storybook migrated *off* Express to polka+sirv;
  Vite uses connect+sirv; SSE is trivial on bare `node:http`). Express-class
  frameworks are legacy weight here. `sirv` (native-http-compatible, 67 KB) is the
  one researched escape hatch, deferred until SPEC-006 proves a static-serving need.
- **Route fallback** (binding SPEC-004 handoff, "Shipping Strategy"): non-API
  browser routes may fall back to the app shell; `/api/*` and missing static
  assets **must not** be swallowed by the fallback — implemented as FR-018.
- **Static ownership**: SPEC-006 owns the durable `web/` source and its
  `copy-assets`/packaging wiring; SPEC-005 serves `dist/web/` only *when present*
  and ships only the placeholder + `openapi.yaml` (SPEC-004 "Deferred Concerns").

---

## Reference points (attach-or-spawn + registry, for daemon-client.ts)

- `src/mcp/proxy.ts` — attach-or-spawn reference: `runProxy()` (`:85`),
  `connectWithHello()` (`:133`), `runLocalHandshakeProxy()` (`:216`), the
  `DaemonHello` handshake, and `onDaemonLost` socket lifecycle.
- `src/mcp/daemon-registry.ts` — `/api/repos` source of truth: `listDaemons()`
  returns live `DaemonRecord{ root, pid, version, socketPath, startedAt }`; the
  16-hex id is `sha256(path.resolve(root)).slice(0,16)` (`recordPath`, `:45–48`)
  — **the same canonical form FR-010 keys on**, so API id == registry key by
  construction.
- `src/bin/codegraph.ts:1934` — the `serve` command (kept `hidden`); the `--web`
  option + action branch attach here with a `--web`/`--mcp` mutual-exclusion guard
  (FR-001). Keeping the command hidden preserves byte-identical `--help` (dormancy).
