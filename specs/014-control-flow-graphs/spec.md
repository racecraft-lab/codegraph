# Feature Specification: SPEC-014 Control-Flow Graphs

**Feature Branch**: `014-control-flow-graphs`

**Created**: 2026-07-25

**Status**: Draft

**Input**: User description: "Create deterministic, opt-in, per-function CFGs for TypeScript/JavaScript and Python from the SPEC-014 Design Concept, preserving all Q1-Q28 decisions and the accepted two-slice delivery."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enable CFG Analysis and Read Deterministic Library Results (Priority: P1)

A local CodeGraph user enables CFG analysis for a project and can request a function's CFG by function ID through the library contract. Supported TypeScript/JavaScript functions return deterministic, complete per-function control-flow graphs; unsupported or unsafe functions return explicit success-shaped states instead of partial graphs.

**Why this priority**: This is the smallest useful vertical slice. It proves opt-in activation, deterministic extraction, sound skip behavior, and the core stateful library result before adding more read surfaces or Python parity.

**Independent Test**: Can be tested by enabling CFG analysis on fixtures, reading known TypeScript/JavaScript function IDs through the library, and comparing stable graph, status, and skip results across repeated indexing runs.

**Acceptance Scenarios**:

1. **Given** a project with CFG analysis disabled, **When** CFG analysis is enabled and a supported TypeScript/JavaScript function is indexed, **Then** the library returns an `available` CFG for that function ID with deterministic block IDs, block metadata, and typed edges.
2. **Given** identical source and CFG analysis enabled, **When** the same project is re-indexed three times, **Then** the ordered machine response is byte-equivalent for each run and block IDs remain stable for the unchanged function.
3. **Given** a TypeScript/JavaScript function containing an unsupported construct, **When** CFG analysis reaches that function, **Then** the whole function is skipped, a stable status and reason are persisted, and no block or edge rows for a partial CFG are exposed.
4. **Given** a generated function whose CFG would exceed 10,000 basic blocks, **When** CFG analysis reaches that function, **Then** the whole function is skipped as `resource_limited`, the stable reason identifies the block cap, and no partial CFG is exposed.
5. **Given** supported TypeScript/JavaScript fixtures covering explicit throws, short-circuit expressions, switch flow, optional chaining, nullish coalescing, nested functions, unreachable statements, and abrupt transfers, **When** their CFGs are read, **Then** the graph represents the accepted intra-procedural control flow without implicit exception edges or nested-body inlining.

---

### User Story 2 - Keep Persisted CFG State Correct Through Lifecycle Transitions (Priority: P1)

A project operator can trust that persisted CFG state follows the project lifecycle: first enable, incremental sync, deletion, disablement, unexpected refresh failure, and re-enable. Old rows are never presented as fresh, disabled rows stay inert, and failed refreshes retain only explicitly stale snapshots.

**Why this priority**: CFGs are persisted analysis results. If lifecycle transitions are wrong, downstream reads may show stale, deleted, or partial control flow as current fact.

**Independent Test**: Can be tested with real project files and storage by driving each transition and asserting status rows, block/edge availability, source versions, and read results before and after each operation.

**Acceptance Scenarios**:

1. **Given** an already indexed project with no changed files, **When** CFG analysis is enabled for the first time, **Then** every existing supported function is backfilled and every skipped function records a stable status and reason.
2. **Given** CFG analysis enabled and current CFG rows for a file, **When** that file changes and sync succeeds, **Then** CFG state for the affected file is transactionally replaced and CFG state for unaffected files remains unchanged.
3. **Given** CFG analysis enabled and a function with persisted CFG state, **When** the source file or function is deleted and sync succeeds, **Then** that function's current CFG is no longer returned and reads by the old function ID return a deleted or unknown-function state.
4. **Given** CFG analysis enabled with computed rows, **When** CFG analysis is disabled, **Then** existing rows may be retained but reads return `disabled`, rows are inert, and disabled indexing performs zero CFG status, block, or edge writes.
5. **Given** CFG analysis enabled with a prior successful snapshot, **When** an unexpected refresh failure occurs for an affected file, **Then** the prior snapshot is retained only as explicitly `stale`, the failure reason is stable, and the failed refresh exposes no partial CFG.
6. **Given** CFG analysis enabled with no prior snapshot, **When** the first attempted CFG refresh for a function fails unexpectedly, **Then** reads return an unavailable or not-computed state with a stable reason and no CFG payload.
7. **Given** CFG rows retained while analysis is disabled, **When** CFG analysis is re-enabled, **Then** the project performs a fresh backfill or affected-file refresh before serving rows as current.

