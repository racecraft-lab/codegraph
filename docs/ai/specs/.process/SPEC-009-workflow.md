# SpecKit Workflow: SPEC-009 - LSP Server Facade

**Template Version**: 1.0.0
**Created**: 2026-07-16
**Purpose**: Execute SPEC-009 from scaffold through implementation on branch
`009-lsp-server-facade`.

---

## Design Concept

This workflow was enriched from the required Grill Me interview run during
`$speckit-pro:speckit-scaffold-spec SPEC-009`.

The full decision log, goals, non-goals, protocol boundaries, security posture,
reviewability estimate, and accepted two-slice decomposition live at:

```text
docs/ai/specs/.process/SPEC-009-design-concept.md
```

Re-read that file before every phase. It is the source of truth for decisions
captured during scaffold. Grill Me is complete and is not part of autopilot;
later ambiguity is handled by `/speckit-clarify` and the normal consensus path.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|---|---|---|---|
| Specify | `/speckit-specify` | Complete | G1 passed: 3 stories, 23 scenarios, 45 requirements, and 12 success criteria with no unresolved markers. |
| Clarify | `/speckit-clarify` | Pending | Confirm protocol, security, and UI edge cases left by Specify. |
| Plan | `/speckit-plan` | Pending | Design additive daemon reads, transports, source pane, and slice boundaries. |
| Checklist | `/speckit-checklist` | Pending | Run API, streaming, security, and UX/accessibility checklists. |
| Tasks | `/speckit-tasks` | Pending | Generate dependency-ordered work for the accepted two slices. |
| Analyze | `/speckit-analyze` | Pending | Resolve cross-artifact gaps before implementation. |
| Confidence Gate | G6.5 | Pending | Score pre-implementation confidence in advisory mode. |
| Implement | `/speckit-implement` | Pending | Execute both vertical slices with TDD and black-box conformance. |
| Post | Canonical post gates | Pending | Verify, review, package, create PRs, remediate, and retrospect. |

**Status legend:** Pending | In Progress | Complete | Blocked

### Phase Gates

| Gate | Checkpoint | Approval criteria |
|---|---|---|
| G1 | After Specify | User stories and read-only protocol behavior are clear; no unresolved clarification marker remains. |
| G2 | After Clarify | Root binding, errors, limits, stale-source behavior, and viewer states are explicit. |
| G3 | After Plan | Constitution gates pass; daemon operations, transport lifecycle, dependencies, and two slice file tables are approved. |
| G4 | After Checklists | Every genuine gap is resolved in spec or plan; intentional exclusions are documented. |
| G5 | After Tasks | All requirements map to dependency-ordered tasks and each slice is independently testable. |
| G6 | After Analyze | No critical issue remains and warnings have explicit dispositions. |
| G6.5 | Before Implement | The latest confidence emit is evaluated in advisory mode with bounded remediation. |
| G7 | After each implementation slice | Focused tests, build/typecheck, black-box conformance, and required manual UAT pass. |

### Canonical Post Gates

Autopilot must keep these steps visible in durable workflow state and complete or
explicitly skip each before final handoff:

- Post: Doctor Extension Check
- Post: Verify Implementation
- Post: Verify Tasks Phantom Check
- Post: Code Review
- Post: Integration Suite
- Post: Reviewability Diff Gate
- Post: Self-Review
- Post: UAT Runbook Generation
- Post: Final Reviewability Backstop
- Post: PR Packet/Body Generation
- Post: PR Body Generation
- Post: PR Creation
- Post: Review Remediation
- Post: Retrospective

---

## Archive Sweep

| Field | Result |
|---|---|
| Status | Complete - no candidates |
| Execution path | Installed archive extension contract with Codex-native worktree binding |
| Current target excluded | `specs/009-lsp-server-facade` |
| Eligible previous specs | None; earlier merged specs already have archive reports |
| Cleanup | Not applied; `safeToApplyCleanup=false` |

The extension prerequisite script could not resolve a pre-Specify
`.specify/feature.json`. The already-validated worktree supplied the repository,
feature, memory, and template paths as allowed by the Codex adapter. The current
target was the only active directory under `specs/`, so the sweep completed as
a successful no-op.

