# Feature Specification: In-Browser Indexing

**Feature Branch**: `007-in-browser-indexing`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "SPEC-007 In-Browser Indexing: add browser-local repositories to the existing CodeGraph SPA so evaluation users can deliberately select or drop a local source folder, build a persistent origin-private graph in the browser, browse the core graph experience without installing CodeGraph, and optionally opt into secure semantic search without weakening deterministic, local-first behavior."

## Clarifications

### Session 2026-07-28 — Browser Capability and UX Contracts

- Q: Where does a user enter browser-local mode? → A: The existing repository/workspace shell exposes an explicit **Open local folder** action; runtime labels remain visible at trust-boundary and destructive-action surfaces.
- Q: What is available after reload before a saved folder is reconnected? → A: The last-good index and cached accepted source remain browseable; live-source refresh stays disabled until an explicit reconnect succeeds.
- Q: How is a directory-drop snapshot identified? → A: Each completed drop creates a distinct snapshot repository with an accepted-file manifest fingerprint for duplicate warnings; it never silently merges with a later picked folder.
- Q: What does a second tab see while another tab owns the repository? → A: A pre-storage busy state names the repository and offers **Retry** and **Switch repository** while local actions remain disabled.
- Q: How do disabled server-only routes and local deletion behave? → A: Core graph routes stay enabled through the local client, server-only surfaces show explanations, and delete requires repository-name confirmation while stating that source-folder files will not change.

### Session 2026-07-28 — Storage, Integrity, and Runtime Contracts

- Q: What durable identity does a browser repository use? → A: An origin-scoped opaque id is minted when a folder is accepted or a snapshot import succeeds; virtual display labels never expose host absolute paths, picked folders retain a reconnect handle reference, and snapshots retain a manifest fingerprint as metadata rather than identity.
- Q: What is the publication boundary for graph and source-cache data? → A: A repository generation becomes current only when its graph, accepted-source manifest, source cache, status, and last-success pointer form one complete publication; every incomplete generation leaves the prior complete generation visible.
- Q: How does browser storage reuse the canonical graph schema? → A: The browser database follows the same canonical graph schema and schema-version stream as Node, with source-cache additions flowing through shared migrations; separate browser registry state may version independently only while mapping to the canonical repository id and current generation.
- Q: What does manual incremental refresh publish? → A: It diffs accepted files by relative path and content hash, stages adds/changes/deletes, retains unchanged data, and publishes one complete generation; recoverable file errors become a bounded partial-warning report while fatal or cancelled operations publish nothing.
- Q: What contract crosses the worker boundary? → A: Versioned structured-clone-safe envelopes carry identifiers, progress, result or plain-object error, and exactly one terminal state; operation-scoped cancellation ignores stale messages as no-ops.

### Session 2026-07-28 — Embedding, Security, and Delivery

- Q: Which semantic settings may persist after reload while bearer keys stay memory-only? → A: Only a repository-scoped secret-free embedding profile, stored vectors, and resumable semantic metadata may persist; bearer keys and authorization material remain in current page or dedicated-worker memory only, and endpoint traffic after reload requires explicit key re-entry. This preserves the user-ratified Q14/Q15 decision and was confirmed by all three security consensus perspectives.
- Q: How are TLS, mixed-content, CORS, model, and availability failures classified? → A: Stable redacted codes preflight insecure and mixed-content cases, combine browser-unreadable fetch failures as CORS/TLS/network blocked, classify HTTP/model/dimension/partial/availability failures separately, and never offer a proxy, no-CORS mode, or insecure override.
- Q: What is the no-network-default audit boundary? → A: No-consent local operations may load only enumerated same-origin shipped assets; every repository-derived API, external-origin, WebSocket, beacon, or embedding request remains forbidden until explicit semantic consent.
- Q: What CSP/WASM contract must supported hosts satisfy? → A: CLI and trusted HTTPS hosts serve workers, SQLite, grammar WASM, and static assets from the SPA origin under a policy that permits required same-origin worker and WebAssembly execution; SAH-pool does not depend on COOP/COEP and CSP-blocked embeddings degrade without affecting keyword search.
- Q: How do asset paths and package-copy failures behave? → A: Required assets resolve through the web build base, ship in `dist/web` and the npm package, and are verified fail-closed; a runtime missing asset disables local indexing with a precise message and no CDN fallback.

