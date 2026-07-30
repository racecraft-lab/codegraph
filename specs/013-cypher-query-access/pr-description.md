## Summary

Implements SPEC-013 Cypher Query Access as a bounded, read-only graph-query surface across the package API, CLI, and MCP.

## What changed

- Added the public `queryCypher(projectRoot, query)` API for the supported CodeGraph Cypher subset.
- Added dual-route CLI behavior: `codegraph query` routes bounded `MATCH` text through Cypher, while `codegraph search` remains the explicit legacy search escape hatch.
- Added the default-listed, reserved MCP `codegraph_query` tool for deliberate graph-language requests without replacing `codegraph_explore`.
- Added canonical JSON result unions, bounded diagnostics, byte-stable CLI/MCP output, and recipe evidence.
- Added documented recipes and guardrails for representative live self-index usage.

## Why

Agents and users need a precise, local, read-only way to ask structured graph questions when retrieval snippets are not enough. The feature keeps `codegraph_explore` as the primary context tool, while adding a deliberately scoped Cypher path for graph-shaped questions.

## Non-goals

- Full openCypher support.
- Writes, arbitrary SQL, or mutation paths.
- Replacing `codegraph_explore`.
- Network calls or external evaluation as part of normal operation.
- Schema migrations or data migrations.

## Review order

1. Contracts, public types, and serializer behavior.
2. Parser, planner, and runtime execution boundaries.
3. CLI routing, diagnostics, and explicit search escape hatch.
4. MCP tool exposure, tool annotations, and guidance.
5. Tests, docs, evidence matrix, and PR packet.

Delivery route: one navigable PR. The work includes two internal slice checkpoints: Slice 1 for bounded path/query foundations, and Slice 2 for aggregation, string predicates, recipes, and surface parity. `gh stack` is not applicable; no stack proof is manufactured.

## Scope budget and reviewability

- Current `origin/main` diff: 39 files, `+15292/-1458`, net `+13834`.
- This includes generated process/spec evidence.
- Production entries: 7.
- `src/query/cypher/index.ts` is 3995 lines, materially above the planning estimate. That is a candid reviewability warning; review parser/planner/runtime sections deliberately rather than treating it as a small patch.

## Traceability

- Functional requirements: FR-001 through FR-032 are tracked in `specs/013-cypher-query-access/evidence-matrix.md`.
- Success criteria: SC-001 through SC-010 are tracked in the same matrix.
- Recipe, guardrail, live UAT, and parity rows are recorded in the matrix with reviewer/date/artifact fields.

## Verification

- `npm run build`: pass.
- `npm run typecheck`: pass.
- `npm test`: pass, 266 files passed, 4810 tests passed, 181 skipped.
- Focused final guardrail suite: pass, 130 tests.
- Live self-index UAT: 939 files, 16980 nodes, 72612 edges.
- Twelve documented recipes: package = CLI = MCP bytes for all recipes; MCP results are success-shaped.
- Final parity hashes recorded in the matrix:
  - valid: `2205b01b3f2ea841fae136eca833cdbe5a1e030b3d93f6a2ce27de545d78537d`
  - empty: `71b30786b00cca61dad730f6551f534f7215885240e478d8a04f90e3a21ef6ea`
  - capped: `57ebee126f297e2c8612ad0b3284c20bb21b3209de5a688a055ca445dc4ef292`
  - syntax: `f4230f0e605bd9a1ae342d9668b5fc2a7f8b03c1de9981a9855828733c404f3f`
  - unsupported: `9ed5005a573223decc9b0163fac2741f712d154efdc35691e7671791fca13246`
  - oversized: `3f5921a90eb0ec7795909317ec3e99a98573da56c7c6b7234e2d70e23b43a67c`
  - payload: `8a7bf59417d0a792dddb44131a531080e14c19ab9dd5fd3a8648be9b27efd668`
  - timeout: `c6bcb2eeae3bb90bb94c686694a3c0fffd6af95f579f431b6d2dd2ee2aae98e6`
  - not-indexed: `42869ec8f189cbcaf06300cde18f370505334d543dbe818a921c7fedda1795d3`
  - malformed stdin CLI-only boundary: `234b465edbc85750eaa672c2f579fbe4a812355fb3be7185bfcefecf4e00001f`

## Known gaps and caveats

- Retrieval A/B is `BLOCKED_BY_AUTHORIZATION`. External runs: 0. External sends: 0. Cost: 0.
- The stored status includes a pre-existing csharp LSP server crash. It did not block live UAT.
- No hidden claim is made for external retrieval validation or gh-stack proof.

## Rollback and flag notes

- Rollback is a normal PR revert.
- No schema migration or data migration is included.
- Runtime behavior is local, read-only, and dormant until invoked.
- MCP allowlisting can constrain the exposed tool surface.
- No feature flag was added.
