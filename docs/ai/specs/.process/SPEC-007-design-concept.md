---
topic: "In-browser indexing"
slug: "SPEC-007-design-concept"
date: "2026-07-27"
mode: "setup"
spec_id: "SPEC-007"
source_input:
  type: "file"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md#spec-007-in-browser-indexing"
question_count: 22
stop_reason: "natural"
---

# Design Concept: In-browser indexing

> **Source:** `docs/ai/specs/intelligence-platform-technical-roadmap.md#spec-007-in-browser-indexing`
> **Date:** 2026-07-27
> **Questions asked:** 22
> **Stop reason:** natural

## Goals

- Keep one CodeGraph SPA and add browser-local repositories as a second runtime,
  with an explicit "Open local folder" entry point and unmistakable local/server
  labels.
- Let the same build run from `codegraph serve --web` or a trusted HTTPS static
  host so the feature provides a true zero-install evaluation path.
- Index every currently shipped browser-compatible tree-sitter grammar on demand
  in a Web Worker, persist the graph and accepted source files in OPFS, and keep
  repository bytes local unless the user explicitly enables an embedding endpoint.
- Give local repositories the existing overview, keyword search, symbol/source,
  relationship, graph, and impact experience, plus manual incremental refresh,
  reconnect, storage visibility, and explicit deletion.
- Preserve the last good index across cancellation or failure, serialize access
  across tabs, and degrade honestly when filesystem, storage, or browser
  capabilities are unavailable.
- On current desktop Chromium, index CodeGraph's roughly 900 accepted files and
  16k nodes in at most 60 seconds without embeddings, keep the UI responsive, and
  keep local search/impact reads at p95 at or below 150 ms.

## Non-goals

- A second browser-only application or a divergent hosted build (Q1, Q3).
- Automatic filesystem permission prompts or silently reopening a folder without
  a user-driven reconnect action (Q2, Q6).
- ZIP ingestion or another archive parser in the fallback path (Q4).
- Browser-side LSP, daemon jobs, chat, flows/clusters, dataflow, or index syncing
  to the local daemon (Q11).
- A parallel browser-specific graph extractor or a Node-polyfill bundle for the
  existing filesystem/database orchestrator (Q8).
- Experimental live filesystem watching or polling-based auto-refresh (Q12).
- Persisting embedding API keys, allowing plaintext LAN egress from a secure
  hosted origin, or making semantic indexing a prerequisite for keyword use
  (Q14-Q16).
- Multi-tab database concurrency, automatic lock takeover, automatic index
  eviction, or unexpected deletion of source folders (Q18, Q20).
- Full folder-picker/reconnect parity on Firefox and Safari in this release
  (Q21).

## Design Tree (Q&A log)

### Q1. How should in-browser indexing fit into the existing CodeGraph web app?

**Branch:** Product architecture

**Recommended answer:** One SPA, two runtimes
> SPEC-006 already established one React route model and one set of result types.
> A runtime-neutral data boundary preserves that UI investment and avoids a
> second product surface.

**Alternatives offered:**
- Dedicated local route: clearer separation, but duplicates state and navigation.
- Separate browser app: strongest isolation, but creates the most drift and
  maintenance.

**User's answer:** One SPA, two runtimes (Recommended)

---

### Q2. How should users enter browser-local mode in the shared SPA?

**Branch:** Product architecture

**Recommended answer:** Explicit workspace switch
> Filesystem access requires deliberate user activation, and the constitution
> forbids surprising network or storage behavior. A visible workspace action
> makes the trust boundary clear.

**Alternatives offered:**
- Fallback when offline: reduces visible controls, but couples the feature to an
  API error.
- Auto-reopen local: faster, but creates permission and stale-handle confusion.

**User's answer:** Explicit workspace switch (Recommended)

---

### Q3. Where must the browser-local experience run?

**Branch:** Delivery

**Recommended answer:** Same build on HTTPS or CLI
> AC-7 defines a zero-install path, while SPEC-006 already ships the SPA through
> the CLI. One host-agnostic build serves both without a release-divergent demo.

**Alternatives offered:**
- CLI-served only: simpler, but still requires CodeGraph installation.
- Separate hosted demo: tailored UX, but a second build can drift.