---

### User Story 3 - Query the Same Stateful Contract Through CLI, MCP, and Project Status (Priority: P2)

A user can query the same CFG state through library reads, CLI JSON, CLI human output, and a paginated MCP tool. Machine-readable surfaces share one exact response shape, MCP pagination reconstructs the complete graph, and project status reports aggregate CFG health.

**Why this priority**: CFGs are intended for humans and agents. Cross-surface parity prevents agents, scripts, and CLI users from receiving different states for the same function.

**Independent Test**: Can be tested by reading the same function ID through all public read surfaces, comparing machine responses field-for-field, reconstructing MCP pages, and checking project status counts.

**Acceptance Scenarios**:

1. **Given** a function ID with an available CFG, **When** the library result and CLI JSON result are requested, **Then** both responses use the same state, reason, CFG, ordering, and metadata shape.
2. **Given** a function ID with any expected absence state, **When** CLI human output is requested, **Then** the output is readable and bounded while preserving the same state and reason as the machine contract.
3. **Given** an available CFG larger than one MCP page, **When** all MCP pages are requested in deterministic order, **Then** the pages reconstruct the complete ordered CFG with no duplicate blocks, no duplicate edges, no gaps, and accurate totals.
4. **Given** disabled analysis, an unknown function ID, an unsupported function, a resource-limited function, and a stale function, **When** each is queried through library, CLI JSON, and MCP, **Then** each surface returns the same success-shaped state and stable reason without throwing expected-state errors.
5. **Given** CFG analysis has available, stale, unsupported, and resource-limited functions, **When** project status is requested, **Then** status reports CFG enablement, freshness, available counts, skipped counts, stale counts, unsupported counts, and resource-limit counts without per-function diagnostic flooding.
6. **Given** this repository has CFG analysis enabled for UAT, **When** a real TypeScript/JavaScript function is queried through library, CLI JSON, and MCP pages, **Then** the UAT evidence proves cross-surface parity and records the project status counts.

---

### User Story 4 - Obtain Python Semantic Parity After the TypeScript/JavaScript Slice (Priority: P3)

After the TypeScript/JavaScript vertical slice works end to end, Python functions flow through the same state, persistence, and read contracts with semantic parity for Python constructs including `match`/`case`, comprehensions, generator expressions, explicit `raise`, nested function boundaries, and unreachable code.

**Why this priority**: Python is required scope, but the accepted delivery plan preserves reviewability by proving the complete path with TypeScript/JavaScript first and then carrying Python through the same contract.

**Independent Test**: Can be tested with committed Python fixtures that reuse the same expected state machine and cross-surface parity tests as TypeScript/JavaScript, adding Python-specific construct coverage.

**Acceptance Scenarios**:

1. **Given** Python fixtures covering ordinary branches, loops, explicit `raise`, nested functions, and unreachable statements, **When** CFG analysis runs after the TypeScript/JavaScript slice, **Then** Python results use the same block, edge, status, and machine response contract.
2. **Given** Python fixtures using `match`/`case`, list/set/dict comprehensions, and generator expressions, **When** their CFGs are read, **Then** the graph represents real intra-procedural control flow for cases, loops, filters, and evaluation order.
3. **Given** Python async or generator functions containing `await`, `yield`, or `yield from`, **When** their CFGs are read, **Then** those constructs are treated as ordinary intra-procedural operations without suspension or resumption edges.
4. **Given** a committed Python parity fixture and an equivalent supported TypeScript/JavaScript fixture, **When** library, CLI JSON, and MCP reads are compared, **Then** both languages satisfy the same state, pagination, determinism, and skip contracts.

### Edge Cases

