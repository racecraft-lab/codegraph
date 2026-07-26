# Contract: CFG Project Status

Both human and JSON `codegraph status` include a top-level `cfg` object.

## JSON Shape

```ts
export interface CfgProjectStatus {
  enabled: boolean;
  state:
    | 'available'
    | 'disabled'
    | 'not_indexed'
    | 'not_computed'
    | 'stale'
    | 'unavailable'
    | 'empty';
  reason:
    | null
    | 'analysis_disabled'
    | 'project_not_indexed'
    | 'cfg_not_computed'
    | 'first_refresh_failed'
    | 'refresh_failed_retained_stale'
    | 'source_version_mismatch'
    | 'no_current_cfg_functions';
  availableCount: number;
  skippedCount: number;
  unsupportedCount: number;
  resourceLimitedCount: number;
  staleCount: number;
}
```

## State Precedence

Aggregate status resolves state in this order:

1. `disabled`
2. `not_indexed`
3. `not_computed`
4. `unavailable` when first computation failed and no current CFG exists
5. `stale` when any retained stale CFG exists
6. `empty` when computation completed with zero current CFGs
7. `available`

## Count Rules

- `skippedCount` equals `unsupportedCount + resourceLimitedCount`.
- Status output is aggregate only and does not flood per-function diagnostics.
- Human status may format labels differently, but values must match the JSON object.