### Session 2026-07-28 — Performance and Cross-Runtime Parity

- Q: What proves deterministic Node/browser parity and lazy grammar loading? → A: The same accepted fixture trees must produce matching accepted-file manifests, language maps, semantic symbol/edge projections, bounded warning codes, grammar-load manifests, and repeated-run counts; runtime-only ids, timestamps, row order, and registry metadata are excluded.
- Q: What must accompany the 60-second self-repository benchmark? → A: Evidence records the machine, operating mode, browser/toolchain/commit versions, accepted graph scale, cache/storage and embeddings state, timing markers, elapsed time, and run count.
- Q: How is the 150 ms p95 local-read target measured? → A: A deterministic search/graph/impact suite runs at least 20 measured user-observed samples per operation after one warmup, from request or action start through visible rendered result.
- Q: What proves the UI remains responsive while indexing? → A: Each major phase records a main-thread heartbeat gap, Chromium long-task evidence where supported, and Playwright proof that progress, cancel, and route chrome remain actionable.
- Q: What browser matrix closes graceful degradation? → A: Chromium verifies the full path; Firefox and WebKit/Safari independently probe folder, snapshot, storage, lock, worker, and database capabilities and assert precise guidance without promising picker/reconnect parity.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a Local Folder (Priority: P1)

As an evaluator using current desktop Chromium, I can deliberately choose a local source folder from the existing SPA and watch clear progress until a persistent, keyword-searchable browser-local repository is ready.

**Why this priority**: This is the minimum zero-install evaluation path and the first trust-boundary moment for local source access.

**Independent Test**: Can be fully tested by loading the SPA, activating "Open local folder", choosing a representative repository, and confirming that indexing completes without a server dependency.

**Acceptance Scenarios**:

1. **Given** the SPA is loaded in a browser that supports folder picking, **When** the user activates the local-folder action and selects a source directory, **Then** indexing starts only after that user action and shows repository identity, progress, cancellation, and completion status.
2. **Given** the selected folder contains files covered by shipped CodeGraph grammars, **When** the browser scans the folder, **Then** only accepted source files are indexed using the same non-git input-selection scope as the Node runtime.
3. **Given** indexing completes successfully, **When** the user reloads the page, **Then** the browser-local repository remains visible with its last good keyword-searchable graph and accepted source data.

---

### User Story 2 - Browse the Local Graph Experience (Priority: P1)

As a developer, I can use the existing overview, search, symbol/source, relationships, graph, and impact-oriented navigation for a browser-local repository without learning a separate product surface.

**Why this priority**: The feature is valuable only if the local repository feels like CodeGraph, not a disconnected import demo.

**Independent Test**: Can be tested by opening a completed local repository and exercising each core browse/search path through the same SPA routes used for server repositories.

**Acceptance Scenarios**:

1. **Given** a browser-local repository has a completed keyword index, **When** the user opens overview, search, symbol, source, relationships, and graph views, **Then** each view uses the same result shapes and clearly labels the repository as local.
2. **Given** a route or capability depends on server-only behavior outside SPEC-007 scope, **When** the user reaches that surface from a local repository, **Then** the app disables it visibly and explains why it is unavailable.
3. **Given** the user searches for a term present in accepted source, **When** keyword search returns results, **Then** the user can navigate to matching symbols and source context without granting fresh folder permission.

---

### User Story 3 - Inspect Local Impact (Priority: P2)

As a maintainer, I can inspect a local symbol's bounded impact and affected files using the browser-owned graph.

**Why this priority**: Impact analysis is one of CodeGraph's core graph-context workflows and proves that local indexing is more than text search.

**Independent Test**: Can be tested by selecting a known symbol in the local repository and confirming that impact and affected-file results are bounded, explainable, and consistent with the local graph.

**Acceptance Scenarios**:

1. **Given** a local repository has completed graph indexing, **When** the user requests impact for a symbol, **Then** the app returns bounded impacted symbols and files using existing impact result semantics.
2. **Given** the selected symbol has no graph relationships, **When** impact is requested, **Then** the app reports an empty bounded impact instead of presenting a failure.
3. **Given** graph data comes from the browser-local index, **When** relationships, graph, or impact views are opened, **Then** the app does not make repository-derived network requests by default.

---

### User Story 4 - Reconnect, Refresh, and Delete (Priority: P2)