- CFG analysis remains fully dormant while disabled: no network calls, no CFG row writes, no changed read behavior, and no persisted analysis setting changes except explicit enablement or disablement.
- A function ID that never existed returns `unknown_function`; a previously known function that no longer exists or belongs to a deleted file returns `deleted`. Neither state exposes a CFG payload or a stale graph marked current.
- Unsupported syntax, parser-unavailable functions, parse-unsafe regions, and functions exceeding 10,000 blocks skip the whole function and persist a stable reason without exposing partial blocks or edges.
- Unexpected refresh failure with a prior snapshot retains only an explicitly stale snapshot; first-run failure without a prior snapshot returns an unavailable or not-computed state.
- A function with unreachable statements keeps disconnected unreachable blocks without synthetic reachability edges.
- Nested functions, lambdas, local classes, and local class methods receive separate CFGs; enclosing functions record only the declaration or value creation flow.
- Valid CFGs too large for a single MCP response are paginated with deterministic totals, ordering, and reconstruction guarantees.
- Empty or no-op supported functions return `available` with `reason: null` and a complete minimal CFG containing entry and exit nodes. `empty` is reserved for aggregate project CFG health when enabled analysis has computed zero current CFGs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep CFG analysis opt-in and persist CFG enablement only after an explicit enable action. (Q2)
- **FR-002**: The system MUST keep disabled CFG analysis dormant: disabled indexing and reads MUST make no network calls, write no CFG status/block/edge rows, and preserve existing non-CFG behavior. (Q2, Q20)
- **FR-003**: The system MUST perform a full CFG backfill on first enable, including when the ordinary incremental change set is empty. (Q19)
- **FR-004**: The system MUST compute statuses for all current functions in an affected file before one transaction replaces the prior CFG status, block, and edge rows for that file, so changed functions cannot retain apparently current old CFG rows. CFG rows MUST store function ID, file path, language, and relevant spans by value rather than depend on a foreign-key cascade from general symbol nodes; cascades MAY exist only within CFG-owned tables. (Q3)
- **FR-005**: The system MUST remove current CFG payloads for deleted files and deleted functions after successful sync and retain compact `deleted` status tombstones for previously known function IDs. A never-seen function ID MUST return `unknown_function`; neither deleted nor unknown IDs may expose blocks or edges. (Q3)
- **FR-006**: The system MUST retain existing CFG rows as inert and unreadable while CFG analysis is disabled. (Q20)
- **FR-007**: The system MUST refresh retained rows before serving them as current after CFG analysis is re-enabled. (Q20, Q19)
- **FR-008**: The system MUST retain a prior CFG snapshot only as explicitly `stale` when an unexpected enabled refresh failure occurs after a prior successful snapshot. (Q13)
- **FR-009**: The system MUST return an `unavailable` success-shaped state with reason `first_refresh_failed`, without a CFG payload, when an unexpected enabled refresh failure occurs before any prior snapshot exists. CFG analysis failures MUST be contained to CFG status outcomes and MUST NOT fail otherwise successful project indexing or sync, publish partial CFG state, or change non-CFG index results. Caller cancellation MUST write no partial CFG state and MUST NOT create a failure marker: before any snapshot it leaves the function `not_computed`; with an older source snapshot it leaves that snapshot `stale`; and after an atomic swap commits the committed result stands. (Q13)
- **FR-010**: The system MUST expose reads by function ID only; name lookup, source-position lookup, and fuzzy target resolution are out of scope. (Q9)
- **FR-011**: The system MUST use one exact machine-readable response shape for library results, CLI JSON, and MCP responses. (Q7, Q27)
- **FR-012**: The public TypeScript API MUST export `CfgReadResult`, `CfgState`, `CfgReason`, `CfgGraph`, `CfgBlock`, `CfgEdge`, and `CfgPage`. `CfgReadResult` MUST contain exactly these top-level fields in every library, CLI JSON, and MCP response: `analysis: 'cfg'`, `functionId: string`, `state: CfgState`, `reason: CfgReason | null`, `message: string`, `sourceVersion: string | null`, `stale: boolean`, `cfg: CfgGraph | null`, and `page: CfgPage | null`.
- **FR-013**: Per-function `CfgState` MUST be `available`, `disabled`, `not_indexed`, `not_computed`, `stale`, `unavailable`, `unsupported`, `resource_limited`, `unknown_function`, or `deleted`. Aggregate project CFG health MAY additionally use `empty` only when enabled analysis has computed zero current CFGs. `CfgReason` MUST be the closed snake_case enum `analysis_disabled`, `project_not_indexed`, `cfg_not_computed`, `function_unknown`, `function_deleted`, `unsupported_language`, `unsupported_construct`, `parse_error`, `parse_unsafe_region`, `parser_unavailable`, `block_limit_exceeded`, `first_refresh_failed`, `refresh_failed_retained_stale`, `source_version_mismatch`, or `no_current_cfg_functions`. Per-function `reason` MUST be null only for a fresh successful `available` result. `message` MUST be at most 240 Unicode code points and MUST NOT contain raw source text or raw exception strings. `stale` MUST be true only when `state` is `stale`; `cfg` and `page` MUST be non-null only for `available` or retained `stale` results.
- **FR-014**: A non-null `cfg` payload MUST contain only complete CFG metadata: graph identity, language, function ID, exactly one synthetic `entry` block and one synthetic `exit` block, ordered basic blocks with roles (`entry`, `exit`, `body`, `condition`, `merge`, or `unreachable`) and source spans, and ordered typed edges. Blocks MUST be ordered by deterministic lowering ordinal with `entry` first and `exit` last, using block ID as a tie-breaker. Edges MUST be ordered by source-block ordinal, the edge-kind order fixed in FR-027, and target block ID. Even an empty or no-op supported function MUST contain its entry and exit blocks. The payload MUST NOT contain lowering instructions or partial CFG fragments, and byte-equivalent JSON MUST preserve these array orders. (Q10, Q11)
- **FR-015**: The system MUST persist compact per-function CFG status with a stable reason code and an opaque `sourceVersion` derived from the indexed file/function snapshot so expected absence states can be read without re-running analysis. A persisted result is current only when its token equals the current indexed function token; a retained prior result whose token differs MUST be reported as `stale`. Unrelated project writes MUST NOT make an unchanged function stale. (Q12)
- **FR-016**: The system MUST skip the entire function when a construct cannot be modeled safely; it MUST persist a stable unsupported status and reason and MUST NOT expose a partial CFG. (Q1)
- **FR-017**: The system MUST skip the entire function when its CFG would exceed 10,000 basic blocks; it MUST persist `resource_limited` status and a stable block-limit reason and MUST NOT expose a partial CFG. (Q15, Q23)
- **FR-018**: The system MUST model exception control flow only for explicit `throw` and `raise` syntax and MUST NOT infer implicit exception edges from calls, property access, allocation, or other potentially failing operations. Every modeled normal or abrupt exit from a `try`/`finally` construct MUST route through its lexical `finally` block before reaching the pending target; an explicit abrupt transfer inside `finally` MUST supersede the pending transfer. (Q4)
- **FR-019**: The system MUST model real short-circuit flow for TypeScript/JavaScript logical expressions, Python `and`/`or`, and conditional expressions where those constructs affect whether operands execute. (Q5)
- **FR-020**: The system MUST model TypeScript/JavaScript `switch` control flow, including default behavior and fallthrough, without inventing edges that are not present in source semantics. (Q6)
- **FR-021**: The system MUST model Python `match`/`case` control flow in the Python slice through the same multi-way branch contract used by other languages. Cases MUST be evaluated in source order, each pattern MUST be represented as a case predicate, and a `case ... if guard` guard MUST use the ordinary expression and short-circuit CFG rules. (Q6)
- **FR-022**: The system MUST model Python list, set, and dict comprehensions plus generator expressions as real intra-procedural control flow for loops, filters, and evaluation order. (Q25)
- **FR-023**: The system MUST model TypeScript/JavaScript optional chaining and nullish coalescing as explicit short-circuit branches. (Q26)
- **FR-024**: The system MUST treat `await`, `yield`, and `yield from` as ordinary intra-procedural operations and MUST NOT model scheduler, suspension, or resumption edges. (Q17)
- **FR-025**: The system MUST keep nested functions, lambdas, and local class methods as separate CFGs; enclosing CFGs MUST NOT inline nested bodies. Every function-like form that receives a separate CFG, including all currently extracted TypeScript, JavaScript, and Python functions and methods plus Python lambdas, MUST have a deterministic function ID consistent with existing CodeGraph symbol identity semantics. The Python slice MUST add deterministic identity for Python lambdas before their CFGs can be read. (Q28)
- **FR-026**: The system MUST preserve unreachable source regions as disconnected blocks and MUST NOT create synthetic reachability edges to them. (Q18)
- **FR-027**: The system MUST persist the edge kinds `fallthrough`, `true`, `false`, `case`, `default`, `loop_back`, `return`, `throw`, `break`, `continue`, and `finally` rather than collapse semantically distinct transfers. `break` and `continue` edges MUST target the statically resolved loop, switch, or labeled-statement successor within the same function; a cross-boundary or parse-unsafe target MUST cause the whole function to be skipped. (Q21)
- **FR-028**: The public library read MUST be `CodeGraph.getCfg(functionId, { limit, offset })`. The CLI read MUST be `codegraph cfg <function-id>` with `-p, --path`, `-j, --json`, `--limit`, and `--offset`; JSON mode MUST write only the exact `CfgReadResult` object, while human mode MUST render at most the requested page and remain bounded. The command MUST exit 0 whenever it returns any expected `CfgReadResult` state and MUST use a nonzero exit only for invalid usage, invalid path or workspace access, output or serialization failure, or an unexpected internal failure that prevents a valid result. (Q7, Q8, Q9, Q27)
- **FR-029**: The MCP read tool MUST be named `codegraph_get_cfg`, accept exactly `projectPath: string`, `functionId: string`, and optional integer `limit` and `offset`, and return the exact `CfgReadResult` machine object. Library, CLI, and MCP CFG reads MUST default to `limit = 100` and `offset = 0`, clamp `limit` to `1..500`, and clamp `offset` to zero or greater. The shared paging request MUST be applied independently to the deterministic block and edge arrays. `CfgPage` MUST contain `limit`, `offset`, and nested `blocks` and `edges` windows, each with `total`, `returned`, `hasMore`, and `nextOffset: number | null`, sufficient to reconstruct the complete CFG without overlap or gaps. (Q8, Q16)
- **FR-030**: The system MUST report aggregate CFG health as a top-level `cfg` object in both human and JSON project status containing exactly `enabled`, `state`, `reason`, `availableCount`, `skippedCount`, `unsupportedCount`, `resourceLimitedCount`, and `staleCount`. Aggregate `state` MUST use deterministic precedence: `disabled`, then `not_indexed`, then `not_computed`, then `unavailable` for a failed first computation with no current CFG, then `stale` when any retained stale CFG exists, then `empty` when computation completed with zero current CFGs, otherwise `available`. `skippedCount` MUST equal `unsupportedCount + resourceLimitedCount`. (Q24)
- **FR-031**: Identical source MUST produce deterministic CFG output and stable basic-block IDs across repeated re-indexing; changed functions may receive replacement block IDs after transactional refresh. (Q10)
- **FR-032**: Enabled CFG analysis MUST satisfy a paired-median index-time overhead budget of at most 20% over the same project with CFG analysis disabled. (Q14)
- **FR-033**: Delivery MUST preserve the accepted two vertical language slices: first shared infrastructure plus TypeScript/JavaScript end to end through library, CLI, MCP, and status; second Python parity through the same contracts. (Q22)
- **FR-034**: The system MUST include self-repository UAT that exercises a real TypeScript/JavaScript function through library, CLI JSON, and MCP pagination, plus a committed Python parity fixture. (Constitution Dogfooding)

