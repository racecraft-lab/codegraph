# Feature Specification: Cypher Query Access

**Feature Branch**: `013-cypher-query-access`

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "Define a safe, deterministic, dependency-free openCypher subset over CodeGraph's existing public graph model and expose one canonical result contract across the library, CLI, and MCP."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bounded Graph Evidence [US1] (Priority: P1)

As a graph explorer, I can run one connected node/relationship pattern with filters and bounded paths and receive deterministic typed evidence about an indexed repository.

**Why this priority**: This is the minimal useful vertical slice. It lets a user ask practical graph questions without private storage knowledge and proves the grammar, graph model, result contract, and all public entry points together.

**Independent Test**: Slice 1 is independently testable by running the same bounded connected-path query through the package API, CLI, and MCP surfaces against a prepared index and confirming typed node, edge, path, ordering, cap, and diagnostic behavior.

**Acceptance Scenarios**:

1. **Given** an indexed repository with active graph records, **When** a user runs one connected `MATCH` chain with labels, relationship types, explicit arrows, top-level property filters, and `RETURN`, **Then** each supported surface returns deterministic public node, edge, path, or scalar values without exposing storage-shaped records.
2. **Given** a query that binds a path with an explicit variable relationship upper bound no greater than eight, **When** matching paths include cycles, **Then** returned paths never repeat the same relationship while still allowing a node to appear more than once.
3. **Given** a query that omits `ORDER BY` and returns more rows than the default cap, **When** the result is returned, **Then** rows use a documented stable order, include at most 100 rows, and mark the result as truncated.

---

### User Story 2 - Practical Recipe Queries [US2] (Priority: P2)

As a power user, I can project, order, limit, count, group, and use documented string and identifier forms to answer callers, path, hub, and dead-export recipes.

**Why this priority**: This completes the accepted language subset needed for the documented recipes while keeping the feature bounded to one connected read-only pattern.

**Independent Test**: Slice 2 is independently testable by adding count/grouping, string predicates, backtick identifiers, and all documented recipes on top of Slice 1, then proving those recipes across the same public surfaces.

**Acceptance Scenarios**:

1. **Given** a query using aliases, `ORDER BY`, `LIMIT`, `count(*)`, `count(expr)`, and non-aggregate returned values, **When** the query runs, **Then** results use implicit grouping by the non-aggregate values and retain deterministic ordering and cap behavior.
2. **Given** a query using `STARTS WITH`, `ENDS WITH`, `CONTAINS`, null checks, boolean operators, comparisons, and backtick-escaped identifiers, **When** names and properties match the public graph model exactly, **Then** the result reflects the documented three-valued null semantics and case rules.
3. **Given** at least ten documented Cypher recipes for common graph questions, **When** they are run against CodeGraph's live self-index, **Then** each recipe returns representative reviewed output or a documented empty result and the row, path, timeout, syntax, and read-only guard probes are also exercised.

---

### User Story 3 - Safe Cross-Surface Operation [US3] (Priority: P3)

As an operator or agent integrator, I get the same canonical bounded result through the package API, CLI, and MCP, with precise safe failures and no mutation.

**Why this priority**: The feature must be safe and predictable before it can become a default-listed agent tool, especially because CodeGraph's primary retrieval workflow must remain unchanged.

**Independent Test**: This story is independently testable by sending identical valid and invalid queries through all entry points and comparing result shape, byte-identical CLI/MCP JSON, exit behavior, MCP guidance, and mutation guards.

**Acceptance Scenarios**:

1. **Given** the same valid query through `queryCypher`, `codegraph query --json`, and `codegraph_query`, **When** each surface returns machine-readable output, **Then** CLI JSON and MCP text are byte-identical canonical JSON and the package API exposes the same typed values.
2. **Given** oversized input, unsupported syntax, mutating syntax, an unknown public name, or a query that exceeds the fixed deadline, **When** a caller submits the query, **Then** the feature returns a stable diagnostic or timeout state with no mutation and no partial timeout rows.
3. **Given** the MCP tool list and instructions, **When** an agent is choosing a retrieval strategy, **Then** `codegraph_explore` remains the primary recommendation and `codegraph_query` is reserved for deliberate structured graph-language requests.

### Edge Cases

