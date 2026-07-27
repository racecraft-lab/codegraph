# Quickstart: SPEC-014 Control-Flow Graphs

This is the local acceptance runbook for the implementation phase. It uses
committed fixtures, real SQLite, the built CLI, and no secrets.

## Prerequisites

Run from the SPEC-014 worktree root.
The shell commands below target POSIX shells on macOS or Linux.

```bash
nvm use 24.11.1
npm ci
npm run build
```

The package supports Node `^20.19.0 || >=22.12.0 <25.0.0`; this runbook pins
Node 24.11.1 because its probes read SQLite directly with `node:sqlite`. CFG
analysis does not require embeddings, LSP, LLM credentials, or
`.envrc.local`; do not print, copy, or persist private environment files.

## Activation Contract

CFG has no `--analysis cfg` CLI flag. Enable it only by persisting
`analysis.cfg=true` in `codegraph.json`:

```json
{
  "analysis": {
    "cfg": true
  }
}
```

For an existing initialized project, update the config and run:

```bash
node dist/bin/codegraph.js sync "$PROJECT_ROOT" --embeddings off
```

The first enabled `sync` performs a full CFG backfill even when no source file
changed. `index "$PROJECT_ROOT" --embeddings off --no-lsp` is an optional full
rebuild, not a requirement for first enable. Setting `analysis.cfg=false` or
removing it immediately suppresses reads and makes later indexing and sync
CFG-dormant. Re-enable and run `sync` or `index` before retained rows can be
served as current.

## Slice 1: TypeScript/JavaScript End-to-End

1. Create a temporary fixture project and enable CFG only through
   `codegraph.json`.

   ```bash
   TMP_ROOT=$(mktemp -d)
   TSJS_PROJECT="$TMP_ROOT/cg-cfg-tsjs"
   mkdir -p "$TSJS_PROJECT/src"
   cp __tests__/analysis/cfg/fixtures/tsjs/baseline.ts "$TSJS_PROJECT/src/baseline.ts"
   printf '{"analysis":{"cfg":true}}\n' > "$TSJS_PROJECT/codegraph.json"
   node dist/bin/codegraph.js init "$TSJS_PROJECT" --embeddings off
   ```

   Expected: indexing succeeds, `analysis.cfg=true` is the only CFG activation
   mechanism, and CFG status/block/edge rows are written because CFG is enabled.

2. Resolve the real function ID from SQLite.

   ```bash
   TS_FUNCTION_ID=$(PROJECT="$TSJS_PROJECT" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.PROJECT + '/.codegraph/codegraph.db', { readOnly: true }); const row = db.prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?').get('src/baseline.ts', 'baselineScore'); db.close(); if (!row) throw new Error('baselineScore not indexed'); console.log(row.id);")
   ```

   Expected: `TS_FUNCTION_ID` contains an indexed `function:*` ID. Do not
   hard-code function IDs; they are content-derived and can change with fixture
   or extraction-contract changes.

3. Read the same function through the library.

   ```bash
   PROJECT_PATH="$TSJS_PROJECT" FUNCTION_ID="$TS_FUNCTION_ID" node --input-type=module -e "const { CodeGraph } = await import('./dist/index.js'); const cg = await CodeGraph.open(process.env.PROJECT_PATH); const result = cg.getCfg(process.env.FUNCTION_ID, { limit: 500, offset: 0 }); console.log(JSON.stringify(result, null, 2)); cg.close();"
   ```

   Expected: `state` is `available`, `reason` is null, `cfg` and `page` are
   non-null, and blocks contain exactly one `entry` and one `exit`.

4. Read the same function through CLI JSON and human output.

   ```bash
   node dist/bin/codegraph.js cfg "$TS_FUNCTION_ID" -p "$TSJS_PROJECT" --json --limit 500 --offset 0
   node dist/bin/codegraph.js cfg "$TS_FUNCTION_ID" -p "$TSJS_PROJECT" --limit 1 --offset 0
   ```

   Expected: JSON output is the exact `CfgReadResult` object and matches the
   library result field-for-field for the same page. Human output is bounded to
   the requested page while preserving the same state and reason.