**User's answer:** Same build on HTTPS or CLI (Recommended)

---

### Q4. What should browsers without `showDirectoryPicker()` receive?

**Branch:** Folder acquisition

**Recommended answer:** Drag-drop snapshot
> The roadmap explicitly names a drag-drop fallback. A snapshot preserves useful
> degradation without adding archive parsing or pretending a durable folder
> handle exists.

**Alternatives offered:**
- Capability message only: simplest, but drops the roadmap fallback.
- ZIP import fallback: broader reach, but adds archive parsing, limits, and a
  second ingestion contract.

**User's answer:** Drag-drop snapshot (Recommended)

---

### Q5. What source material may the browser persist so symbol/source views still work after reload?

**Branch:** Persistence and privacy

**Recommended answer:** Persist indexed source in OPFS
> The current symbol experience reads source context. Persisting only accepted
> source files inside origin-private storage preserves that experience after
> reload while keeping deletion bounded to derived browser data.

**Alternatives offered:**
- Derived index only: minimizes duplication, but source views require renewed
  permission.
- Bounded snippets only: saves space, but limits navigation and context.

**User's answer:** Persist indexed source in OPFS (Recommended)

---

### Q6. How should a persisted local repository reconnect to its source folder after reload?

**Branch:** Persistence and permissions

**Recommended answer:** Saved handle, explicit reconnect
> Persisting a directory handle allows stable identity, while checking permission
> silently and requesting it only after a click respects browser activation and
> permission rules.

**Alternatives offered:**
- Index only until reopened: no durable handle, so every refresh starts with a
  new picker.
- Content fingerprint matching: adds expensive matching and ambiguous collisions.

**User's answer:** Saved handle, explicit reconnect (Recommended)

---

### Q7. Which language coverage should the first browser indexer promise?

**Branch:** Extraction parity

**Recommended answer:** All shipped grammars, lazy
> `src/extraction/grammars.ts` already defines the supported WASM grammar catalog.
> Detecting files before loading assets preserves parity without paying to load
> every grammar for every repository.

**Alternatives offered:**
- Core languages only: smaller first release, but creates intentional parity gaps.
- User-selected languages: saves resources, but adds setup friction and missed
  files.

**User's answer:** All shipped grammars, lazy (Recommended)

---

### Q8. How should browser indexing reuse the existing extraction implementation?

**Branch:** Runtime architecture

**Recommended answer:** Shared pure extraction kernel
> A small injected file/grammar/store seam follows the roadmap's minimal-refactor
> constraint and Constitution Principle III. Node and browser orchestration can
> differ without graph semantics diverging.

**Alternatives offered:**
- Browser-specific extractor: initially direct, but graph semantics will drift.
- Polyfill the Node orchestrator: reuses more code textually, but bundles fragile
  filesystem, process, worker, crypto, and SQLite shims.

**User's answer:** Shared pure extraction kernel (Recommended)

---

### Q9. Which SQLite-Wasm persistence tradeoff should SPEC-007 choose?

**Branch:** Browser database

**Recommended answer:** SAH-pool, single active tab
> SQLite's official `opfs-sahpool` VFS provides high-performance OPFS persistence
> without requiring COOP/COEP response headers, which is necessary for arbitrary
> HTTPS static hosting. Its no-concurrent-tab constraint is handled explicitly.

**Alternatives offered:**
- Concurrent OPFS VFS: supports multiple tabs, but requires COOP/COEP headers.
- IndexedDB-backed VFS: changes the roadmap's OPFS target and gives up the
  preferred persistence path.

**User's answer:** SAH-pool, single active tab (Recommended)

---

### Q10. How should the existing browse/search/impact UI talk to browser-local indexes?

**Branch:** UI integration

**Recommended answer:** Typed repository client
> The existing `web/src/lib/api/types.ts` already supplies stable UI result
> shapes. A server fetch implementation and a worker-RPC implementation can share
> those contracts without spreading runtime branches through routes.

**Alternatives offered:**
- Service Worker API shim: preserves fetch paths, but adds routing and lifecycle
  complexity.
- Direct local queries in routes: avoids one abstraction, but distributes
  conditionals across the UI.

