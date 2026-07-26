# Implementation Plan: SPEC-014 Control-Flow Graphs

**Branch**: `014-control-flow-graphs` | **Date**: 2026-07-25 | **Spec**: `specs/014-control-flow-graphs/spec.md`

**Input**: Feature specification from `specs/014-control-flow-graphs/spec.md`, Plan Prompt in `docs/ai/specs/.process/SPEC-014-workflow.md`, Design Concept in `docs/ai/specs/.process/SPEC-014-design-concept.md`, constitution, roadmap, and repository evidence.

## Summary

SPEC-014 adds deterministic, opt-in, per-function control-flow graphs for TypeScript, JavaScript, and Python. The design uses the smallest language-neutral CFG lowering/building layer under `src/analysis/cfg`, persists compact per-function status plus block and edge metadata in SQLite, and exposes one exact machine shape through `CodeGraph.getCfg`, `codegraph cfg --json`, and `codegraph_get_cfg`.

The plan preserves the clarified decisions "Add CLI and MCP", "Function ID only", "Exact shared shape", "Skip function", "Retain stale CFG", and "Two language slices". Delivery remains two vertical slices: Slice 1 ships shared infrastructure plus TypeScript/JavaScript end to end through library, CLI, MCP, and status; Slice 2 adds Python parity through the same contracts.

## Technical Context

**Language/Version**: TypeScript on the package-supported Node range
`^20.19.0 || >=22.12.0 <25.0.0`; this runbook's direct `node:sqlite` probes
and project commands use Node 24.11.1.

**Primary Dependencies**: Existing `web-tree-sitter`, CodeGraph extraction/query/database layers, `node:sqlite` through the local adapter. No new runtime dependency is planned.

**Storage**: SQLite only. CFG tables are added to `src/db/schema.sql` and mirrored by a new migration. New SQL ships because the existing build copies `src/db/schema.sql` into `dist/`.

**Testing**: Vitest with real files and real SQLite. CFG tests use committed TypeScript/JavaScript and Python fixtures plus self-repo UAT. No database mocking.

**Target Platform**: Local CodeGraph library, CLI, and MCP server on supported Node runtimes. REST is out of scope for SPEC-014.

**Project Type**: Local-first library, CLI, and MCP server.

**Performance Goals**: Enabled CFG analysis paired-median index-time ratio must be `<= 1.20` against the same benchmark monorepo with CFG disabled.

**Constraints**: Fully dormant while disabled; no network calls; no CFG status/block/edge writes while disabled; no persisted lowering instructions; no implicit exception edges; no partial CFGs; MCP pages clamp `limit` to `1..500` and `offset` to `>=0`; per-function safety cap is 10,000 basic blocks.

**Scale/Scope**: Current self-repo index scale and the committed benchmark monorepo fixture. CFG rows are per function and replaced by affected file, not by full project on every sync except first enable/backfill.

**Reviewability Budget**: Primary surface: schema/migration plus analysis harness/adapters. Secondary surfaces: library read, CLI read, MCP read tool, aggregate status, deterministic fixtures, benchmark/UAT. Setup estimate remains 780 reviewable LOC with a two-slice warning accepted during Grill Me. Current reviewability evidence:

| Evidence | Result | Disposition |
|---|---|---|---|
| Setup `estimate-spec-size` | `estimated_loc=780`, `suggested_slices=2`, `status=warn` from final setup signals `user_stories=4`, `files=8`, `frs=24`, net-new | Preserve the operator-ratified two-slice split; warning is below the setup-mode block threshold. |
| Plan `estimate-reviewable-loc` | `projected=360`, `status=pass`, with 9 declared production file operations | Current plan-phase reviewability evidence permits implementation to proceed. |
| Slice boundary | Slice 1 proves shared infrastructure plus TypeScript/JavaScript through library, CLI, MCP, and status; Slice 2 carries Python through the same contracts | Re-check before implementation and again in final task `T043`; re-slice before implementation if a current gate shows either slice is too large. |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Check

