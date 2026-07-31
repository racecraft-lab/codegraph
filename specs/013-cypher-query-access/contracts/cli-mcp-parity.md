# Contract: CLI and MCP Parity

## CLI Routing

`codegraph query <text>` keeps existing symbol-search behavior unless:

- the first non-whitespace lexical token is case-insensitive `MATCH`, or
- `<text>` is exactly `-`.

Those forms route to Cypher.

`codegraph search <text>` is the explicit alias for existing symbol search and is the escape hatch for literal search terms beginning with `MATCH` or `-`.

Cypher mode accepts shared `--path` and `--json`. Search-only `--kind`, `--mode`, and `--limit` are rejected before Cypher execution. Cypher row limits live inside query text.

## CLI Input

| Input | Behavior |
|---|---|
| quoted positional query beginning with `MATCH` | Cypher mode |
| positional `-` | read bounded UTF-8 stdin as Cypher |
| malformed UTF-8 on stdin | reject before parsing or execution with `CYPHER_INVALID_STDIN_ENCODING`, empty excerpt, no query text echo, and CLI failure exit |
| quoted positional query not beginning with `MATCH` | legacy search |
| `codegraph search <text>` | legacy search |
| `--file` | unsupported |

## MCP Tool

Tool name: `codegraph_query`

Input schema:

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Cypher query text, <= 10,000 UTF-16 code units. |
| `projectPath` | string | no | Same cross-project behavior as other tools. |

The tool is default-listed. Tool description and server instructions must keep `codegraph_explore` primary and reserve `codegraph_query` for deliberate structured graph-language requests.

## Canonical JSON

CLI `--json` and MCP text use the same serializer:

- UTF-8 encoded.
- Minified JSON.
- Stable recursive object-key order.
- Preserved array order.
- No trailing newline.
- No markdown fences or framing text.
- Fixed 1 MiB UTF-8 payload ceiling for machine output.

Byte parity requirement:

```text
bytes(codegraph query --json) == bytes(codegraph_query text)
```

The equality applies to success, empty, capped, diagnostic, and timeout states for the same input and index state.

## Machine Output Bounding

The shared serializer measures canonical UTF-8 payload bytes after deterministic minified JSON serialization and before CLI/MCP emission. If a success result would exceed the fixed 1 MiB payload ceiling, the shared result becomes diagnostic `CYPHER_OUTPUT_TOO_LARGE` with:

- no partial rows;
- no raw query text, emitted SQL, or bound parameters;
- `effectiveCap` when available;
- guidance to narrow `RETURN`, `MATCH`, or `LIMIT`;
- byte-identical CLI `--json` and MCP text payloads.

Human CLI table output may wrap or summarize the same diagnostic for humans, but it must not bypass the shared machine-output cap.

## Human CLI Table

The default CLI table consumes the same bounded rows and metadata as canonical JSON. Human-readable table formatting is not byte-identical to MCP and must not change query semantics.

## MCP Result Shaping

| State | MCP `isError` | Content |
|---|---|---|
| success rows | absent/false | canonical JSON |
| success empty | absent/false | canonical JSON with `rows: []` |
| not indexed | absent/false | diagnostic JSON with narrowing guidance |
| parser diagnostic | absent/false | diagnostic JSON |
| unsupported subset | absent/false | diagnostic JSON |
| timeout | absent/false | timeout JSON with narrowing guidance |
| path/access refusal | true | refusal text or diagnostic payload |
| malfunction | true | malfunction text |

Expected recoverable states must never teach the agent that CodeGraph is broken.

## Verification

Parity tests must capture raw bytes, not parsed JSON only. Fixtures must cover:

- valid path query
- empty success
- capped/truncated result
- syntax diagnostic
- unsupported write diagnostic
- oversized input diagnostic
- malformed UTF-8 stdin diagnostic
- payload-too-large diagnostic
- timeout state
- not-indexed diagnostic