- Query text exceeds 10,000 characters before parsing starts.
- Unknown labels, relationship types, properties, aliases, or case-mismatched public names are used.
- A query contains a write clause, direct SQL, external parameter syntax, multiple patterns, `OPTIONAL MATCH`, `DISTINCT`, unsupported aggregation, undirected relationships, `IN`, or nested JSON predicates.
- A variable relationship has no explicit upper bound, has a lower bound greater than the upper bound, or requests more than eight edges.
- A path candidate revisits an edge, revisits a node, or crosses an inactive LSP-suppressed audit row.
- Optional public fields such as documentation, signature, provenance, metadata, or decorators are absent or null.
- A result exceeds the default or hard row cap.
- A query reaches the fixed five-second deadline.
- CLI stdin contains malformed or oversized UTF-8 input.
- A legacy symbol-search term begins with `MATCH` or is exactly `-` and therefore must use the explicit `codegraph search` alias.
- JSON-valued public fields are returned whole but are used in predicates.

## Requirements *(mandatory)*

### Supported Query Subset

The supported subset is one read-only query with:

- One `MATCH` clause containing one connected node-edge chain.
- Optional path binding for the matched chain.
- Node labels from public node kinds and relationship types from public edge kinds.
- Explicit incoming or outgoing relationships only.
- Fixed-length relationships and variable relationships with an explicit upper bound of at most eight.
- A `WHERE` clause with top-level public properties, null checks, boolean operators, comparisons, parentheses, and string predicates.
- A `RETURN` clause with variables, top-level properties, aliases, native scalar values, typed graph values, `count(*)`, and `count(expr)`.
- Optional `ORDER BY` and `LIMIT`.
- Case-insensitive keywords, case-sensitive variables/schema names/properties/aliases, and backtick-escaped identifiers.

### Functional Requirements