---

## Prerequisites

### Worktree Binding

Run every phase from the dedicated worktree for this branch. Before each phase,
verify both commands:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --show-toplevel
```

The branch must be:

```text
009-lsp-server-facade
```

The top-level path must end in `/codegraph/.worktrees/009-lsp-server-facade`.
The scaffold handoff supplies the current machine's exact absolute root.

Do not run this workflow from the main checkout or another Codex worktree. If a
phase says the workflow file is not in the current checkout, stop and restart
from the dedicated worktree.

### Bootstrap Evidence

Scaffold bootstrap completed on 2026-07-16 with the repo-supported Node
`24.11.1`:

```bash
npm install
npm run build
```

Both commands passed and the tracked worktree remained clean. The worktree's
dogfood index is healthy and fully embedded: 748 files, 10,941 nodes, 45,461
edges, and 6,596/6,596 embeddings.

The embedding bootstrap used a user-approved secure, session-only transport and
did not change `.envrc.local`. Future re-embedding must use a user-approved
secure configured endpoint or tunnel; do not silently send source-derived data
to a non-loopback plaintext endpoint. Normal graph reads do not require that
endpoint.

### Agent and Preset Evidence

- Required Codex agents were checked with the installed agent helper; all ten
  files were current (`no_op`).
- `spec-template` resolves to
  `.specify/presets/speckit-pro-reviewability/templates/spec-template.md`.
- `plan-template` resolves to
  `.specify/presets/speckit-pro-reviewability/templates/plan-template.md`.
- `tasks-template` resolves to
  `.specify/presets/codegraph-project-overrides/templates/tasks-template.md`.

### Constitution Validation

Apply `.specify/memory/constitution.md` throughout:

| Principle | SPEC-009 requirement | Verification |
|---|---|---|
| Think Before Coding | Preserve the Grill Me decisions and resolve exact contracts before implementation. | `spec.md`, `clarifications`, `plan.md`, `research.md` |
| Simplicity First | Implement only the six roadmap read methods, one source extension, two transports, and the focused viewer. | Scope review and diff review |
| Surgical Changes | Use additive daemon reads and the reserved server seam; keep the upstream CLI diff minimal. | Declared file table, CodeGraph impact review, reviewability gate |
| Goal-Driven Execution | Prove packaged stdio and WebSocket behavior plus visible browser value. | Black-box fixtures, React tests, browser UAT, self-repo run |
| Deterministic, LLM-Free Extraction | Answer from persisted graph data only; never infer with an LLM or guessed text match. | Exact-mapping tests and no-result ambiguity tests |
| Retrieval Performance Is a Regression Surface | Bound searches and references; review all `src/mcp/` changes with retrieval-guardian. | Caps, focused performance tests, retrieval-guardian review |
| Local-First, Private, Zero Native Dependencies | Remain dormant until invoked, preserve loopback/same-origin behavior, and make no new network calls. | Security tests, offline/package tests, dependency review |

**Constitution check at scaffold:** PASS. Re-run pre- and post-design during Plan.

### Phase 0 Verification

| Check | Result | Evidence |
|---|---|---|
| Worktree and branch | Pass | Dedicated `009-lsp-server-facade` worktree; shell branch check authoritative |
| SpecKit prerequisites | Pass | Runner reported `all_pass=true`; workflow and constitution present |
| Codex agents | Pass | 10/10 current, `gpt-5.5`, dry-run mutation `no_op` |
| Build | Pass | `npm run build` on Node 24.11.1 |
| Typecheck | Pass | `npm run typecheck` on Node 24.11.1 |
| Lint | Skipped | No root lint command is defined |
| Baseline tests | Pass | `npm test`: 246 files, 4,095 passed, 7 skipped |
| Setup reviewability | Pass | Installed setup-mode gate: `status=pass`, `docs/process` surface |
| Plan coverage audit | Pass | 37 durable items; every phase and all 14 Post rows present |

The first sandboxed test attempt could not bind loopback ports or Unix sockets.
The authoritative baseline reran with local socket permissions and passed. Git
commit signing was disabled only for temporary fixture repositories so local
user signing policy could not invalidate those tests.

### Project Commands

| Purpose | Command |
|---|---|
| Build | `npm run build` |
| Typecheck | `npm run typecheck` |
| Unit/root suite | `npm test` |
| Web integration suite | `npm run test:web` |
| Full verify | `npm run build && npm run typecheck && npm test && npm run test:web` |

All Node commands use the repository-pinned Node 24.11.1. The runner's raw
`npm build` and `npm typecheck` detections were corrected to the scripts
defined by `package.json`.

### Capability Path

Capability path: codebase context -> `mcp__codegraph__codegraph_explore`;
library documentation -> Context7; web/domain research and source extraction ->
installed Tavily capabilities when needed; browser UAT -> installed Playwright
capabilities. Evidence: live runtime tool enumeration and runner capability
advisory. Confidence: high because each selected capability was enumerated in
this session.

### Scoped Instructions

Before planning or changing files, read the nearest scoped guidance, especially:

- `src/mcp/AGENTS.md`
- `src/server/AGENTS.md`
- `web/AGENTS.md` if present at implementation time
- `__tests__/AGENTS.md`

Changes under `src/mcp/` require the `retrieval-guardian` review before shipping.
Server WebSocket lifecycle work requires cleanup/backpressure lifecycle tests.

---

## Specification Context

### Basic Information

| Field | Value |
|---|---|
| Spec ID | SPEC-009 |
| Name | LSP Server Facade |
| Branch | `009-lsp-server-facade` |
| Dependencies | SPEC-005 complete; consumes the SPEC-005 server/daemon seam and the SPEC-006 web shell. SPEC-008 provides reusable LSP conventions but is not a roadmap dependency. |
| Enables | In-browser source intelligence and generic read-only LSP tooling over CodeGraph. |
| Priority | P0 |

### Roadmap Scope

Expose CodeGraph as a read-only LSP server through `codegraph lsp` over stdio and
through `/lsp` over WebSocket. Implement graph-backed initialize, definition,
references, hover, document symbols, and workspace symbols. Wire the packaged web
app to a focused source viewer with go-to-definition, references, and hover. Prove
the result with a scripted generic LSP client.

### Success Criteria Summary

- `codegraph lsp [path]` serves protocol-correct LSP over standard Content-Length
  framing against one prebound indexed repository.
- `/lsp?repo=<id>` serves the same read contract over one JSON-RPC text message per
  WebSocket frame while preserving SPEC-005 loopback, Host, and same-origin rules.
- Capabilities advertise only the six read methods, UTF-16 positions, no text
  synchronization, and the typed experimental content request.
- Definition, references, hover, and symbols use exact persisted graph evidence;
  ambiguity yields honest empty results.
- Mutation requests cannot reach write code and return Method Not Found.
- URI realpath containment, index membership, source hash equality, 1 MiB limits,
  timeouts, in-flight bounds, and cleanup behavior are covered by tests.
- The symbol page gains a focused read-only source pane with hover, definition
  history, grouped references, stale/unavailable states, and manual retry.
- Stdio and WebSocket black-box conformance plus self-repo browser UAT pass.
- Delivery remains two vertical slices, each within the plan-phase reviewability
  budget or split further before implementation.

---

## Phase 1: Specify

**When to run:** At feature start. Specify what users observe and why; keep
implementation choices only where the roadmap or Design Concept makes them
binding. Output: `specs/009-lsp-server-facade/spec.md`.

### Specify Prompt

```text
/speckit-specify

