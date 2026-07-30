# SpecKit Workflow: SPEC-013 — Cypher Query Access

**Template Version**: 1.0.0
**Created**: 2026-07-29
**Purpose**: Execute SPEC-013 from specification through implementation on branch
`013-cypher-query-access`.

---

## Design Concept

This workflow was enriched from the required Grill Me interview run during
`$speckit-pro:speckit-scaffold-spec SPEC-013`.

The full 29-question decision log, goals, non-goals, guardrails, accepted
two-slice shape, and source grounding live at:

```text
docs/ai/specs/.process/SPEC-013-design-concept.md
```

Re-read that file before every phase. It is the source of truth for decisions
captured during scaffold. Grill Me is complete and is not part of autopilot;
later ambiguity is handled by `/speckit-clarify` and the normal consensus path.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|---|---|---|---|
| Specify | `/speckit-specify` | ✅ Complete | 32 requirements, 3 user stories, 9 acceptance scenarios; G1 passed. |
| Clarify | `/speckit-clarify` | ✅ Complete | Three sessions completed; all decisions encoded; G2 passed. |
| Plan | `/speckit-plan` | ✅ Complete | Architecture packet complete; reviewability helper and G3 passed. |
| Checklist | `/speckit-checklist` | ✅ Complete | 78 checks; 8 gaps resolved; G4 passed with 0 remaining gaps. |
| Tasks | `/speckit-tasks` | ✅ Complete | 79 dependency-ordered TDD tasks; 32/32 FRs and 10/10 SCs mapped; G5 passed. |
| Analyze | `/speckit-analyze` | ✅ Complete | 0 findings at every severity; G6 passed. |
| Confidence Gate | G6.5 | ✅ Complete | Advisory NO_DATA soft-skip recorded; implementation proceeds. |
| Implement | `/speckit-implement` | 🔄 In Progress | Execute approved tasks with test-first evidence. |
| Post | Canonical post gates | ⏳ Pending | Verify, review, publish, remediate, and retrospect. |

**Status legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates

| Gate | Checkpoint | Approval criteria |
|---|---|---|
| G1 | After Specify | The three user stories and supported grammar are testable; no unresolved clarification marker remains. |
| G2 | After Clarify | Grammar, graph semantics, bounds, errors, and surface parity are explicit and consistent with the Design Concept. |
| G3 | After Plan | Constitution gates pass; the parser/planner/SQL/runtime contracts, file tables, and two vertical slices are approved. |
| G4 | After Checklists | Every genuine gap is resolved in `spec.md` or `plan.md`; intentional exclusions are documented. |
| G5 | After Tasks | Every functional requirement maps to dependency-ordered TDD work and each accepted slice is independently demonstrable. |
| G6 | After Analyze | No critical issue remains; every warning has an explicit disposition. |
| G6.5 | Confidence Gate | Record the advisory confidence score, evidence, uncertainty, and implementation disposition. |
| G7 | After each implementation slice | Focused tests, build, full relevant suite, CLI/MCP parity, guardrails, and self-index UAT pass. |

### Canonical Post Gates

Autopilot must keep these steps visible in durable workflow state and complete
or explicitly skip each before final handoff:

| Canonical step | Status |
|---|---|
| Post: Doctor Extension Check | ⏳ Pending |
| Post: Verify Implementation | ⏳ Pending |
| Post: Verify Tasks Phantom Check | ⏳ Pending |
| Post: Code Review | ⏳ Pending |
| Post: Integration Suite | ⏳ Pending |
| Post: Reviewability Diff Gate | ⏳ Pending |
| Post: Self-Review | ⏳ Pending |
| Post: UAT Runbook Generation | ⏳ Pending |
| Post: Final Reviewability Backstop | ⏳ Pending |
| Post: PR Packet/Body Generation | ⏳ Pending |
| Post: PR Body Generation | ⏳ Pending |
| Post: PR Creation | ⏳ Pending |
| Post: Review Remediation | ⏳ Pending |
| Post: Retrospective | ⏳ Pending |

---

## Prerequisites

### Worktree Binding