As a returning user, I can reopen a persisted local repository, explicitly reconnect to its saved folder handle, refresh it incrementally, and delete browser-owned data without changing source files.

**Why this priority**: A persistent local repository must remain trustworthy across browser sessions and source changes.

**Independent Test**: Can be tested by indexing a folder, reloading the page, reconnecting by user action, applying controlled file changes, refreshing, cancelling or failing a refresh, and deleting the browser-owned repository data.

**Acceptance Scenarios**:

1. **Given** a local repository was previously created from a picked folder, **When** the user returns after reload, **Then** the app shows the stored repository and requests folder reconnection only after an explicit user action.
2. **Given** accepted source files changed since the last successful index, **When** the user starts manual refresh, **Then** adds, changes, and deletes are detected incrementally and published only after a successful transaction.
3. **Given** refresh is cancelled or fatally fails, **When** the user returns to the repository, **Then** the last good index remains available and the failed operation is visible.
4. **Given** the user confirms deletion, **When** browser-owned data is removed, **Then** accepted source cache, graph data, metadata, and non-secret semantic state are deleted without modifying the original source folder.

---

### User Story 5 - Degrade Honestly (Priority: P2)

As a user on another browser, a snapshot path, or a second tab, I receive a supported fallback or precise capability, busy, quota, permission, or storage message instead of an opaque error.

**Why this priority**: The feature crosses uneven browser capabilities and storage limits; clear degradation is part of the product promise.

**Independent Test**: Can be tested by exercising unsupported picker environments, directory drop where supported, permission denial, quota pressure, and two-tab access to the same local repository.

**Acceptance Scenarios**:

1. **Given** the browser does not support the full folder-picker and reconnect path, **When** the user attempts local indexing, **Then** the app identifies the missing capability and offers a supported directory-drop snapshot only where the browser exposes one.
2. **Given** a directory is imported as a snapshot, **When** indexing completes, **Then** the repository is clearly labeled as a snapshot and does not claim durable reconnect or live source-folder refresh.
3. **Given** another tab already owns the same local repository, **When** a user opens or refreshes it in a second tab, **Then** the app shows a clear busy state and retry path instead of risking concurrent database access.
4. **Given** storage quota, persistence, or permission blocks progress, **When** the operation cannot continue, **Then** the app preserves existing data and explains the user action needed to continue or recover.

---

### User Story 6 - Opt Into Semantic Search (Priority: P3)

As a privacy-conscious operator, I can configure a secure embedding endpoint after the keyword index is usable and receive semantic search without storing bearer credentials or breaking keyword fallback.

**Why this priority**: Semantic search is valuable but optional; local-first keyword capability and credential handling must stay intact.

**Independent Test**: Can be tested by completing keyword indexing, entering an endpoint and bearer key, confirming semantic progress, reloading to verify the key is not retained, and confirming keyword search still works after semantic failures.

**Acceptance Scenarios**:

1. **Given** keyword indexing has completed, **When** the user explicitly enables semantic indexing and provides endpoint credentials, **Then** repository-derived embedding traffic begins only after consent.
2. **Given** semantic indexing succeeds, **When** the user performs semantic search, **Then** semantic results are available alongside keyword fallback.
3. **Given** the page reloads, semantic indexing is interrupted, or the endpoint fails due to TLS, mixed-content, CORS, or availability, **When** the user searches again, **Then** keyword search remains usable and no bearer credential is recovered from durable browser storage.

---

### User Story 7 - Verify the Shipped Build (Priority: P3)

As a maintainer, I can verify that the same CLI-served and trusted HTTPS static-host build carries the required local-indexing assets, preserves deterministic extraction, and meets self-repository performance targets.

**Why this priority**: The feature must ship as CodeGraph, remain offline by default, and prove its performance on the repository it serves.

**Independent Test**: Can be tested by building the package, serving the SPA through the supported hosts, indexing this repository through the browser-local path, and recording performance, asset, privacy, and determinism evidence.

**Acceptance Scenarios**:

1. **Given** the packaged SPA is served through the CLI or a trusted HTTPS static host, **When** the local-indexing flow runs, **Then** every required worker, grammar, database, and static asset loads from the shipped build without a CDN request.
2. **Given** the current CodeGraph repository is indexed in desktop Chromium without embeddings, **When** the benchmark is run under documented conditions, **Then** indexing completes within the selected time target and the UI remains responsive.
3. **Given** the same accepted fixture inputs are indexed by Node and browser runtimes, **When** graph semantics are compared, **Then** deterministic symbol and edge semantics agree for the shared extraction kernel.