## Feature: LSP Server Facade

### Problem Statement
CodeGraph's persisted graph is available through its library, CLI, MCP, and local
REST API, but generic LSP tooling and the packaged browser source viewer cannot
consume it through a standard language-intelligence protocol. Expose a bounded,
read-only LSP facade over stdio and same-origin WebSocket without creating a
second analysis engine or allowing source mutation.

### Users
- A developer or local tool that wants definition, references, hover, and symbol
  discovery through standard LSP over stdio.
- A developer browsing an indexed repository in the packaged CodeGraph web app.
- A local operator who needs predictable security, resource limits, cleanup, and
  honest stale/unavailable behavior.

### User Stories
1. As a tooling user, I can start `codegraph lsp [path]`, initialize one indexed
   repository, query read-only graph intelligence, and shut down cleanly.
2. As a web user, I can open source for a symbol, inspect hover data and grouped
   references, and navigate to definitions within a focused source pane.
3. As an operator, I can trust that sessions stay repository-bound, same-origin,
   bounded, read-only, dormant until invoked, and fail closed on stale or unsafe
   input.

### Binding Behavior
- One repository is bound when the session is created. Supplied initialize roots
  must realpath-match it; multi-root is not supported.
- The server answers only from the persisted indexed snapshot and advertises no
  text synchronization or diagnostics.