Run every phase from the dedicated worktree. Before each phase, verify:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --show-toplevel
```

The branch must be:

```text
013-cypher-query-access
```

The exact worktree root for this scaffold is:

```text
/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/013-cypher-query-access
```

Do not run this workflow from the main checkout or another Codex worktree. If a
phase reports that the workflow file is not in the current checkout, stop and
restart from this dedicated worktree.

### Bootstrap Evidence

The operator approved the technical roadmap's exact Dogfooding Protocol rung 6
command block. Scaffold bootstrap completed on 2026-07-29 with the
repository-pinned Node `24.11.1` and npm `11.6.2`:

```bash
npm ci
npm run build
node dist/bin/codegraph.js init .
node dist/bin/codegraph.js status . --json
node dist/bin/codegraph.js status .
```

The health assertion passed: 939 files, 16,980 nodes, 72,612 edges,
10,983/10,983 embeddings, hybrid search available, LSP enabled, no pending
references or changes, no worktree mismatch, and no reindex recommendation.
The worktree remained clean after bootstrap.

The untracked main-checkout environment was loaded through Git's common
directory exactly as the roadmap requires. Never copy its private values into
committed artifacts or logs. A pre-existing advisory warned about a configured
plaintext remote endpoint; do not broaden network use or expose endpoint
details. Query execution itself must remain local and dormant until invoked.

### Agent, Preset, and Legacy Evidence

- The installed Codex agent helper dry-run found all ten required agents
  current, including `uat-runbook-author.toml`; mutation was `no_op`.
- `spec-template` resolves to the installed
  `speckit-pro-reviewability` preset.
- `plan-template` resolves to the installed
  `speckit-pro-reviewability` preset.
- `tasks-template` resolves to the project-specific
  `codegraph-project-overrides` preset, which intentionally has higher
  priority.
- `.specify/feature.json` is absent, so no feature override changes resolution.
- No Tier-2 legacy artifact exists for SPEC-013; no relocation was needed.
- The roadmap has no reviewability exception pragma for SPEC-013, and none is
  needed at scaffold.

### Reviewability Evidence

The roadmap budget is 445 net-new reviewable production LOC across about six
production and twelve total files. Its existing two-slice suggestion is
advisory.

The setup-mode reviewability check returned `status=warn` but no blocker. Its
global roadmap scan estimated 380 reviewable LOC, seven production files,
twenty-two total files, and six touched surfaces. The warning was accepted only
with the narrower SPEC-013 sizing pass and the two-slice mitigation below.

After Grill Me, the advisory estimator used three user stories, six primary
files/surfaces, and twenty-four functional contracts. It projected about 675
reviewable LOC and recommended two slices. The maintainer accepted:

1. bounded connected-path querying end-to-end through library, CLI, and MCP;
2. count/grouping, string predicates, backtick identifiers, and recipe closure
   across the same surfaces.

Planning must replace estimates with declared per-slice production-file tables,
rerun the estimator, and split further if either slice breaches the applicable
reviewability limit.

### gh-stack Readiness

The maintainer's exact delivery instruction was:

> "two slices but make sure we use gh-stack if more than one pr is required"

Scaffold verification found GitHub CLI `2.96.0`, `github/gh-stack v0.0.8`,
`rerere.enabled=true`, `remote.pushDefault=origin`, and `origin` pointing to the
racecraft tracking fork. If G5's atomicity route requires more than one PR:

- use the installed `gh-stack` skill;
- create one linear bottom-to-top stack with explicit branch names and
  `--base main`;
- keep the foundational connected-path slice at the bottom and the
  count/string/backtick/recipe closure slice above it;
- use `gh stack submit --auto --remote origin` in non-interactive execution;
- verify the resulting chain with `gh stack view --json`;
- never push or open PRs against `upstream`.

If the classifier selects a single PR, do not manufacture a stack merely
because the estimator suggested two implementation slices.

### Constitution Validation

Apply `.specify/memory/constitution.md` throughout:

| Principle | SPEC-013 requirement | Verification |
|---|---|---|
| Think Before Coding | Preserve all 29 Grill Me decisions and settle grammar/result contracts before implementation. | `spec.md`, clarification log, `plan.md`, contracts |
| Simplicity First | Implement one connected read-only subset with no new dependency, no general SQL input, and no speculative grammar. | Scope review, dependency diff, parser grammar tests |
| Surgical Changes | Keep parser/planner/runtime additive and make narrow CLI/MCP/public-export changes. | Declared file tables, diff review, reviewability gates |
| Goal-Driven Execution | Prove useful callers, paths, hub, and dead-export recipes plus every guardrail on the live self-index. | Fixtures, parity tests, UAT runbook |
| Deterministic, LLM-Free Extraction | Compile deterministic AST to parameterized SQL over persisted graph records; never infer missing graph facts. | SQL snapshots, repeatability/order tests |
| Retrieval Performance Is a Regression Surface | Keep `codegraph_explore` primary despite a default-listed Cypher tool, bound every query, and run retrieval A/B plus retrieval-guardian. | Tool instructions review, A/B evidence, guardian verdict |
| Local-First, Private, Zero Native Dependencies | Use existing SQLite locally, add no dependency or network call, and remain dormant until query invocation. | Dependency review, offline tests, read-only connection tests |

**Constitution check at scaffold:** PASS. Re-run before and after Plan.

### Project Commands

| Purpose | Command |
|---|---|
| Activate runtime | `nvm use` |
| Build | `npm run build` |
| Full root suite | `npm test` |
| Focused test | `npx vitest run <explicit-test-file>` |
| CLI development | `npm run cli -- <arguments>` |
| Index/status | `node dist/bin/codegraph.js status .` |

All Node commands use the `.nvmrc` runtime. Source execution that touches
`node:sqlite` requires Node 22.5 or newer; local verification uses Node 24.11.1.

### Autopilot Phase 0 Evidence

Autopilot revalidated the scaffold from the exact workflow-bearing worktree
with `gpt-5.6-sol` at `xhigh` reasoning. The direct Git branch/root/upstream
guard passed. The SpecKit runner also passed all prerequisite checks when given
absolute worktree paths; its linked-worktree metadata still follows Git's common
control checkout and reports `main`/`is_worktree=false`, so the direct Git guard
remains authoritative for phase binding.

The repository-pinned Node `24.11.1` baseline passed:

- `npm run build`
- `npm run typecheck`
- `npm test` — 262 test files passed, 15 skipped; 4,670 tests passed,
  181 skipped

Only the durable autopilot state file was modified after the baseline. The
installed phase-agent bundle dry-run was current with no mutation. The resolved
spec, plan, and tasks templates were read in full, and the implementation role
is `implement-executor`.

### Capability Path

Capability path: roadmap/spec/project context -> repository files and the
installed SpecKit runner plus the live CodeGraph/GitNexus query surface;
standards/API grounding -> Context7 when available and primary official
documentation fallback; stack readiness -> installed `gh-stack` CLI and skill;
delivery -> GitHub connector and `gh`. Confidence: high because the repository,
runtime, extension, presets, agents, and capability surface were enumerated in
this session.

### Scoped Instructions

Before planning or changing files, read the nearest guidance, especially:

- `src/db/AGENTS.md`
- `src/mcp/AGENTS.md`
- `__tests__/AGENTS.md`
- any new scoped instructions under `src/query/` if present at implementation
  time.

Any change under `src/mcp/` or to default retrieval steering requires the
`retrieval-guardian` agent review before shipping. Preserve success-shaped MCP
guidance for expected recoverable states and keep `codegraph_explore` primary.

---

## Specification Context

### Basic Information

| Field | Value |
|---|---|
| Spec ID | SPEC-013 |
| Name | Cypher Query Access |
| Branch | `013-cypher-query-access` |
| Dependencies | None |
| Enables | Power-user and agent ad-hoc graph queries |
| Priority | P1 |
| Roadmap phase | Tier 3 — Analysis breadth; parallel-safe |

### Roadmap Scope

Add a dependency-free, read-only openCypher subset that compiles to
parameterized SQL and recursive CTEs over CodeGraph's existing nodes and edges.
Expose it through a supported package API, `codegraph query`, and one MCP tool.
Ship precise unsupported-syntax diagnostics, bounded execution, and at least ten
documented recipes.

### Success Criteria Summary

- [ ] `queryCypher`, `codegraph query`, and `codegraph_query` accept the same
  documented subset and enforce the same 10,000-character input ceiling.
- [ ] One `MATCH` clause supports one connected node/edge chain with explicit
  incoming or outgoing arrows, labels/types, top-level public properties, and
  bounded variable relationships.
- [ ] Node kind and edge kind map to labels/types; properties use canonical,
  case-sensitive camelCase public fields; unknown fields fail precisely.
- [ ] Traversal uses active static/LSP/heuristic edges, excludes
  LSP-suppressed rows, and exposes provenance for optional filtering.
- [ ] Variable paths are relationship-simple, may revisit nodes, require an
  explicit upper bound, and never exceed eight edges.
- [ ] Path binding returns ordered typed node-and-edge evidence.
- [ ] `WHERE` implements three-valued null semantics, `IS NULL`,
  `IS NOT NULL`, core comparisons/booleans, `STARTS WITH`, `ENDS WITH`, and
  `CONTAINS`; JSON-valued fields remain opaque return-only values.
- [ ] Keywords are case-insensitive; schema names, variables, properties, and
  aliases are canonical case-sensitive; backtick escaping is supported.
- [ ] `RETURN` supports aliases, native scalar values, typed nodes/edges/paths,
  `count(*)`, and `count(expr)` with implicit grouping by non-aggregate items.
- [ ] `ORDER BY` and `LIMIT` are supported; absent `ORDER BY` still yields a
  documented stable order suitable for deterministic caps and snapshots.
- [ ] Query literals become bound SQL parameters; emitted statements are
  whitelisted `SELECT`/CTE forms executed through a dedicated read-only SQLite
  connection.
- [ ] The default row cap is 100, the hard cap is 1,000, and capped results
  return deterministic partial rows with `truncated: true` and the effective
  cap.
- [ ] A fixed five-second deadline returns no partial rows. CLI exits 1; MCP
  returns a typed success-shaped timeout state with narrowing guidance.
- [ ] Syntax/unsupported diagnostics include a stable code, UTF-16 offset,
  line/column, bounded escaped excerpt, expected construct, and grammar anchor.
- [ ] CLI accepts a quoted positional query or `-` for bounded UTF-8 stdin; no
  `--file` contract is added.
- [ ] CLI `--json` and MCP text are byte-identical canonical JSON; the default
  CLI table renders the same bounded rows.
- [ ] The MCP tool is default-listed with instructions that preserve
  `codegraph_explore` as the primary retrieval tool.
- [ ] At least ten recipes run on CodeGraph's live self-index; representative
  answers and row/path/timeout/syntax/read-only guards are manually verified.
- [ ] Default steering changes pass retrieval-guardian review and the
  constitution's retrieval A/B gate.
- [ ] No write clause, external `$parameter`, undirected pattern, multiple
  pattern, `OPTIONAL MATCH`, non-count aggregation, DISTINCT, nested JSON
  predicate, or direct SQL surface is accepted.

---

## Phase 1: Specify

**When to run:** At feature start. Specify observable behavior and user value;
keep implementation detail only where the roadmap or Design Concept makes it
binding. Output: `specs/013-cypher-query-access/spec.md`.

### Specify Prompt

```text
/speckit-specify

