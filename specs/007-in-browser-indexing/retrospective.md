---
feature: "SPEC-007 - In-Browser Indexing"
branch: "007-in-browser-indexing"
date: "2026-07-28"
completion_rate: 100
spec_adherence: 100
counts:
  tasks_total: 38
  tasks_completed: 38
  functional_requirements: 63
  nonfunctional_requirements: 0
  success_criteria: 21
  requirements_implemented: 84
  requirements_partial: 0
  requirements_modified: 0
  requirements_not_implemented: 0
  requirements_unspecified: 0
  critical_findings: 0
---

# SPEC-007 Retrospective

## Executive Summary

SPEC-007 delivered private, browser-local repository indexing through the
existing SPA. All 38 tasks are complete, all 63 functional requirements and 21
success criteria have implementation and test evidence, and no NFR series was
defined. Completion and spec adherence are both 100%.

The implementation follows the planned architecture: a dedicated worker owns
SQLite-Wasm and indexing work, OPFS SAH-pool persists the graph, a shared
extraction kernel preserves Node/browser semantics, and the UI routes through a
typed repository-client boundary. Keyword indexing and reads remain local and
network-dormant. Semantic indexing is a separate, explicit, resumable operation
against an operator-selected HTTPS endpoint with page-memory-only credentials.

The principal deviation was review surface, not product scope. The scaffold
estimated 1,055 changed lines, while the final review-remediation checkpoint
contained 86 changed files and 24,938 additions. The feature still preserves
the ratified three vertical slices, introduces no fourth capability class, and
remains one navigable draft PR.

## Proposed Spec Changes

None. The implementation does not require edits to `spec.md`, so no
spec-modification human gate is needed.

## Requirement Coverage

Adherence formula:

```text
((84 implemented + 0 modified + (0 partial * 0.5)) /
 (84 total - 0 unspecified)) * 100 = 100%
```

| Requirement IDs | Count | Result | Primary evidence |
|---|---:|---|---|
| FR-001–FR-010 | 10 | Implemented | Capability probing, deliberate picker/drop admission, traversal budgets, lazy grammar loading, worker indexing, and persistent local repository creation in `web/src/local-indexing/` plus capability/worker/full-path tests. |
| FR-011–FR-020 | 10 | Implemented | Local overview/search/source/relationships/graph/impact, runtime labeling, reconnect, refresh/delete lifecycle, capability guidance, quota/persistence, and lock ownership in the local client, SPA state, routes, and lifecycle/storage/lock tests. |
| FR-021–FR-030 | 10 | Implemented | Default network dormancy, explicit semantic consent, memory-only bearer keys, secure endpoint policy, deterministic extraction, typed repository clients, handle/registry lifecycle, source retention, atomic generation publication, and error mapping. |
| FR-031–FR-040 | 10 | Implemented | File admission parity, lazy shipped assets, single-tab ownership, cancellation, transactional refresh, storage estimation, canonical schema/migrations, cleanup, and bounded per-file warnings in source/SQLite/worker code and recovery tests. |
| FR-041–FR-050 | 10 | Implemented | Versioned worker RPC, secret-free embedding profiles, redacted semantic failures, privacy audit, trusted-host policy, packaged assets, cross-runtime fixtures, responsiveness evidence, three-browser degradation, and keyboard/focus coverage. |
| FR-051–FR-060 | 10 | Implemented | Accessible long-operation UI, active-operation deletion, hostile path rejection, inert source rendering, shutdown/recovery, vector convergence, generation-aligned refresh counts, failure-point recovery, message budgets, and query-plan evidence. |
| FR-061–FR-063 | 3 | Implemented | Resource cleanup/high-water evidence, lazy package request inventory, and cancellable/resumable semantic work with responsive local reads. |
| NFR series | 0 | Not defined | Performance, privacy, integrity, accessibility, and shipping constraints were expressed as FRs and SCs. |
| SC-001–SC-007 | 7 | Met | Chromium folder import; labeled snapshot fallback; explicit deletion; zero repository egress without consent; local graph experience; last-good-state recovery; secret absence. |
| SC-008–SC-014 | 7 | Met | Self-repository indexing under 60 seconds; read p95 under 150 ms; package-local assets; cross-runtime semantics; accessible/mobile/reduced-motion flows; hostile-path containment; inert hostile source. |
| SC-015–SC-021 | 7 | Met | Transaction recovery; generation-consistent refresh; semantic convergence; lock release; enforced budgets; lazy asset ordering; responsive reads during semantic work. |