| Principle | Result | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | Q1-Q28 and Clarify sessions freeze states, reasons, public names, paging, exit behavior, lifecycle, and language semantics. No new ambiguity was found. |
| II. Simplicity First | PASS with tracked complexity | Persist status/block/edge metadata only, keep lowering IR in memory, and expose reads by function ID only. Complexity rows below cover the required multi-surface contract and affected-file lifecycle. |
| III. Surgical Changes | PASS | New CFG implementation is isolated to `src/analysis/cfg`; existing edits are limited to schema/migration, config, library, CLI, MCP guidance/tool registration, and status. |
| IV. Goal-Driven Execution | PASS | Each slice has failing-first fixture, SQLite lifecycle, parity, determinism, pagination, status, benchmark, and UAT gates. |
| V. Deterministic, LLM-Free Extraction | PASS | CFG structure derives only from tree-sitter AST/static lowering. Unsupported or unsafe functions are skipped whole. |
| VI. Retrieval Performance | PASS | MCP output is paginated and bounded; `src/mcp/` changes require retrieval-guardian before merge. |
| VII. Local-First | PASS | Uses `node:sqlite`, no network calls, no native dependency, no writes while disabled, and schema ships through existing build asset copy. |
| Dogfooding | PASS | Self-repo UAT activates CFG on this repository without secrets and verifies library/CLI/MCP/status parity. |

### Post-Design Check

| Principle | Result | Evidence |
|---|---|---|
| I. Think Before Coding | PASS | Research, data model, and contracts preserve clarified names, states, reasons, ordering, paging, exit behavior, source versions, and cancellation lifecycle. |
| II. Simplicity First | PASS with tracked complexity | One compact CFG module is enough for Slice 1; Python is added only after the path is proven. No persisted lowering instructions or REST/write surfaces are introduced. |
| III. Surgical Changes | PASS | Slice tables below keep file ownership vertical and exclude unrelated refactors. |
| IV. Goal-Driven Execution | PASS | Verification tables map each slice to concrete tests and UAT probes. |
| V. Deterministic, LLM-Free Extraction | PASS | Block IDs, block order, edge order, reasons, and messages are deterministic; unsafe lowerings produce status rows only. |
| VI. Retrieval Performance | PASS | MCP page totals reconstruct complete CFGs; expected states return success-shaped results, not `isError`. |
| VII. Local-First | PASS | Disabled path is byte-dormant for CFG rows and network-free; `.envrc.local` is not read, logged, or persisted by CFG code. |
| Dogfooding | PASS | Quickstart includes self-repo TypeScript probe and committed Python parity fixture. |

## Project Structure

### Documentation (this feature)

```text
specs/014-control-flow-graphs/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cfg-cli.md
│   ├── cfg-mcp.md
│   ├── cfg-shared-contract.md
│   └── cfg-status.md
└── tasks.md              # Created later by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── analysis/
│   └── cfg/
│       └── index.ts      # Slice 1 shared IR, builder, store, TS/JS lowerer; Slice 2 imports Python parity
├── db/
│   ├── schema.sql
│   └── migrations.ts
├── project-config.ts
├── index.ts
├── bin/codegraph.ts
└── mcp/
    ├── tools.ts
    └── server-instructions.ts

__tests__/
└── analysis/
    └── cfg/
        ├── cfg-contract.test.ts
        ├── cfg-lifecycle.test.ts
        ├── cfg-typescript.test.ts
        ├── cfg-python.test.ts
        ├── cfg-performance.test.ts
        └── fixtures/
```

**Structure Decision**: Use one new `src/analysis/cfg` module for CFG-specific lowering, building, persistence, and reads. Keep existing surface edits narrow and do not update root agent instruction files.

## Declared File Operations

The following entries are implementation ownership declarations for the two vertical slices. Tests, fixtures, and docs are listed in the slice tables below but are not counted as production reviewable LOC by the runner.

- NEW src/analysis/cfg/index.ts
- MODIFIED src/db/schema.sql
- MODIFIED src/db/migrations.ts
- MODIFIED src/project-config.ts
- MODIFIED src/index.ts
- MODIFIED src/bin/codegraph.ts
- MODIFIED src/mcp/tools.ts
- MODIFIED src/mcp/server-instructions.ts
- MODIFIED src/extraction/languages/python.ts

## Architecture

### CFG IR and Builder

The runtime design uses a small in-memory IR and builder:

- `CfgLowerer`: language adapter that receives a parsed source file, the current function node, source text, and the current function ID.
- `CfgBuilder`: owns synthetic `entry` and `exit` blocks, deterministic block IDs, block ordering, typed edges, finally routing, safety-cap accounting, and validation.
- `CfgStatusStore`: owns status/block/edge writes and reads, source-version checks, affected-file swaps, tombstones, stale retention, disabled suppression, and pagination.