### Edge Cases

- The folder picker is unavailable, permission is denied, permission is later revoked, or the saved folder handle is stale.
- Directory drop is unavailable, incomplete, or imports a snapshot whose source later changes outside the browser.
- The selected folder contains unreadable files, binary files, oversized files, ignored paths, nested ignore rules, or files with unsupported extensions.
- Indexing or refresh is cancelled, the tab closes, the worker fails, or the database operation cannot publish a complete transaction.
- The same local repository is opened in a second tab while the first tab owns it.
- Browser storage quota is low, persistent storage is denied, or the user requests deletion while an operation is active.
- A required local-indexing asset is missing from the packaged or static-host build.
- The semantic endpoint is insecure, blocked by mixed-content rules, unavailable, has incompatible model dimensions, fails CORS, or returns partial embedding results.
- Source content includes text that looks like HTML or script and must remain displayed as inert source text.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SPA MUST support one shared repository experience with distinct server and browser-local repository runtimes, preserving a single user-facing product surface. *(AC-7.1, AC-7.2; Q1, Q10)*
- **FR-002**: The system MUST start browser-local folder access only from an explicit user action and MUST NOT prompt automatically. *(AC-7.1; Q2)*
- **FR-003**: The same shipped build MUST support the browser-local experience from the CLI-served SPA and from a trusted HTTPS static host. *(AC-7.1, Shipping; Q3)*
- **FR-004**: The system MUST provide full picker and reconnect behavior on current desktop Chromium and MUST provide capability-specific guidance or a supported directory-drop snapshot elsewhere. *(AC-7.1, AC-7.4; Q4, Q21)*
- **FR-005**: Browser source selection MUST match the Node non-git input-selection contract for built-in exclusions, nested ignore rules, project include/exclude configuration, extension overrides, supported extensions, binary checks, and the source file size cap. *(AC-7.1, Determinism; Q17)*
- **FR-006**: Browser indexing MUST cover all shipped browser-compatible CodeGraph grammars and load only the grammar assets required by the accepted files. *(AC-7.1, Shipping; Q7)*
- **FR-007**: Browser and Node indexing MUST share deterministic source-to-graph semantics so accepted fixture inputs produce matching graph meaning across runtimes. *(AC-7.1, Determinism; Q8)*
- **FR-008**: Parsing and graph persistence work MUST run outside the main UI thread and report progress, cancellation, completion, and bounded per-file warnings. *(AC-7.1, Performance; Q8, Q13)*
- **FR-009**: Browser-local graph data MUST be stored in origin-private browser storage using the selected persistent SQLite-backed design, with one active tab owner per local repository. *(AC-7.1, AC-7.4; Q9, Q18)*
- **FR-010**: The system MUST persist accepted source files with derived graph data so source and symbol views work after reload without fresh folder permission. *(AC-7.1, AC-7.2; Q5)*
- **FR-011**: The browser-local repository MUST provide overview, keyword search, symbol/source, relationships, graph, and bounded impact experiences using existing result semantics. *(AC-7.2; Q11)*
- **FR-012**: Local and server repositories MUST be visibly distinguishable in repository selection, route context, status, destructive actions, and error states. *(AC-7.2, Privacy; Q1, Q2, Q10)*
- **FR-013**: Server-only capabilities outside SPEC-007 scope MUST be visibly disabled for browser-local repositories with concise explanations. *(AC-7.2, AC-7.4; Q11)*
- **FR-014**: The system MUST support manual incremental refresh and MUST NOT introduce filesystem watching, polling auto-refresh, daemon sync, or hidden background refresh. *(AC-7.2; Q12)*
- **FR-015**: Refresh MUST publish adds, changes, and deletes transactionally, preserving the last good index on cancellation or fatal failure. *(AC-7.2, Data Integrity; Q13)*
- **FR-016**: Persisted picked-folder repositories MUST support saved-handle identity and explicit reconnect; reconnect permission MUST be requested only after user activation. *(AC-7.2; Q6)*
- **FR-017**: The system MUST show browser-owned storage status, request persistence only after a user action, and never automatically evict local indexes. *(AC-7.2, Privacy; Q20)*
- **FR-018**: A second tab or window that attempts to access an owned local repository MUST receive a clear busy/retry state instead of opening the same persistent database concurrently. *(AC-7.4, Data Integrity; Q18)*
- **FR-019**: Unsupported browsers MUST receive precise missing-capability guidance and MUST NOT be promised full folder-picker or reconnect parity. *(AC-7.4; Q21)*
- **FR-020**: Directory-drop imports MUST be labeled as snapshot repositories and MUST NOT imply durable source-folder reconnect or automatic source freshness. *(AC-7.4; Q4)*
- **FR-021**: The app MUST make no repository-derived network request by default for browser-local repositories. *(Privacy; Q14, Q16)*
- **FR-022**: Semantic indexing MUST require explicit post-keyword user consent, endpoint configuration, and bearer-key entry, and bearer credentials MUST remain memory-only. *(Privacy, Semantic; Q14, Q15)*
- **FR-023**: Semantic indexing MUST be advisory, resumable where possible, and unable to disable completed keyword search when it fails or is unavailable. *(Semantic; Q15)*
- **FR-024**: Semantic endpoint failures caused by secure-context, TLS, mixed-content, CORS, model, or availability constraints MUST be reported clearly without offering an insecure transport override. *(Privacy, Semantic; Q16)*
- **FR-025**: On current desktop Chromium under documented benchmark conditions, this repository's accepted files MUST complete browser keyword indexing within 60 seconds without embeddings while the UI remains responsive. *(Performance; Q19)*
- **FR-026**: Local keyword search, graph navigation, and bounded impact reads MUST meet a p95 user-observed latency target at or below 150 ms under the documented self-repository benchmark. *(Performance; Q19)*
- **FR-027**: Package and static-host builds MUST include every required worker, database, grammar, and static asset and MUST NOT rely on CDN delivery for local indexing. *(Shipping; Q3, Q7, Q9)*
- **FR-028**: SPEC-007 delivery MUST be planned as three independently demonstrable vertical slices and MUST stay inside the accepted reviewability warning boundary unless re-split before implementation. *(Reviewability; Q22)*
- **FR-029**: Explicit deletion MUST remove browser-owned local repository data, accepted source cache, metadata, and non-secret semantic state without modifying the user's source folder. *(AC-7.2, Privacy; Q5, Q20)*
- **FR-030**: User-visible status MUST distinguish complete, stale, refreshing, snapshot, cancelled, failed, partial-warning, busy, quota-blocked, permission-blocked, and deleted repository states. *(AC-7.2, AC-7.4; Q13, Q18, Q20, Q21)*
- **FR-031**: The existing repository/workspace shell MUST expose an **Open local folder** command that invokes selection only within that direct user activation and labels the runtime as Server, Local folder, or Local snapshot in the switcher, status area, page headers, and destructive dialogs. *(AC-7.1, AC-7.2; Q1, Q2)*
- **FR-032**: After reload, a picked-folder repository MUST open against its last-good local index and cached accepted source, show a Reconnect action, and keep live-source refresh disabled until reconnect succeeds; stale or denied reconnect MUST leave cached browsing available with a visible recovery action. *(AC-7.2; Q5, Q6)*
- **FR-033**: Each completed directory drop MUST create a distinct snapshot repository, retain an accepted-file manifest fingerprint for duplicate warnings, display Snapshot plus import time, and never merge with or refresh from a later picked-folder repository unless the user explicitly chooses Replace. *(AC-7.4; Q4)*
- **FR-034**: If the per-repository ownership lock is unavailable, every browser-local route MUST show a busy state before opening local graph storage, name the affected repository, and offer Retry and Switch repository actions; graph, source, search, refresh, delete, and semantic actions MUST remain disabled until ownership is acquired. *(AC-7.4, Data Integrity; Q18)*
- **FR-035**: Browser-local repositories MUST keep overview, keyword search, symbol/source, relationships, graph, and impact routes enabled through the local repository client, replace daemon re-analysis with local manual refresh, and show disabled-state explanations for chat, flows/clusters/catalogs, LSP-only source intelligence, daemon jobs, and other out-of-scope server-only routes. *(AC-7.2, AC-7.4; Q10, Q11, Q12)*
- **FR-036**: Local deletion MUST use a destructive confirmation dialog that displays the runtime label, repository display name or snapshot label, the browser-owned data classes to remove, and the statement **Source folder files will not be changed**; the final Delete action MUST require typing the displayed repository name. *(AC-7.2, Privacy; Q5, Q20)*
- **FR-037**: Browser repositories MUST use an origin-scoped opaque id minted when a picked folder is accepted or a snapshot import completes; host absolute paths MUST NOT be stored or displayed, picked folders MUST retain a reconnect handle reference for same-entry checks, and snapshots MUST retain their accepted-file manifest fingerprint as metadata rather than primary identity. *(AC-7.1, AC-7.4; Q4, Q6)*
- **FR-038**: Every index or refresh publication MUST use a repository generation that becomes current only after the graph database, accepted-source manifest, source-cache entries, repository status, and last-success pointer are complete; cancellation, worker failure, crash during staging, quota failure, migration failure, or database write failure MUST preserve the prior complete generation and incomplete staging MUST be cleaned on the next open. *(AC-7.1, AC-7.2, Data Integrity; Q9, Q13)*
- **FR-039**: Browser graph storage MUST initialize from the same canonical graph schema and schema-version stream as Node, and source-cache tables MUST enter through the shared migration path rather than a browser-only graph-schema fork; separately versioned browser registry state MUST map to the canonical repository id and current generation. *(Determinism, Data Integrity; Q8, Q9)*
- **FR-040**: Manual refresh MUST compute a candidate accepted-file manifest by relative path and content hash, index only added or changed files, remove graph and source-cache entries for deleted files, retain unchanged files, and publish the result as one successful generation; recoverable per-file errors MUST produce aggregate counts plus at most 100 file details and a truncation flag, while fatal or cancelled outcomes MUST publish no partial graph. *(AC-7.2, Data Integrity; Q12, Q13)*
- **FR-041**: Browser worker RPC MUST use versioned, structured-clone-safe envelopes containing request, operation, repository, kind, and progress identifiers plus either result or a plain-object error; each operation MUST emit exactly one complete, cancelled, failed, or partial-warning terminal state, errors MUST exclude raw runtime objects and source contents, and stale operation-scoped cancel or result messages MUST be ignored as no-ops. *(AC-7.1, AC-7.2, Data Integrity; Q8, Q13)*
- **FR-042**: Browser-local semantic search MUST persist only a repository-scoped secret-free Embedding Profile containing a canonical endpoint URL without userinfo, query, or fragment components, model id, optional dimensions, consent state, semantic generation, coverage counts, safe status code, stored vectors, input hashes, and resumable item state; bearer keys and authorization material MUST exist only in current page or dedicated-worker memory, MUST be absent from all durable browser stores and artifacts, and endpoint traffic after reload MUST require explicit key re-entry. *(Privacy, Semantic; Q14, Q15)*
- **FR-043**: Semantic endpoint errors MUST use stable user-visible codes for insecure endpoint URL, mixed-content blocked before request, CORS/TLS/network-blocked unreadable fetch failure, HTTP status failure, model or dimension mismatch, partial response, cancellation, and endpoint unavailable; messages MUST expose only a redacted endpoint origin and safe next action, exclude source text, raw endpoint components, credentials, and provider bodies, and never offer proxy, no-CORS, or insecure transport overrides. *(Privacy, Semantic; Q16)*
- **FR-044**: No-consent browser-local network audits MUST fail on any repository-derived fetch, XHR, WebSocket, beacon, API, external-origin, or embedding request during import, browsing, keyword search, graph, impact, refresh, reload, and delete; only enumerated same-origin shipped JS, worker, WASM, database, grammar, font/style, and static assets without source-derived payloads, credentials, custom headers, or CDN origins are allowed. *(Privacy, Shipping; Q14, Q16)*
- **FR-045**: CLI-served and trusted HTTPS static-host builds MUST document and verify a minimum browser policy that serves local-indexing module workers, SQLite-Wasm, grammar WASM, database, and static assets from the SPA origin, permits required same-origin worker and WebAssembly execution under CSP, does not require COOP/COEP for the selected SAH-pool design, and reports CSP or connect-policy blocks without changing keyword availability. *(Shipping, Privacy; Q3, Q9, Q16)*
- **FR-046**: Every required browser-local worker, SQLite-Wasm file, grammar WASM file, database/static asset, and generated manifest entry MUST resolve through the web build asset base, be copied into `dist/web` and the npm package, and be verified by package/static-host tests; missing, empty, or uncopied assets MUST fail build or package verification, while a runtime missing-asset response MUST disable browser-local indexing with a precise shipped-asset-unavailable message and no CDN fallback. *(Shipping; Q3, Q7, Q9)*
- **FR-047**: Cross-runtime parity fixtures MUST run the same accepted fixture trees through Node and browser adapters and compare accepted-file manifests, language maps, symbol and edge semantic projections, bounded warning codes, lazy grammar-load manifests, and repeated-run counts; runtime-specific ids, timestamps, storage row order, and browser registry metadata MUST NOT be parity criteria. *(AC-7.1, Determinism; Q7, Q8)*
- **FR-048**: Browser indexing benchmarks MUST record main-thread responsiveness during scan, source read, grammar load, parse, SQLite store, and publish phases using a requestAnimationFrame or equivalent heartbeat maximum-gap metric, Chromium long-task entries where supported, and Playwright assertions that progress, cancel, and route chrome remain actionable throughout indexing. *(Performance; Q8, Q19)*
- **FR-049**: Browser compatibility evidence MUST cover current desktop Chromium, Firefox, and WebKit/Safari projects: Chromium MUST verify the full picker, reconnect, OPFS, Web Lock, worker, SQLite-Wasm, and local browse path; Firefox and WebKit/Safari MUST verify exact missing-capability guidance, no full picker/reconnect promise, directory-drop snapshot only when usable directory entries are exposed, and independent storage and lock capability reporting. *(AC-7.4; Q4, Q18, Q21)*

