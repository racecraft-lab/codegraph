# Quickstart: Cypher Query Access

## Prerequisites

- Use the repository-pinned Node runtime: `nvm use`.
- Work from branch `013-cypher-query-access`.
- Use an initialized CodeGraph self-index. Do not run `codegraph init` unless the operator explicitly asks.
- Do not perform off-box retrieval evaluation unless the operator explicitly records runtime authorization for provider, endpoints, repository context, retention/training setting, cost/time limit, and timestamp.

## Focused Validation

```bash
npx vitest run __tests__/cypher-parser.test.ts
npx vitest run __tests__/cypher-runtime.test.ts
npx vitest run __tests__/cli-query-command.test.ts
npx vitest run __tests__/mcp-cypher-query.test.ts
npx vitest run __tests__/cypher-recipes.test.ts
npx vitest run __tests__/mcp-server-instructions.test.ts
```

Expected result: all focused tests pass. Tests use real temporary files and real SQLite.

## Full Validation

```bash
npm run build
npm run typecheck
npm test
```

Expected result: build, typecheck, and full test suite pass on Node 24.11.1.

## Slice 1 Demonstration

Package API:

```bash
npx vitest run __tests__/cypher-runtime.test.ts
```

CLI:

```bash
node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --json
printf '%s' 'MATCH (n:function)-[:calls]->(m:function) RETURN n.name, m.name ORDER BY n.name LIMIT 5' | node dist/bin/codegraph.js query - --json
```

MCP:

```text
Call codegraph_query with query:
MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5
```

Expected result: package, CLI, and MCP return the same bounded typed graph evidence. CLI `--json` and MCP text are byte-identical canonical JSON for the same state.

## Slice 2 Demonstration

```bash
node dist/bin/codegraph.js query "MATCH (n:function)-[:calls]->(m:function) WHERE n.name STARTS WITH 'get' RETURN n.name AS caller, count(m) AS calls ORDER BY calls DESC LIMIT 10" --json
node dist/bin/codegraph.js query "MATCH (`source function`:function)-[:calls]->(target:function) RETURN `source function`.name, target.name LIMIT 5" --json
node dist/bin/codegraph.js search "MATCH literal search term"
```

Expected result: count/grouping, string predicates, backtick identifiers, aliases, stable ordering, and `search` alias behavior match the contracts.

## Guard Probes

| Probe | Command shape | Expected state |
|---|---|---|
| Oversized input | submit >10,000 characters | `CYPHER_INPUT_TOO_LONG`, no excerpt |
| Unsupported write | `MATCH (n) DELETE n RETURN n` | diagnostic before execution |
| Direct SQL | `SELECT * FROM nodes` | diagnostic before execution |
| Undirected relationship | `MATCH (a)-[:calls]-(b) RETURN a` | diagnostic |
| Unbounded path | `MATCH p = (a)-[:calls*]->(b) RETURN p` | `CYPHER_UNBOUNDED_PATH` |
| Too-deep path | `MATCH p = (a)-[:calls*1..9]->(b) RETURN p` | `CYPHER_PATH_TOO_DEEP` |
| Unknown property | `MATCH (n:function) RETURN n.updatedAt` | `CYPHER_UNKNOWN_PROPERTY` |
| Timeout | deliberately expensive bounded query fixture | `CYPHER_TIMEOUT`, no rows |
| Row cap | query with >100 rows and no `LIMIT` | 100 rows, `truncated: true` |
| Read-only proof | run valid and invalid query then compare schema/data counts | unchanged |

## Live Self-Index Recipes

Record at least ten recipe rows in the evidence matrix. Required categories:

- callers of a function
- bounded path between functions
- hubs by count
- potentially dead exports
- route/component neighborhood
- imports by module
- async function callers
- heuristic edge review
- file-local relationship summary
- source-position filtered relationship review

For each row, record query, surface, expected state, observed row count, truncation flag, representative output or expected-empty reason, parity hash when applicable, artifact path, reviewer, and date.

## Retrieval Gates

1. Run retrieval-guardian after any change under `src/mcp/`.
2. Run retrieval A/B only after explicit runtime operator authorization for off-box evaluation.
3. If authorization is absent, record the retrieval A/B gate as blocked, not skipped or passed.