## Feature: Cypher Query Access

### Problem Statement
CodeGraph exposes useful fixed graph operations, but power users and agents
cannot express bounded ad-hoc graph patterns without dropping to private SQLite
details or adding bespoke product APIs. Define a safe, deterministic,
dependency-free openCypher subset over the existing public graph model and
expose one canonical result contract across the library, CLI, and MCP.

### Users
- A developer exploring callers, paths, hubs, and potentially dead exports in
  an indexed repository.
- A coding agent with a deliberate structured graph-language request that is
  not best served by the primary codegraph_explore workflow.
- A package consumer that needs a typed, bounded, local query API.
- An operator who needs read-only guarantees, stable output, precise
  diagnostics, and predictable resource limits.

### User Stories
1. As a graph explorer, I can run one connected node/relationship pattern with
   filters and bounded paths and receive deterministic typed evidence.
2. As a power user, I can project, order, limit, count, group, and use the
   documented string/identifier subset for practical recipes.
3. As an operator or agent integrator, I get the same canonical bounded result
   through library, CLI, and MCP, with precise safe failures and no mutation.

### Binding Behavior
- Map node/edge kinds to labels/types and expose only stable public camelCase
  properties; reject unknown names.
- Traverse active static, LSP, and heuristic edges; exclude inactive
  LSP-suppressed audit rows.
- Parse case-insensitive keywords and case-sensitive canonical identifiers,
  including backtick-escaped identifiers and aliases.
- Support one connected explicit-direction chain, bounded
  relationship-isomorphic variable paths through eight edges, and path binding.
- Support null checks, three-valued boolean logic, comparisons, STARTS WITH,
  ENDS WITH, CONTAINS, projections/aliases, ORDER BY, LIMIT, count(*), and
  count(expr) with implicit grouping.
- Accept literals in query text and bind them into generated SQL. Do not add
  external parameter objects.
