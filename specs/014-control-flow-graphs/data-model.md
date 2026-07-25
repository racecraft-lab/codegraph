# Data Model: SPEC-014 Control-Flow Graphs

## Entity: CFG Analysis Setting

**Purpose**: Project-level opt-in state for CFG analysis.

**Fields**:

- `analysis.cfg`: boolean in `codegraph.json`; only literal `true` enables analysis.

**Validation rules**:

- Missing, malformed, or non-boolean values resolve to disabled.
- Disabled indexing and sync write zero CFG status, block, or edge rows.
- Reads consult this setting first and return `disabled` with reason `analysis_disabled` when it is false.

## Entity: Function CFG Status

**Purpose**: Durable per-function state for available graphs and expected absence states.

**Fields**:

- `function_id`: text primary key, the public function ID used by all reads.
- `file_path`: project-relative source path stored by value.
- `language`: indexed language stored by value.
- `function_kind`: indexed node kind, normally `function` or `method`.
- `function_name`: indexed simple name for bounded diagnostics and human output.
- `start_line`, `start_column`, `end_line`, `end_column`: relevant function span stored by value.
- `state`: stored status state for persisted outcomes: `available`, `unavailable`, `unsupported`, `resource_limited`, or `deleted`.
- `reason`: nullable closed reason code.
- `message`: bounded safe message, at most 240 Unicode code points, no raw source or raw exception string.
- `source_version`: opaque per-function source snapshot token, nullable for states without a current source.
- `status_version`: integer CFG status contract version.
- `block_version`: integer CFG block contract version.
- `edge_version`: integer CFG edge contract version.
- `schema_version`: integer database schema version that owns the CFG tables.
- `updated_at`: millisecond timestamp.

**Validation rules**:

- `reason` is null only for fresh `available`.
- `deleted` rows have no blocks or edges.
- `unsupported` and `resource_limited` rows have no blocks or edges.
- A stored status is current only when the live function still exists, its computed source token equals `source_version`, and all CFG contract versions match.
- A missing status for a known current function reads as `not_computed`.
- A never-seen function ID reads as `unknown_function`.

## Entity: CFG Block

**Purpose**: Ordered basic-block metadata for a complete CFG.

**Fields**:

- `function_id`: owning CFG status row.
- `block_id`: deterministic text ID.
- `ordinal`: deterministic lowering ordinal.
- `role`: `entry`, `exit`, `body`, `condition`, `merge`, or `unreachable`.
- `spans_json`: ordered source spans as an array of `{startLine,startColumn,endLine,endColumn}`.

**Validation rules**:

- Every available or retained-stale graph has exactly one `entry` block and one `exit` block.
- `entry` has the first ordinal and `exit` has the last ordinal.
- `unreachable` blocks may be disconnected and must not receive synthetic reachability edges.
- Blocks contain no raw source text and no lowering instructions.

## Entity: CFG Edge

**Purpose**: Ordered typed edge between CFG blocks.

**Fields**:

- `function_id`: owning CFG status row.
- `edge_ordinal`: deterministic persisted order.
- `source_block_id`: source block.
- `target_block_id`: target block.
- `kind`: `fallthrough`, `true`, `false`, `case`, `default`, `loop_back`, `return`, `throw`, `break`, `continue`, or `finally`.

**Validation rules**:

- Source and target blocks must belong to the same function CFG.
- Break and continue targets must resolve within the same function; otherwise the whole function is skipped.
- Explicit `throw` and Python `raise` are the only exception-producing syntax.
- Try/finally normal and abrupt exits route through lexical finally blocks; abrupt transfer inside `finally` supersedes the pending transfer.

## Entity: CFG Page

**Purpose**: Pagination metadata for large complete CFGs.

**Fields**:

- `limit`: effective limit after default/clamp.
- `offset`: effective offset after default/clamp.
- `blocks`: `{total, returned, hasMore, nextOffset}`.
- `edges`: `{total, returned, hasMore, nextOffset}`.

**Validation rules**:

- Default `limit` is 100 and default `offset` is 0.
- `limit` clamps to `1..500`.
- `offset` clamps to zero or greater.
- The same effective request is applied independently to ordered block and edge arrays.

## Entity: CFG Project Status

**Purpose**: Aggregate project-level CFG health in `codegraph status`.

**Fields**:

- `enabled`
- `state`
- `reason`
- `availableCount`
- `skippedCount`
- `unsupportedCount`
- `resourceLimitedCount`
- `staleCount`

**Validation rules**:

- `skippedCount` equals `unsupportedCount + resourceLimitedCount`.
- Aggregate precedence is `disabled`, `not_indexed`, `not_computed`, `unavailable`, `stale`, `empty`, then `available`.
- Aggregate `empty` is only used when enabled analysis has computed zero current CFGs.

## State Transitions

| Event | Prior State | Result |
|---|---|---|
| Disabled read | Any retained rows | `disabled`, no CFG payload |
| First enable | No CFG rows | Full backfill; each function becomes `available`, `unsupported`, `resource_limited`, or `unavailable` |
| Successful affected-file refresh | Current rows for file | One transaction replaces status, blocks, and edges for every current function in the file |
| Source file deleted | Current rows for file | Payload rows removed; compact `deleted` tombstones retained for prior function IDs |
| Function deleted from existing file | Current function row | Payload rows removed; compact `deleted` tombstone retained |
| Disable | Any retained rows | Rows remain inert; disabled sync writes no CFG rows |
| Re-enable | Retained rows | Fresh backfill or affected-file refresh required before rows can be current |
| Unexpected first refresh failure | No prior snapshot | `unavailable` with `first_refresh_failed`, no payload |
| Unexpected later refresh failure | Prior available snapshot | Prior payload retained as `stale` with `refresh_failed_retained_stale` |
| Cancellation before swap | Any | No marker and no partial writes |
| Cancellation after swap | Swap committed | Committed result stands |

## SQLite Ownership Rules

- CFG status has no foreign key to `nodes(id)`.
- Blocks and edges may cascade from CFG-owned status rows.
- Affected-file swap deletes and inserts only CFG rows for that file inside one transaction.
- Deleted tombstones are compact status rows and do not retain block or edge rows.
- Schema definitions in `src/db/schema.sql` and migrations stay byte-equivalent where practical.