- Implement initialize, definition, references, hover, documentSymbol, and
  workspace/symbol plus the advertised read-only
  `codegraph/textDocumentContent` extension.
- Use exact graph nodes/located semantic edges. Ambiguous positions return
  null/empty; no nearest-line or name fallback.
- Use UTF-16 positions. Cap workspace symbols at 100 and document symbols or
  references at 500.
- Accept only indexed file URIs inside the bound realpath. Reject content whose
  disk hash differs from the indexed hash.
- Reject unsupported requests with JSON-RPC -32601. Unsupported notifications
  are ignored and cannot mutate state.
- Limit messages/source to 1 MiB, WebSocket in-flight requests to 16, and request
  duration to 5 seconds.
- Preserve loopback-only packaged UI startup, Host validation, and same-origin
  browser upgrades; do not put bearer tokens in WebSocket URLs.
- When LSP fails in the browser, preserve the rest of symbol detail and show a
  manual retry for the source pane only.

### Reviewability
- Deliver two vertical slices: core/stdio/conformance, then WebSocket/viewer/UAT.
- The scaffold estimator returned 450 projected reviewable LOC, warn, two slices.
- Re-estimate from plan file tables and split further if either slice exceeds its
  allowed review surface.

### Out of Scope
- Mutating methods, diagnostics, unsaved-buffer overlays, auto-indexing, external
  language-server proxying, multi-repo sessions, remote URI schemes, cross-origin
  browser access, TLS, IDE packaging, and a tabbed editor workspace.
