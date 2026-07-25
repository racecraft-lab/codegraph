# Quickstart: SPEC-014 Control-Flow Graphs

This guide is the acceptance runbook for the implementation phase. It uses local files, real SQLite, and no secrets.

## Prerequisites

```bash
npm ci
npm run build
```

Do not print, copy, or persist `.envrc.local`. CFG analysis does not require embedding or LLM credentials.

## Slice 1: TypeScript/JavaScript End-to-End

1. Enable CFG analysis for a temporary fixture project.

   ```bash
   node dist/bin/codegraph.js index /tmp/cg-cfg-tsjs --analysis cfg
   ```

   Expected: `codegraph.json` contains `analysis.cfg=true`, the index succeeds, and CFG status/block/edge rows are written only because CFG is enabled.

2. Query a supported TypeScript or JavaScript function by function ID through the library.

   ```bash
   node -e "import('./dist/index.js').then(async ({default: CodeGraph}) => { const cg = await CodeGraph.open('/tmp/cg-cfg-tsjs'); const r = cg.getCfg(process.argv[1], {limit:100, offset:0}); console.log(JSON.stringify(r)); cg.destroy(); })" FUNCTION_ID
   ```

   Expected: `state` is `available`, `reason` is null, `cfg` and `page` are non-null, and blocks contain exactly one `entry` and one `exit`.

3. Query the same function through CLI JSON.

   ```bash
   node dist/bin/codegraph.js cfg FUNCTION_ID -p /tmp/cg-cfg-tsjs --json --limit 100 --offset 0
   ```

   Expected: output is the exact `CfgReadResult` object and matches the library result field-for-field.

4. Query the same function through MCP pagination.

   Use `codegraph_get_cfg` with `projectPath=/tmp/cg-cfg-tsjs`, the same `functionId`, `limit=100`, and increasing `offset`.

   Expected: pages reconstruct complete ordered blocks and edges with no duplicates or gaps.

5. Check aggregate status.

   ```bash
   node dist/bin/codegraph.js status /tmp/cg-cfg-tsjs --json
   ```

   Expected: top-level `cfg` reports `enabled=true`, deterministic state, available count, skipped count, unsupported count, resource-limited count, and stale count.

6. Drive lifecycle transitions with real file changes.

   - Modify one fixture file and run `node dist/bin/codegraph.js sync /tmp/cg-cfg-tsjs`.
   - Delete one fixture file and run sync again.
   - Disable CFG by setting `analysis.cfg=false` in `codegraph.json` and run sync.
   - Re-enable with `--analysis cfg` and run sync.

   Expected: affected-file rows swap atomically, deleted functions return `deleted`, disabled reads return `disabled`, disabled sync writes no CFG rows, and re-enable refreshes before serving current rows.

## Slice 2: Python Parity

1. Add the committed Python parity fixture to the indexed fixture project.

2. Run sync with CFG enabled.

   ```bash
   node dist/bin/codegraph.js sync /tmp/cg-cfg-tsjs --analysis cfg
   ```

3. Query Python functions and lambdas by function ID through library, CLI JSON, and MCP.

   Expected: Python `match`/`case`, comprehensions, generator expressions, explicit `raise`, unreachable blocks, nested boundaries, `await`, `yield`, and `yield from` use the same `CfgReadResult`, block, edge, status, and page contracts as TypeScript/JavaScript.

## Self-Repo UAT

1. From the SPEC-014 worktree, build the local CLI.

   ```bash
   npm run build
   ```

2. Enable CFG analysis for this repository without reading or printing secrets.

   ```bash
   node dist/bin/codegraph.js sync . --analysis cfg
   ```

3. Discover a real TypeScript/JavaScript function ID through existing graph queries.

   ```bash
   node dist/bin/codegraph.js query "kind:function path:src/index.ts getStats" -p . --json
   ```

4. Query that function through library, CLI JSON, and MCP pages.

   Expected: all machine results share one shape and the CLI JSON object matches the library object. MCP pages reconstruct the complete CFG. Project status reports aggregate CFG counts.

5. Record the UAT evidence in the implementation PR packet and retrospective without storing `.envrc.local` contents or any private endpoint material.