- **FR-001**: The feature MUST expose the same documented Cypher subset through `queryCypher`, `codegraph query`, and `codegraph_query`. The existing `codegraph query <text>` command MUST preserve legacy symbol-search behavior unless the first non-whitespace lexical token is case-insensitive `MATCH` or the operand is `-`; those two forms route to Cypher. The CLI MUST add `codegraph search <text>` as an explicit alias for unchanged legacy search behavior and as the escape hatch for literal searches beginning with `MATCH` or `-`.
- **FR-002**: The feature MUST reject query text longer than 10,000 characters before parsing and MUST apply this ceiling consistently across package, CLI positional input, CLI stdin, and MCP input.
- **FR-003**: The v1 virtual schema MUST expose every current `NODE_KINDS` value as a node label and every current `EDGE_KINDS` value as a relationship type. Queryable node properties MUST be limited to `id`, `kind`, `name`, `qualifiedName`, `filePath`, `language`, `startLine`, `endLine`, `startColumn`, `endColumn`, `docstring`, `signature`, `visibility`, `isExported`, `isAsync`, `isStatic`, `isAbstract`, `decorators`, `typeParameters`, and `returnType`; volatile `updatedAt` MUST NOT be exposed. Queryable relationship properties MUST be limited to `source`, `target`, `kind`, `metadata`, `line`, `column`, and `provenance`. These canonical case-sensitive camelCase names, including public `column` rather than storage `col`, define the complete v1 property catalog.
- **FR-004**: The feature MUST reject unknown or incorrectly cased labels, relationship types, properties, variables, and aliases with precise diagnostics.
- **FR-005**: Traversal MUST include active static, LSP, and heuristic relationships and MUST exclude inactive LSP-suppressed audit rows.
- **FR-006**: The grammar MUST accept exactly one connected node/relationship chain per query and MUST reject disconnected, comma-separated, or multi-`MATCH` patterns. Each declared node or relationship variable name MUST be unique within that chain; node recurrence inside a variable-length path result does not relax this declaration rule.
- **FR-007**: Every relationship pattern MUST state an incoming or outgoing direction; undirected relationship syntax MUST be rejected.
- **FR-008**: Variable relationship patterns MUST require an explicit upper bound no greater than eight edges.
- **FR-009**: Variable path matching MUST be relationship-simple, meaning a returned path cannot repeat the same relationship, while nodes may recur.
- **FR-010**: Path binding MUST return ordered typed path evidence that preserves the matched node and relationship sequence.
- **FR-011**: `WHERE` MUST implement Cypher three-valued null semantics with `IS NULL`, `IS NOT NULL`, `AND`, `OR`, `NOT`, parentheses, and comparison operators `=`, `<>`, `<`, `<=`, `>`, and `>=`. Missing optional properties evaluate to null; comparisons or string predicates involving null evaluate to null; `WHERE` retains only rows whose final predicate is true; and null equality MUST use `IS NULL` or `IS NOT NULL`.
- **FR-012**: `WHERE` MUST support `STARTS WITH`, `ENDS WITH`, and `CONTAINS` for supported string values.
- **FR-013**: JSON-valued or array-valued public fields such as `metadata`, `decorators`, and `typeParameters` MAY be returned whole as opaque values but MUST NOT be used by `WHERE` in v1. Nested access, indexing, comparison, string predicates, and null predicates over those fields MUST be rejected as unsupported subset syntax.
- **FR-014**: Keywords MUST be case-insensitive, while variables, aliases, labels, relationship types, and properties MUST remain case-sensitive.
- **FR-015**: Backtick-escaped identifiers and aliases MUST be accepted wherever the documented subset accepts an identifier. A literal backtick inside one MUST use two consecutive backticks. Control characters and Unicode escape forms such as `\uXXXX` MUST be rejected with an unsupported-subset diagnostic; after doubled-backtick unescaping, names MUST be compared exactly and case-sensitively without Unicode normalization.
- **FR-016**: Query literals MUST be accepted in query text and bound safely by the engine; caller-supplied external parameter objects MUST NOT be added in this version.
- **FR-017**: `RETURN` MUST support aliases, native scalar values, typed nodes, typed relationships, typed paths, `count(*)`, and `count(expr)`.
- **FR-018**: Aggregation MUST group implicitly by every returned non-aggregate item and MUST reject aggregation forms other than `count(*)` and `count(expr)`.
- **FR-019**: `ORDER BY` and `LIMIT` MUST be supported. Explicit ascending order MUST place null after non-null and descending order MUST place null before non-null. When `ORDER BY` is absent, CodeGraph MUST apply a documented deterministic extension before `LIMIT` and row caps: compare projected values in `RETURN` order; compare nodes by public `id`; relationships by `(source, target, kind, line, column)`; paths by their alternating node and relationship identity sequence; and scalars by type rank `boolean < number < string < opaque JSON/array < null`, with false before true, numbers ascending, strings by Unicode code point, and opaque values by canonical JSON bytes. Rows with equal projected keys MUST use the full matched-chain identity in pattern order as the final tie-breaker.
- **FR-020**: Results MUST default to at most 100 rows and clamp any explicit limit to a hard cap of 1,000 rows. Execution MUST inspect at most `effectiveCap + 1` rows, or use an equivalent bounded existence check, return only `effectiveCap` rows, set `truncated: true` only when an additional row exists, include `effectiveCap`, and MUST NOT compute or expose an unbounded `totalRows`.
- **FR-021**: The feature MUST enforce one fixed, non-configurable five-second execution deadline across all surfaces. Synchronous SQLite work MUST run off the main thread behind a cancellable boundary; a timed-out worker MUST be terminated and cleaned or replaced before reuse, the caller MUST receive no partial rows, and timed-out work MUST NOT continue in the background after the response.
- **FR-022**: Timeout handling MUST make the CLI exit with failure and MUST make MCP return a success-shaped typed timeout state with guidance to narrow the query. Every surface MUST map the same timeout state from the shared execution boundary.
- **FR-023**: Syntax, unsupported-subset, and unknown-name diagnostics MUST include a stable code, UTF-16 offset, line, column, expected construct, grammar-reference anchor, and an escaped excerpt whose serialized value is at most 160 UTF-16 code units. Diagnostics MUST include `truncatedBefore` and `truncatedAfter`, MUST escape control characters and line breaks, and MUST preserve valid UTF-16 boundaries. Oversized-input diagnostics MUST report only the observed length and 10,000-character maximum and MUST NOT echo query text.
- **FR-024**: The planner/emitter MUST produce exactly one parameterized SQLite statement whose top level is `SELECT`, `WITH`, or `WITH RECURSIVE`; every CTE body and the final statement MUST be `SELECT`-only. Statement lists, `PRAGMA`, `ATTACH`, `DETACH`, transaction control, DDL, DML, mutating clauses, direct SQL input, external parameter syntax, unsupported openCypher forms, and unsupported aggregations MUST be rejected before SQLite prepare or execution. Execution MUST use a dedicated SQLite read-only connection that performs no initialization, migration, schema healing, journal/WAL change, indexing, sync, or watcher work.
- **FR-025**: The CLI MUST accept Cypher as one quoted positional query beginning with `MATCH` or `-` for bounded UTF-8 stdin and MUST NOT add a `--file` input contract. Cypher mode MUST allow shared `--path` and `--json` options, reject search-only `--kind`, `--mode`, and `--limit` before execution, require Cypher `LIMIT` inside query text, and report the resolved search-or-Cypher mode in help and usage diagnostics.
- **FR-026**: CLI `--json` and MCP text output MUST use one canonical serializer and MUST be byte-identical for the same result state. The canonical payload MUST be UTF-8 minified JSON with deterministic recursive object-key order, preserved array order, and no trailing newline or other framing bytes; both machine surfaces MUST write those exact payload bytes.
- **FR-027**: The default CLI table output MUST consume and render the same bounded rows and metadata as canonical JSON without changing query semantics. Human-readable terminal framing is outside the byte-identical machine JSON contract.
- **FR-028**: The MCP tool MUST be default-listed with instructions that keep `codegraph_explore` primary and reserve `codegraph_query` for deliberate structured graph-language requests. Success, empty, not-indexed, diagnostic, and timeout states MUST return success-shaped canonical JSON without `isError`; typed fields carry narrowing guidance, while `isError` remains reserved for path/access refusals and genuine malfunctions.
- **FR-029**: At least ten documented recipes MUST run against CodeGraph's live self-index. Verification MUST publish one evidence matrix whose recipe and guard-probe rows record an identifier, query/input, slice, surfaces exercised, command, expected state, observed status/row count/truncation, representative output or expected-empty reason, parity hash when applicable, artifact path or transcript, reviewer, and date.
- **FR-030**: Retrieval-affecting MCP steering changes MUST receive retrieval-guardian review and retrieval A/B validation before merge. Any external or off-box evaluation MUST remain blocked until the operator explicitly authorizes the provider, model/tool endpoints, repository context to be sent, retention/training setting, cost/time limit, and approval timestamp at that runtime gate; bootstrap, scaffold, and local dogfood approvals MUST NOT be treated as authorization.
- **FR-031**: The public package API MUST export `queryCypher(projectRoot, query)` and stable public types for a discriminated `success`, `diagnostic`, or `timeout` result. Typed values MUST reuse the public node and relationship contracts, empty rows remain a success result, not-indexed behavior uses a stable diagnostic code, and parser, planner, SQL-emitter, and AST internals MUST remain unsupported private APIs.
- **FR-032**: Delivery MUST preserve two independently demonstrable vertical rule slices: Slice 1 for bounded connected-path querying end-to-end, and Slice 2 for count/grouping, string predicates, backticks, and recipe closure.