The IR is only a transient lowering shape for statements, expression branches, loops, multi-way branches, explicit throws/raises, abrupt transfers, nested function boundaries, and unreachable blocks. It is never persisted. The persisted graph contains complete metadata only: status/source version, block role/source spans, and typed edges.

### Deterministic Identity and Ordering

Block IDs are derived from `functionId`, opaque `sourceVersion`, block role, and deterministic lowering ordinal. They must be stable for identical source and may change when the function changes. Blocks are ordered by lowering ordinal with `entry` first and `exit` last, then block ID as a tie-breaker. Edges are ordered by source-block ordinal, this fixed edge-kind order, and target block ID:

```text
fallthrough, true, false, case, default, loop_back, return, throw, break, continue, finally
```

### Source and Contract Versions

Each status row stores:

- `source_version`: opaque function snapshot token derived from file content hash, function ID, function span, language, and CFG contract versions.
- `status_version`: closed-state/reason contract version.
- `block_version`: block-role/span contract version.
- `edge_version`: edge-kind/order contract version.
- `schema_version`: database schema version that introduced the CFG tables.

Reads report a persisted row as current only when the live function token and every CFG contract version match. A mismatch is reported as `stale` with reason `source_version_mismatch` unless disabled analysis suppresses rows first.

### Persistence and Lifecycle

CFG tables deliberately do not use a foreign key to `nodes(id)`. Function ID, file path, language, and spans are stored by value because node rows are deleted and re-inserted during sync. Cascades may exist only within CFG-owned tables, such as status to blocks to edges.

Lifecycle rules:

- Disabled: live config is consulted first. Reads return `disabled` with `analysis_disabled`; indexing/sync writes no CFG status, block, or edge rows.
- First enable: Set `analysis.cfg=true` in `codegraph.json` and run `index` or `sync`; the run schedules a full CFG backfill even when the normal change set is empty.
- Successful affected-file refresh: compute every current function status for the file, then one transaction replaces prior CFG status, blocks, and edges for that file.
- Deletion: successful sync removes current payloads for deleted files/functions and retains compact `deleted` tombstones for previously known function IDs.
- Disable: retained rows become inert and unreadable.
- Re-enable: retained rows are not served as current until a fresh backfill or affected-file refresh validates their source versions.
- Unexpected first refresh failure: write `unavailable` with `first_refresh_failed`, no payload.
- Unexpected refresh failure after a prior successful snapshot: keep the prior payload only as `stale` with `refresh_failed_retained_stale`.
- CFG analysis failures are contained to CFG status handling: they do not fail otherwise successful project indexing/sync, publish partial status/block/edge rows, or change non-CFG index results.
- Cancellation: before swap, no marker and no partial state; after atomic swap commits, the committed result stands.

### Public Surfaces

Machine-readable surfaces share the exact `CfgReadResult` shape from `contracts/cfg-shared-contract.md`:

- Library: `CodeGraph.getCfg(functionId, { limit, offset })`
- CLI JSON: `codegraph cfg <function-id> -p <path> --json --limit <n> --offset <n>`
- MCP: `codegraph_get_cfg` with `projectPath`, `functionId`, optional `limit`, optional `offset`

CLI human output may render differently but must preserve the same state and reason and stay bounded to the requested page. Expected CFG states exit 0; invalid usage, invalid project access, serialization/output failure, and unexpected internal failures that prevent a result exit nonzero.

## Two-Slice Plan

### Slice 1: Shared Infrastructure plus TypeScript/JavaScript End to End