No requirement is partial, modified, absent, or implemented outside the
ratified requirement set.

## Success Criteria Assessment

| Criterion | Result | Evidence summary |
|---|---|---|
| SC-001 | Met | Current Chromium creates a browser-local repository through the deliberate picker path without a server dependency. |
| SC-002 | Met | Directory drop creates a labeled snapshot where supported; Firefox/WebKit capability tests provide exact independent guidance. |
| SC-003 | Met | Delete removes accepted source, registry, graph, and OPFS state without writing to the selected folder. |
| SC-004 | Met | No-consent import/read/refresh/reload/delete audits record zero repository-derived requests. |
| SC-005 | Met | The local client supplies overview, keyword search, symbol/source, relationships, graph, and bounded impact with local/server trust labels. |
| SC-006 | Met | Cancellation, fatal failure, and bounded warnings preserve the prior readable generation. |
| SC-007 | Met | Bearer keys remain in memory and are excluded from storage, URLs, logs, errors, and fixtures. |
| SC-008 | Met | Two 737-file self-repository runs completed in 7.64 and 5.99 seconds; the post-CodeQL checkpoint completed in 6.05 and 5.50 seconds. |
| SC-009 | Met | Latest 20-sample p95 was 61.5 ms search, 73.1 ms graph, and 70.7 ms impact, below the 150 ms target. |
| SC-010 | Met | CLI-served/package tests byte-verify all required workers, SQLite/tree-sitter assets, grammars, database, and manifest entries with no CDN fallback. |
| SC-011 | Met | Shared fixtures compare accepted manifests, language maps, symbol/edge projections, warnings, grammar loads, and repeated counts across runtimes. |
| SC-012 | Met | Keyboard/focus, assistive status, 320 CSS-pixel overflow, and reduced-motion assertions pass in component and Chromium journeys. |
| SC-013 | Met | Hostile traversal, duplicate, cycle, entry-kind, binary, unreadable, and budget inputs yield only accepted-safe entries plus bounded warnings. |
| SC-014 | Met | Script-like and URL-like source renders as inert text and causes no execution or source-derived request. |
| SC-015 | Met | Failure injection across staging, graph write, publish, status, migration, quota, crash, and delete cleanup preserves or restores a readable generation. |
| SC-016 | Met | Incremental refresh aligns added/changed/deleted/unchanged/skipped counts with graph, source, manifest, and semantic metadata in one generation. |
| SC-017 | Met | Model, dimension, generation, hash, cancellation, and partial-response cases resume or mark semantic state stale while keyword reads remain available. |
| SC-018 | Met | Close/crash/delete tests release ownership or expose recoverable stale ownership without concurrent database access. |
| SC-019 | Met | Self-repository evidence enforces file-batch, worker-payload, snapshot, progress, embedding-batch, and vector-write ceilings. |
| SC-020 | Met | Packaged evidence records asset bytes, bundle impact, and demand-driven request order. |
| SC-021 | Met | During semantic work, local p95 remains below 150 ms; cancellation stops later batches and resumable state stays generation-consistent. |

## Architecture Drift

| Planned decision | Implemented result | Drift |
|---|---|---|
| One SPA with REST and browser-local runtimes | Shared `RepositoryClient` boundary with server and local implementations | None |
| Dedicated worker owns parsing and SQLite | Versioned worker RPC contains parse/store/publish and semantic operations | None |
| Official SQLite-Wasm OPFS SAH-pool | Worker-owned SAH-pool plus canonical schema and browser source-cache migration | None |
| Shared pure extraction semantics | `src/extraction/browser-kernel.ts` supplies shared admission/extraction behavior; adapters load runtime-specific parsers | None |
| Manual incremental refresh | Hash-manifest delta and one-generation transactional publication | None |
| Keyword-first, optional semantic indexing | Keyword graph publishes first; semantic work requires explicit consent and a re-entered page-memory key | None |
| Chromium full path, honest independent degradation | Full Chromium acceptance plus Firefox/WebKit capability-specific tests | None |
| Same-origin shipped assets, no CDN | Build/package manifest verifies local worker/WASM/database assets and demand-driven loads | None |

The implementation did not introduce a watcher, archive ingestion, browser Git
clone, service worker, hosted proxy, provider-specific semantic contract, or
another capability class.