5. Read the same function through the MCP handler surface.

   ```bash
   CODEGRAPH_MCP_TOOLS=get_cfg PROJECT_PATH="$TSJS_PROJECT" FUNCTION_ID="$TS_FUNCTION_ID" node --input-type=module -e "const { CodeGraph } = await import('./dist/index.js'); const { ToolHandler } = await import('./dist/mcp/tools.js'); const cg = await CodeGraph.open(process.env.PROJECT_PATH); const handler = new ToolHandler(cg); const result = await handler.execute('codegraph_get_cfg', { projectPath: process.env.PROJECT_PATH, functionId: process.env.FUNCTION_ID, limit: 1, offset: 0 }); console.log(JSON.stringify(result, null, 2)); cg.close();"
   ```

   Expected: the result does not set `isError: true`. Repeating the call with
   increasing `offset` reconstructs ordered blocks and edges without duplicates
   or gaps.

6. Check aggregate status.

   ```bash
   node dist/bin/codegraph.js status "$TSJS_PROJECT" --json
   ```

   Expected: top-level `cfg` reports `enabled=true`, deterministic state,
   available count, skipped count, unsupported count, resource-limited count,
   and stale count.

7. Drive lifecycle transitions with real file changes.

   ```bash
   printf '\nexport const touchedForSync = true;\n' >> "$TSJS_PROJECT/src/baseline.ts"
   node dist/bin/codegraph.js sync "$TSJS_PROJECT" --embeddings off
   TS_FUNCTION_ID=$(PROJECT="$TSJS_PROJECT" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.PROJECT + '/.codegraph/codegraph.db', { readOnly: true }); const row = db.prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?').get('src/baseline.ts', 'baselineScore'); db.close(); if (!row) throw new Error('baselineScore not indexed'); console.log(row.id);")
   CFG_COUNTS_BEFORE_DISABLE=$(PROJECT="$TSJS_PROJECT" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.PROJECT + '/.codegraph/codegraph.db', { readOnly: true }); const row = db.prepare('SELECT (SELECT COUNT(*) FROM cfg_status) || ? || (SELECT COUNT(*) FROM cfg_blocks) || ? || (SELECT COUNT(*) FROM cfg_edges) AS counts').get(':', ':'); db.close(); console.log(row.counts);")
   printf '{"analysis":{"cfg":false}}\n' > "$TSJS_PROJECT/codegraph.json"
   node dist/bin/codegraph.js sync "$TSJS_PROJECT" --embeddings off
   node dist/bin/codegraph.js cfg "$TS_FUNCTION_ID" -p "$TSJS_PROJECT" --json
   CFG_COUNTS_AFTER_DISABLE=$(PROJECT="$TSJS_PROJECT" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.PROJECT + '/.codegraph/codegraph.db', { readOnly: true }); const row = db.prepare('SELECT (SELECT COUNT(*) FROM cfg_status) || ? || (SELECT COUNT(*) FROM cfg_blocks) || ? || (SELECT COUNT(*) FROM cfg_edges) AS counts').get(':', ':'); db.close(); console.log(row.counts);")
   test "$CFG_COUNTS_BEFORE_DISABLE" = "$CFG_COUNTS_AFTER_DISABLE"
   printf '{"analysis":{"cfg":true}}\n' > "$TSJS_PROJECT/codegraph.json"
   node dist/bin/codegraph.js index "$TSJS_PROJECT" --embeddings off --no-lsp
   TS_FUNCTION_ID=$(PROJECT="$TSJS_PROJECT" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.PROJECT + '/.codegraph/codegraph.db', { readOnly: true }); const row = db.prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?').get('src/baseline.ts', 'baselineScore'); db.close(); if (!row) throw new Error('baselineScore not indexed'); console.log(row.id);")
   node dist/bin/codegraph.js cfg "$TS_FUNCTION_ID" -p "$TSJS_PROJECT" --json
   ```

   Expected: the disabled JSON read reports `disabled` with
   `analysis_disabled`; the before/after row-count strings are equal; and the
   final re-enabled read reports `available` only after the full refresh.

8. Clean up when manual inspection is complete.

   ```bash
   rm -rf "$TMP_ROOT"
   ```

## Slice 2: Python Parity