### Reviewability Budget *(mandatory)*

- **Primary surface**: API and bounded query runtime
- **Secondary surfaces, if any**: CLI, MCP, documentation/recipes, test fixtures, and UAT evidence
- **Projected reviewable LOC**: Approximately 675 net-new reviewable LOC from the accepted scaffold estimate; planning must replace this with explicit per-slice file tables.
- **Projected production files**: Approximately 6 primary production files or surfaces before planning validation.
- **Projected total files**: Approximately 12 total files before planning validation.
- **Budget result**: Warning accepted with required split mitigation.
- **Split decision**: Keep one SPEC-013 specification but implement as two vertical rule slices. Slice 1 proves bounded connected-path querying end-to-end through package, CLI, and MCP. Slice 2 adds count/grouping, string predicates, backtick identifiers, and recipe closure across the same surfaces. If task atomicity requires more than one PR, use one linear gh-stack chain.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.
- Review order MUST show the accepted vertical slice order and identify whether the work is a single PR or a gh-stack chain.
- Verification evidence MUST include focused tests, full relevant suite results, cross-surface parity, live self-index recipe results, retrieval-guardian disposition, and retrieval A/B disposition when MCP steering changes are included.
- The evidence matrix MUST map every requirement and success criterion to its verification command, input/dataset, result, artifact or transcript, reviewer, and date.
- If delivery uses more than one PR, the packet MUST include `gh stack view --json` proof of one linear bottom-to-top chain after stack creation and synchronization. For a single PR, gh-stack proof is not applicable and MUST NOT be manufactured.
- Off-box evaluation authorization MUST be recorded separately at the runtime gate; absence of authorization leaves the required retrieval A/B gate blocked and never permits repository context to be sent.