```

### Specify Results

| Metric | Value |
|---|---|
| Functional Requirements | 45 (`FR-001` through `FR-045`) |
| User Stories | 3 (`US1`, `US2`, `US3`) |
| Acceptance Criteria | 23 scenarios and 12 measurable success criteria |

### Files Generated

- [x] `specs/009-lsp-server-facade/spec.md`

Specify completed through the documented direct-execution recovery path after
two bounded `spec-executor` attempts produced no output. The requirements
quality checklist passed on its first iteration. Installed gate G1 passed with
zero `[NEEDS CLARIFICATION]` markers; Clarify remains mandatory as an audit and
refinement phase.

### Required Traceability

- Use `[US1]`, `[US2]`, and `[US3]` on user stories and acceptance scenarios.
- Assign stable `[FR-xxx]` identifiers to every protocol, security, viewer, and
  lifecycle requirement.
- Use `[NEEDS CLARIFICATION]` only for genuine unresolved behavior; do not reopen
  settled Grill Me decisions.
- Carry the accepted Slice 1/Slice 2 boundary into acceptance criteria so each
  slice remains independently demonstrable.

---

## Phase 2: Clarify

**When to run:** After Specify. Ask no more than five targeted questions per
session and encode every answer back into `spec.md`.

### Clarify Prompts

#### Session 1: LSP Contract

```text
/speckit-clarify Focus on protocol semantics: initialize/root validation,
request versus notification behavior, definition/reference range precision,
UTF-16 conversion, deterministic symbol ordering, result caps, and lifecycle
errors. Preserve the read-only allowlist and exact-evidence/no-guessing decisions.
```

#### Session 2: WebSocket and Security

```text
/speckit-clarify Focus on transport/security: Content-Length stdio framing,
one JSON-RPC object per WebSocket text frame, loopback/Host/Origin validation,
repo binding, malformed/binary/oversized frames, in-flight limits, timeout,
backpressure, peer disconnect, daemon loss, and server shutdown cleanup.
```

#### Session 3: Source Viewer and Degradation

```text
/speckit-clarify Focus on browser behavior: typed experimental source-content
contract, realpath/index/hash checks, focused source pane interaction, hover,
definition query-string/history navigation, grouped references, accessibility,
stale/unavailable states, manual retry, and connection dormancy.
```

### Clarify Results

| Session | Focus area | Questions | Key outcomes |
|---|---|---|---|
| 1 | LSP contract | Pending | Pending Clarify |
| 2 | WebSocket and security | Pending | Pending Clarify |
| 3 | Viewer and degradation | Pending | Pending Clarify |

---

## Phase 3: Plan

**When to run:** After the specification is final. Output the implementation
blueprint and supporting artifacts under `specs/009-lsp-server-facade/`.

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Runtime/backend: TypeScript on supported Node 20-24; Node 24.11.1 for local verification.
- CLI: Commander in `src/bin/codegraph.ts`, with the smallest upstream-facing diff.
- Graph access: additive typed `codegraph/read` operations over the existing daemon client.
- Stdio: standard LSP Content-Length JSON-RPC framing.
- WebSocket: `ws` on the server; native browser WebSocket in the packaged app.
- Frontend: React 19, React Router, Tailwind/shadcn primitives already shipped in `web/`.
- Data: existing SQLite/FTS graph and files metadata; no migration unless planning proves one is unavoidable.
- Tests: Vitest, real temp SQLite fixtures, real subprocess/HTTP/WebSocket integration, React Testing Library, and Playwright browser UAT.

## Binding Constraints
- Re-read `docs/ai/specs/.process/SPEC-009-design-concept.md` before design.
- Preserve the exact read-only capability and method allowlist.
- Reuse one shared repository-bound LSP dispatcher for both transports.
- Plan additive daemon operations for cursor lookup, located incoming references,
  file symbols, workspace symbols, indexed file metadata/hash, and source content.
- Decide whether secure source read/hash belongs inside the daemon operation or in
  the facade after an indexed-metadata read; use one authority, not two competing paths.
- Define typed params/results and error mapping for
  `codegraph/textDocumentContent`, advertised in ServerCapabilities.experimental.
- Use one UTF-16 conversion path with Unicode fixtures.
- Preserve SPEC-005 loopback-only browser startup, Host allowlist, and same-origin policy.
- Use `ws`; do not hand-roll RFC 6455.
- Keep the source viewer focused and read-only. Select the smallest accessible
  component that maps positions accurately; no tabs, editing, or workspace chrome.
- Add a user-facing `CHANGELOG.md` bullet under Unreleased for the new LSP facade/viewer.
- Touch `src/mcp/` surgically and schedule retrieval-guardian before shipping.

## Accepted Grill Me Answers
Treat the Q&A log as binding. The planning choices are the user's accepted
answers, quoted by their picker labels: "Two slices (Recommended)", "Bind on
connect (Recommended)", "Indexed snapshot (Recommended)", "Resolved graph
edges (Recommended)", "Focused source pane (Recommended)", "Use ws package
(Recommended)", "Reject by allowlist (Recommended)", "Return no result
(Recommended)", "Indexed file URIs only (Recommended)", "Deterministic hard
caps (Recommended)", "UTF-16 only (Recommended)", "Bounded graph metadata
(Recommended)", "LSP read extension (Recommended)", "Strict local bounds
(Recommended)", "Same-origin browsers (Recommended)", "Scripted black-box
test (Recommended)", "Degrade with retry (Recommended)", "Update source
location (Recommended)", "Daemon read operations (Recommended)", "Fail before
session (Recommended)", and "Reject as stale (Recommended)". Plan within those
answers; do not replace them with implementation preferences.

## Reviewability and Slices
- Produce a declared production-file table per slice and run estimate-reviewable-loc.
- Slice 1: daemon reads, shared LSP server, stdio CLI, protocol/unit/integration/black-box tests.
- Slice 2: ws bridge, server lifecycle/security, browser client/source pane, package/offline/browser UAT.
- Each slice must be independently valuable, testable, and below the applicable reviewability limit.
```

### Required Plan Artifacts