### Acceptance Criteria Coverage

- **AC-7.1 - Deliberate local import**: FR-001 through FR-010, FR-016, FR-025, FR-027, FR-031, FR-037 through FR-041, and FR-047 through FR-048 cover explicit folder selection, local indexing, persistence, worker progress, asset delivery, deterministic source selection, transactional publication, and cross-runtime parity.
- **AC-7.2 - Core graph experience**: FR-010 through FR-017, FR-026, FR-029, and FR-030 cover overview, search, source, relationships, graph, impact, reconnect, refresh, storage, and deletion.
- **AC-7.3 - Local-first privacy and semantic opt-in**: FR-021 through FR-024 and FR-029 cover no default egress, explicit semantic consent, memory-only credentials, secure transport, resumability, and keyword fallback.
- **AC-7.4 - Graceful degradation and busy states**: FR-004, FR-018 through FR-020, FR-024, FR-027, FR-030, FR-033 through FR-034, FR-043, FR-045 through FR-046, and FR-049 cover snapshot fallback, unsupported browsers, busy tabs, quota and permission messages, static-host behavior, and the three-browser capability matrix.

### Reviewability Budget *(mandatory)*

- **Primary surface**: UI runtime plus browser-local indexing runtime
- **Secondary surfaces, if any**: Shared deterministic extraction seam, browser graph persistence, package/static asset delivery, and focused verification fixtures
- **Projected reviewable LOC**: 1055
- **Projected production files**: 13
- **Projected total files**: Approximately 14 or more after focused tests and evidence artifacts
- **Budget result**: warning accepted
- **Split decision**: Keep SPEC-007 as one feature specification but require three independently demonstrable vertical slices: persistent keyword path; graph and lifecycle; degradation, semantic search, and shipping. If planning crosses the accepted warning boundary or requires a fourth capability class, split before implementation.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order,
  scope budget, traceability, verification evidence, known gaps, and rollback
  or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed
  files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities *(include if feature involves data)*