- Return typed public node, edge, path, and scalar values in one canonical
  result shape.
- Default to 100 rows, cap at 1,000, expose deterministic truncation, and enforce
  one fixed five-second deadline with no partial timeout results.
- Produce stable bounded source-span diagnostics with a grammar-reference
  anchor.
- Expose queryCypher, codegraph query, and default-listed codegraph_query through
  one serializer; CLI --json and MCP text must be byte-identical.
- Keep codegraph_explore primary in MCP instructions and schedule
  retrieval-guardian plus retrieval A/B validation.

### Reviewability
- Preserve two thin vertical rule slices, not interface-layer slices.
- Slice 1 is the minimal bounded connected-path capability end-to-end through
  library, CLI, and MCP.
- Slice 2 adds count/grouping, string predicates, backticks, and documented
  recipe closure across the same surfaces.
- The scaffold estimate is approximately 675 reviewable LOC with status warn;
  planning must produce and estimate explicit per-slice file tables.
- If task atomicity requires multiple PRs, use gh-stack as a linear two-PR chain.

### Out of Scope
Write clauses, direct SQL, full openCypher, OPTIONAL MATCH, multiple MATCH or
disconnected patterns, undirected relationships, external $parameters,
aggregations beyond count, DISTINCT, nested JSON predicates, IN lists,
caller-configurable limits/deadlines, --file input, and public parser/AST APIs.
```

### Specify Results

| Metric | Value |
|---|---|
| Functional requirements | 32 |
| User stories | 3 |
| Acceptance scenarios | 9 |
| Success criteria | 9 |
| Quality checklist | 16 passed, 0 open |
| G1 | PASS — 0 `[NEEDS CLARIFICATION]` markers |

### Files Generated

- [x] `specs/013-cypher-query-access/spec.md`
- [x] `specs/013-cypher-query-access/checklists/requirements.md`
- [x] `.specify/feature.json`

The mandatory `before_specify` Git feature hook was already satisfied by the
prepared `013-cypher-query-access` worktree and was not repeated. The disabled
agent-context hook was skipped. The enabled Git commit hook is satisfied by
autopilot's per-phase checkpoint below.

### Required Traceability

- Use `[US1]`, `[US2]`, and `[US3]` on user stories and scenarios.
- Assign stable `[FR-xxx]` identifiers to grammar, semantics, guardrails,
  diagnostics, serialization, and surface requirements.
- Use `[NEEDS CLARIFICATION]` only for genuine unresolved behavior; do not
  reopen settled Grill Me decisions without new contradictory evidence.
- Carry Slice 1 and Slice 2 into acceptance criteria so both remain
  independently demonstrable.

---

## Phase 2: Clarify

**When to run:** After Specify. Ask no more than five targeted questions per
session and encode every accepted answer back into `spec.md`.

### Clarify Prompts

#### Session 1: Grammar and Graph Semantics

```text
/speckit-clarify Focus on grammar and graph semantics: public label/type/property
mapping, active-edge visibility, explicit direction, one connected-chain scope,
relationship-simple variable paths, path binding, null/boolean behavior,
case-sensitive schema names, backticks, and exact stable implicit ordering.
Treat the 29-question Design Concept as binding and identify only remaining
testability gaps. Ask at most five questions.
```

#### Session 2: Guardrails, Errors, and Read-only Safety

```text
/speckit-clarify Focus on safety contracts: 10,000-character input rejection,
literal binding, whitelisted SELECT/CTE emission, dedicated read-only SQLite
connection, default/hard row caps, truncation metadata, eight-edge path cap,
five-second off-thread deadline, no-row timeout mapping, bounded diagnostics,
and proof that unsupported/mutating syntax never reaches execution. Ask at most
five questions.
```

#### Session 3: Public Surfaces, Parity, and Delivery

```text
/speckit-clarify Focus on cross-surface behavior: queryCypher public types,
positional/stdin CLI input, table versus canonical JSON, byte-identical CLI/MCP
serialization, success-shaped MCP narrowing guidance, default tool steering,
ten live self-index recipes, retrieval A/B evidence, two vertical slices, and
the conditional gh-stack route. Ask at most five questions.
```

### Clarify Results

| Session | Focus area | Questions | Key outcomes |
|---|---|---|---|
| 1 | Grammar and graph semantics | 5 answered; 2 consensus-routed | Exact stable public property catalog excludes `updatedAt`; duplicate declarations rejected; Cypher 3VL fixed; doubled-backtick escape with Unicode escapes unsupported; deterministic CodeGraph implicit order fully specified. |
| 2 | Guardrails, errors, and safety | 5 answered; 3 consensus-routed | SELECT/CTE-only emission and a mutation-free read-only open path are explicit; pre-executor rejection and real SQLite no-write proof required; timeout workers are terminated; truncation uses `effectiveCap + 1`; diagnostic excerpts are capped at 160 UTF-16 units with no oversized-input echo. |
| 3 | Surfaces, parity, and delivery | 5 answered; 3 consensus-routed | Existing `query` search remains through MATCH/stdin dual routing plus explicit `search` alias; public result union and success-shaped MCP states fixed; canonical JSON has no newline; evidence matrix and conditional gh-stack proof required; off-box A/B remains blocked pending explicit runtime authorization. |

Session 1 consensus used `codebase-analyst`, `spec-context-analyst`, and
`domain-researcher`. All three accepted the stable-catalog and deterministic
ordering direction with high confidence. The domain review confirmed that
implicit ordering is an intentional CodeGraph extension because Cypher itself
does not guarantee order without `ORDER BY`.

Session 2 consensus used dedicated `codebase-analyst` and
`spec-context-analyst` results plus the Clarify executor's cited official
Node/SQLite documentation as the domain perspective. A dedicated
`domain-researcher` dispatch was retried but unavailable because the host's
child-thread limit was exhausted; all available perspectives nevertheless
agreed at high confidence.

Session 3 consensus used all three analyst perspectives and reached 3/3
agreement. No off-box evaluation was run or authorized. The specification
records a mandatory future runtime authorization gate; without that explicit
approval, retrieval A/B remains blocked rather than silently waived.

**G2:** PASS — zero `[NEEDS CLARIFICATION]` markers remain.

---

## Phase 3: Plan

**When to run:** After the specification is final. Output an implementation
blueprint and supporting artifacts under
`specs/013-cypher-query-access/`.

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Runtime: TypeScript on the repository's supported Node 20-24 range; use Node
  24.11.1 for local verification.
- Storage: existing node:sqlite schema and query helpers; no schema migration
  unless planning proves an unavoidable need.
- Parser: dependency-free lexer plus recursive-descent parser under
  src/query/cypher/.
- Planner/emitter: typed private AST to parameterized SQLite SELECT/recursive
  CTE statements; callers never supply SQL.
- Execution: dedicated read-only SQLite connection and a bounded off-thread
  execution boundary that can enforce a real five-second statement deadline.
- Surfaces: supported queryCypher package export, Commander CLI command, and one
  MCP tool using one canonical serializer.
- Tests: Vitest unit/property-style tables, real temp SQLite fixtures,
  subprocess CLI coverage, MCP tool coverage, and live self-index UAT.
- Dependencies: add none.

## Binding Architecture Decisions
- Re-read docs/ai/specs/.process/SPEC-013-design-concept.md before design.
- Define one stable virtual property graph from src/types.ts, not raw schema
  column names.
- Reuse the existing active-edge predicate semantics so LSP-suppressed rows are
  excluded.
- Keep lexer/parser/planner/emitter private. Export queryCypher and stable
  result/error types through src/index.ts.
- Represent nodes and edges with public types and paths as ordered nodes plus
  edges. Keep scalar results native JSON.
- Preserve relationship-isomorphic path semantics and require an explicit
  upper bound no greater than eight.
- Specify three-valued null behavior independent of accidental SQLite
  expression quirks.
- Create a whitelist-validating SQL emitter; bind every literal.
- Use a dedicated SQLite read-only connection. Treat DatabaseSync's lock timeout
  as distinct from the five-second statement deadline.
- Run synchronous SQLite query work off-thread with deterministic cancellation
  and cleanup. A deadline yields no partial rows.
- Apply stable implicit ordering before truncation. Record the precise order as
  a public subset guarantee.
- Default to 100 rows and clamp explicit LIMIT to 1,000; include truncated and
  effective-cap metadata.
- Share one canonical serializer between CLI --json and MCP text. The table
  renderer consumes the same rows.
- Keep codegraph_explore explicitly primary in src/mcp/server-instructions.ts;
  reserve codegraph_query for deliberate structured graph-language requests.
- Add a user-facing CHANGELOG.md bullet under Unreleased.
- Schedule retrieval-guardian and retrieval A/B validation for the default MCP
  steering change.

## Accepted Grill Me Answers
Treat every Q&A decision as binding. The user selected "Public model", "Active
edges only", "Explicit arrows only", "No repeated edge", "Three-valued nulls",
"Literals only", "Typed graph values", "Partial result flag", "Stable internal
order", "Eight edges", "Default 100, max 1000", "Fixed five seconds",
"Structured no-row result", "Structured source span", "Read-only connection",
"Default with guardrail", "Argument or stdin", "Byte-identical JSON", "Typed
library method", "Count star and value", "One connected pattern", "Support path
binding", "Opaque JSON only", "Add string matching", "Keywords insensitive",
"Backticks too", "Ten thousand characters", and "Recipes plus guardrails".
For delivery, the user's exact instruction was: "two slices but make sure we use
gh-stack if more than one pr is required".

## Required Design Detail
- Grammar EBNF and supported/unsupported examples.
- Public property/label/type catalog and value typing.
- AST invariants and diagnostic codes/source-span rules.
- SQL planning/emission invariants, parameter binding, and read-only proof.
- Path CTE state, edge-uniqueness representation, direction, and stable order.
- Worker/deadline lifecycle, cleanup, and typed result/error state machines.
- Canonical JSON schema and CLI table/MCP mapping.
- Tests at lexer, parser, planner, SQL, runtime, library, CLI, MCP, and live UAT
  boundaries.
- Exact production-file table and projected reviewable LOC per accepted slice.

## Slices
- Slice 1: bounded connected-path queries end-to-end through library, CLI, and
  MCP, including public model mapping, active edges, direction, paths, binding,
  stable result shape/order, input/row/path/deadline/read-only/diagnostic guards.
- Slice 2: count/grouping, STARTS WITH/ENDS WITH/CONTAINS, backtick identifiers,
  all remaining recipes/docs, and full cross-surface/retrieval closure.
- Do not split by lexer/parser/CLI/MCP layer. Each slice must be useful and
  independently testable at the public surfaces.
- If the G5 atomicity classifier selects split-PR, name two explicit branches
  and plan a bottom-to-top gh-stack based on main; otherwise retain one PR.
```