## Deviations And Root Causes

| Severity | Deviation | Evidence | Root cause and recommendation |
|---|---|---|---|
| SIGNIFICANT | Review surface materially exceeded the 1,055-line scaffold estimate. | The pre-retrospective head contains 86 files and +24,938/-2,094 versus `origin/main`; production/config alone had already exceeded 10,000 added lines at the reviewability gate. | Planning captured the architecture but undercounted storage failure paths, browser matrices, accessibility, packaging, and evidence-heavy tests. Future estimates should price each acceptance matrix and generated/process surface separately before implementation. |
| MINOR | Source-derived UAT skeleton generation was skipped. | The installed `generate-uat-skeleton` helper was deferred; executable UAT remained in `quickstart.md` and Playwright. | Treat a missing helper as fail-open, but promote a stable generator so the canonical runbook is not reconstructed from tests. |
| POSITIVE | Post-review hardening expanded error, type, ingress, and filesystem boundaries without changing requirements. | Specialized error/type reviews drove regression tests; later bounded re-reviews returned no findings. | Run these focused reviews at slice boundaries, not only in the post tail. |
| POSITIVE | CodeQL findings produced structural fixes rather than suppressions for HTML-tag parsing, worker ingress, and self-repository file reads. | Vue script extraction uses a bounded scanner; worker messages reject unexpected origins; benchmark reads use an open descriptor with `fstat`. | Add browser-security static analysis before the final full matrix. |
| POSITIVE | The autopilot bootstrap failure was repaired in the authoritative SpecKit Pro source. | SpecKit Pro draft PR #397 makes nearest trusted worktree markers win over ancestor runner-source markers and supports Python 3.11 mutation-lock stat calls; 4,242/4,242 tests and release-artifact checks pass. | Keep nested linked-worktree fixtures in the runner suite so installed payloads cannot regress root discovery. |

No deviation changes user-visible scope, requirement meaning, or constitution
compliance.

## Innovations And Reusable Practices

1. **Generation-aligned local publication.** Source cache, graph rows, accepted
   manifest, visible status, and semantic stale/resume metadata move together.
   This transaction pattern is reusable for future browser-local derived data.
2. **Capability-specific degradation.** Each browser capability is probed and
   explained independently instead of inferring behavior from browser names.
3. **Demand-driven package proof.** Static-host tests verify not only asset
   presence and bytes but the order in which heavyweight assets are requested.
4. **Descriptor-bound benchmark input.** Opening, validating, and reading the
   same file descriptor removes the self-repository test's time-of-check/time-
   of-use window and is reusable in filesystem-backed test harnesses.
5. **Nearest-marker worktree bootstrap.** Runner discovery now honors the
   closest trusted project marker before considering any ancestor's vendored
   runner source.

These are implementation and process practices, not proposed constitution
changes.

## Constitution Compliance

| Principle | Result | Evidence |
|---|---|---|
| I. Think Before Coding | Pass | Four clarification sessions, research, data model, contracts, and two plan constitution gates preceded implementation. |
| II. Simplicity First | Pass | One SPA, one client boundary, one shared kernel, one worker-owned store; declared non-goals remain absent. |
| III. Surgical Changes | Pass with size warning | Every changed production surface traces to extraction, persistence, worker, local client, UI, packaging, or acceptance evidence; no unrelated capability was added. |
| IV. Goal-Driven Execution | Pass | All 38 tasks record red/green/refactor evidence and proportional verification. |
| V. Deterministic Extraction | Pass | Shared fixtures and repeated self-repository runs preserve semantic projections and deterministic counts. |
| VI. Retrieval Performance | Pass | Latest search/graph/impact p95 is 61.5/73.1/70.7 ms against the 150 ms target. |
| VII. Local-First, Private, Zero Native Dependencies | Pass | Default local flows are network-dormant; assets are JS/WASM and package-local; semantic egress is explicit, HTTPS-only, credential-ephemeral, and separate from keyword availability. |

Critical constitution violations: None.

## Unspecified Implementations

No unspecified product capability was added. Review remediation added only
bounded correctness/security protections and tests:

- explicit dedicated-worker origin rejection;
- descriptor-bound self-repository fixture reads;
- structural Vue script-boundary scanning;
- more defensive protocol/error handling and type invariants.

