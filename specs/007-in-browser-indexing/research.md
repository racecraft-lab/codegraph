# Research: In-Browser Indexing

**Date**: 2026-07-28

## Decision 1: Use Official SQLite-Wasm With OPFS SAH-Pool

**Decision**: Add exact dependency `@sqlite.org/sqlite-wasm@3.53.0-build1` and use SQLite-Wasm from a dedicated module worker. Persist browser-local graph databases through the `opfs-sahpool` VFS, installed with a CodeGraph-owned VFS name and OPFS directory. Database filenames must be absolute within that VFS, for example `/repos/<repository-id>/generations/<generation>/graph.db`.

**Rationale**: The official SQLite WASM documentation identifies `opfs-sahpool` as the OPFS VFS for clients that value performance or cannot rely on COOP/COEP headers. It is supported by major browsers through OPFS worker APIs and avoids the SharedArrayBuffer requirement of the original OPFS VFS. The npm package is the official browser-side SQLite WASM package and is current as `3.53.0-build1`.

**Alternatives Considered**:

- `opfs`: Rejected because it needs COOP/COEP for SharedArrayBuffer.
- IndexedDB object stores: Rejected because it would fork CodeGraph query/schema behavior.
- WASMFS: Rejected because SQLite documents it as a custom/unsupported route with weaker concurrency behavior.
- Node SQLite in browser: Rejected because `node:sqlite` is not available in web bundles.

**Sources**:

- https://sqlite.org/wasm/doc/trunk/persistence.md
- https://sqlite.org/wasm/doc/tip/npm.md
- https://www.npmjs.com/package/@sqlite.org/sqlite-wasm

## Decision 2: Serialize Writes With Web Locks And One Worker-Owned Database Connection

**Decision**: Use an origin-scoped Web Lock for each active repository indexing operation and keep all SQLite writes inside the dedicated worker. The browser database should not open multiple simultaneous writer connections for the same repository/generation. If the lock or SAH-pool install fails because another tab owns the repository, report a recoverable `repository_busy` state.

**Rationale**: SQLite documents SAH-pool as high performance but not suitable for multiple simultaneous connections to the same pool directory. Web Locks provide a browser-native same-origin lock primitive that is available in workers and releases when the callback completes.

**Alternatives Considered**:

- Multiple tabs writing concurrently: Rejected because it risks database corruption or stale generation publication.
- BroadcastChannel-only coordination: Rejected because it is advisory and does not provide lock ownership.
- WAL for concurrency: Rejected for the baseline because SQLite notes no practical concurrency benefit for these OPFS modes, and WAL under OPFS has additional locking constraints.

**Sources**:

- https://sqlite.org/wasm/doc/trunk/persistence.md
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API

## Decision 3: Deliver Workers And WASM Through Vite Static Asset Semantics

**Decision**: Create the local indexing worker with `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`. Resolve SQLite, tree-sitter core, and grammar WASM assets through Vite-supported URL imports or direct `new URL(..., import.meta.url)` references, then configure `Parser.init({ locateFile })` and `Language.load(...)` with those URLs.

**Rationale**: Vite 8 documents `new Worker(new URL(..., import.meta.url))` for module workers and static URL imports for assets. web-tree-sitter browser usage requires serving `tree-sitter.wasm` and loading grammar WASM files from reachable URLs.

**Alternatives Considered**:

- CDN-hosted WASM: Rejected because offline/local-first package behavior must work and no network is allowed by default.
- Runtime string-built asset paths: Rejected because Vite cannot reliably include assets whose paths are not statically discoverable.
- Inlining all WASM: Rejected until measured because grammar assets can be large and cacheable as separate packaged assets.

**Sources**:

- https://vite.dev/guide/features.html
- https://tree-sitter.github.io/tree-sitter/using-parsers/6-web-tree-sitter.html

## Decision 4: Keep One Canonical SQLite Schema With Shared Migrations

**Decision**: Add browser source-cache tables and any required metadata columns through `src/db/schema.sql` and `src/db/migrations.ts`. Browser code must run the same migration sequence before opening a local graph. Browser-only registry data that does not belong to graph query semantics may live outside the graph database, but queryable graph/source facts use the canonical schema.

**Rationale**: CodeGraph already treats schema and migrations as the source of truth for deterministic graph storage. The browser feature must not create a parallel database contract or silently diverge from Node graph behavior.

**Alternatives Considered**:

- Browser-only SQL schema: Rejected because it would split query behavior and migration maintenance.
- Storing source cache only in IndexedDB: Rejected because source/source-pane reads need transactionally consistent generation data.
- Reusing existing `files` rows for source text without cache metadata: Rejected because refresh, delete, manifest validation, and rollback need stable content hashes and generation ownership.

**Sources**:

- Current `src/db/schema.sql`
- Current `src/db/migrations.ts`

## Decision 5: Introduce A Runtime-Neutral Extraction Kernel