### Required Plan Artifacts

| Artifact | Status | Required content |
|---|---|---|
| `plan.md` | Complete | Context, pre/post constitution pass, architecture, exact limits, file tables, slice/PR strategy |
| `research.md` | Complete | openCypher subset semantics, SQLite recursive CTE/read-only/deadline decisions, serializer and worker decisions |
| `data-model.md` | Complete | virtual nodes/edges/paths, AST, compiled statement, result, truncation, timeout, diagnostic states |
| `contracts/` | Complete | grammar/public API, canonical result/error schema, CLI/MCP parity contract |
| `quickstart.md` | Complete | focused/full tests, recipe commands, self-index UAT, guardrail probes |

### Plan Reviewability Gate

Run the installed read-only `estimate-reviewable-loc` helper against the
completed plan and each explicit slice. Record the structured result here and
in the plan. The roadmap and scaffold estimates are advisory; the plan's
declared file tables are the authoritative pre-implementation sizing signal.

Corrected absolute-worktree helper result:

- status: `pass`
- projected advisory LOC: 280
- production entries: 7
- total declared implementation entries: 8

Manual reviewable estimates remain 675 overall, 390 for Slice 1, and 285 for
Slice 2. Slice 1 has 6 production files. Slice 2 has 5 production files plus
the non-production `CHANGELOG.md` entry. The full feature remains warning-level
and is mitigated by the two independently demonstrable vertical slices; no
block threshold is reached.