1. Create a temporary Python fixture project and enable CFG only through
   `codegraph.json`.

   ```bash
   TMP_ROOT=$(mktemp -d)
   PY_PROJECT="$TMP_ROOT/cg-cfg-python"
   mkdir -p "$PY_PROJECT/src"
   cp __tests__/analysis/cfg/fixtures/python/parity_baseline.py "$PY_PROJECT/src/parity_baseline.py"
   printf '{"analysis":{"cfg":true}}\n' > "$PY_PROJECT/codegraph.json"
   node dist/bin/codegraph.js init "$PY_PROJECT" --embeddings off
   ```

2. Resolve the real Python function ID from SQLite.

   ```bash
   PY_FUNCTION_ID=$(PROJECT="$PY_PROJECT" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.PROJECT + '/.codegraph/codegraph.db', { readOnly: true }); const row = db.prepare('SELECT id FROM nodes WHERE file_path = ? AND name = ?').get('src/parity_baseline.py', 'branch_loop_parity'); db.close(); if (!row) throw new Error('branch_loop_parity not indexed'); console.log(row.id);")
   ```

3. Read the Python CFG through library, CLI JSON, CLI human, MCP, and status.

   ```bash
   PROJECT_PATH="$PY_PROJECT" FUNCTION_ID="$PY_FUNCTION_ID" node --input-type=module -e "const { CodeGraph } = await import('./dist/index.js'); const cg = await CodeGraph.open(process.env.PROJECT_PATH); const result = cg.getCfg(process.env.FUNCTION_ID, { limit: 500, offset: 0 }); console.log(JSON.stringify(result, null, 2)); cg.close();"
   node dist/bin/codegraph.js cfg "$PY_FUNCTION_ID" -p "$PY_PROJECT" --json --limit 500 --offset 0
   node dist/bin/codegraph.js cfg "$PY_FUNCTION_ID" -p "$PY_PROJECT" --limit 1 --offset 0
   CODEGRAPH_MCP_TOOLS=get_cfg PROJECT_PATH="$PY_PROJECT" FUNCTION_ID="$PY_FUNCTION_ID" node --input-type=module -e "const { CodeGraph } = await import('./dist/index.js'); const { ToolHandler } = await import('./dist/mcp/tools.js'); const cg = await CodeGraph.open(process.env.PROJECT_PATH); const handler = new ToolHandler(cg); const result = await handler.execute('codegraph_get_cfg', { projectPath: process.env.PROJECT_PATH, functionId: process.env.FUNCTION_ID, limit: 1, offset: 0 }); console.log(JSON.stringify(result, null, 2)); cg.close();"
   node dist/bin/codegraph.js status "$PY_PROJECT" --json
   ```

   Expected: Python `branch_loop_parity` uses the same `CfgReadResult`, block,
   edge, status, and page contracts as TypeScript/JavaScript.

4. Clean up when manual inspection is complete.

   ```bash
   rm -rf "$TMP_ROOT"
   ```

## Automated UAT

Run these tests when collecting PR evidence. They create isolated mirrors under
the OS temp directory, write `analysis.cfg=true` only to those mirrors, index
real SQLite with embeddings off and LSP disabled, and remove the mirrors during
test cleanup.

```bash
npx vitest run __tests__/analysis/cfg/cfg-contract.test.ts -t 'keeps CFG parsers available when the built CLI indexes and first-enable syncs through parse workers' --reporter=verbose
CODEGRAPH_PYTHON_FIXTURE_UAT=1 CODEGRAPH_NO_DAEMON=1 CODEGRAPH_MCP_TOOLS=get_cfg node node_modules/vitest/vitest.mjs run __tests__/analysis/cfg/cfg-contract.test.ts -t 'T038' --reporter=verbose
CODEGRAPH_SELF_REPO_UAT=1 CODEGRAPH_NO_DAEMON=1 CODEGRAPH_MCP_TOOLS=get_cfg node node_modules/vitest/vitest.mjs run __tests__/analysis/cfg/cfg-contract.test.ts -t 'dogfoods the current repository' --reporter=verbose
```

Expected: the built-runtime regression proves TypeScript `init`, TypeScript
plus Python first-enable zero-change `sync`, and real built-CLI reads. Each
env-gated UAT emits exactly one bounded JSON line:
`{"uat":"spec-014-python-fixture-cfg",...}` or
`{"uat":"spec-014-self-repo-cfg",...}`. The lines include runtime identity,
selected function ID, graph/source-version IDs, block/edge totals, MCP page
count, and CFG status.

