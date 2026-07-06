# SPEC-008 Slice Plan

## Reviewability Warning

The task reviewability gate produced a size-only block. The implementation uses
the marker plan in `.process/reviewability/pr-marker-plan.json` to checkpoint
and review the work in this order:

1. `foundation` - T001-T018
2. `us1` - T019-T037
3. `us2` - T038-T049
4. `us3` - T050-T062
5. `us4` - T063-T114

## File Ownership

Foundation owns the initial `src/lsp/` contracts, config parsing, prerequisite
probing, status models, provenance typing, fake fixture layout, validation
script scaffold, and foundation tests. Later markers extend those surfaces for
runtime JSON-RPC, precision correction, watch integration, parity validation,
and final dogfood evidence.

