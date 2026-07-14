# Contract: REST Endpoints

**Feature**: SPEC-011 | Surface: `src/server/` + `src/server/openapi.yaml` | FR-028, FR-029, FR-030

Two new **unprefixed** endpoints (like existing `/api/*` routes), added to the committed SPEC-005 `openapi.yaml`. They **mirror the MCP tools' field names and offset/limit semantics** so the two surfaces cannot drift (FR-028) — each surface keeps its own page-size ceiling.

## Shared conventions (reuse SPEC-005)

- **Paging** (SPEC-005 params): `Limit` integer, default **100**, max **500**; `Offset` integer, zero-based, default **0**.
- **Envelope**: SPEC-005 `ListResult` — `{ items: [...], total, limit, offset }`.
- **Field names**: identical to the MCP items (`id`, `name`, `entryKind`, `stepCount`, `truncated`, `canonicalLabel`, `displayLabel`, `memberCount`, `isSingleton`, and the `get_flow` step/truncation shapes).
- **Success-shaped** (FR-030): expected conditions (not indexed, disabled, stale, unknown id, empty) return a normal **200** with a body describing the condition and, for lists, an empty `items` — never a 4xx/5xx used to signal an ordinary catalog state. (A stale catalog returns 200 with the items + a `state: "stale"` + `sourceVersion`.)

## `GET /api/flows`

- **Query**: `Limit`, `Offset`.
- **Sort**: `name` asc, then `id` asc.
- **200 body**: `ListResult` of flow-summary items (same shape as `codegraph_list_flows` items) + `sourceVersion`, `state`.

## `GET /api/flows/{id}`

- **Path**: `id` (the deterministic flow id).
- **200 body**: the full flow detail — identical shape to `codegraph_get_flow` (`root`, `steps[]`, `truncated`, `truncation:{depth,width,totalSteps}`, `sourceVersion`, `state`).
- **Unknown id**: 200 with success-shaped `"unknown flow id"` guidance (not 404), to match the MCP surface's success-shaped contract (FR-030). _(Note: this deliberately diverges from a conventional REST 404 to keep the two surfaces' condition-handling identical; recorded as an intentional contract choice for tasks/implementation.)_

## `GET /api/clusters`

- **Query**: `Limit`, `Offset`, `minSize` (integer, default 1, `<1` clamps to 1; FR-029).
- **Sort**: `memberCount` desc, then `canonicalLabel` asc, then `id` asc.
- **200 body**: `ListResult` of cluster-summary items (same shape as `codegraph_list_clusters` items; `total` reflects the post-`minSize` count) + `sourceVersion`, `state`.

## openapi.yaml additions

- Paths: `/api/flows`, `/api/flows/{id}`, `/api/clusters`.
- Schemas: `FlowSummary`, `FlowDetail`, `FlowStep`, `FlowTruncation`, `ClusterSummary` — field names shared with the MCP items. Reuse the existing `ListResult`, `Limit`, `Offset` components.

## Traceability

| Requirement | Where |
|---|---|
| FR-028 REST mirrors, shared field names, SPEC-005 Limit/Offset/ListResult | all endpoints + openapi additions |
| FR-029 `minSize` | `GET /api/clusters` |
| FR-030 success-shaped conditions | Shared conventions + per-endpoint notes |