| Operation | Path | Purpose |
|---|---|---|
| NEW | `src/analysis/cfg/index.ts` | Shared `CfgReadResult` types, in-memory IR, builder, TypeScript/JavaScript lowerer, store, pagination, status resolver, lifecycle orchestration. |
| MODIFIED | `src/db/schema.sql` | Add CFG status, block, and edge tables plus indexes; no FK to `nodes(id)`. |
| MODIFIED | `src/db/migrations.ts` | Add the schema migration and bump current schema version. |
| MODIFIED | `src/project-config.ts` | Extend `analysis` config with `cfg?: boolean`, default false, malformed values disabled. |
| MODIFIED | `src/index.ts` | Wire opt-in CFG analysis after successful index/sync; expose `getCfg`; expose aggregate status. |
| MODIFIED | `src/bin/codegraph.ts` | Add `codegraph cfg`, JSON/human output, expected-state exit behavior, and status output; CFG activation is only through `analysis.cfg=true` in `codegraph.json` followed by `index` or `sync`. |
| MODIFIED | `src/mcp/tools.ts` | Add bounded read-only `codegraph_get_cfg` tool returning the shared machine object. |
| MODIFIED | `src/mcp/server-instructions.ts` | Add concise agent-facing guidance for the new CFG tool without telling agents to use Read. |
| NEW | `__tests__/analysis/cfg/cfg-contract.test.ts` | Library/CLI JSON/MCP shape parity, paging clamps, expected-state exit behavior. |
| NEW | `__tests__/analysis/cfg/cfg-lifecycle.test.ts` | Real-SQLite enable, backfill, affected-file refresh, delete, disable, stale failure, first failure, cancellation, re-enable. |
| NEW | `__tests__/analysis/cfg/cfg-typescript.test.ts` | TS/JS semantics, determinism, unsupported/resource-limited skips, no partial graphs. |
| NEW | `__tests__/analysis/cfg/cfg-performance.test.ts` | Paired-median disabled/enabled benchmark method over benchmark monorepo fixture. |
| NEW | `__tests__/analysis/cfg/fixtures/tsjs/` | Golden fixtures for short-circuit, switch/fallthrough, optional chaining, nullish coalescing, try/finally, nested functions, unreachable blocks, over-limit. |

Verification gates for Slice 1:

| Gate | Command or Probe | Expected Result |
|---|---|---|
| Focused TS/JS semantics | `npx vitest run __tests__/analysis/cfg/cfg-typescript.test.ts` | Deterministic CFGs, stable block IDs on same source, exact edge kinds/order, unsupported whole-function skips. |
| Lifecycle | `npx vitest run __tests__/analysis/cfg/cfg-lifecycle.test.ts` | Every enable/sync/delete/disable/stale/failure/cancellation/re-enable state matches the contract. |
| Public contract | `npx vitest run __tests__/analysis/cfg/cfg-contract.test.ts` | Library, CLI JSON, and MCP results are field-for-field equal for expected states. |
| Performance evidence | `CODEGRAPH_CFG_PERF_EVIDENCE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` | Authoritative paired-median enabled/disabled ratio is `<= 1.20` with 2 warmup pairs and 10 measured pairs. |
| Performance smoke | `CODEGRAPH_CFG_PERF_SMOKE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` | Non-authoritative 2 warmup plus 5 measured-pair smoke verifies benchmark shape and invariants without serving as PR timing evidence. |
| Build and full suite | `npm run build` then `npm test` | Build assets include schema changes; full test suite remains green. |
| Retrieval review | retrieval-guardian on `src/mcp/` diff | MCP change does not regress retrieval guidance or error shaping. |
| Self-repo UAT | `quickstart.md` Slice 1 UAT | Real TS/JS function returns matching library/CLI/MCP results and status counts. |

### Slice 2: Python Parity Through the Same Contracts

| Operation | Path | Purpose |
|---|---|---|
| MODIFIED | `src/analysis/cfg/index.ts` | Add Python lowering for the shared builder, including `match`/`case`, comprehensions, generator expressions, explicit `raise`, ordinary-operation `await`/`yield`, and Python-specific unsupported detection. |
| MODIFIED | `src/extraction/languages/python.ts` | Add deterministic Python lambda identity so separately addressable lambda CFGs can be read by function ID. |
| NEW | `__tests__/analysis/cfg/cfg-python.test.ts` | Python parity and construct coverage through the shared read contract. |
| NEW | `__tests__/analysis/cfg/fixtures/python/` | Python fixtures for branches, loops, `raise`, `match`/`case`, comprehensions, generators, nested functions/lambdas, unreachable blocks, async/generator ordinary-operation semantics. |
| MODIFIED | `__tests__/analysis/cfg/cfg-contract.test.ts` | Add Python rows to parity matrix without changing the shared machine shape. |
| MODIFIED | `__tests__/analysis/cfg/cfg-performance.test.ts` | Include Python parity fixture in final cross-language benchmark evidence. |
| MODIFIED | `specs/014-control-flow-graphs/quickstart.md` | Record Python parity UAT alongside the self-repo TypeScript/JavaScript probe. |