| Artifact | Status | Required content |
|---|---|---|
| `plan.md` | Pending | Technical context, constitution gates, two slice file tables, execution flow, reviewability result |
| `research.md` | Pending | `ws` integration, LSP lifecycle/error codes, UTF-16 conversion, source-viewer component choice, daemon source-read authority |
| `data-model.md` | Pending | Session, bound repo, request state, graph location, indexed source snapshot, viewer connection state |
| `contracts/` | Pending | LSP capability/method/error contract and typed experimental content extension; WebSocket handshake/frame contract |
| `quickstart.md` | Pending | Build/run/test stdio and WebSocket paths, fixture client, web viewer, and self-repo UAT |

### Plan Reviewability Gate

Run the installed read-only `estimate-reviewable-loc` helper against `plan.md` and
record its exact structured result here and in the Design/Implementation Summary.
The scaffold estimate is advisory; plan file tables are the next authoritative
pre-implementation sizing signal.

---

## Phase 4: Domain Checklists

**When to run:** After Plan. Run the four enriched domains below and address every
real gap before Tasks.

### 1. API Contracts

```text
/speckit-checklist api-contracts

Focus on SPEC-009:
- initialize capabilities, lifecycle state, requests versus notifications, and standard errors
- exact params/results for all six standard read methods
- typed codegraph/textDocumentContent params/result/error contract and experimental advertisement
- null/empty behavior, includeDeclaration, ordering, deduplication, UTF-16 ranges, and caps
- daemon operation compatibility and transport-equivalent semantics
- Pay special attention to: no accidental mutation path or protocol-shape drift between stdio and WebSocket.
```

### 2. Streaming Protocol

```text
/speckit-checklist streaming-protocol

Focus on SPEC-009:
- Content-Length parser fragmentation/coalescing, malformed headers, size bounds, EOF, and stderr isolation
- WebSocket text-frame JSON-RPC, binary rejection, ping/pong, close codes, malformed/oversized messages
- 16-request in-flight bound, 5-second timeout, out-of-order responses, cancellation disposition, and backpressure
- daemon loss, peer disconnect, server shutdown, timer/listener/client cleanup
- Pay special attention to: no leaked daemon references or orphan stdio process.
```

### 3. Security

```text
/speckit-checklist security

Focus on SPEC-009:
- prebound repository identity and initialize-root equality
- file URI parsing, decoding, realpath containment, symlink escape, regular-file and index-membership checks
- content hash equality, 1 MiB source/message bounds, redacted diagnostics, and no source/body logs
- preservation of SPEC-005 loopback startup, Host validation, same-origin browser Origin, and no URL token
- Method Not Found for write requests and ignored non-mutating unsupported notifications
- Pay special attention to: client-controlled URI/path input and stale-source confusion.
```

### 4. UX and Accessibility

```text
/speckit-checklist ux

Focus on SPEC-009:
- focused source-pane loading, ready, empty, stale, unavailable, timeout, disconnected, and retry states
- hover cards, keyboard-accessible definition activation, query-string/history back-forward, and references grouping
- preservation of existing symbol metadata and relationship panels during LSP degradation
- visible focus, semantic controls, screen-reader status announcements, reduced-motion behavior, and mobile overflow
- dormant connection lifecycle and explicit manual retry rather than hidden background loops
- Pay special attention to: precise position selection without turning the feature into a full editor workspace.
```

### Checklist Results

| Checklist | Items | Gaps | Spec references |
|---|---|---|---|
| api-contracts | Pending | Pending | Pending |
| streaming-protocol | Pending | Pending | Pending |
| security | Pending | Pending | Pending |
| ux | Pending | Pending | Pending |
| Total | Pending | Pending | Pending |

For each genuine gap, update `spec.md` or `plan.md`, re-run the affected
checklist, and document intentional exclusions instead of silently deferring them.

---

## Phase 5: Tasks

**When to run:** After all checklist gaps are resolved. Output:
`specs/009-lsp-server-facade/tasks.md`.

### Tasks Prompt

