# Research: Cypher Query Access

## Decision: Use a dependency-free lexer and recursive-descent parser

**Rationale**: The accepted subset is deliberately small: one connected `MATCH` chain, optional path binding, optional `WHERE`, required `RETURN`, optional `ORDER BY`, and optional `LIMIT`. A hand-written lexer/parser avoids new dependencies, keeps the grammar private, and lets diagnostics retain exact UTF-16 offsets and grammar anchors.

**Alternatives considered**:

- Add an openCypher parser dependency. Rejected because SPEC-013 requires dependency-free delivery and a narrow subset.
- Reuse the existing search query parser. Rejected because it is for symbol search syntax, not graph patterns, paths, aggregation, or source-span grammar diagnostics.

## Decision: Compile private AST to parameterized `SELECT` or `WITH RECURSIVE ... SELECT`

**Rationale**: The feature must never accept direct SQL, must bind every literal internally, and must support bounded variable paths. A whitelist-validating emitter can restrict every statement and CTE body to `SELECT` forms while still supporting recursive path traversal.

**Alternatives considered**:

- Interpret paths in application code after loading broad edge sets. Rejected because it risks unbounded materialization and makes ordering/capping less precise.
- Generate broader SQL and trust parser exclusion of writes. Rejected because the spec requires a second read-only proof before SQLite prepare/execution.

## Decision: Use public graph model labels and properties

**Rationale**: Labels come from `NODE_KINDS`, relationship types from `EDGE_KINDS`, and properties from public node/edge fields. This avoids coupling queries to storage column names and keeps user-facing query text stable.

**Alternatives considered**:

- Raw storage columns. Rejected because storage names such as `qualified_name`, `file_path`, and `col` would leak implementation details.
- Minimal identity-only properties. Rejected because the accepted recipes need names, paths, source positions, export flags, signatures, provenance, and counts.

## Decision: Reuse the existing active-edge semantics

**Rationale**: Traversal must match normal CodeGraph graph truth. The existing active-edge predicate excludes only rows with `metadata.lsp.active` set to false and includes static, LSP, and heuristic active edges.

**Alternatives considered**:

- Verified-only edges. Rejected because it excludes useful heuristic flow evidence.
- All stored edges. Rejected because inactive LSP audit rows would surface misleading graph matches.

## Decision: Relationship-simple variable paths, nodes may recur

**Rationale**: This follows the accepted openCypher-compatible path model while bounding growth through the explicit maximum of eight relationships. The private CTE state tracks internal edge identity to prevent repeating a relationship within one returned path.

**Alternatives considered**:

- Node-simple paths. Rejected because it diverges from the accepted design and rejects valid cyclic code graphs.
- Reachability-only paths. Rejected because path binding must return ordered typed evidence.

## Decision: Implement Cypher three-valued logic explicitly

**Rationale**: Optional public fields must distinguish absent/null values from false, empty strings, and zero. Planner/emitter behavior must match the spec independent of accidental SQLite expression quirks.

**Alternatives considered**:

- Delegate directly to SQLite null behavior. Rejected because the subset needs a documented public semantic contract.
- Coerce absent values to defaults. Rejected because it hides absence and breaks `IS NULL` recipes.

## Decision: Add a dedicated read-only SQLite query open path

**Rationale**: Normal `DatabaseConnection.open` can run persistent PRAGMAs, migrations, and healing. SPEC-013 query execution must be dormant and read-only. Node 24 documentation confirms `DatabaseSync` has a `readOnly` option and all `DatabaseSync` APIs execute synchronously; its `timeout` option is a busy-lock wait.

**Alternatives considered**:

- Reuse `DatabaseConnection.open`. Rejected because it can produce migrations/healing/WAL/index side effects.
- Trust only SQL whitelist validation. Rejected because the design requires defense in depth through a dedicated read-only connection.

## Decision: Enforce the five-second deadline with worker termination/replacement

**Rationale**: Node's SQLite API is synchronous, and its busy timeout is not a statement deadline. A worker boundary lets the main thread resolve timeout state, terminate the stuck worker, and replace it before accepting another query. Context7's Node 24 worker documentation confirms `worker.terminate()` returns a Promise that resolves after the worker exits.

**Alternatives considered**:

- In-process timer around synchronous execution. Rejected because the timer cannot fire while the main thread is blocked.
- Caller-configurable timeout. Rejected by the design concept; v1 uses one fixed five-second deadline.

## Decision: Canonical JSON is UTF-8 minified with stable keys and no trailing newline

**Rationale**: CLI `--json` and MCP text must be byte-identical. The serializer must control object-key ordering recursively, preserve array order, emit minified UTF-8 JSON, and append no newline or framing bytes.

**Alternatives considered**:

- Shape-equivalent JSON. Rejected because key order or whitespace drift would break the byte-identical contract.
- Surface-specific serializers. Rejected because it would duplicate behavior and invite parity drift.

## Decision: Preserve existing `query` search with dual routing and add `search` alias

**Rationale**: `codegraph query <text>` is an existing symbol-search command. The accepted clarification keeps legacy search unless the first non-whitespace token is `MATCH` or the operand is `-`. `codegraph search <text>` gives users an explicit unchanged search path and an escape hatch for literal terms beginning with `MATCH` or `-`.

**Alternatives considered**:

- Replace `query` with Cypher. Rejected because it would break existing users.
- Add only a new `cypher` command. Rejected because the workflow requires `codegraph query` as the user-facing Cypher surface.

## Decision: Default-list `codegraph_query` with retrieval guardrails

**Rationale**: The MCP tool must be available by default for deliberate structured graph-language requests, but `codegraph_explore` remains primary. Expected recoverable states must be success-shaped to preserve agent trust in the toolset.

**Alternatives considered**:

- Opt-in only MCP tool. Rejected by the accepted design.
- Replace an existing default retrieval tool. Rejected because it could regress established retrieval behavior.

## Decision: Single PR by default, conditional gh-stack only if G5 requires it

**Rationale**: The accepted delivery shape is two implementation slices, not necessarily two PRs. A single PR remains simplest unless the task atomicity classifier requires multiple PRs. If multiple PRs are required, use one linear gh-stack route with Slice 1 below Slice 2.

**Alternatives considered**:

- Always use two PRs. Rejected because it manufactures process overhead when atomicity does not require it.
- Split by interface layer. Rejected because library-only, CLI-only, or MCP-only slices would not be independently useful.
