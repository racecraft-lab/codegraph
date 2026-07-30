# Data Model: Cypher Query Access

## Virtual Property Graph

### Virtual Node

Represents one public CodeGraph node.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable public node id. |
| `kind` | string | One value from `NODE_KINDS`; also the Cypher node label. |
| `name` | string | Simple symbol name. |
| `qualifiedName` | string | Fully qualified symbol name. |
| `filePath` | string | Project-relative source path. |
| `language` | string | Public language value. |
| `startLine` | number | One-based start line. |
| `endLine` | number | One-based end line. |
| `startColumn` | number | Zero-based start column. |
| `endColumn` | number | Zero-based end column. |
| `docstring` | string or null | Missing optional values surface as null. |
| `signature` | string or null | Missing optional values surface as null. |
| `visibility` | string or null | Public/private/protected/internal when known. |
| `isExported` | boolean or null | Missing optional values surface as null. |
| `isAsync` | boolean or null | Missing optional values surface as null. |
| `isStatic` | boolean or null | Missing optional values surface as null. |
| `isAbstract` | boolean or null | Missing optional values surface as null. |
| `decorators` | array or null | Opaque return-only value; not predicateable. |
| `typeParameters` | array or null | Opaque return-only value; not predicateable. |
| `returnType` | string or null | Missing optional values surface as null. |

`updatedAt` is intentionally excluded.

### Virtual Relationship

Represents one active public CodeGraph edge.

| Field | Type | Notes |
|---|---|---|
| `source` | string | Source node id. |
| `target` | string | Target node id. |
| `kind` | string | One value from `EDGE_KINDS`; also the Cypher relationship type. |
| `metadata` | object or null | Opaque return-only value; not predicateable. |
| `line` | number or null | One-based occurrence line. |
| `column` | number or null | Zero-based occurrence column; maps from storage `col`. |
| `provenance` | string or null | `tree-sitter`, `scip`, `heuristic`, `lsp`, or null. |

The internal SQL row id may be used only as private path state for relationship uniqueness. It is not part of the public relationship value.

### Path Value

| Field | Type | Notes |
|---|---|---|
| `nodes` | Virtual Node[] | Ordered node sequence. Length is relationships length + 1. |
| `relationships` | Virtual Relationship[] | Ordered relationship sequence. |
| `length` | number | Number of relationships in the path. |

Path validation:

- A path cannot repeat the same internal relationship identity.
- Nodes may recur.
- Variable path upper bound must be explicit and no greater than 8.

## Query Model

### Cypher Query

| Field | Type | Validation |
|---|---|---|
| `projectRoot` | string | Existing initialized project root. |
| `queryText` | string | At most 10,000 UTF-16 code units before lexing. |
| `surface` | enum | package, CLI, or MCP. |

### Token

Private lexer record:

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | keyword, identifier, backtickIdentifier, string, number, punctuation, operator, eof. |
| `raw` | string | Original token text. |
| `value` | unknown | Parsed literal or identifier value. |
| `offset` | number | UTF-16 offset. |
| `line` | number | One-based line. |
| `column` | number | Zero-based column. |

### Private AST

Private AST roots:

- `QueryAst`
- `MatchChainAst`
- `NodePatternAst`
- `RelationshipPatternAst`
- `WhereAst`
- `ReturnItemAst`
- `OrderItemAst`
- `LimitAst`

Invariants:

- Exactly one `MATCH` chain.
- At least two node patterns for every relationship chain.
- Variables are unique declarations within the chain.
- Relationship direction is explicit.
- Variable relationship upper bounds are present and <= 8.
- Path binding is either absent or references the full matched chain.
- Unsupported forms never reach SQL emission.

### Planned Query

| Field | Type | Notes |
|---|---|---|
| `statementKind` | enum | `select` or `recursiveSelect`. |
| `sql` | string | One whitelisted parameterized statement. |
| `params` | array | Bound literal values only. |
| `columns` | ResultColumn[] | Public result columns in return order. |
| `effectiveCap` | number | 100 by default, <= 1,000 after clamp. |
| `requiresWorker` | true | All runtime execution goes through the deadline boundary. |

