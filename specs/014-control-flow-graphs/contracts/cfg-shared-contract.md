# Contract: Shared CFG Machine Shape

Library, CLI JSON, and MCP responses return exactly this top-level shape for every expected result state.

## Public Type Names

- `CfgReadResult`
- `CfgState`
- `CfgReason`
- `CfgGraph`
- `CfgBlock`
- `CfgEdge`
- `CfgPage`

## Types

```ts
export type CfgState =
  | 'available'
  | 'disabled'
  | 'not_indexed'
  | 'not_computed'
  | 'stale'
  | 'unavailable'
  | 'unsupported'
  | 'resource_limited'
  | 'unknown_function'
  | 'deleted';

export type CfgAggregateState = CfgState | 'empty';

export type CfgReason =
  | 'analysis_disabled'
  | 'project_not_indexed'
  | 'cfg_not_computed'
  | 'function_unknown'
  | 'function_deleted'
  | 'unsupported_language'
  | 'unsupported_construct'
  | 'parse_error'
  | 'parse_unsafe_region'
  | 'parser_unavailable'
  | 'block_limit_exceeded'
  | 'first_refresh_failed'
  | 'refresh_failed_retained_stale'
  | 'source_version_mismatch'
  | 'no_current_cfg_functions';

export interface CfgReadResult {
  analysis: 'cfg';
  functionId: string;
  state: CfgState;
  reason: CfgReason | null;
  message: string;
  sourceVersion: string | null;
  stale: boolean;
  cfg: CfgGraph | null;
  page: CfgPage | null;
}

export interface CfgGraph {
  analysis: 'cfg';
  graphId: string;
  language: string;
  functionId: string;
  sourceVersion: string;
  blocks: CfgBlock[];
  edges: CfgEdge[];
}

export interface CfgBlock {
  id: string;
  role: 'entry' | 'exit' | 'body' | 'condition' | 'merge' | 'unreachable';
  ordinal: number;
  spans: Array<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }>;
}

export interface CfgEdge {
  source: string;
  target: string;
  kind:
    | 'fallthrough'
    | 'true'
    | 'false'
    | 'case'
    | 'default'
    | 'loop_back'
    | 'return'
    | 'throw'
    | 'break'
    | 'continue'
    | 'finally';
}

export interface CfgPage {
  limit: number;
  offset: number;
  blocks: {
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  edges: {
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}
```

## Ordering

- Blocks are ordered by deterministic lowering ordinal, with `entry` first and `exit` last, then block ID.
- Edges are ordered by source-block ordinal, edge-kind order, then target block ID.
- Edge-kind order is `fallthrough`, `true`, `false`, `case`, `default`, `loop_back`, `return`, `throw`, `break`, `continue`, `finally`.
- Byte-equivalent JSON preserves these array orders.

## Payload Rules

- `reason` is null only for fresh `available`.
- `stale` is true only when `state` is `stale`.
- `cfg` and `page` are non-null only for `available` or retained `stale`.
- `message` is bounded to 240 Unicode code points and contains no raw source text or raw exception string.
- No response contains lowering instructions or partial CFG fragments.

## Expected State and Reason Mapping

| State | Allowed reasons | CFG payload | Containment outcome |
|---|---|---|---|
| `available` | `null` | Complete current `cfg` and `page` | Fresh success |
| `disabled` | `analysis_disabled` | None | Retained rows are suppressed |
| `not_indexed` | `project_not_indexed` | None | Expected absence |
| `not_computed` | `cfg_not_computed` | None | Expected absence; retryable by enable/backfill or affected-file refresh |
| `stale` | `refresh_failed_retained_stale`, `source_version_mismatch` | Retained stale `cfg` and `page` only | Never reported as current |
| `unavailable` | `first_refresh_failed` | None | Failure contained to CFG status; no partial graph |
| `unsupported` | `unsupported_language`, `unsupported_construct`, `parse_error`, `parse_unsafe_region`, `parser_unavailable` | None | Whole-function skip; no partial graph |
| `resource_limited` | `block_limit_exceeded` | None | Whole-function skip; no partial graph |
| `unknown_function` | `function_unknown` | None | Expected absence |
| `deleted` | `function_deleted` | None | Tombstone only |

`no_current_cfg_functions` is reserved for aggregate project CFG status, not per-function `CfgReadResult`.