Pre-design and post-design constitution checks both passed. **G3:** PASS —
`plan.md` exists with zero unresolved markers.

---

## Phase 4: Domain Checklists

**When to run:** After Plan. Run the four enriched domains below and address
every real `[Gap]` before Tasks.

### 1. API Contracts

```text
/speckit-checklist api-contracts

Focus on SPEC-013:
- exact grammar, label/type/property catalog, identifier casing, backticks, and
  supported/unsupported syntax
- queryCypher input/result/error types and src/index.ts exports
- typed node, edge, path, scalar, count/grouping, ordering, limit, truncation,
  timeout, and source-diagnostic contracts
- positional/stdin CLI behavior, table/JSON rendering, MCP tool schema, and
  byte-identical canonical JSON
- Pay special attention to: no contract drift between library, CLI, and MCP.
```

### 2. Security

```text
/speckit-checklist security

Focus on SPEC-013:
- 10,000-character pre-lexing bound and bounded diagnostic excerpts
- grammar rejection of writes/direct SQL/external parameters
- whitelisted SELECT/CTE AST emission and literal parameter binding
- dedicated read-only SQLite connection and inability to reach write helpers
- safe error/log redaction, worker cleanup, and dormant/local-only behavior
- Pay special attention to: parser-to-emitter escape hatches and untrusted
  backtick/string literal handling.
```

### 3. Performance

```text
/speckit-checklist performance

Focus on SPEC-013:
- explicit variable-path upper bound through eight edges
- relationship-simple recursive state and cycle/path explosion containment
- default 100 and hard 1,000 row caps applied before unbounded materialization
- stable ordering cost, count/grouping cost, and representative query-plan
  checks on realistic graph density
- fixed five-second deadline, off-thread cancellation, no partial timeout rows,
  and repeated-timeout cleanup
- Pay special attention to: recursive CTE growth before LIMIT and MCP output
  bounding.
```

### 4. Error Handling and Data Integrity

```text
/speckit-checklist error-handling

Focus on SPEC-013:
- lexer/parser/planner/unsupported-property diagnostic taxonomy
- UTF-16 offset, line/column, escaped excerpt, expected construct, and stable
  grammar anchor accuracy across Unicode and multiline input
- three-valued null behavior, active-edge filtering, provenance, and typed JSON
  conversion without storage-shape leakage
- truncation versus timeout distinction and CLI exit/MCP success-shaped mapping
- deterministic ordering and canonical serialization across repeated runs
- Pay special attention to: no silent coercion, truncation, timeout, or
  unsupported-syntax fallback.
```

### Checklist Results

| Checklist | Items | Gaps | Spec references |
|---|---|---|---|
| api-contracts | 24 | 0 (1 resolved) | FR-001 through FR-031; grammar, public API, CLI/MCP parity, and data model contracts |
| security | 14 | 0 (2 resolved) | FR-002, FR-015, FR-016, FR-021 through FR-024, FR-028, FR-030 |
| performance | 18 | 0 (3 resolved) | FR-008, FR-009, FR-018 through FR-022, FR-026, SC-007, SC-008 |
| error-handling | 22 | 0 (2 resolved) | FR-003 through FR-005, FR-011 through FR-016, FR-019 through FR-028, SC-005 |
| Total | 78 | 0 (8 resolved) | G4 passed: 0 `[Gap]` markers |

For each genuine gap, update `spec.md` or `plan.md`, rerun the affected
checklist, and document intentional exclusions instead of silently deferring
them.

---

## Phase 5: Tasks

**When to run:** After every checklist gap is resolved. Output:
`specs/013-cypher-query-access/tasks.md`.

### Tasks Prompt

```text
/speckit-tasks

## Sources
- specs/013-cypher-query-access/spec.md
- specs/013-cypher-query-access/plan.md
- specs/013-cypher-query-access/research.md
- specs/013-cypher-query-access/data-model.md
- specs/013-cypher-query-access/contracts/
- docs/ai/specs/.process/SPEC-013-design-concept.md

## Task Structure
- Follow strict RED -> GREEN -> REFACTOR -> VERIFY TDD.
- Keep tasks small, testable, dependency-ordered, and tied to FR identifiers.
- Organize by user story and accepted vertical slice, not by lexer/parser/CLI
  technical layers.
- Mark [P] only when tasks have no shared files, generated state, branch state,
  or artifact-order dependency.
- Add explicit focused-test and public-surface acceptance evidence to every
  implementation task.

## Slice 1: Bounded Connected-path Querying
- Start from failing public-contract fixtures.
- Cover public graph mapping, active edges, explicit direction, one connected
  pattern, scalar/public graph projection, relationship-simple bounded paths,
  path binding, comparisons/nulls, aliases/order/limit, canonical result shape,
  stable order, parameterized read-only execution, input/row/path/deadline
  guards, structured diagnostics, library export, CLI, and MCP.
- Finish with an independently demonstrable end-to-end public query and
  focused/self-index smoke evidence.

## Slice 2: Language and Recipe Closure
- Add count(*)/count(expr) implicit grouping, STARTS WITH/ENDS WITH/CONTAINS,
  and backtick identifiers through the same public surfaces.
- Complete ten or more recipes, canonical CLI/MCP parity, full guardrail UAT,
  retrieval instruction tests, retrieval A/B, retrieval-guardian, and release
  documentation.
- Finish with all recipes on the live self-index and representative manual
  answer review.

## Delivery Constraints
- Run the G5 atomicity classifier after tasks exist.
- If it selects split-PR, tasks must name the two explicit branches and use the
  installed gh-stack skill bottom-to-top with origin, --auto submission, and
  JSON verification.
- If it selects one PR, preserve the two internal verification slices without
  creating an artificial stack.
- Keep upstream fetch-only and never include local session URLs in commits or
  PR text.
```