**User's answer:** Typed repository client (Recommended)

---

### Q11. Which existing UI capabilities must work for a browser-local repository in SPEC-007?

**Branch:** Feature parity

**Recommended answer:** Core graph parity
> AC-7.2 names browse/search/impact, and the roadmap explicitly excludes
> browser-side LSP/dataflow and daemon synchronization. A clear core boundary
> avoids absorbing unrelated server features.

**Alternatives offered:**
- Include catalogs: also runs flows/clusters locally, expanding post-index
  analysis.
- Full current UI parity: pulls chat, catalogs, and every current route into the
  browser runtime.

**User's answer:** Core graph parity (Recommended)

---

### Q12. How should a browser-local index pick up source changes after the initial import?

**Branch:** Freshness

**Recommended answer:** Manual incremental refresh
> Rewalking and hashing on an explicit action can reuse established sync
> semantics. The PRD explicitly excludes a new file-watching system, and browser
> observer APIs are not a stable cross-browser foundation.

**Alternatives offered:**
- Manual full rebuild: simpler, but slower and less failure-tolerant.
- Experimental live watch: adds unstable APIs and a polling fallback.

**User's answer:** Manual incremental refresh (Recommended)

---

### Q13. What should users see if indexing is cancelled, the tab closes, or a file fails?

**Branch:** Integrity and recovery

**Recommended answer:** Keep last good index
> Transactional publication makes repository status truthful and preserves the
> deterministic graph contract. Bounded per-file parse failures remain visible
> without making ordinary mixed repositories unusable.

**Alternatives offered:**
- Expose partial results: improves time-to-first-result, but complicates every
  correctness signal.
- Fail on any file: strict, but brittle for real repositories.

**User's answer:** Keep last good index (Recommended)

---

### Q14. How should browser-local semantic search handle endpoint configuration and source-derived egress?

**Branch:** Semantic search and privacy

**Recommended answer:** Explicit opt-in, memory-only key
> Constitution Principle VII permits only user-configured endpoint traffic.
> Persisting non-secret settings while keeping bearer credentials in memory
> preserves convenience without silently retaining a reusable secret.

**Alternatives offered:**
- Persist credentials locally: convenient, but increases shared-profile and
  browser-compromise exposure.
- Keyless endpoints only: simpler, but excludes common private endpoints.

**User's answer:** Explicit opt-in, memory-only key (Recommended)

---

### Q15. When should browser-local embeddings be generated?

**Branch:** Semantic search and degradation

**Recommended answer:** After keyword index
> AC-7 requires keyword search at minimum. Publishing the deterministic local
> graph first keeps endpoint latency, CORS, and outages advisory and makes the
> semantic phase resumable.

**Alternatives offered:**
- Inside indexing: yields everything at once, but delays and couples the usable
  index to endpoint health.
- Only at query time: cannot search a corpus semantically without repeatedly
  processing it.

**User's answer:** After keyword index (Recommended)

---

### Q16. What transport policy should browser-local embedding endpoints enforce?

**Branch:** Semantic search and transport security

**Recommended answer:** Secure-context rules
> An HTTPS-hosted SPA cannot reliably call plaintext LAN endpoints because of
> mixed-content protections, and sending source-derived text in cleartext would
> violate the project's privacy posture.

**Alternatives offered:**
- Allow insecure LAN opt-in: browsers may still block it, and payloads remain
  exposed.
- Server proxy only: protects credentials, but removes the zero-install semantic
  path.

**User's answer:** Secure-context rules (Recommended)

---

### Q17. Which file-selection rules must browser indexing match?

**Branch:** Input scope

**Recommended answer:** Node non-git parity
> `scanDirectoryWalk` already defines the correct non-git contract: built-in
> exclusions, nested `.gitignore`, project include/exclude and extension
> overrides, supported extensions, binary checks, and the file-size cap.

**Alternatives offered:**
- Gitignore plus defaults: defers project-specific scope and extension behavior.
- Browser-specific rules: knowingly produces different graphs across runtimes.

**User's answer:** Node non-git parity (Recommended)

---

### Q18. What should happen when the same local repository is opened in another tab?

**Branch:** Concurrency