## Performance Evidence

The benchmark test is opt-in so normal full-suite runs are not timing-gated by
machine load.

```bash
CODEGRAPH_CFG_PERF_EVIDENCE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts
CODEGRAPH_CFG_PERF_SMOKE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts
npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts
```

Expected:

- `CODEGRAPH_CFG_PERF_EVIDENCE=1`: authoritative product evidence with 2 warmup
  pairs, 10 measured pairs, and paired-median ratio `<= 1.20`.
- `CODEGRAPH_CFG_PERF_SMOKE=1`: non-authoritative smoke with 2 warmup pairs and
  5 measured pairs; it verifies benchmark shape and invariants but does not
  block PR evidence on timing.
- Plain `npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts` skips
  timed benchmarking and keeps deterministic non-timing parser/cache coverage.

Every timing run records repository commit, benchmark fixture identity, Node
version, OS, architecture, CPU model, logical core count, total memory, storage
root, command line, CFG-related environment overrides, warmup pairs, measured
pair timings, disabled/enabled medians, min/max, and
`median(enabled)/median(disabled)`. The disabled arm records zero CFG status,
block, or edge writes.

## PR Review Packet

### What Changed and Why

- Added default-off, deterministic per-function CFGs for TypeScript,
  JavaScript, and Python.
- Persisted exact CFG status, block, and edge rows in local SQLite with
  lifecycle handling for enable, sync, delete, disable, re-enable, failure,
  staleness, and cancellation.
- Exposed one bounded `CfgReadResult` contract through the library, CLI JSON,
  MCP, and aggregate status.
- Added source-once parsing for each CFG run, Python lambda identity, semantic
  parity fixtures, schema-shipping checks, and isolated UAT.

### Review Order

The aggregate branch exceeds the reviewability budget and must be reviewed in
this marker-safe order:

1. Full SPEC, baseline fixtures, contracts, and process documentation.
2. Foundation: config, schema/migration, public result types, and helpers.
3. TypeScript/JavaScript core, determinism, skip states, and block cap.
4. TypeScript/JavaScript `throw` and `finally`.
5. TypeScript/JavaScript expression short-circuit flow.
6. TypeScript/JavaScript switch, loop, and label flow.
7. TypeScript/JavaScript unreachable-code and golden completion.
8. Lifecycle: enable/backfill/sync/delete/disable/re-enable/failure/cancellation.
9. Library, CLI, MCP, and status surfaces.
10. Python identity and semantic parity.
11. Performance, schema shipping, retrieval remediation and guardian evidence,
    UAT, final gates, and reconciled roadmap and process artifacts.

### Scope Budget

Current `origin/main...working tree` snapshot:

| Scope | Actual |
|---|---:|
| Entire feature | 67 files; +17,145/-190 |
| Production `src/**` | 10 files; +4,432/-25; 4,457 churn |
| Tests | 34 files; +7,178/-29 |
| SPEC/process documents | 23 files; +5,535/-136 |
| Committed fixtures | 18 files; +238 |
| Benchmark harness | 1 file; +548 |
| Tracked generated `dist/**` | 0 files |

The setup forecast was 780 reviewable LOC, 8 production surfaces, and 18 total
files. The actual feature materially exceeds every forecast, so the final
reviewability decision is `marker_split`, not a single aggregate PR.

### Evidence Separation

- Product source: `src/analysis/cfg/index.ts`, schema/migrations, config,
  library API, CLI, MCP, Python extraction, and extraction version.
- Verification harness: focused CFG contract, lifecycle, language, schema,
  dormancy, CLI, status, and MCP tests.
- Fixtures: only `__tests__/analysis/cfg/fixtures/tsjs/` and
  `__tests__/analysis/cfg/fixtures/python/`.
- Benchmark: `cfg-performance.test.ts` and its bounded emitted evidence only.
- Generated/shipped: `dist/db/schema.sql` is regenerated by `npm run build`,
  is not committed separately, and is byte-equal to the source schema at
  SHA-256 `ee029372fb2aaeb7c697ed3a4d317a7eee811fe5bfdba960f9bc9ccb563c53c3`.
