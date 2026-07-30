# Implementation Plan: Cypher Query Access

**Branch**: `013-cypher-query-access` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-cypher-query-access/spec.md`

## Summary

SPEC-013 adds one bounded, read-only Cypher query contract over CodeGraph's public graph model. The implementation uses a dependency-free lexer/parser/private AST/planner and a whitelist-validating emitter that produces one parameterized SQLite `SELECT` or `WITH RECURSIVE ... SELECT` statement. Execution uses a dedicated mutation-free read-only SQLite open path and an off-thread five-second boundary; package API, CLI, and MCP all consume one canonical result serializer.

## Technical Context

**Language/Version**: TypeScript on the repository-supported Node range; local verification uses Node 24.11.1.

**Primary Dependencies**: Existing `node:sqlite`, `node:worker_threads`, Commander CLI, Vitest, and internal CodeGraph modules only. No new runtime or development dependency is allowed.

**Storage**: Existing `.codegraph/graph.db` SQLite schema. Cypher reads through a dedicated read-only connection path that does not call `DatabaseConnection.open`, does not run migrations, does not run schema healing, does not change PRAGMAs that mutate persistent state, and does not start sync, watch, WAL, index, or initialization work.

**Testing**: Vitest unit and integration tests with real temporary files and real SQLite. Focused tests use `npx vitest run <explicit-test-file>`. Full gates use `npm run build`, `npm run typecheck`, and `npm test`.

**Target Platform**: Local CodeGraph library, CLI, and MCP server on supported Node 20-24 runtimes. Source paths that use `node:sqlite` require Node 22.5+ at runtime; validation uses Node 24.11.1.

**Project Type**: Local-first library, CLI, and MCP server.

**Performance Goals**: Default 100-row result cap, hard 1,000-row cap, `effectiveCap + 1` bounded truncation detection, variable path upper bound of 8 relationships, and one fixed five-second execution deadline.

**Constraints**: Dependency-free parser; no direct SQL input; no mutation; no external parameters; no network calls; no unexpected schema writes; deterministic output ordering and byte-identical CLI/MCP JSON.

**Scale/Scope**: One connected read-only graph pattern per query over the existing indexed repository graph. Slice 1 proves bounded connected-path queries end-to-end; Slice 2 adds count/grouping, string predicates, backtick identifiers, and recipe closure.

**Reviewability Budget**: Primary surface: API and bounded query runtime. Planned production entries: 7 across 8 total declared implementation files; `CHANGELOG.md` is documentation, not a production file. Manual reviewable LOC estimate: 675 total, split into Slice 1 390 and Slice 2 285. The corrected helper result is `status=pass`, 7 production entries, 8 total entries, and 280 projected advisory LOC. Budget result: full-feature file/LOC warning accepted with the required two-slice mitigation; neither slice exceeds 6 production files or 400 manual reviewable LOC, and no block threshold is reached.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Constitution Check

| Principle | Status | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | The clarified spec has zero clarification markers and the 29-question design concept is binding. |
| II. Simplicity First | PASS | The plan is one dependency-free read-only subset with no new dependency, no general SQL, no external parameter object, and no configurable limits. |
| III. Surgical Changes | PASS | New logic is isolated under `src/query/cypher/`; existing surfaces receive narrow additive calls only. |
| IV. Goal-Driven Execution | PASS | Every story has independent acceptance tests; the quickstart defines focused, full, and live self-index validation. |
| V. Deterministic, LLM-Free Extraction | PASS | Cypher reads persisted deterministic graph records and never synthesizes graph structure. |
| VI. Retrieval Performance Is a Regression Surface | PASS | `codegraph_explore` remains primary; default MCP steering changes require retrieval-guardian and A/B validation. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | Execution is local, dormant until invocation, dependency-free, and read-only over existing SQLite. |

### Post-Design Constitution Check

| Principle | Status | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | `research.md`, `data-model.md`, and contracts resolve design choices without open markers. |
| II. Simplicity First | PASS | The only complexity row is the required worker deadline boundary; simpler alternatives cannot enforce a real five-second deadline for synchronous SQLite. |
| III. Surgical Changes | PASS | Declared file tables keep production changes to 7 files plus one changelog entry and preserve upstream-owned files with narrow call-site edits. |
| IV. Goal-Driven Execution | PASS | Contract, CLI, MCP, runtime, read-only, timeout, recipe, and retrieval gates have concrete verification commands. |
| V. Deterministic, LLM-Free Extraction | PASS | Planner compiles only persisted nodes/edges and active-edge predicates; no LLM or heuristic inference is introduced. |
| VI. Retrieval Performance Is a Regression Surface | PASS | MCP success-shaped states are preserved; `isError` remains reserved for refusals and malfunctions; off-box A/B requires operator authorization. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | Dedicated read-only connection avoids migration/healing side effects and adds no dependencies or network use. |

## Project Structure

### Documentation (this feature)

```text
specs/013-cypher-query-access/
+-- plan.md
+-- research.md
+-- data-model.md
+-- quickstart.md
+-- checklists/
|   +-- requirements.md
+-- contracts/
    +-- grammar.md
    +-- public-api.md
    +-- cli-mcp-parity.md