Verification gates for Slice 2:

| Gate | Command or Probe | Expected Result |
|---|---|---|
| Focused Python semantics | `npx vitest run __tests__/analysis/cfg/cfg-python.test.ts` | Python uses the same block, edge, status, paging, and read result contract as TS/JS. |
| Cross-language parity | `npx vitest run __tests__/analysis/cfg/cfg-contract.test.ts` | Equivalent TS/JS and Python fixtures satisfy the same state, ordering, pagination, and skip contracts. |
| Performance evidence | `CODEGRAPH_CFG_PERF_EVIDENCE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` | Combined enabled CFG overhead remains `<= 1.20` paired median with 2 warmup pairs and 10 measured pairs. |
| Performance smoke | `CODEGRAPH_CFG_PERF_SMOKE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` | Non-authoritative smoke verifies benchmark shape and invariants; rerun evidence mode for PR timing evidence. |
| Build and full suite | `npm run build` then `npm test` | Full repo remains green with Python parity enabled. |
| Self-repo and fixture UAT | `quickstart.md` Slice 2 UAT | Self-repo TS/JS probe still passes and committed Python fixture proves parity. |

## Phase 0 Research Output

See `research.md`.

Key decisions:

- Reparse affected source files with existing tree-sitter during CFG analysis rather than persisting syntax trees or lowering instructions.
- Use by-value CFG status/block/edge tables with only CFG-owned cascades.
- Derive read state from live config, project/index state, function existence, source-version equality, status, and row availability.
- Use shared paging over deterministic block and edge arrays.
- Reuse the committed benchmark-monorepo paired-median method with CFG disabled and CFG enabled arms.

## Phase 1 Design Output

See:

- `data-model.md`
- `contracts/cfg-shared-contract.md`
- `contracts/cfg-cli.md`
- `contracts/cfg-mcp.md`
- `contracts/cfg-status.md`
- `quickstart.md`

## Performance and Reliability

Benchmark method:

- Materialize the same committed benchmark-monorepo fixture for both arms.
- Arm A: `analysis.cfg=false` or absent.
- Arm B: `analysis.cfg=true`.
- Record benchmark identity before timing: repository commit, benchmark fixture path, fixture content hash or fixture commit, Node version, OS, architecture, CPU model, logical core count, total memory, storage root, command line, and CFG-related environment overrides.
- Run `CODEGRAPH_CFG_PERF_EVIDENCE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` for authoritative PR evidence: 2 warmup pairs, then 10 measured pairs, with paired-median ratio `<= 1.20`.
- Run `CODEGRAPH_CFG_PERF_SMOKE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` only as non-authoritative smoke: 2 warmup pairs and 5 measured pairs, validating benchmark shape and invariants without blocking on timing.
- Plain `npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` skips the timed benchmark and keeps deterministic non-timing parser/cache coverage in normal suites.
- Alternate arms by pair to reduce drift.
- Clean `.codegraph/` between project materializations so the comparison measures index-time analysis, not cache residue.
- Record every pair timing plus median(A), median(B), min/max, sample count, warmup count, and `median(B)/median(A)`. A single unpaired run cannot satisfy or fail the budget.
- Pass when paired-median ratio is `<= 1.20`.

Reliability constraints:

- The 10,000-block cap is enforced before any CFG payload rows are written.
- Builders check cancellation at file/function boundaries, after bounded lowering batches of at most 500 statements, blocks, or edges, and before the final atomic swap; long CFG lowering yields between batches so generated functions do not monopolize index or sync.
- MCP pages default to `limit=100`, clamp to `1..500`, and use `offset>=0`.
- Expected states are success-shaped on library, CLI JSON, and MCP surfaces.
- Messages are bounded to 240 Unicode code points and never include raw source text or raw exception strings.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Multiple read surfaces in Slice 1 | Clarified decision "Add CLI and MCP" requires library, CLI JSON/human output, MCP, and aggregate status parity. | Library-only was explicitly rejected in Q8 and would fail FR-011, FR-028, FR-029, and FR-030. |
| Affected-file CFG refresh instead of full catalog swap | FR-004 requires changed/deleted functions in an affected file not to retain apparently current old rows while unaffected files remain unchanged. | Full project recompute was rejected in Q3; `nodes(id)` cascade would destroy stale retention and violates FR-004. |
