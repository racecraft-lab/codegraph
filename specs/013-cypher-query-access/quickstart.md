# Quickstart: Cypher Query Access

Use this runbook from the SPEC-013 worktree:

```bash
cd /Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/013-cypher-query-access
```

Do not run `codegraph init` here unless the operator explicitly asks. The live
self-index commands below expect an existing `.codegraph/codegraph.db`.

## Node 24 Activation

```bash
nvm use
node -v
```

Expected runtime: `v24.11.1`, matching `.nvmrc`. If shell startup does not load
`nvm`, use the pinned binary explicitly:

```bash
export PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin
node -v
```

## Focused Tests

Run the focused contract and guardrail suites:

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-parser.test.ts
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-runtime.test.ts
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cli-query-command.test.ts
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/mcp-cypher-query.test.ts
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/mcp-server-instructions.test.ts
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-recipes.test.ts
```

Run the final focused guardrail bundle:

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/mcp-server-instructions.test.ts __tests__/cypher-recipes.test.ts
```

## Full Tests

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npm run build
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npm run typecheck
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npm test
```

`npm run build` refreshes `dist/`; the package, CLI, and MCP examples below use
the current built output.

## Package API Example

```bash
node <<'JS'
const { queryCypher } = require('./dist/index.js');

(async () => {
  const result = await queryCypher(
    process.cwd(),
    'MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5',
  );
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
JS
```

Expected state: canonical Cypher result-union JSON. The result may be `success`,
`diagnostic`, or `timeout`; do not fabricate row counts.

## CLI Examples

Run a bounded Cypher query:

```bash
node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --path "$PWD" --json
```

Run a bounded stdin query:

```bash
printf '%s' 'MATCH (n:function)-[:calls]->(m:function) RETURN n.name, m.name LIMIT 5' | node dist/bin/codegraph.js query - --path "$PWD" --json
```

Use the explicit keyword-search escape hatch (`codegraph search`) for non-Cypher
search:

```bash
node dist/bin/codegraph.js search "MATCH" --path "$PWD" --json --limit 3
```

`codegraph query` enters Cypher mode only for `MATCH ...` input. Cypher mode
uses `LIMIT` inside the query text; CLI search flags such as `--kind`, `--mode`,
`--limit`, and `--file` are for keyword or hybrid search, not Cypher execution.

## MCP Example

The MCP tool is named `codegraph_query`; its schema requires `query` and accepts
optional `projectPath`.

```bash
node <<'JS'
const { ToolHandler } = require('./dist/mcp/tools');

(async () => {
  const handler = new ToolHandler(null);
  try {
    const result = await handler.execute('codegraph_query', {
      projectPath: process.cwd(),
      query: 'MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5',
    });
    const text = result.content.find((part) => part.type === 'text')?.text ?? '';
    process.stdout.write(text);
  } finally {
    handler.closeAll();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
JS
```

Expected state: `isError` remains false for success, empty, diagnostic,
not-indexed, and timeout result-union states. `isError` is reserved for path or
access refusals and tool malfunctions.

## Existing Self-Index

Check the current local index:

```bash
node dist/bin/codegraph.js status . --json
```

Run bounded live self-index queries:

```bash
node dist/bin/codegraph.js query "MATCH (n:function) WHERE n.name STARTS WITH 'q' RETURN n.filePath, count(*) AS callers ORDER BY callers DESC LIMIT 10" --path "$PWD" --json
node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 10" --path "$PWD" --json
```

Expected state: successful bounded rows, a truthful empty `success`, or a
bounded diagnostic. Record actual output in evidence tasks; do not invent it.

## Recipes

Recipe commands live in
`docs/ai/specs/013-cypher-query-access-recipes.md`. Validate the recipe document:

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-recipes.test.ts
```

For each recipe used as evidence, run the package API, CLI, or MCP command from
the recipe entry against the live self-index and record the actual state, row
count, truncation flag, representative output or expected-empty reason, parity
hash when applicable, artifact, reviewer, and date.

## CLI/MCP Parity Hash Workflow

Run this self-contained comparison against the current built `dist/`:

```bash
node <<'JS'
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ToolHandler } = require('./dist/mcp/tools');

(async () => {
  const projectRoot = process.cwd();
  const query =
    'MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5';
  const cli = spawnSync(
    process.execPath,
    ['dist/bin/codegraph.js', 'query', query, '--path', projectRoot, '--json'],
  );
  if (cli.status !== 0) {
    process.stderr.write(cli.stderr);
    process.exit(cli.status ?? 1);
  }

  const handler = new ToolHandler(null);
  try {
    const response = await handler.execute('codegraph_query', {
      projectPath: projectRoot,
      query,
    });
    const text = response.content.find((part) => part.type === 'text')?.text;
    if (typeof text !== 'string') throw new Error('MCP response has no text');
    const mcp = Buffer.from(text, 'utf8');
    if (!cli.stdout.equals(mcp)) throw new Error('CLI/MCP byte mismatch');
    process.stdout.write(
      `${createHash('sha256').update(cli.stdout).digest('hex')}  ${cli.stdout.length} bytes\n`,
    );
  } finally {
    handler.closeAll();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
JS
```

Required result: the command prints one SHA-256 and byte count. A mismatch exits
nonzero. Replace `query` with another bounded state when collecting a specific
evidence row; the focused CLI/MCP suites cover valid, empty, capped, syntax,
unsupported-write, oversized-input, payload-ceiling, timeout, and not-indexed
states.

## Guardrail Probes

Run the focused guardrail suites:

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts
```

Public CLI guard examples:

```bash
node dist/bin/codegraph.js query "MATCH (n) DELETE n RETURN n" --path "$PWD" --json
node -e 'process.stdout.write("MATCH (n:function) WHERE n.name = \"" + "oversized".repeat(1260) + "\" RETURN n.name LIMIT 1")' | node dist/bin/codegraph.js query - --path "$PWD" --json
printf '\377' | node dist/bin/codegraph.js query - --path "$PWD" --json
```

Package API direct-SQL guard:

```bash
node <<'JS'
const { queryCypher } = require('./dist/index.js');

(async () => {
  const result = await queryCypher(
    process.cwd(),
    "UPDATE nodes SET name = 'forbidden' WHERE id = 'fn:entry'",
  );
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
JS
```

Required result: mutation and direct SQL are rejected before execution, oversized
input returns `CYPHER_INPUT_TOO_LONG`, malformed stdin returns
`CYPHER_INVALID_STDIN_ENCODING`, payload ceiling returns
`CYPHER_OUTPUT_TOO_LARGE`, read-only snapshots remain unchanged, and timeout
workers are replaced with no active-worker leak.

Bounded ranged expansion also fails closed rather than returning partial rows:
when a depth-scaled pure, mixed, or aggregate path-expansion budget is
exceeded, all public surfaces return `CYPHER_PATH_EXPANSION_LIMIT` with
guidance to narrow `MATCH` or the relationship range.

## Retrieval A/B Authorization

`codegraph_explore` remains the primary MCP retrieval tool. `codegraph_query` is
default-listed for deliberate structured graph-language requests only.

Run local retrieval steering checks:

```bash
env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/mcp-server-instructions.test.ts
```

Do not run external/off-box retrieval A/B unless the operator explicitly records
all of these authorization fields first:

- provider
- model/tool endpoints
- repository context to send
- retention/training setting
- cost/time limit
- approval timestamp

If any field is absent, record `BLOCKED_BY_AUTHORIZATION` in
`specs/013-cypher-query-access/evidence-matrix.md` and preserve local-only
state:

```bash
rg -n "BLOCKED_BY_AUTHORIZATION|external runs=0|external sends=0|cost=0" specs/013-cypher-query-access/evidence-matrix.md
```

Blocked-without-authorization is an explicit T069 disposition. It does not prove
external retrieval parity; it preserves the repository until a fully recorded
runtime authorization exists.