### Reviewability Budget *(mandatory)*

- **Primary surface**: schema/migration plus analysis harness/adapters
- **Secondary surfaces, if any**: library read contract, CLI read output, MCP read tool, project status, deterministic fixtures, performance benchmark
- **Projected reviewable LOC**: 780 net-new reviewable LOC
- **Projected production files**: 8 files/surfaces
- **Projected total files**: 18 files, including tests, fixtures, contracts, and UAT evidence
- **Budget result**: warning accepted
- **Split decision**: Preserve the operator-ratified two vertical slices. Slice 1 delivers shared infrastructure plus TypeScript/JavaScript end to end through all read surfaces. Slice 2 delivers Python parity through the same contracts. If plan-phase reviewability gates show either slice is too large, the plan must re-slice before implementation.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.
- The PR packet MUST separate generated, fixture, benchmark, and source changes so reviewers can evaluate the CFG contract in the accepted vertical-slice order.

### Key Entities *(include if feature involves data)*

- **CFG Analysis Setting**: The project-level opt-in state that determines whether CFG analysis runs, whether reads are visible, and whether retained rows are inert or refreshable.
- **Function CFG Status**: Per-function state containing function ID, file path, language, relevant spans, opaque source version, freshness, stable reason code, and whether a current CFG payload is available, stale, unsupported, resource-limited, unavailable, deleted, or unknown. Deleted functions retain only a compact tombstone; status rows do not depend on general symbol-node cascades.
- **Control-Flow Graph Result**: The complete per-function graph returned by successful reads, containing graph identity, language, function ID, ordered basic-block metadata, and ordered typed edges.
- **Basic Block Metadata**: A deterministic block identity, one of the roles `entry`, `exit`, `body`, `condition`, `merge`, or `unreachable`, and ordered source spans for a source region in a function CFG. It excludes lowering instructions. Every available CFG has exactly one synthetic entry and one synthetic exit block.
- **Control Edge**: A typed relationship between basic blocks representing deterministic intra-procedural control flow using `fallthrough`, `true`, `false`, `case`, `default`, `loop_back`, `return`, `throw`, `break`, `continue`, or `finally`.
- **CFG Page**: The MCP pagination envelope containing deterministic offset, limit, returned counts, total counts, and continuation visibility for large valid CFGs.
- **CFG Project Status**: Aggregate project-level visibility for enablement, freshness, available function counts, skipped counts, unsupported counts, resource-limited counts, and stale counts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With CFG analysis disabled, fixture indexing performs zero CFG status, block, or edge writes and no network attempts; existing non-CFG query behavior remains unchanged.
- **SC-002**: First enable backfills all existing supported functions and records stable skip states for unsupported or over-limit functions even when no files changed.
- **SC-003**: Three repeated re-indexes of identical source produce byte-equivalent ordered machine responses and stable block IDs for all tested supported functions.
- **SC-004**: Lifecycle verification covers enable, successful sync, delete, disable, unexpected stale refresh failure, first-run failure, and re-enable with 100% of expected state assertions passing.
- **SC-005**: Every unsupported, parse-unsafe, and over-10,000-block fixture exposes zero partial CFG blocks or edges and returns a stable success-shaped state with a stable reason code.
- **SC-006**: Library, CLI JSON, and MCP machine responses match field-for-field for available, not-indexed, disabled, not-computed, unknown, unsupported, resource-limited, unavailable, stale, and deleted states; `codegraph cfg` exits 0 for each expected state and nonzero only when no valid result can be produced.
- **SC-007**: MCP pagination reconstructs 100% of a large valid CFG with no duplicate blocks, no duplicate edges, no gaps, and accurate total counts.
- **SC-008**: Project status reports CFG enablement, freshness, available counts, skipped counts, unsupported counts, resource-limited counts, and stale counts correctly for controlled mixed-state fixtures.
- **SC-009**: Enabled CFG analysis has a paired-median index-time ratio of 1.20 or lower against the same benchmark project with CFG disabled.
- **SC-010**: Self-repo UAT retrieves a real TypeScript/JavaScript function CFG through library, CLI JSON, and MCP pages, proves machine-response parity, and records aggregate status.
- **SC-011**: Python parity fixtures prove `match`/`case`, comprehensions, generator expressions, explicit `raise`, nested function boundaries, unreachable blocks, and ordinary-operation `await`/`yield` semantics through the same machine contract.

## Assumptions

- Existing CodeGraph function IDs are the authoritative public target identifiers for SPEC-014 reads.
- Every function-like form that receives a separate CFG must have a deterministic CodeGraph function ID. The Plan must add deterministic Python lambda identity consistent with existing symbol identity semantics before Python lambda CFGs are exposed.
- Existing project indexing, file content identity, and function identity/span data provide the inputs for an opaque per-function source snapshot token used to decide whether a persisted CFG is current, stale, deleted, or not computed. The token is not the project-wide graph write version.
- Stable reason codes can be finalized during Clarify without reopening the Q1-Q28 policy choices.
- Public names are frozen as `CodeGraph.getCfg`, `codegraph cfg`, `codegraph_get_cfg`, `CfgReadResult`, `CfgState`, `CfgReason`, `CfgGraph`, `CfgBlock`, `CfgEdge`, and `CfgPage`.
- The 10,000-block safety cap remains binding unless Plan-phase measurement proves it impractical; changing the value would not reopen the whole-function skip policy.
- Dataflow, dependence analysis, taint, REST, write surfaces, implicit exception inference, async suspension modeling, and name/position lookup remain outside SPEC-014 even if later specs consume CFGs.
