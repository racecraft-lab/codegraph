# Implementation Plan: LSP Server Facade

**Branch**: `009-lsp-server-facade` | **Date**: 2026-07-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-lsp-server-facade/spec.md`

## Summary

Add a repository-bound, read-only LSP facade over standard input/output and the
packaged local server's reserved WebSocket upgrade seam. One shared dispatcher
answers lifecycle, definition, references, hover, document symbols, workspace
symbols, and the custom snapshot-aware content request from deterministic daemon
reads. The packaged browser adds one dormant, focused, accessible source pane on
symbol detail. Delivery remains two vertical slices: core/stdio/conformance,
then WebSocket/viewer/UAT.

## Technical Context

**Language/Version**: TypeScript 5.x at the root and TypeScript 6 in `web/`,
running on Node `>=20.0.0 <25.0.0`; verification uses Node 24.11.1.

**Primary Dependencies**: Existing Commander 14, `node:http`, daemon
`SocketTransport`, SQLite graph APIs, React 19.2, React Router DOM 7.18.1,
Base UI/Tailwind primitives, and new pure-JS `ws` with `@types/ws` for typing.

**Storage**: Existing `.codegraph/` SQLite/FTS database and indexed file
metadata. No schema migration and no new persisted state.

**Testing**: Root Vitest 3.2 with real temp repositories/SQLite and real child
process/socket transports; web Vitest 4.1 + React Testing Library; Playwright
1.61 for browser/package/self-repo UAT.

**Target Platform**: Packaged and npm CodeGraph on macOS, Linux, and Windows;
stdio is cross-platform, and WebSocket remains loopback/same-origin.

**Project Type**: Local-first TypeScript library/CLI/daemon/server plus packaged
React web application.

**Performance Goals**: Deterministic capped results (workspace symbols 100,
references/document symbols 500); 1 MiB inbound message/source caps; 16 in-flight
WebSocket requests; 5-second accepted-request deadline; viewer pointer activity
must not consume unbounded request slots.

**Constraints**: Read-only allowlist; exact persisted evidence only; UTF-16 wire
positions; no auto-indexing, schema writes, background reconnect, external
network calls, bearer token in WebSocket URLs, or optional native dependency.

**Scale/Scope**: One repository per session, one focused browser source pane,
two transports sharing one dispatcher, and six advertised read capabilities
including the custom content extension.

**Reviewability Budget**: Primary surface per slice is harness/adapter. Across
the accepted two-slice exception the declared operations contain 17 TypeScript
production-or-test review files and 20 total entries; the installed estimator
projects 680 reviewable LOC. Slice 1 contains 8 TypeScript review files (320
projected LOC) and Slice 2 contains 9 (360 projected LOC). Each slice stays below
the 400-LOC warning ceiling independently; the combined warning is accepted only
because Grill Me ratified the two independently testable slices.

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Pre-design decision | Post-design evidence |
|---|---|---|
| I. Think Before Coding | Fifteen clarification decisions freeze lifecycle, security, source, navigation, and accessibility behavior. | No `NEEDS CLARIFICATION` remains; contracts name exact errors, limits, and state transitions. |
| II. Simplicity First | One dispatcher and one daemon read authority serve both transports; no editor workspace or speculative configuration. | Three small new root LSP modules and one WebSocket adapter; browser adds one source pane. |
| III. Surgical Changes | New capability lives in `src/lsp/`, `src/server/`, and `web/`; the upstream-heavy CLI gets one lazy command registration. | No schema change; `src/mcp/read-ops.ts` and `src/server/daemon-client.ts` receive only additive reads/wrappers. |
| IV. Goal-Driven Execution | Each slice begins with behavior/black-box tests and ends with packaged UAT. | Quickstart and task inputs identify focused, integration, package, and self-repo evidence. |
| V. Deterministic, LLM-Free Extraction | All results come from persisted nodes, located edges, and hash-matching indexed source. | Contract returns honest null/empty on ambiguous or unprovable positions. |
| VI. Retrieval Performance | Reads are capped and reuse the daemon; any `src/mcp/` diff receives retrieval-guardian review. | Slice 1 includes focused cap/determinism tests and final retrieval-guardian gate. |
| VII. Local-First, Private, Zero Native Dependencies | `ws` is pure JS; server stays dormant until invoked and no feature state is persisted. | WebSocket uses existing loopback/Host policy, same-origin admission, redaction, and no external requests. |

**Gate result**: PASS before and after design. The accepted two-slice delivery is
a reviewability decomposition, not a constitutional exception to product
behavior. No Complexity Tracking row is needed.

### Actual Slice 1 Reviewability Disposition

The implemented Slice 1 diff contains 1,197 added production lines across six
production files, excluding its 449-line black-box/unit test harness. That is a
size-only block against the 800-line hard ceiling and invalidates the projected
single-marker Slice 1 boundary. Correctness and G7 verification remain green.

Autopilot therefore continues through two ordered review markers while retaining
the ratified product scope and dependency order:

| Marker | Review scope | Actual production additions | Result |
|---|---|---:|---|
| `M1-lsp-read-core` | Protocol helpers plus daemon read authority/wrappers (`T003`–`T005`, `T008`–`T009`, `T014`) | 505 across 3 files | Warn; below the 800-line hard ceiling |
| `M2-lsp-stdio-facade` | Facade, stdio transport, CLI, black-box/UAT verification (`T006`–`T007`, `T010`–`T013`, `T015`–`T017`) | 692 across 3 files | Warn; below the 800-line hard ceiling |

The final full diff must use the persisted marker plan and marker-based PR
emission; it must not fall back to one all-changes PR. Slice 2 receives the same
actual-diff check before its checkpoint.

## Research Decisions

Full rationale and alternatives are in [research.md](research.md). Binding
design decisions are:

- Extend the existing daemon `codegraph/read` vocabulary. The daemon owns graph
  cursor/symbol reads and the entire linearized secure source-read sequence.
- Add `src/lsp/protocol.ts`, `facade.ts`, and `stdio-server.ts`; do not reuse the
  outbound external-language-server client as an inbound server implementation.
- Use `ws` in `noServer` mode on the existing HTTP upgrade seam with
  `maxPayload=1_048_576`, compression disabled, and explicit session ownership.
- Keep `codegraph/textDocumentContent` as an experimental CodeGraph extension;
  document the standardized LSP 3.18 text-only request as distinct.
- Use React Router search navigation for repository-relative location state and
  a single-tab-stop source composite with named hover/definition actions.

## Frozen Operational Limits

| Limit | Value | Behavior |
|---|---:|---|
| Stdio header section | 8 KiB and 32 header lines | Boundary failure is fatal; no resynchronization. |
| Inbound JSON-RPC/WebSocket message | 1,048,576 bytes | Stdio framing exits nonzero; WebSocket closes 1009. |
| Returned source | 1,048,576 UTF-8 bytes | Read cap plus one sentinel byte; envelope overhead is additional. |
| WebSocket in flight | 16 ID-bearing requests | Request 17 gets `-32803` with reason `overloaded`; never queued. |
| Request deadline | 5,000 ms from dispatch | `-32803` with reason `timeout`; late result discarded. |
| Outbound high-water | 2 MiB `bufferedAmount` | Stop dispatch; drain for at most 5 seconds, then close 1013. |
| Hover coalescing | 150 ms latest-wins window | Cancellation/generation guard; at most one hover dispatch pending. |
| Workspace symbols | 100 | Full stable order before cap. |
| References/document symbols | 500 | Deduplicate and full stable order before cap. |

## Source Authority and Position Algorithm

The daemon is the sole trust authority because it already owns the warm graph,
bound root, and indexed file record. A source/content read canonicalizes the
indexed relative path, opens one regular-file handle, reads at most cap plus a
sentinel, hashes the exact candidate bytes, re-checks file identity/containment
and index metadata, then returns only a fully matching snapshot. No partial bytes
leave the operation.

One shared position converter consumes that verified snapshot. It maps incoming
overlong LSP characters to line end. For outgoing persisted columns it evaluates
the graph-native UTF-8-byte and JavaScript UTF-16 interpretations against exact
token/name evidence; candidates that converge produce one UTF-16 range, while
distinct or unprovable candidates return the method-appropriate null/empty/error.
No nearest-line or project-name fallback is allowed.

## Project Structure

### Documentation

```text
specs/009-lsp-server-facade/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── lsp-protocol.md
│   ├── websocket-transport.md
│   └── source-viewer.md
└── tasks.md                 # generated by Phase 5
```

### Source Code

```text
src/lsp/
├── protocol.ts              # NEW: server-side JSON-RPC/LSP types, errors, positions
├── facade.ts                # NEW: repository-bound lifecycle and read dispatcher
└── stdio-server.ts          # NEW: bounded Content-Length transport/process lifecycle
src/mcp/read-ops.ts          # additive daemon graph/source read operations
src/server/daemon-client.ts  # typed facade read wrappers
src/server/lsp-websocket.ts  # NEW: noServer upgrade/session adapter
src/server/index.ts          # reserved upgrade seam wiring and ordered shutdown
src/bin/codegraph.ts         # minimal lazy `lsp [path]` command
web/src/lib/lsp/client.ts     # NEW: native browser JSON-RPC/session client
web/src/components/symbol/SourcePane.tsx # NEW: accessible focused source viewer
web/src/routes/SymbolDetailRoute.tsx     # source-pane integration only
```

**Structure Decision**: Reuse the existing fork-owned LSP/server/web directories,
the additive daemon read boundary, and the reserved SPEC-005 upgrade seam. Do not
add a second graph store, REST mirror, schema migration, editor package, or new
top-level project.

## Slice 1: Read-only LSP Core and Stdio

### Production file table

| Operation | Path | Responsibility | Verification |
|---|---|---|---|
| NEW | `src/lsp/protocol.ts` | Server protocol types, lifecycle/error vocabulary, UTF-16 conversion and stable ordering helpers. | Unicode, ambiguity, ordering, caps. |
| NEW | `src/lsp/facade.ts` | Prebound lifecycle state and explicit read dispatcher shared by both transports. | Lifecycle/allowlist/method parity. |
| NEW | `src/lsp/stdio-server.ts` | Bounded Content-Length parser/writer, stderr-only diagnostics, signals/EOF cleanup. | Fragment/coalesce/fatal framing black box. |
| MODIFIED | `src/mcp/read-ops.ts` | Add exact cursor, references, file/workspace symbols, indexed metadata, and trusted content reads. | Real SQLite/source/race fixtures. |
| MODIFIED | `src/server/daemon-client.ts` | Add typed wrappers for new closed read operations. | Daemon transport/error mapping. |
| MODIFIED | `src/bin/codegraph.ts` | Lazy `codegraph lsp [path]` startup and nonzero pre-session failures. | Packaged CLI black box. |

### Slice 1 test and delivery table

| Operation | Path | Coverage |
|---|---|---|
| NEW | `__tests__/lsp-protocol-read.test.ts` | Protocol, Unicode, ordering, caps, and trusted daemon source-read behavior. |
| NEW | `__tests__/lsp-server.test.ts` | Lifecycle, roots, methods, exact evidence, and deterministic facade behavior. |
| NEW | `__tests__/lsp-stdio-black-box.test.ts` | Built process, framing, stdout purity, unsupported methods, shutdown/signals/orphan checks. |

**Slice 1 estimate**: 8 TypeScript review files × 40 = 320 projected
reviewable LOC; 8 total entries; one harness/adapter primary surface; PASS.

## Slice 2: WebSocket and Focused Viewer

### Production file table

| Operation | Path | Responsibility | Verification |
|---|---|---|---|
| NEW | `src/server/lsp-websocket.ts` | Perimeter-first noServer upgrade, WebSocket wire mapping, limits/backpressure, idempotent cleanup. | Real HTTP/WebSocket security/lifecycle. |
| MODIFIED | `src/server/index.ts` | Replace reserved destroy hook with adapter, share client pool, ordered session shutdown. | Existing server plus upgrade/shutdown tests. |
| NEW | `web/src/lib/lsp/client.ts` | Native browser JSON-RPC client, typed errors, generation/cancellation, no reconnect. | Client state/error tests. |
| NEW | `web/src/components/symbol/SourcePane.tsx` | Single-tab-stop composite, named actions, source, grouped references, states/retry. | RTL + axe/keyboard tests. |
| MODIFIED | `web/src/routes/SymbolDetailRoute.tsx` | Open/close pane and repo-relative query-history integration while preserving metadata. | Partial-degradation/history tests. |
| MODIFIED | `package.json` | Add pure-JS `ws`; add `@types/ws` as development-only typing. | Install/build/package audit. |
| MODIFIED | `package-lock.json` | Lock dependency graph. | `npm ci`/package checks. |
| MODIFIED | `CHANGELOG.md` | User-facing Unreleased capability and dormant/local safety note. | Changelog review. |

### Slice 2 test and delivery table

| Operation | Path | Coverage |
|---|---|---|
| NEW | `__tests__/lsp-websocket.test.ts` | Host/Origin/repo admission, close/error mapping, 16/5s/2MiB limits, isolation and cleanup. |
| NEW | `web/src/tests/source-pane.test.tsx` | Content/errors, hover/definition, refs, URL history, keyboard, retry and race guards. |
| NEW | `web/src/tests/source-viewer-uat.spec.ts` | Packaged self-repo browser source navigation and stale/unavailable recovery. |
| MODIFIED | `web/src/tests/package-offline.spec.ts` | No external requests/assets and source socket dormancy. |

**Slice 2 estimate**: 9 TypeScript review files × 40 = 360 projected
reviewable LOC; 12 total entries including manifests/docs; one harness/adapter
primary surface; PASS.

## Declared File Operations

- NEW src/lsp/protocol.ts
- NEW src/lsp/facade.ts
- NEW src/lsp/stdio-server.ts
- MODIFIED src/mcp/read-ops.ts
- MODIFIED src/server/daemon-client.ts
- MODIFIED src/bin/codegraph.ts
- NEW __tests__/lsp-server.test.ts
- NEW __tests__/lsp-protocol-read.test.ts
- NEW __tests__/lsp-stdio-black-box.test.ts
- NEW src/server/lsp-websocket.ts
- MODIFIED src/server/index.ts
- NEW web/src/lib/lsp/client.ts
- NEW web/src/components/symbol/SourcePane.tsx
- MODIFIED web/src/routes/SymbolDetailRoute.tsx
- MODIFIED package.json
- MODIFIED package-lock.json
- MODIFIED CHANGELOG.md
- NEW __tests__/lsp-websocket.test.ts
- NEW web/src/tests/source-pane.test.tsx
- NEW web/src/tests/source-viewer-uat.spec.ts
- MODIFIED web/src/tests/package-offline.spec.ts

## Execution and Verification Flow

1. Slice 1 starts with failing lifecycle/exactness/source/framing tests, adds the
   daemon reads and shared dispatcher, then wires stdio and the CLI.
2. Verify Slice 1 with focused tests, build, typecheck, full root tests, the
   packaged generic client, process cleanup probes, and G7 evidence.
3. Slice 2 starts with failing upgrade/security/resource and browser interaction
   tests, adds `ws` and the server adapter, then the browser client/source pane.
4. Verify Slice 2 with focused root/web tests, root + web builds/typechecks,
   package/offline checks, browser UAT, self-repo UAT, and full suites.
5. Because `src/mcp/read-ops.ts` changes, run retrieval-guardian before shipping;
   then complete verify, verify-tasks, comprehensive review, reviewability,
   PR-packet, PR, remediation, and retrospective gates.

## PR Review Packet Source

- **What/why**: deterministic graph intelligence through standard read-only LSP
  and the packaged source viewer.
- **Non-goals**: mutation, diagnostics, buffer sync, indexing, cross-origin/TLS,
  editor workspace, external language-server proxying.
- **Review order**: daemon reads → protocol/stdio → WebSocket → browser viewer →
  tests/package/changelog.
- **Scope budget**: quote the two slice tables and installed estimator output.
- **Traceability**: map FR/SC groups to the declared files and test commands.
- **Verification**: record focused/full tests, generic stdio client, real
  WebSocket, browser UAT, and self-repo evidence.
- **Known gaps**: exact-evidence gaps return null/empty; no heuristic fallback.
- **Rollback/activation**: revert the additive command/upgrade seam; without
  `codegraph lsp` or an open source pane the feature remains dormant.

## Complexity Tracking

No constitutional violations. The multi-surface feature is contained by the
user-ratified two-slice decomposition; each slice is independently reviewable,
testable, and below the reviewable-LOC warning ceiling.
