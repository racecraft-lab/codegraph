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

- **FR-001**: The feature MUST expose the same documented Cypher subset through `queryCypher`, `codegraph query`, and `codegraph_query`.
- **FR-002**: The feature MUST reject query text longer than 10,000 characters before parsing and MUST apply this ceiling consistently across package, CLI positional input, CLI stdin, and MCP input.
- **FR-003**: Node labels MUST map to public node kinds, relationship types MUST map to public edge kinds, and properties MUST use canonical case-sensitive camelCase public fields.
- **FR-004**: The feature MUST reject unknown or incorrectly cased labels, relationship types, properties, variables, and aliases with precise diagnostics.
- **FR-005**: Traversal MUST include active static, LSP, and heuristic relationships and MUST exclude inactive LSP-suppressed audit rows.
- **FR-006**: The grammar MUST accept exactly one connected node/relationship chain per query and MUST reject disconnected, comma-separated, or multi-`MATCH` patterns.
- **FR-007**: Every relationship pattern MUST state an incoming or outgoing direction; undirected relationship syntax MUST be rejected.
- **FR-008**: Variable relationship patterns MUST require an explicit upper bound no greater than eight edges.
- **FR-009**: Variable path matching MUST be relationship-simple, meaning a returned path cannot repeat the same relationship, while nodes may recur.
- **FR-010**: Path binding MUST return ordered typed path evidence that preserves the matched node and relationship sequence.
- **FR-011**: `WHERE` MUST implement three-valued null semantics with `IS NULL`, `IS NOT NULL`, `AND`, `OR`, `NOT`, parentheses, and comparison operators `=`, `<>`, `<`, `<=`, `>`, and `>=`.
- **FR-012**: `WHERE` MUST support `STARTS WITH`, `ENDS WITH`, and `CONTAINS` for supported string values.
- **FR-013**: JSON-valued public fields such as metadata and decorators MAY be returned whole but MUST NOT support nested predicate access.
- **FR-014**: Keywords MUST be case-insensitive, while variables, aliases, labels, relationship types, and properties MUST remain case-sensitive.
- **FR-015**: Backtick-escaped identifiers and aliases MUST be accepted wherever the documented subset accepts an identifier.
- **FR-016**: Query literals MUST be accepted in query text and bound safely by the engine; caller-supplied external parameter objects MUST NOT be added in this version.
- **FR-017**: `RETURN` MUST support aliases, native scalar values, typed nodes, typed relationships, typed paths, `count(*)`, and `count(expr)`.
- **FR-018**: Aggregation MUST group implicitly by every returned non-aggregate item and MUST reject aggregation forms other than `count(*)` and `count(expr)`.
- **FR-019**: `ORDER BY` and `LIMIT` MUST be supported, and missing `ORDER BY` MUST still produce a documented stable internal order before row caps are applied.
- **FR-020**: Results MUST default to at most 100 rows, clamp any explicit limit to a hard cap of 1,000 rows, and expose `truncated: true` plus the effective cap when rows are capped.
- **FR-021**: The feature MUST enforce one fixed five-second execution deadline across all surfaces and MUST return no partial rows after a timeout.
- **FR-022**: Timeout handling MUST make the CLI exit with failure and MUST make MCP return a success-shaped typed timeout state with guidance to narrow the query.
- **FR-023**: Syntax, unsupported-subset, and unknown-name diagnostics MUST include a stable code, UTF-16 offset, line, column, bounded escaped excerpt, expected construct, and grammar-reference anchor.
- **FR-024**: Mutating clauses, direct SQL input, external parameter syntax, unsupported openCypher forms, and unsupported aggregations MUST be rejected before execution.
- **FR-025**: The CLI MUST accept one quoted positional query or `-` for bounded UTF-8 stdin and MUST NOT add a `--file` input contract.
- **FR-026**: CLI `--json` and MCP text output MUST use one canonical serializer and MUST be byte-identical for the same result state.
- **FR-027**: The default CLI table output MUST render the same bounded row set as canonical JSON without changing query semantics.
- **FR-028**: The MCP tool MUST be default-listed with instructions that keep `codegraph_explore` primary and reserve `codegraph_query` for deliberate structured graph-language requests.
- **FR-029**: At least ten documented recipes MUST run against CodeGraph's live self-index and MUST include representative review plus row, path, timeout, syntax, and read-only guard probes.
- **FR-030**: Retrieval-affecting MCP steering changes MUST receive retrieval-guardian review and retrieval A/B validation before merge.
- **FR-031**: The public package API MUST expose `queryCypher` and stable result/error types while keeping parser, planner, SQL-emitter, and AST internals unsupported as public APIs.
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

### Key Entities *(include if feature involves data)*

- **Cypher Query**: The caller-provided read-only graph-language text, bounded to 10,000 characters and limited to the documented subset.
- **Virtual Node**: A public CodeGraph node value whose label comes from its node kind and whose properties are stable public fields.
- **Virtual Relationship**: A public CodeGraph edge value whose type comes from its edge kind and whose properties are stable public fields including provenance when present.
- **Path Value**: An ordered sequence of matched virtual nodes and relationships returned when a query binds or projects a path.
- **Result Row**: One canonical output row containing typed graph values or native scalar values.
- **Result State**: The complete bounded response, including rows, effective cap, truncation flag, and non-row states such as timeout or diagnostic failure.
- **Diagnostic**: A structured safe failure record containing a stable code, source location, bounded excerpt, expected construct, and grammar-reference anchor.
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
- **SC-005**: 100% of invalid syntax, unsupported syntax, unknown-name, read-only, oversized-input, row-cap, path-cap, and timeout probes return the documented result or diagnostic state.
- **SC-006**: CLI `--json` and MCP text are byte-identical for the same valid result, capped result, timeout state, and diagnostic state.
- **SC-007**: Capped queries return no more than 100 rows by default and no more than 1,000 rows after an explicit higher limit, with deterministic `truncated: true` metadata when additional rows exist.
- **SC-008**: Timeout probes complete with no partial rows and the documented timeout behavior within the fixed five-second deadline envelope.
- **SC-009**: Retrieval-guardian review and retrieval A/B validation record no unaddressed regression for default MCP steering before merge.

## Assumptions

- The repository is already indexed before users run Cypher queries; this feature does not initialize or repair indexes.
- Query execution is local-first and dormant until a caller explicitly invokes the query surface.
- Public node, edge, and result type names remain stable enough for a v1 query contract; any later expansion is additive.
- Empty result sets are valid outcomes when the graph contains no matching public evidence.
- The default user is technically capable of writing a small documented graph query but still needs precise diagnostics and recipes.
- Planning will replace scaffold-level reviewability estimates with exact file tables and per-slice sizing.