These preserve existing requirements and count as hardening, not scope drift.

## Task Execution Analysis

| Measure | Result |
|---|---|
| Tasks | 38/38 complete |
| Slice 1 | T001–T012 complete: browser graph bootstrap |
| Slice 2 | T013–T024 complete: local repository shell and lifecycle |
| Slice 3 | T025–T038 complete: degradation, semantic opt-in, and shipping |
| Phantom-task verification | Pass: 35 implementation tasks verified; T012, T024, and T038 correctly classified as process checkpoints |
| Dropped tasks | None |
| Added product tasks | None |
| Review remediation | Completed outside task scope as canonical post-workflow hardening |

The three planned slices remained independently demonstrable, although their
implementation was much larger than the scaffold estimate.

## Lessons And Recommendations

1. **High priority — estimate acceptance matrices explicitly.** Count storage
   failure points, browser projects, accessibility states, package modes, and
   privacy/performance evidence as separate review surfaces.
2. **High priority — run CodeQL before the final matrix.** Browser boundary
   fixes then land before expensive cross-browser and self-repository runs.
3. **Medium priority — retain nested-worktree bootstrap regression tests.**
   Project-root discovery must select the nearest trusted marker even when an
   ancestor contains an authoritative runner checkout.
4. **Medium priority — use descriptor-bound filesystem reads in benchmarks.**
   Do not validate a path and reopen it later.
5. **Medium priority — promote UAT skeleton generation.** The quickstart and
   Playwright suite are executable, but a canonical source-derived runbook
   should be available for future non-engineer acceptance.
6. **Low priority — keep the three-slice reviewer order visible.** The PR is
   large but navigable when reviewed as extraction/storage, lifecycle/UI, then
   degradation/semantic/shipping.

## File Traceability Appendix

| Concern | Primary implementation | Primary verification |
|---|---|---|
| Shared extraction and schema | `src/extraction/browser-kernel.ts`, `src/db/schema.sql`, `src/db/migrations.ts` | `__tests__/extraction-browser-kernel.test.ts`, `__tests__/db-browser-source-cache-migration.test.ts` |
| Capability and source admission | `web/src/local-indexing/capabilities.ts`, `web/src/local-indexing/source.ts` | `local-indexing-capabilities.test.ts`, `local-indexing-worker.test.ts`, degradation/full Playwright |
| SQLite/OPFS lifecycle | `web/src/local-indexing/sqlite.ts` | storage, locks, client, and full Playwright suites |
| Worker protocol and indexing | `web/src/local-indexing/worker.ts`, `web/src/local-indexing/extract.ts` | worker, full, privacy, and performance suites |
| Local repository client | `web/src/lib/repository-client.ts`, `web/src/local-indexing/client.ts` | client, route, shell, lifecycle, and recovery tests |
| Semantic opt-in | `web/src/local-indexing/embeddings.ts` | embedding, network/privacy, and full semantic suites |
| SPA lifecycle and accessibility | `web/src/app/state.tsx`, `RepositorySwitcher.tsx`, local-aware routes/styles | shell, route, accessibility, 320 px, keyboard, focus, and reduced-motion evidence |
| Shipping | asset manifest/copy/verify scripts, Vite/Playwright config | package-web-assets and packaged/static-host Playwright suites |
| User guidance | `CHANGELOG.md`, `specs/007-in-browser-indexing/quickstart.md` | documented commands and packaged CSP/privacy assertions |

## Self-Assessment

| Required check | Result | Basis |
|---|---|---|
| Evidence completeness | PASS | Every major deviation names a file, test, workflow result, PR, or measured behavior. |
| Coverage integrity | PASS | FR-001–FR-063, the empty NFR series, and SC-001–SC-021 are covered with no ID gaps. |
| Metrics sanity | PASS | Completion is 38/38 = 100%; adherence is 84/84 = 100%. |
| Severity consistency | PASS | The large review surface is significant; deferred UAT generation is minor; bounded hardening is positive; no critical issue remains. |
| Constitution review | PASS | All seven principles are evaluated and critical violations are explicitly `None`. |
| Human Gate readiness | PASS | Proposed Spec Changes is explicitly `None`; no spec-modifying action is requested. |
| Actionability | PASS | Six prioritized recommendations map directly to observed deviations or hardening evidence. |

Retrospective saved | Adherence: 100% | Completion: 100% | Critical findings: 0