- Managed process metadata: `.specify/feature.json`, generated MOC zones,
  workflow, and autopilot state remain distinct from product source.
- Raw benchmark logs, credentials, and local environment files are not
  committed.

### Traceability

| Requirement area | Requirements and success criteria | Evidence |
|---|---|---|
| Default-off lifecycle | FR-001–FR-010; SC-001, SC-002, SC-004 | Config, index orchestration, CFG store, lifecycle tests |
| Deterministic safe semantics | FR-011–FR-027; SC-003, SC-005, SC-011 | CFG module and TypeScript/JavaScript/Python suites |
| Read surfaces and status | FR-028–FR-030; SC-006–SC-008 | Public API, CLI, MCP, server guidance, contract tests |
| Determinism, performance, slicing | FR-031–FR-033; SC-003, SC-009 | Determinism tests, benchmark, marker plan |
| Dogfooding | FR-034; SC-010, SC-011 | Self-repo UAT, Python fixture UAT, this runbook |
| Schema and shipping | FR-004, FR-005, FR-015 | Schema, migration, build copy, schema-shipping test |

The complete FR-to-task matrix is in `tasks.md` under **Requirement Coverage**.

### Current Verification

- Node 24.11.1 build and typecheck passed.
- The complete CFG directory passed 103 tests with 2 explicit opt-in skips.
- The full repository suite passed 259 files and 4,647 tests; 15 files and 181
  tests were skipped.
- Schema shipping passed 6/6 with exactly 3 tables, 5 indexes, and 3 triggers
  and the matching SHA-256 above.
- The initial authoritative performance RED was `1.4128`; the optimized
  evidence runs passed at `1.1618`, `1.1673`, and `1.159`.
- The disabled benchmark arm wrote zero CFG rows and made zero network fetches.
  The enabled arm wrote 36 statuses, 137 blocks, and 104 edges while preserving
  all held non-CFG counts.
- Self-repo UAT indexed 671 files and selected a 6-block/6-edge graph; aggregate
  status reported 3,160 available, 1,599 unsupported, 0 resource-limited, and
  0 stale.
- Python UAT returned 17 blocks, 21 edges, and 21 MCP pages with one available
  CFG and no skip or stale row.
- Built-runtime manual UAT returned an available 7-block/7-edge TypeScript CFG,
  preserved `1:7:7` CFG row counts across disabled sync, restored `available`
  after re-index, and returned the available 17-block/21-edge Python CFG
  through library, built CLI, MCP, and status.
- T041 focused contract and guardian probes passed. Two authorized Sonnet/high
  A/B repetitions succeeded in every arm with no worst-case Read regression;
  see `.process/evidence/t041-retrieval-ab.json`.

### Non-Goals

- Dataflow, reaching definitions, def-use, PDG, or taint analysis; SPEC-015
  through SPEC-017 own those layers.
- Languages beyond TypeScript, JavaScript, and Python.
- REST or CFG write surfaces, fuzzy/name/source-position lookup, implicit
  exception inference, or scheduler suspension/resumption semantics.
- Persisted lowering instructions, edit-stable block identity, nested-body
  inlining, partial/truncated CFGs, or serving retained rows while disabled.

### Rollback and Feature Flag

Operational rollback is to set `analysis.cfg=false` or remove `cfg`. Reads
immediately become `disabled`, and later index/sync runs make zero CFG writes.
Retained rows stay inert and can be refreshed after re-enable. The local SQLite
index is regenerable; a binary rollback across schema-v11 compatibility should
rebuild the index with that binary instead of reusing a newer migrated
database. CFG requires no network capability or credential.

### Known Gaps and Environment Notes

- The authorized T041 external A/B ran twice per arm and passed. Raw model logs
  remain local and ephemeral; the committed summary records hashes and tool
  counts without persisting repository-derived model transcripts.
- The active Codex task cannot hot-register a newly built MCP surface; the
  in-process MCP handler UAT is authoritative for this task.
- The host watcher exhausted the operating-system watch/file limit, so the
  local dogfood index requires manual sync. This is an environment limitation,
  not CFG contract evidence.
- The live worktree config intentionally keeps CFG disabled. Isolated
  CFG-enabled mirrors are the authoritative acceptance targets.
- No product work is silently deferred; any new product gap requires a named
  follow-up issue or specification.