**Recommended answer:** One owner, clear busy state
> The selected SAH-pool VFS does not support concurrent tab access. A per-repo
> Web Lock makes that constraint deterministic instead of surfacing opaque SQLite
> failures.

**Alternatives offered:**
- Automatic takeover: improves recovery, but adds heartbeat and split-brain risk.
- Unsupported warning: documents the limitation without preventing bad opens.

**User's answer:** One owner, clear busy state (Recommended)

---

### Q19. What reviewable performance bar should the browser indexer target on a current desktop Chromium build?

**Branch:** Performance

**Recommended answer:** Practical repo scale
> The scaffold preflight measured the current self-repo at 901 indexed files and
> 16,127 nodes. A 60-second local-index target and 150 ms read target are
> meaningful for the zero-install evaluation path without turning SPEC-007 into
> a large-repo optimization project.

**Alternatives offered:**
- Demo-scale only: allows 120 seconds and has no query-latency gate.
- Large-repo stretch: adds a 10k-file/100k-node target and likely more
  optimization scope.

**User's answer:** Practical repo scale (Recommended)

---

### Q20. How should local indexes handle browser storage quota and eviction risk?

**Branch:** Storage lifecycle

**Recommended answer:** Estimate, request persistence, never auto-delete
> `StorageManager` exposes quota and persistence controls in workers and windows.
> Explicit retention and deletion keep local data ownership predictable.

**Alternatives offered:**
- Best effort only: smaller UI, but failures and retention become surprising.
- Auto-evict old indexes: reduces interruptions, but can delete user data without
  a direct command.

**User's answer:** Estimate, request persistence, never auto-delete (Recommended)

---

### Q21. What browser-support claim should SPEC-007 make?

**Branch:** Compatibility

**Recommended answer:** Chromium full, others graceful
> This matches AC-7.4 and the uneven folder-access surface: guarantee the complete
> picker/reconnect path where the API exists, use snapshot ingestion where
> directory-entry APIs permit it, and otherwise report the exact missing
> capability.

**Alternatives offered:**
- Full three-browser parity: requires additional nonstandard selection/storage
  paths.
- Chromium only: simplest, but does not satisfy graceful degradation.

**User's answer:** Chromium full, others graceful (Recommended)

---

### Q22. How should SPEC-007 be split given the estimator's three-slice recommendation?

**Branch:** Delivery and reviewability

**Recommended answer:** Three vertical slices
> The required `estimate-spec-size` helper returned
> `estimated_loc=1055`, `suggested_slices=3`, and `status=warn` from seven user
> stories, thirteen projected production files, and twenty-four functional
> requirements. Three independently demonstrable slices keep the expanded
> browser runtime reviewable.

**Alternatives offered:**
- Two larger slices: fewer integration points, but heavier reviews.
- Single implementation PR: one integration point, but exceeds the advisory
  reviewability guidance.

**User's answer:** Three vertical slices (Recommended)

## Open Questions

- **What:** Confirm the exact official SQLite-Wasm package/version, asset-copy
  wiring, and CSP declaration.
  **Why deferred:** This is dependency and build research rather than a product
  choice.
  **Suggested next step:** Resolve during `/speckit-plan` against the official
  SQLite Wasm documentation and the repository's `copy-assets` contract.
- **What:** Define the smallest schema/query adapter and source-cache tables that
  preserve current UI result shapes without forking the canonical graph schema.
  **Why deferred:** It depends on detailed inspection of `QueryBuilder`, schema
  migrations, and symbol-source reads.
  **Suggested next step:** Record the data model and worker RPC contract in
  `plan.md`, `data-model.md`, and a local repository-client contract.
- **What:** Pin the reference laptop/browser conditions for the 60-second and
  150-millisecond UAT measurements.
  **Why deferred:** The user selected the target profile; the reproducible
  measurement fixture belongs in planning.
  **Suggested next step:** Define hardware/runtime disclosure and a deterministic
  self-repo UAT procedure during `/speckit-plan`.

No user-blocking scope question remains.

## Recommended Next Step

**Run setup.** This document was produced in setup mode. Populate and commit the
SPEC-007 workflow and map-of-content, then start a new Codex task rooted at the
dedicated worktree and run `$speckit-autopilot` with the workflow path.