Emitter invariants:

- Top level is `SELECT`, `WITH`, or `WITH RECURSIVE`.
- Every CTE body and final statement is `SELECT`-only.
- No statement list.
- No direct SQL input.
- No `PRAGMA`, `ATTACH`, `DETACH`, transaction control, DDL, or DML.
- Every literal is represented by a bound parameter.

## Result Model

### Public Union

```ts
type CypherQueryResult =
  | CypherSuccessResult
  | CypherDiagnosticResult
  | CypherTimeoutResult;
```

### Success Result

| Field | Type | Notes |
|---|---|---|
| `status` | `"success"` | Includes empty results. |
| `columns` | ResultColumn[] | Name and value kind in return order. |
| `rows` | ResultRow[] | Bounded row values. |
| `effectiveCap` | number | Applied cap. |
| `truncated` | boolean | True only if one extra row exists. |

### Diagnostic Result

| Field | Type | Notes |
|---|---|---|
| `status` | `"diagnostic"` | Stable non-exception failure state. |
| `code` | string | Stable diagnostic code. |
| `message` | string | Human-readable bounded message. |
| `offset` | number | UTF-16 offset. |
| `line` | number | One-based line. |
| `column` | number | Zero-based column. |
| `expected` | string | Expected construct. |
| `anchor` | string | Grammar/reference anchor. |
| `excerpt` | string | Escaped excerpt <= 160 UTF-16 code units, except oversized input omits query text. |
| `truncatedBefore` | boolean | Excerpt was truncated at start. |
| `truncatedAfter` | boolean | Excerpt was truncated at end. |

Expected diagnostic codes:

- `CYPHER_INPUT_TOO_LONG`
- `CYPHER_SYNTAX`
- `CYPHER_UNSUPPORTED`
- `CYPHER_UNKNOWN_LABEL`
- `CYPHER_UNKNOWN_RELATIONSHIP_TYPE`
- `CYPHER_UNKNOWN_PROPERTY`
- `CYPHER_UNKNOWN_VARIABLE`
- `CYPHER_DUPLICATE_VARIABLE`
- `CYPHER_UNBOUNDED_PATH`
- `CYPHER_PATH_TOO_DEEP`
- `CYPHER_NOT_INDEXED`
- `CYPHER_READ_ONLY_REFUSAL`
- `CYPHER_INTERNAL_ERROR`

### Timeout Result

| Field | Type | Notes |
|---|---|---|
| `status` | `"timeout"` | No partial rows. |
| `code` | `"CYPHER_TIMEOUT"` | Stable timeout code. |
| `deadlineMs` | `5000` | Fixed v1 deadline. |
| `guidance` | string | Narrow the pattern, add labels/properties, reduce path bound, or add `LIMIT`. |

## CLI and MCP State Mapping

| Shared result | Package API | CLI | MCP |
|---|---|---|---|
| success with rows | return union | exit 0 | success-shaped JSON, no `isError` |
| success empty | return union | exit 0 | success-shaped JSON, no `isError` |
| diagnostic | return union | exit 1 | success-shaped JSON, no `isError` unless path/access refusal or malfunction |
| timeout | return union | exit 1 | success-shaped JSON, no `isError` |
| path/access refusal | diagnostic or thrown safety refusal | exit 1 | `isError: true` |
| malfunction | diagnostic or thrown internal error | exit 1 | `isError: true` |

## State Transitions

```text
received
  -> rejected_input_too_long
  -> lexed
  -> parsed
  -> planned
  -> emitted
  -> executing
      -> success
      -> diagnostic
      -> timeout
      -> malfunction
```

Timeout transition:

```text
executing -> timeout_response -> terminate_worker -> replace_worker -> ready
```

No timeout transition may publish partial rows.
