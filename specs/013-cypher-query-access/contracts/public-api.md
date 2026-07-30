# Contract: Public API

## Exported Package Surface

```ts
export function queryCypher(projectRoot: string, query: string): Promise<CypherQueryResult>;
```

The package also exports stable public result and error types. Lexer, parser, planner, emitter, SQL, and AST internals remain private and unsupported.

## Result Union

```ts
type CypherQueryResult =
  | CypherSuccessResult
  | CypherDiagnosticResult
  | CypherTimeoutResult;
```

### Success

```ts
interface CypherSuccessResult {
  status: 'success';
  columns: CypherColumn[];
  rows: CypherRow[];
  effectiveCap: number;
  truncated: boolean;
}
```

Empty results use `status: 'success'` with `rows: []`.

### Diagnostic

```ts
interface CypherDiagnosticResult {
  status: 'diagnostic';
  code: CypherDiagnosticCode;
  message: string;
  offset: number;
  line: number;
  column: number;
  expected: string;
  anchor: string;
  excerpt: string;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
}
```

Oversized-input diagnostics set `excerpt` to an empty string and include no query text in the message.

### Timeout

```ts
interface CypherTimeoutResult {
  status: 'timeout';
  code: 'CYPHER_TIMEOUT';
  deadlineMs: 5000;
  guidance: string;
}
```

Timeout results contain no rows.

## Values

```ts
type CypherValue =
  | { type: 'node'; value: PublicNode }
  | { type: 'relationship'; value: PublicRelationship }
  | { type: 'path'; value: CypherPath }
  | { type: 'scalar'; value: null | boolean | number | string | Record<string, unknown> | unknown[] };
```

`PublicNode` and `PublicRelationship` reuse CodeGraph public graph contracts, except fields excluded by SPEC-013 are not emitted. `CypherPath` contains ordered `nodes`, ordered `relationships`, and `length`.

## Limits

| Limit | Value |
|---|---:|
| Query text length | 10,000 UTF-16 code units |
| Default row cap | 100 |
| Hard row cap | 1,000 |
| Variable relationship upper bound | 8 |
| Execution deadline | 5,000 ms |

## Error Handling

The public API returns diagnostic and timeout union values for expected query failures. It throws only for genuine host-level malfunctions that prevent the API from constructing a stable result.

## Read-Only Contract

`queryCypher` cannot initialize a repository, cannot run migrations, cannot heal schema/index state, cannot start a watcher, cannot sync files, and cannot write to the database. Unsupported or mutating query text is rejected before SQLite prepare/execution.