- **Local Repository**: A browser-owned CodeGraph repository record with an origin-scoped opaque id, display name, source kind, virtual root, optional reconnect handle or manifest fingerprint, status, current generation, storage ownership, creation time, and last successful index metadata.
- **Source Folder Handle**: The browser-retained reference to a picked folder, used only after explicit reconnect and never used to write source files.
- **Snapshot Repository**: A browser-owned repository imported from directory drop where supported, without durable reconnect or automatic source freshness claims.
- **Accepted Source File**: A source file that passes the shared non-git input-selection contract and is eligible for source cache and graph extraction.
- **Source Cache Entry**: Origin-private retained source content and metadata for accepted files, deleted together with the local repository.
- **Graph Index**: The derived deterministic symbol, edge, search, relationship, and impact data for a local repository.
- **Worker Operation**: A browser-local index, refresh, query, embed, cancel, or close operation represented by a versioned structured-clone-safe envelope with request, operation, and repository identifiers, progress, one terminal state, and a result or plain-object error.
- **Capability Report**: The browser-specific status of picker, reconnect, directory drop, storage, persistence, locks, secure context, and network constraints.
- **Storage Report**: The quota, persistence, usage, deletion, and recoverability state for browser-owned local repository data.
- **Embedding Profile**: Repository-scoped, secret-free endpoint origin/configuration, model, optional dimensions, consent state, semantic generation, vector coverage, stored vectors, input hashes, resumable item state, and safe status codes; bearer keys, authorization headers, token-like URL components, raw provider bodies, and raw error causes are never part of this entity.
- **User-Visible Error**: A recoverable or terminal plain-object condition with stable code, safe message, retryability, phase, bounded details, affected operation, and the next user action.

