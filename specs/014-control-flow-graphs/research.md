# Research: SPEC-014 Control-Flow Graphs

## Decision 1: Reparse Affected Source Files for CFG Lowering

**Decision**: CFG analysis reparses each affected source file with the existing tree-sitter grammar, finds current function-like syntax nodes by indexed function ID, file path, language, and spans, then lowers only those functions.

**Rationale**: Existing CodeGraph nodes persist stable public function IDs and spans, but not syntax trees. Reparse-on-analysis keeps the CFG pass deterministic, local, and independent from read paths without adding persisted AST or lowering-instruction storage.

**Alternatives considered**:

- Persist AST or lowering IR: rejected because SPEC-014 explicitly persists CFG metadata only and defers instruction storage to later dataflow specs.
- Lower during general extraction only: rejected because first-enable backfill and re-enable need to compute CFGs for an already indexed project even when no ordinary file change exists.

## Decision 2: Keep the CFG IR In Memory Only

**Decision**: Use one transient, language-neutral IR for statement sequencing, expression branches, loops, multi-way branches, explicit throws/raises, abrupt transfers, finally routing, nested-function boundaries, and unreachable blocks. Persist only status, block metadata, ordered source spans, and typed edges.

**Rationale**: The Design Concept decision "CFG metadata only" keeps the public contract stable while leaving future dataflow instruction choices to SPEC-015. This also satisfies Constitution Principle II by avoiding a storage model not needed for CFG reads.

**Alternatives considered**:

- Store normalized IR JSON per block: rejected because it would freeze a dataflow-facing representation before SPEC-015.
- Store instruction rows: rejected because it increases schema surface and review scope without being required by any SPEC-014 read.

## Decision 3: Use CFG-Owned Tables with By-Value Function Metadata

**Decision**: Add CFG-owned status, block, and edge tables. Store function ID, file path, language, function spans, reason, state, and source version by value. Do not add a foreign key from CFG status to `nodes(id)`; allow cascades only within CFG-owned tables.

**Rationale**: Existing analysis tables document the same stale-retention problem: a sync deletes and reinserts node rows, so a `nodes(id)` cascade would destroy retained stale data before a replacement is computed. SPEC-014 additionally needs affected-file swaps and deleted-function tombstones.

**Alternatives considered**:

- FK cascade from status to nodes: rejected by FR-004 and stale-retention requirements.
- Full catalog swap for every sync: rejected because Q3 selected affected-file replacement and because unchanged functions must not become stale from unrelated writes.

## Decision 4: Derive Read State from Live Context plus Status Rows

**Decision**: Reads resolve state in this order: disabled config, not indexed project, current function existence, deleted tombstone, missing status, status/source-version/version freshness, and payload availability.

**Rationale**: This preserves the closed public state set while keeping expected absence states success-shaped. The live config is consulted first so retained rows remain inert when disabled.

**Alternatives considered**:

- Store every public state literally: rejected because `disabled`, `not_indexed`, `unknown_function`, and some `stale` cases are read-time facts.
- Throw or return null for expected states: rejected by "Stateful result" and "Exact shared shape".

## Decision 5: Apply Pagination to Blocks and Edges Independently

**Decision**: The shared read path materializes deterministic block and edge arrays, then applies the same effective `limit` and `offset` independently to each array and reports totals, returned counts, `hasMore`, and `nextOffset` for both windows.

**Rationale**: This matches the clarified MCP contract and lets pages reconstruct a large graph without duplicate blocks, duplicate edges, or gaps.

**Alternatives considered**:

- Return the full graph through MCP: rejected because valid CFGs can exceed a safe tool payload.
- Fixed truncation: rejected because SPEC-014 forbids partial or truncated CFGs presented as usable results.

## Decision 6: Reuse the Benchmark-Monorepo Paired-Median Method

**Decision**: Measure index-time overhead with the existing benchmark-monorepo fixture in paired disabled/enabled arms. Use warmup pairs, alternating measured pairs, median(B)/median(A), and a pass bar of `<= 1.20`.

**Rationale**: The roadmap and Design Concept require the same method used by previous optional analysis work, making SPEC-014 comparable and less flaky than one-off wall-clock measurements.

**Alternatives considered**:

- Measure only without a threshold: rejected by Q14 and SC-009.
- Use a broader threshold: rejected by the accepted at-most-20-percent decision.

## Decision 7: Validate the 10,000-Block Cap with Deterministic Fixtures

**Decision**: Keep the 10,000-block per-function cap. The builder checks the cap before persisting any status/block/edge payload for that function; over-cap functions persist `resource_limited` with `block_limit_exceeded`.

**Rationale**: The cap is generous enough for ordinary fixtures, deterministic, and protects local indexing from generated pathological functions.

**Alternatives considered**:

- No CFG-specific cap: rejected because a generated function could exhaust analysis resources.
- Persist a capped prefix: rejected because SPEC-014 forbids usable partial CFGs.