```text
/speckit-tasks

Read and reconcile these sources before generating tasks:
- `specs/009-lsp-server-facade/spec.md`
- `specs/009-lsp-server-facade/plan.md`
- `docs/ai/specs/.process/SPEC-009-design-concept.md`

The Design Concept's Goals, Non-goals, and accepted Q&A decisions are binding.
Use the Q&A rationale to order risk-first TDD work, and generate no task for a
Non-goal unless a verification task is needed to prove the exclusion.

## Task Structure
- Small, testable tasks with explicit file paths and FR/user-story references.
- TDD order: failing behavior test, minimal implementation, focused verification.
- Organize by independently demonstrable user story and accepted slice, not by horizontal layer.
- Mark parallel-safe tasks [P] only when they do not share files or ordering dependencies.
- Include cleanup, failure, privacy, package/offline, and self-repo UAT tasks; do not leave them as prose.

## Slice 1: Read-only LSP core and stdio
1. Shared types/contracts and failing lifecycle/capability tests.
2. Additive daemon reads and exact graph/URI/hash/UTF-16 behavior.
3. Shared repository-bound dispatcher and standard read handlers/content extension.
4. Content-Length stdio transport and minimal `codegraph lsp [path]` CLI integration.
5. Fixture integration, packaged black-box conformance, build/typecheck, and slice UAT.

## Slice 2: WebSocket and focused viewer
1. `ws` dependency and failing upgrade/origin/repo/lifecycle/resource tests.
2. `/lsp` bridge on the reserved SPEC-005 seam with bounded cleanup/backpressure.
3. Native browser JSON-RPC client and dormant connection state.
4. Focused source pane, hover, definition/history, references, stale/degraded/manual retry, and accessibility.
5. Web tests, package/offline checks, browser UAT, self-repo conformance, retrieval-guardian, and full verification.

## Constraints
- Keep the CLI diff minimal and preserve existing default `codegraph`/`serve` behavior.
- No schema migration, external LSP process, diagnostics, edit method, auto-indexing, cross-origin support, or full editor workspace.
- Add the Unreleased changelog note and all public-contract tests in the same slice as the capability.
```

### Tasks Results

| Metric | Value |
|---|---|
| Total Tasks | Pending Tasks |
| Phases | Two implementation slices plus setup/final verification |
| Parallel Opportunities | Pending Tasks |
| User Stories Covered | US1, US2, US3 planned |

---

## Atomicity Route

After Tasks/G5, autopilot runs the read-only atomicity classifier and records the
decision here. Leave these cells blank during scaffold and earlier phases.

| Field | Value | Meaning |
|---|---|---|
| Route | | `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope` |
| Releasable | | `true` or `false` |
| Signals | | Decisive structural findings |
| Warnings | | Release-safety warnings, if any |

Classifier target:

```text
runner helper atomicity-route specs/009-lsp-server-facade
```

---

## Phase 6: Analyze

**When to run:** Always after Tasks and before implementation.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Cross-artifact consistency across `spec.md`, `plan.md`, `tasks.md`, and
   `docs/ai/specs/.process/SPEC-009-design-concept.md`.
2. Flag any drift from the Design Concept's Goals, Non-goals, accepted Q&A
   decisions, reviewability result, or two-slice boundary; the Design Concept is
   the source of truth for scaffold-time scope.
3. Constitution alignment: deterministic, read-only, local-first, dormant, private, bounded.
4. Requirement coverage across daemon reads, shared handlers, stdio, WebSocket, viewer, and UAT.
5. Exact consistency between standard LSP contracts, the experimental source method, tests, and task file paths.
6. Two-slice vertical independence and plan-phase reviewability evidence.
7. Security/lifecycle negative cases: root mismatch, path escape, stale hash, write method, origin, malformed/oversized input, timeout, disconnect, and shutdown.
8. No phantom UI outcome: source text, hover, definition navigation/history, references, degradation, and accessibility all have implementation and verification tasks.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|---|---|---|---|
| Pending | Pending Analyze | Pending Analyze | Pending Analyze |

G6 requires zero critical findings. High findings should be fixed; every remaining
warning needs an explicit disposition before implementation.

---

## Phase 6.5: Confidence Gate

**When to run:** After Analyze consensus and before implementation.

Run the installed confidence gate in advisory mode against the latest
regex-parseable confidence emit. Attempt at most three focused remediation
iterations when the score is below 0.90, record the lowest-scoring criterion,
and continue only according to the installed advisory-mode contract.

---

## Phase 7: Implement