### Tasks Results

| Metric | Value |
|---|---|
| Total tasks | 79 |
| Phases | 7 |
| Parallel opportunities | 22 |
| User stories covered | 3 |
| Slice 1 tasks | 28 |
| Slice 2 tasks | 30 |

---

### Verify Tasks and Tasks-Phase Reviewability

- `/speckit.verify-tasks`: passed; 79 open tasks, 0 checked tasks, 0 malformed
  checkboxes, and 0 phantom findings. No report was written because no task is
  complete yet.
- `reviewability-gate` requested mode: `tasks`.
- Installed-runner disposition: deferred; tasks mode is not supported and was
  not invoked.
- Fallback evidence: setup-mode `warn` with no blocker; plan estimator `pass`
  at 280 projected advisory LOC and 7 production entries; two internal
  vertical slices are operator-ratified; no PR split was operator-ratified.
- Fingerprint status: current for `spec.md`, `plan.md`, and `tasks.md`.
- Correctness blocks: none.
- Disposition: proceed without a PR marker plan.

The Tasks phase added the cross-slice
`specs/013-cypher-query-access/evidence-matrix.md` evidence artifact to the
plan's declared evidence scope. Re-running `estimate-reviewable-loc` remained
`pass` at 280 projected advisory LOC and 7 production entries.

**G5:** PASS — 79 tasks with 32/32 functional requirements, 10/10 success
criteria, and all five checklists mapped.

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot skill
runs the read-only atomicity classifier and records its decision here. Leave the
cells blank during scoping. The accepted two-slice intent and conditional
gh-stack requirement do not preempt the classifier.

| Field | Value | Meaning |
|---|---|---|
| **Route** | `one-navigable-PR` | One navigable PR with the two internal verification slices. |
| **Releasable** | `true` | No destructive-migration or concurrency-sensitive unreleasability signal. |
| **Signals** | `change-shape:modify-heavy` | Existing CLI/MCP surfaces are modified alongside additive query files. |
| **Warnings** | None | No release-safety warning. |

Run the classifier against:

```text
runner helper atomicity-route specs/013-cypher-query-access
```

If the route is `split-PR`, initialize and submit the planned explicit branch
names non-interactively:

```text
gh stack init --base main <slice-1-branch> <slice-2-branch>
gh stack submit --auto --remote origin
gh stack view --json
```

The angle-bracket names above are intentionally operational slots to be replaced
with the exact branch names approved at G5; do not execute them literally.

---

## Layer Plan

| Field | Value |
|---|---|
| Status | Skipped |
| Reason | Atomicity route is `one-navigable-PR`; layer planning is required only for `split-PR`. |
| PR topology | One PR from `013-cypher-query-access` with two internal implementation checkpoints. |

---

## Phase 6: Analyze

**When to run:** Always run after Tasks to catch cross-artifact issues before
implementation.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment, especially deterministic local execution, zero new
   dependencies, read-only safety, and retrieval regression gates.
2. Exact consistency across the roadmap, Design Concept, spec.md, plan.md,
   contracts, checklists, and tasks.md.
3. Coverage of all 29 Grill Me decisions and every FR/user story by acceptance
   scenarios and dependency-ordered tasks.
4. Public virtual-graph names versus SQLite storage names; active-edge semantics
   and LSP-suppressed row exclusion.
5. Grammar and non-goal closure: no accidental write, OPTIONAL MATCH, multiple
   pattern, undirected, external parameter, DISTINCT, IN, nested JSON predicate,
   or public parser contract.
6. Bound enforcement and error mapping across library, CLI, MCP, worker, and
   SQLite boundaries.
7. Stable order, truncation, timeout, typed value, count/grouping, and canonical
   JSON parity requirements.
8. Per-slice reviewability, independent demonstrability, task ordering, and the
   classifier-selected one-PR or gh-stack route.
9. Retrieval-guardian, retrieval A/B, ten-recipe live self-index UAT, and all
   canonical post gates.
```

### Analyze Severity Levels

| Severity | Meaning | Required action |
|---|---|---|
| `CRITICAL` | Blocks implementation or violates constitution | Must resolve before G6 |
| `HIGH` | Significant contract or coverage gap | Resolve before implementation unless explicitly dispositioned |
| `MEDIUM` | Improvement or ambiguity | Review and record decision |
| `LOW` | Minor inconsistency | Record for follow-up |

### Analysis Results

| ID | Severity | Issue | Resolution |
|---|---|---|---|
| None | — | No cross-artifact finding detected | No remediation required; G6 passed |

---

## Phase 6.5: Confidence Gate

**When to run:** After Analyze and its consensus item complete. Record the
advisory confidence score, supporting evidence, remaining uncertainty, and the
implementation disposition before dispatching implementation.

| Metric | Value |
|---|---|
| Mode | Advisory |
| Threshold | 0.90 |
| Score | No data |
| Disposition | Soft-skip and proceed |

The installed confidence helper returned exit 1 with
`recommended_action: soft_skip` because no synthesizer confidence emit was
present. Analyze had zero unresolved findings and therefore required no
consensus synthesis. Advisory mode requires this warning to be logged and
implementation to proceed. This may indicate a synthesizer-prompt regression
worth reporting to the plugin author.

---

## Phase 7: Implement

**When to run:** After G6 passes and tasks are approved.

### Implement Prompt

```text
/speckit-implement