### Key Entities *(include if feature involves data)*

- **Cypher Query**: The caller-provided read-only graph-language text, bounded to 10,000 characters and limited to the documented subset.
- **Virtual Node**: A public CodeGraph node value whose label comes from its node kind and whose properties are stable public fields.
- **Virtual Relationship**: A public CodeGraph edge value whose type comes from its edge kind and whose properties are stable public fields including provenance when present.
- **Path Value**: An ordered sequence of matched virtual nodes and relationships returned when a query binds or projects a path.
- **Result Row**: One canonical output row containing typed graph values or native scalar values.
- **Result State**: The complete bounded response, including rows, `effectiveCap`, a truncation flag based on bounded extra-row detection, and non-row states such as timeout or diagnostic failure; it does not include an unbounded total-row count.
- **Diagnostic**: A structured safe failure record containing a stable code, UTF-16 source location, expected construct, grammar-reference anchor, an escaped excerpt of at most 160 UTF-16 code units, and leading/trailing truncation flags. Oversized-input diagnostics contain no query excerpt.
- **Recipe**: A documented query for a practical CodeGraph task, validated against the live self-index or documented as intentionally empty for that index.

### Out of Scope

- Write clauses or any direct SQL input.
- Full openCypher compatibility.
- `OPTIONAL MATCH`, multiple `MATCH` clauses, comma-separated patterns, disconnected patterns, or Cartesian products.
- Undirected relationship syntax.
- External `$parameter` bindings or parameter objects.
- Aggregations other than `count(*)` and `count(expr)`.
- `DISTINCT`.
- Nested predicates over JSON-valued fields.
- `IN` list membership.
- Caller-configurable timeouts, row caps, or path caps.
- CLI `--file` query input.
- Public lexer, parser, planner, SQL-emitter, or AST APIs.
- Returning partial rows after timeout or silently truncating capped results.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of package API, CLI, and MCP acceptance tests enforce the same documented grammar subset and 10,000-character input ceiling.
- **SC-002**: Slice 1 can be demonstrated independently by one connected bounded-path query that returns typed path evidence through package API, CLI, and MCP.
- **SC-003**: Slice 2 can be demonstrated independently by count/grouping, string predicate, backtick identifier, and recipe queries through package API, CLI, and MCP.
- **SC-004**: At least 10 documented recipes run on the live CodeGraph self-index with recorded representative output or recorded expected-empty disposition.
- **SC-005**: 100% of invalid syntax, unsupported syntax, unknown-name, read-only, oversized-input, row-cap, path-cap, and timeout probes return the documented result or diagnostic state. Boundary instrumentation proves rejected mutating or unsupported input never invokes SQL preparation/execution, and real SQLite probes prove successful reads and rejected inputs leave schema/data versions, graph row counts, and representative node/edge records unchanged.
- **SC-006**: CLI `--json` and MCP text are byte-identical UTF-8 payloads, including the absence of a trailing newline, for the same valid result, capped result, timeout state, and diagnostic state.
- **SC-007**: Capped queries return no more than 100 rows by default and no more than 1,000 rows after an explicit higher limit, with deterministic `truncated: true` metadata when additional rows exist.
- **SC-008**: Timeout probes complete with no partial rows and the documented timeout behavior within the fixed five-second deadline envelope.
- **SC-009**: Retrieval-guardian review and, after separately recorded operator authorization for any off-box context sharing, retrieval A/B validation record no unaddressed regression for default MCP steering before merge.

## Assumptions

- The repository is already indexed before users run Cypher queries; this feature does not initialize or repair indexes.
- Query execution is local-first and dormant until a caller explicitly invokes the query surface.
- Public node, edge, and result type names remain stable enough for a v1 query contract; any later expansion is additive.
- Empty result sets are valid outcomes when the graph contains no matching public evidence.
- The default user is technically capable of writing a small documented graph query but still needs precise diagnostics and recipes.
- Planning will replace scaffold-level reviewability estimates with exact file tables and per-slice sizing.