**When to run:** After G6 and the confidence gate. Process Slice 1 before Slice 2
unless Tasks proves a narrower parallel path safe.

### Implement Prompt

```text
/speckit-implement

## Approach: TDD First
For every behavior:
1. RED: add a failing unit, integration, subprocess, WebSocket, or UI test.
2. GREEN: implement the smallest behavior that satisfies the requirement.
3. REFACTOR: remove duplication while preserving the read-only boundary.
4. VERIFY: run the focused test and the slice gate before marking the task complete.

## Pre-Implementation Setup
1. Confirm cwd is the exact SPEC-009 worktree and branch.
2. Read root and nearest scoped AGENTS.md files.
3. Confirm git status and preserve unrelated user changes.
4. Run the smallest baseline build/typecheck/focused tests required by the first task.
5. Re-read the Design Concept, spec, plan, checklists, tasks, and constitution.
6. Consult the Design Concept Q&A log for why each accepted choice exists; use
   that rationale to design edge-case tests and reject scope-expanding refactors.

## Implementation Notes
- Use CodeGraph explore before structural code reading/editing and trust returned source.
- Use apply_patch for file edits and keep every changed line traceable to SPEC-009.
- Preserve existing APIs and CLI defaults; new behavior activates only through
  `codegraph lsp` or a deliberate `/lsp` connection from the source pane.
- Re-index or use direct reads as required after edits; do not initialize a new graph.
- Run retrieval-guardian after any `src/mcp/` diff and before shipping.
- Do not claim a slice complete from green unit tests alone; run its black-box and UAT gates.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|---|---|---|---|
| Setup/Foundation | Pending | 0 | Pending Tasks |
| Slice 1 - Core and stdio | Pending | 0 | Pending Tasks |
| Slice 2 - WebSocket and viewer | Pending | 0 | Pending Tasks |
| Polish/Post gates | Pending | 0 | Pending Tasks |

---

## Post-Implementation Checklist

- [ ] Every task is marked complete and phantom-verified.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes and package assets still ship.
- [ ] Focused LSP/daemon/server/web suites pass.
- [ ] Full `npm test` passes.
- [ ] `npm run test:web` passes.
- [ ] Required Playwright/browser UAT passes against the packaged app.
- [ ] Scripted stdio and WebSocket conformance pass against built artifacts.
- [ ] Self-repo UAT demonstrates definition, references, hover, symbols, source content, and graceful stale/unavailable behavior.
- [ ] URI escape, root mismatch, stale hash, write methods, origin, malformed/binary/oversized frames, in-flight limits, timeout, disconnect, and shutdown are covered.
- [ ] No new network call occurs unless the user explicitly configured an existing provider; SPEC-009 itself is network-local and dormant.
- [ ] Retrieval-guardian reports no do-not-regress issue for `src/mcp/` changes.
- [ ] CodeGraph diff impact, reviewability gate, code review, and final backstop pass.
- [ ] `CHANGELOG.md` has a user-facing Unreleased entry.
- [ ] PR packet/body contains no local paths, private infrastructure details, secrets, or Codex/session URLs.
- [ ] Draft PR is created only by the authorized autopilot/PR phase and targets `origin` (`racecraft-lab/codegraph`).

---

## Lessons Learned

### What Worked Well

- Pending retrospective.

### Challenges Encountered

- Pending retrospective.

### Patterns to Reuse

- Pending retrospective.

---

## Project Structure Reference

```text
codegraph/
├── src/
│   ├── bin/codegraph.ts            # minimal `lsp` command integration
│   ├── lsp/                        # existing outbound client + new facade
│   ├── mcp/                        # typed daemon read protocol
│   └── server/                     # SPEC-005 server + reserved upgrade seam
├── web/src/
│   ├── lib/                        # native browser LSP client
│   ├── components/symbol/          # focused source pane and references UI
│   └── routes/SymbolDetailRoute.tsx
├── __tests__/                      # daemon/LSP/server/subprocess conformance
├── docs/ai/specs/                  # workflow and process design record
└── specs/009-lsp-server-facade/    # spec, plan, contracts, tasks, evidence
```

---

Template populated from SpecKit Pro workflow template 1.0.0 and the accepted
SPEC-009 Grill Me decisions.