## Approach: TDD-first
For each task:
1. RED: add the smallest failing behavioral test.
2. GREEN: implement only enough production code to pass.
3. REFACTOR: simplify without broadening scope.
4. VERIFY: run the focused test and the task's public acceptance check.

## Pre-implementation Setup
1. Verify branch and worktree binding with git rev-parse.
2. Activate the .nvmrc runtime and confirm Node 24.11.1 locally.
3. Confirm git status is clean and baseline build/tests still pass.
4. Re-read the Design Concept, spec, plan, contracts, tasks, and scoped
   AGENTS.md files.
5. Confirm the G5 atomicity route and, if split-PR, the explicit gh-stack branch
   plan before changing code.

## Implementation Rules
- Execute tasks in dependency order and preserve the accepted vertical slices.
- Keep lexer/parser/planner/emitter internals private and dependency-free.
- Write failing tests before production behavior.
- Bind literals; never concatenate them into SQL.
- Use only whitelisted SELECT/CTE forms and a dedicated read-only connection.
- Keep query work bounded and cancellable with deterministic worker cleanup.
- Reuse public graph types and active-edge semantics; do not expose schema
  columns as the language contract.
- Use one canonical serializer across CLI JSON and MCP.
- Keep codegraph_explore primary in MCP instructions.
- Run retrieval-guardian and retrieval A/B before the steering change ships.
- If multiple PRs are required, use gh-stack non-interactively against origin
  and verify the chain as JSON after every submit/update.
- Stop on unexplained baseline failure, reviewability block, generated-state
  drift, scope expansion, or dirty worktree state outside the assigned task.

## Verification
- Focused lexer/parser/planner/SQL/runtime/library/CLI/MCP tests.
- npm run build.
- npm test.
- All documented recipes against the live self-index.
- Manual review of representative graph answers.
- Byte-identical CLI --json and MCP output proof.
- Explicit row/path/timeout/syntax/read-only guard probes.
- Retrieval A/B and retrieval-guardian verdict.
- Final git diff --check and clean status.
```

### Implementation Progress

| Slice | Tasks | Completed | Notes |
|---|---|---|---|
| Setup and evidence routing | T001-T007 | 0/7 | Depends on G6/G6.5 completion before implementation dispatch. |
| Foundational test harness | T008-T012 | 0/5 | RED support only; no production behavior. |
| 1 — bounded connected-path querying | T013-T031 | 0/19 | US1 RED → GREEN → REFACTOR → VERIFY. |
| 1 — safe-surface closure | T032-T040 | 0/9 | US3 parity, diagnostics, and retrieval steering for Slice 1. |
| 2 — language and recipe closure | T041-T057 | 0/17 | US2 RED → GREEN → REFACTOR → VERIFY. |
| Final safety and retrieval closure | T058-T070 | 0/13 | US3 guardrails, parity, retrieval gates, and evidence. |
| Polish and delivery evidence | T071-T079 | 0/9 | Changelog, UAT, parity, PR packet, and hygiene. |

---

## Post-Implementation Checklist

- [ ] Every task marked complete in `tasks.md` is verified as real, not phantom.
- [ ] Focused tests pass for lexer, parser, planner, SQL emission, runtime,
  library, CLI, MCP, serializers, and diagnostics.
- [ ] `npm run build` passes on the pinned runtime.
- [ ] `npm test` passes.
- [ ] No new runtime dependency or unexpected schema migration was added.
- [ ] Dedicated read-only connection and mutating-syntax rejection are proven.
- [ ] Row, path, input, deadline, and diagnostic bounds are proven.
- [ ] CLI `--json` and MCP text are byte-identical for success, truncation,
  timeout, and syntax-error fixtures.
- [ ] At least ten recipes pass against the live self-index and representative
  answers are manually reviewed.
- [ ] `codegraph_explore` remains primary in default MCP guidance.
- [ ] Retrieval A/B and retrieval-guardian gates pass.
- [ ] Per-PR reviewability gates pass.
- [ ] If multiple PRs were required, `gh stack view --json` proves the intended
  bottom-to-top chain against `origin`.
- [ ] User-facing `CHANGELOG.md` entry is under `## [Unreleased]`.
- [ ] PR packet includes scope, non-goals, review order, budget, traceability,
  evidence, known gaps, and rollback/flag notes.
- [ ] Final `git diff --check` passes and the worktree is clean after commits.

---

## Lessons Learned

### What Worked Well

- Pending implementation.

### Challenges Encountered

- Pending implementation.

### Patterns to Reuse

- Pending implementation.

---

## Project Structure Reference

```text
codegraph/
├── src/
│   ├── query/cypher/            # New private lexer, parser, planner, SQL emitter, runtime
│   ├── db/                      # Existing schema, connections, and active-edge semantics
│   ├── mcp/                     # Tool registration, canonical text, server instructions
│   ├── bin/codegraph.ts         # codegraph query CLI surface
│   ├── types.ts                 # Stable public node/edge model
│   └── index.ts                 # queryCypher and public result/error exports
├── __tests__/                   # Root integration and surface tests
├── docs/
│   ├── cypher-recipes.md        # Grammar reference and ten or more recipes
│   └── ai/specs/.process/       # Design concept and this workflow
├── specs/013-cypher-query-access/
│   ├── SPEC-MOC.md
│   ├── spec.md
│   ├── plan.md
│   ├── research.md
│   ├── data-model.md
│   ├── contracts/
│   ├── quickstart.md
│   └── tasks.md
├── .specify/memory/constitution.md
└── CHANGELOG.md
```

---

Template based on the installed SpecKit workflow template and populated for
SPEC-013 from roadmap, repository, constitution, runner, Grill Me, and
maintainer evidence.