**Decision**: Extract the per-source parsing/materialization path into a browser-safe kernel that accepts explicit file descriptors, UTF-8 text, grammar loaders, config, and write adapters. Keep Node filesystem traversal, gitignore discovery, and child-process/git behavior in the existing Node orchestrator.

**Rationale**: The current extractor imports Node modules and filesystem helpers that cannot enter the browser bundle. A narrow kernel preserves deterministic parser behavior while allowing separate Node and browser source providers.

**Alternatives Considered**:

- Bundling the current extractor into the web app: Rejected because Node imports would fail and filesystem behavior would be incorrect.
- Copying parser logic into web-only files: Rejected because graph extraction semantics would drift.
- Moving all extraction into the worker without a shared seam: Rejected because Node behavior would become harder to preserve and test.

**Sources**:

- Current `src/extraction/index.ts`
- Current `src/extraction/grammars.ts`
- Current `src/project-config.ts`

## Decision 6: Match Source Selection Semantics Within Browser Limits

**Decision**: Browser indexing applies CodeGraph config include/exclude/extensions rules, built-in ignore defaults, strict UTF-8 `.gitignore` parsing where files are visible, binary/NUL detection, unsupported-language warnings, and the 1 MiB file cap. It does not promise git-index semantics where the browser cannot access `.git` state safely.

**Rationale**: File System Access and dropped directory entries expose user-granted files, not a full POSIX filesystem or git plumbing. The browser path can preserve CodeGraph filtering rules while transparently labeling unsupported git-only behavior.

**Alternatives Considered**:

- Ignoring `.gitignore`: Rejected because it would index too much and diverge from user expectations.
- Trying to interpret `.git` internals in the browser: Rejected as fragile and outside the accepted scope.
- Prompting repeatedly for hidden directories: Rejected because permission prompts must be user-initiated and minimal.

**Sources**:

- Current `src/extraction/index.ts`
- Current `src/project-config.ts`
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle

## Decision 7: Use Capability-Gated Browser Flows

**Decision**: Treat full folder-open/reconnect indexing as Chromium-first. Detect `showDirectoryPicker`, persistent `FileSystemDirectoryHandle` support, OPFS, StorageManager APIs, Web Locks, module workers, WASM capability, and CSP restrictions before enabling controls. Firefox/WebKit receive snapshot/import or unsupported-state flows depending on live capability results.

**Rationale**: MDN marks File System Access picker/drop APIs as limited availability and permission-gated. OPFS and StorageManager APIs have different worker/window availability. Capability detection must drive UI, tests, and support messaging.

**Alternatives Considered**:

- Browser sniffing: Rejected because capability support changes and policies can differ by context.
- Hiding unsupported features without explanation: Rejected because users need actionable local-state information.
- Auto-requesting permissions on load: Rejected because permission prompts require user activation and would violate the spec.

**Sources**:

- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle
- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission
- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
- https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist

## Decision 8: Keep Semantic Search Dormant Until Explicit Direct-Endpoint Consent

**Decision**: Browser semantic search remains disabled until the user explicitly configures a direct HTTPS endpoint and model profile. Store only a secret-free profile and vector state. Keep API keys in memory only. Reject endpoint URLs with userinfo, query strings, fragments, insecure schemes from secure contexts, or paths that would require a proxy. Classify browser-hidden CORS/TLS/mixed-content failures as stable network-policy errors.

**Rationale**: The constitution requires privacy to be dormant by default. Browser Fetch and CSP rules constrain direct endpoints, and secure contexts block mixed active content. A local proxy or insecure workaround would change the privacy model.

**Alternatives Considered**:

- Default cloud embeddings: Rejected because it would make network calls without opt-in.
- Persisting API keys in IndexedDB or OPFS: Rejected because stored browser data can outlive the session and violates the design concept.
- `no-cors` fetch mode: Rejected because it produces opaque responses and is not usable for embedding API results.

**Sources**:

- https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src
- https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP

## Decision 9: Verify With Self-Repo Scale, Package Assets, And No-Network Audits

**Decision**: Use the current self-repo baseline from SPEC-007 as the primary scale fixture and verify browser indexing with Playwright. The verification matrix must include packaged web assets, Chromium full flow, Firefox/WebKit degradation, performance timing, main-thread heartbeat, cancellation, refresh, delete, and no-default-network behavior.

**Rationale**: This feature is user-facing retrieval infrastructure. Passing unit tests without proving packaged WASM assets and local browser behavior would miss the highest-risk failures.

**Alternatives Considered**:

- Unit tests only: Rejected because worker/WASM/OPFS/File System Access behavior is integration-heavy.
- Dev-server-only testing: Rejected because npm package users must receive working packaged assets.
- Toy fixtures only: Rejected because the self-repo scale is part of the acceptance boundary.

**Sources**:

- Current `package.json`
- Current `web/package.json`
- Current `scripts/copy-web-assets.mjs`
- `docs/ai/specs/intelligence-platform-technical-roadmap.md`
