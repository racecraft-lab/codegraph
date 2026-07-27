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
   mkdir -p /tmp/cg-cfg-tsjs
   printf '{"analysis":{"cfg":true}}\n' > /tmp/cg-cfg-tsjs/codegraph.json
   node dist/bin/codegraph.js init /tmp/cg-cfg-tsjs --embeddings off
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
   - Re-enable by setting `analysis.cfg=true` in `codegraph.json` and run sync.

   Expected: affected-file rows swap atomically, deleted functions return `deleted`, disabled reads return `disabled`, disabled sync writes no CFG rows, and re-enable refreshes before serving current rows.

## Slice 2: Python Parity

1. Add the committed Python parity fixture to the indexed fixture project.

2. Run sync with CFG enabled.

   ```bash
   node dist/bin/codegraph.js sync /tmp/cg-cfg-tsjs --embeddings off
   ```

3. Query Python functions and lambdas by function ID through library, CLI JSON, and MCP.

   Expected: Python `match`/`case`, comprehensions, generator expressions, explicit `raise`, unreachable blocks, nested boundaries, `await`, `yield`, and `yield from` use the same `CfgReadResult`, block, edge, status, and page contracts as TypeScript/JavaScript.

## Self-Repo UAT

1. From the SPEC-014 worktree, use Node 24 and build the local CLI.

   ```bash
   nvm use 24.11.1
   npm run build
   ```

2. Run the opt-in self-repo UAT.

   ```bash
   CODEGRAPH_SELF_REPO_UAT=1 CODEGRAPH_NO_DAEMON=1 CODEGRAPH_MCP_TOOLS=get_cfg node node_modules/vitest/vitest.mjs run __tests__/analysis/cfg/cfg-contract.test.ts -t 'dogfoods the current repository'
   ```

   The UAT never enables CFG on the live worktree. It creates a temporary mirror project, copies current tracked TypeScript/JavaScript working-tree contents with `git ls-files -z -- '*.ts' '*.tsx' '*.js' '*.jsx'`, writes only the mirror `codegraph.json` with `analysis.cfg=true`, and indexes that mirror into real SQLite with embeddings off and LSP disabled.

3. Confirm the runtime target and selected function.

   Expected: the test dynamically selects the first available bounded CFG in `src/analysis/cfg/index.ts`, ordered by source position and function ID. It does not hard-code a function name or ID.

4. Confirm library, CLI, MCP, and status parity.

   Expected: the library full read is `available`; SQL block/edge totals match the returned page; built CLI JSON with `--limit 500 --offset 0` is deep-equal to the library result; in-process `ToolHandler` calls to `codegraph_get_cfg` with `limit=1` reconstruct ordered blocks and edges without duplicates or gaps; built CLI `status --json` `cfg` is deep-equal to `CodeGraph.getCfgStatus()`, with `enabled=true`, `availableCount>0`, `staleCount=0`, and `skippedCount=unsupportedCount+resourceLimitedCount`.

   The MCP portion intentionally uses the in-process handler with `CODEGRAPH_MCP_TOOLS=get_cfg`: this hot-loads the CFG tool surface and avoids daemon/socket fixtures while still exercising the MCP handler contract.

5. Record the bounded JSON evidence line.

   Expected: stdout includes exactly one bounded JSON UAT line like `{"uat":"spec-014-self-repo-cfg",...}`. It records Node/runtime identity, copied file count, selected `functionId`, `filePath`, `startLine`, `sourceVersion`, `graphId`, block/edge totals, MCP page count, and project CFG status. The test closes the CodeGraph database before recursively removing the temporary mirror.

6. Run the performance benchmark evidence capture.

   ```bash
   npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts
   ```

   Expected: evidence records repository commit, benchmark fixture identity, Node version, OS, architecture, CPU model, logical core count, total memory, storage root, command line, CFG-related environment overrides, warmup pairs, measured pair timings, disabled/enabled medians, min/max, and `median(enabled)/median(disabled)`. PR evidence uses at least 2 warmup pairs and 10 measured pairs with ratio `<= 1.20`; reduced CI smoke uses at least 5 measured pairs and reruns the 10-pair method before any blocking over-budget failure. The disabled arm records zero CFG status, block, or edge writes.

7. Record the UAT evidence in the implementation PR packet and retrospective without storing `.envrc.local` contents or any private endpoint material.