### Out of Scope

- A separate browser app, duplicate hosted demo, service-worker API shim, or route fork that creates a second product.
- ZIP/archive ingestion, automatic filesystem permission prompts, live filesystem watching, polling auto-refresh, daemon sync, or source-folder writes.
- Browser-side LSP, dataflow, flows/clusters, chat, catalogs, daemon jobs, or full current UI parity outside the selected core graph experience.
- Node-polyfill bundles, browser-specific graph semantics, or a parallel extractor.
- Full folder-picker and reconnect parity on Firefox or Safari in this release.
- Multi-tab database concurrency, automatic lock takeover, automatic index eviction, persisted bearer credentials, or insecure endpoint override.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user on current desktop Chromium can create a browser-local repository from a deliberate folder-picker action without running a CodeGraph server.
- **SC-002**: A supported directory drop creates a clearly labeled snapshot repository, and unsupported browsers receive capability-specific guidance in 100% of tested degradation cases.
- **SC-003**: 100% of accepted local source and derived graph data for a repository is removed by explicit delete, with no changes made to the original source folder.
- **SC-004**: In a no-consent local repository session, repository-derived network requests are zero during import, browsing, keyword search, graph, impact, refresh, reload, and delete.
- **SC-005**: After keyword indexing completes, users can browse overview, keyword search, symbol/source, relationships, graph, and bounded impact through the shared SPA with local/server labels visible at trust-boundary moments.
- **SC-006**: Refresh cancellation, fatal refresh failure, and bounded per-file failures preserve the last good index in all covered recovery tests.
- **SC-007**: Bearer credentials entered for optional semantic search are absent from durable browser storage, URLs, logs, errors, and committed fixtures in all covered tests.
- **SC-008**: On documented current desktop Chromium conditions, this CodeGraph repository completes browser keyword indexing in at most 60 seconds without embeddings; evidence records CPU model, available and logical cores, memory, OS, power mode, browser and version, Playwright version when used, Node/npm versions, commit SHA, host mode, accepted-file/node/edge counts, cache/storage state, start/end markers, elapsed time, and run count.
- **SC-009**: On the same self-repository benchmark, local keyword search, graph navigation, and bounded impact reads meet p95 latency at or below 150 ms using a deterministic query suite with at least 20 measured samples per operation after one warmup, measured from user action or request start through visible rendered result.
- **SC-010**: CLI-served and trusted HTTPS static-host builds load all required local-indexing workers and assets from the shipped package and make no CDN request.
- **SC-011**: Shared deterministic extraction fixtures show matching graph semantics between browser and Node runtimes for accepted inputs across repeated runs.

## Assumptions

- SPEC-006's shared SPA browsing surface and result types are available and remain the integration target.
- The user can access the SPA from a secure context when browser filesystem or semantic endpoint policies require it.
- Current desktop Chromium is the only browser family expected to support the complete picker and reconnect path in this release.
- Directory-drop snapshot behavior is offered only where browser APIs expose usable directory entries.
- Browser-local data is origin-private browser-owned data; deleting it is separate from modifying or deleting the selected source folder.
- Semantic search is optional and may be unavailable because of endpoint, transport, model, or browser policy constraints.
- Planning will confirm exact dependency versions, schema adapters, worker contracts, benchmark hardware, and asset-copy details before implementation.