```

### Source Code (repository root)

```text
src/
+-- query/
|   +-- cypher/
|       +-- index.ts        # lexer, parser, private AST, planner, emitter, queryCypher facade
|       +-- runtime.ts      # read-only SQLite open path and off-thread five-second boundary
|       +-- serializer.ts   # canonical stable-key minified JSON and table row adapter
+-- index.ts                # public queryCypher and type exports
+-- bin/codegraph.ts        # dual-routed query/search CLI surface
+-- mcp/
    +-- tools.ts            # codegraph_query tool, default-listing, success-shaped states
    +-- server-instructions.ts
```

```text
__tests__/
+-- cypher-parser.test.ts
+-- cypher-runtime.test.ts
+-- cypher-recipes.test.ts
+-- cli-query-command.test.ts
+-- mcp-cypher-query.test.ts
+-- mcp-server-instructions.test.ts
```

**Structure Decision**: Keep the query engine in one new `src/query/cypher/` module group and modify existing library, CLI, and MCP entry points narrowly. Do not update agent instruction files during planning.

## Declared File Operations

- NEW src/query/cypher/index.ts
- NEW src/query/cypher/runtime.ts
- NEW src/query/cypher/serializer.ts
- MODIFIED src/index.ts
- MODIFIED src/bin/codegraph.ts
- MODIFIED src/mcp/tools.ts
- MODIFIED src/mcp/server-instructions.ts
- MODIFIED CHANGELOG.md

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Off-thread query execution boundary | Node `DatabaseSync` executes synchronously and its `timeout` option is a busy-lock wait, not a statement deadline. SPEC-013 requires a real five-second execution deadline with no partial timeout rows. | In-process timers cannot interrupt synchronous SQLite execution, and relying on the SQLite busy timeout would only govern lock waiting, not long-running statements. |

## Architecture Decisions

### Query Pipeline

1. `queryCypher(projectRoot, query)` validates the 10,000-character input ceiling before lexing.
2. The lexer emits tokens with UTF-16 offset, line, and column tracking. Keywords are case-insensitive. Schema identifiers remain case-sensitive.
3. The recursive-descent parser accepts exactly one connected `MATCH` chain, optional path binding, optional `WHERE`, required `RETURN`, optional `ORDER BY`, and optional `LIMIT`.
4. The parser builds a private AST. No AST, parser, planner, lexer, or emitter type is exported.
5. The semantic planner validates labels, relationship types, properties, variable uniqueness, aggregate grouping, JSON predicate exclusions, active-edge visibility, caps, and read-only grammar.
6. The SQL emitter produces one parameterized SQLite statement whose top level is `SELECT`, `WITH`, or `WITH RECURSIVE`, with every CTE body and final statement being `SELECT`-only.
7. The runtime executes the statement through a dedicated read-only SQLite connection in a worker boundary and returns a shared result union.
8. The serializer produces canonical UTF-8 minified stable-key JSON with no trailing newline for CLI `--json` and MCP text.

### Read-Only SQLite Open Path

- Do not reuse `DatabaseConnection.open`, because it configures persistent PRAGMAs, runs migrations, and performs healing.
- Add a Cypher-specific read-only open path in `src/query/cypher/runtime.ts` using the lower-level adapter or direct `DatabaseSync` with `readOnly: true`.
- The path only validates database existence, opens a read-only connection, registers no write helpers, starts no watcher, runs no migrations, runs no schema SQL, performs no sync, and performs no index or WAL changes.
- All emitted statements are validated before prepare. Statement lists and write-capable tokens are impossible from the AST and rejected again by a final SQL whitelist.

### Deadline and Worker Lifecycle

- Each query request gets a fixed five-second deadline.
- Synchronous SQLite work runs inside a worker so the main thread can enforce the deadline.
- On success, the worker returns the complete result and remains reusable if healthy.
- On timeout, the main thread resolves a timeout result with no rows, calls `worker.terminate()`, waits for bounded termination, and replaces the worker before accepting another query.
- The timed-out worker must not continue serving future requests. Cleanup failures open a circuit breaker that returns a malfunction state rather than silently falling back to unsafe in-process execution.

### Public Surface Behavior

- `queryCypher(projectRoot, query)` is the supported package API. It returns a discriminated union: `success`, `diagnostic`, or `timeout`.
- Existing `codegraph query <text>` remains legacy symbol search unless the first non-whitespace lexical token is case-insensitive `MATCH`, or the operand is `-`. Those two forms route to Cypher.
- Add `codegraph search <text>` as the explicit alias for legacy search, including literal searches beginning with `MATCH` or `-`.
- `codegraph query --json` in Cypher mode and MCP `codegraph_query` text return byte-identical canonical JSON.
- The MCP tool returns success-shaped JSON for success, empty, not-indexed diagnostic, parser diagnostic, unsupported-subset diagnostic, and timeout states. `isError: true` is reserved for path/access refusals and real malfunctions.

## Data and Semantics Decisions

### Field Catalog

Node labels are the current `NODE_KINDS`: `file`, `module`, `class`, `struct`, `interface`, `trait`, `protocol`, `function`, `method`, `property`, `field`, `variable`, `constant`, `enum`, `enum_member`, `type_alias`, `namespace`, `parameter`, `import`, `export`, `route`, `component`.

Relationship types are the current `EDGE_KINDS`: `contains`, `calls`, `imports`, `exports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`.

Queryable node properties are `id`, `kind`, `name`, `qualifiedName`, `filePath`, `language`, `startLine`, `endLine`, `startColumn`, `endColumn`, `docstring`, `signature`, `visibility`, `isExported`, `isAsync`, `isStatic`, `isAbstract`, `decorators`, `typeParameters`, and `returnType`. `updatedAt` is not exposed.

Queryable relationship properties are `source`, `target`, `kind`, `metadata`, `line`, `column`, and `provenance`. `column` maps from storage `col` and is the only public name.

### Active Edge Predicate

Traversal applies the existing active-edge policy:

```sql
(CASE
  WHEN metadata IS NULL THEN 1
  WHEN json_valid(metadata) = 0 THEN 1
  WHEN json_extract(metadata, '$.lsp.active') = 0 THEN 0
  ELSE 1
END) = 1
```

The emitter aliases the predicate per edge table reference.

### Three-Valued Logic

- Missing optional properties evaluate to null.
- Comparisons or string predicates involving null evaluate to null.
- `WHERE` keeps only rows whose final predicate is true.
- `IS NULL` and `IS NOT NULL` are the only null equality tests.
- Opaque JSON and array-valued fields may be returned but cannot appear in `WHERE`.

### Stable Ordering

When `ORDER BY` is absent, apply CodeGraph's deterministic extension before caps:

1. Compare projected values in `RETURN` order.
2. Nodes compare by public `id`.
3. Relationships compare by `(source, target, kind, line, column)`.
4. Paths compare by alternating node and relationship identity sequence.
5. Scalars compare by type rank `boolean < number < string < opaque JSON/array < null`; false before true, numbers ascending, strings by Unicode code point, opaque values by canonical JSON bytes.
6. Rows with equal projected keys use the full matched-chain identity in pattern order as final tie-breaker.

Explicit ascending order places null after non-null. Explicit descending order places null before non-null.

### Caps and Truncation

- Default effective cap is 100.
- Explicit `LIMIT` is clamped to 1,000.
- Runtime inspects at most `effectiveCap + 1` rows, or an equivalent bounded extra-row check.
- Output includes only `effectiveCap` rows.
- `truncated: true` appears only when one additional row exists.
- No unbounded `totalRows` is computed or exposed.

### Diagnostics

Every parser, unsupported-subset, unknown-name, oversized-input, and planner diagnostic includes:

- stable `code`
- `message`
- UTF-16 `offset`
- one-based `line`
- zero-based `column`
- `expected`
- `anchor`
- escaped `excerpt` at most 160 UTF-16 code units
- `truncatedBefore`
- `truncatedAfter`

Oversized-input diagnostics include observed length and maximum only; they do not echo query text.

## Slice Plan and Reviewability

### Plan Reviewability Gate

The installed read-only helper was first invoked with a relative path. Because
the runner follows Git's common linked-worktree control checkout, that attempt
could not see the feature-worktree plan. The orchestrator reran it with the
absolute worktree path:

```text
helper_id=estimate-reviewable-loc
operation=estimate-reviewable-loc
inputs.plan_file=/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/013-cypher-query-access/specs/013-cypher-query-access/plan.md
```

Corrected helper result:

```json
{
  "tool": "estimate-reviewable-loc",
  "status": "pass",
  "projected": 280,
  "declared_files": {
    "production": 7,
    "new": 3,
    "modified": 5,
    "total_entries": 8
  }
}
```

The helper's production-entry formula is advisory. Manual per-slice estimates
remain authoritative for implementation reviewability.

### Slice 1: Bounded Connected-Path End-to-End

**Goal**: A caller can run one connected, explicit-direction, bounded path query through package API, CLI, and MCP and receive deterministic typed graph evidence with caps, diagnostics, read-only proof, and timeout behavior.

**Manual reviewable LOC estimate**: 390.

**Helper logic estimate**: 5 production entries x 40 = 200 advisory LOC. `CHANGELOG.md` is a documentation entry and is excluded from the production count.

**Production file table**:

| Status | Path | Scope | Est. LOC |
|---|---|---|---:|
| NEW | `src/query/cypher/index.ts` | lexer, parser, private AST, semantic planner, fixed/variable path emitter for Slice 1 | 190 |
| NEW | `src/query/cypher/runtime.ts` | read-only open path, worker request boundary, timeout mapping | 95 |
| NEW | `src/query/cypher/serializer.ts` | result union serialization and table adapter for Slice 1 values | 45 |
| MODIFIED | `src/index.ts` | export `queryCypher` and stable public result/error types | 15 |
| MODIFIED | `src/bin/codegraph.ts` | dual-route Cypher mode for `MATCH` and stdin, shared serializer, reject search-only flags | 30 |
| MODIFIED | `src/mcp/tools.ts` | add `codegraph_query`, default-list it, route success-shaped states | 15 |

**Test and evidence table**:

| Status | Path | Scope |
|---|---|---|
| NEW | `__tests__/cypher-parser.test.ts` | grammar, variable path bounds, identifier cases, diagnostics |
| NEW | `__tests__/cypher-runtime.test.ts` | real SQLite fixtures, active edges, read-only proof, caps, timeout |
| MODIFIED | `__tests__/cli-query-command.test.ts` | `query` routing, stdin, JSON, rejected flags |
| NEW | `__tests__/mcp-cypher-query.test.ts` | MCP success-shaped states, default listing, parity payload |
| PHASE | `contracts/grammar.md` | grammar and catalog contract |
| PHASE | `contracts/public-api.md` | result union and value model |
| PHASE | `contracts/cli-mcp-parity.md` | CLI/MCP byte contract |

**Reviewability result**: Within Slice 1 LOC budget. Production file count is at the warning edge because the slice must be end-to-end across package, CLI, and MCP; further interface slicing is rejected because it would violate the accepted vertical-slice shape.

### Slice 2: Count, String, Backticks, and Recipes

**Goal**: Complete the accepted language subset with aggregation, string predicates, backtick identifiers, recipe documentation, self-index UAT, and retrieval closure.

**Manual reviewable LOC estimate**: 285.

**Helper logic estimate**: 6 production entries x 40 = 240 advisory LOC.

**Production file table**:

| Status | Path | Scope | Est. LOC |
|---|---|---|---:|
| MODIFIED | `src/query/cypher/index.ts` | count/grouping, string predicates, backtick escaping, remaining diagnostics | 125 |
| MODIFIED | `src/query/cypher/serializer.ts` | canonical stable-key JSON coverage for aggregate/recipe states | 35 |
| MODIFIED | `src/bin/codegraph.ts` | add explicit `search` alias and final table rendering polish | 35 |
| MODIFIED | `src/mcp/tools.ts` | final MCP schema/guidance fields and recipe states | 35 |
| MODIFIED | `src/mcp/server-instructions.ts` | keep `codegraph_explore` primary while documenting deliberate Cypher use | 30 |
| MODIFIED | `CHANGELOG.md` | user-facing Unreleased capability bullet | 25 |

**Test and evidence table**:

| Status | Path | Scope |
|---|---|---|
| MODIFIED | `__tests__/cypher-parser.test.ts` | count/grouping, strings, backticks, unsupported forms |
| MODIFIED | `__tests__/cypher-runtime.test.ts` | grouping semantics, ordering, cap+1, 3VL, no-write proof |
| MODIFIED | `__tests__/cli-query-command.test.ts` | `search` alias, table rendering, byte-identical JSON |
| MODIFIED | `__tests__/mcp-cypher-query.test.ts` | success-shaped diagnostic/timeout/empty/not-indexed states |
| NEW | `__tests__/cypher-recipes.test.ts` | documented recipes against fixtures and live-self-index harness hooks |
| MODIFIED | `__tests__/mcp-server-instructions.test.ts` | `codegraph_explore` primary and `codegraph_query` reserved |
| NEW | `docs/ai/specs/013-cypher-query-access-recipes.md` | at least ten recipes and guard probes |
| PHASE | `quickstart.md` | runnable validation and UAT guide |

**Reviewability result**: Within Slice 2 LOC and production-file budget. No third slice is planned.

### PR Strategy

Default delivery is one PR from current branch `013-cypher-query-access` because the two rule slices are planned as implementation checkpoints, not automatically separate PRs.

If the G5 task atomicity classifier requires multiple PRs, use one linear gh-stack route:

| Position | Branch suffix | Base | Contains |
|---|---|---|---|
| Bottom | `013-cypher-query-access-slice1` | `origin/main` | Slice 1 bounded connected-path end-to-end |
| Top | `013-cypher-query-access-slice2` | `013-cypher-query-access-slice1` | Slice 2 count/string/backtick/recipe closure |

Required later proof for multi-PR delivery: `gh stack submit --auto --remote origin`, then `gh stack view --json`. Do not create stack branches unless the classifier selects split-PR delivery.

## Evidence Matrix Design

Implementation must maintain one matrix row per recipe, guard probe, and major requirement:

| Column | Meaning |
|---|---|
| `id` | Requirement, success criterion, recipe id, or guard id |
| `slice` | Slice 1 or Slice 2 |
| `surface` | package, CLI, MCP, docs, live UAT, retrieval |
| `input` | Query or command input, bounded and redacted |
| `command` | Exact command or test path |
| `expectedState` | success, empty, diagnostic, timeout, or refusal |
| `observedState` | Result state, row count, truncation, or diagnostic code |
| `parityHash` | Hash for byte-identical CLI/MCP JSON where applicable |
| `artifact` | Transcript, fixture, or log path |
| `reviewer` | Human or agent reviewer |
| `date` | Verification date |

Retrieval-guardian review is mandatory for the default MCP steering change. Retrieval A/B validation is required before merge claims, but any external/off-box evaluation must remain blocked until the operator explicitly records provider, model/tool endpoints, repository context to be sent, retention/training setting, cost/time limit, and approval timestamp at runtime. Do not treat bootstrap or scaffold approval as off-box authorization.

## Validation Plan

Focused validation:

```bash
npx vitest run __tests__/cypher-parser.test.ts
npx vitest run __tests__/cypher-runtime.test.ts
npx vitest run __tests__/cli-query-command.test.ts
npx vitest run __tests__/mcp-cypher-query.test.ts
npx vitest run __tests__/cypher-recipes.test.ts
```

Full validation:

```bash
npm run build
npm run typecheck
npm test
```

Live self-index UAT:

```bash
node dist/bin/codegraph.js status . --json
node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --json
printf '%s' 'MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5' | node dist/bin/codegraph.js query - --json
```

MCP validation must compare canonical JSON payload bytes from CLI `--json` and `codegraph_query` text for identical valid, capped, diagnostic, and timeout states.
