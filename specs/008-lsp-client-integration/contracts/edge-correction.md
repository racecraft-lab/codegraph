# Contract: LSP Edge Verification and Correction

## Scope

This contract defines when LSP results verify, correct, suppress, skip, or degrade graph edges.

## Inputs

The precision pass consumes existing graph data after structural extraction and reference resolution:

- Candidate reference location.
- Semantic reference identity for the work item: source node, edge kind, reference document URI, reference line/character or origin range, and normalized reference name when available.
- Existing source node.
- Existing target node, when present.
- Existing edge provenance.
- Language and workspace path.
- Effective server config and session.

## LSP Requests

The precision pass may use:

- `textDocument/definition`
- `textDocument/references`

Request selection is implementation-specific, but correction rules are the same for both.

## Normalization

LSP `Location` and `LocationLink` responses normalize to:

- URI.
- Target range.
- Optional selection range.
- Workspace relation: `in-workspace`, `external`, `generated`, or `unindexed`.

Equivalent target ranges deduplicate before uniqueness checks.

## Result Rules

| LSP outcome | Graph action | Provenance action | Metadata |
|---|---|---|---|
| Exactly one normalized in-workspace target and exactly one compatible CodeGraph node matching current target | Keep active edge | Set active edge to `lsp` | Record verified count |
| Exactly one normalized in-workspace target and exactly one compatible CodeGraph node different from current target | Retarget the existing active edge or retire the old active edge and create one replacement; exactly one active edge remains for the semantic reference identity | Set surviving active edge to `lsp` | Record correction metadata |
| Exactly one normalized external/unindexed/generated target that conflicts with an active graph target | Suppress or retire the conflicting active edge; do not create a replacement active edge or external graph node | No external active edge is created | Record suppression metadata |
| Multiple normalized targets | Keep existing graph unchanged | Preserve existing provenance | Record ambiguous skip |
| No target | Keep existing graph unchanged | Preserve existing provenance | Record skipped reason |
| Server missing/crashed/timed out | Keep existing graph unchanged | Preserve existing provenance | Record degraded language |

## Correction Metadata

Every correction or suppression records:

- Affected edge id.
- Semantic reference identity.
- Language.
- Server command/display name.
- Previous target node id, when present.
- Previous provenance.
- LSP target URI and range.
- New target node id, when present.
- Reason.
- Active graph effect: verified, retargeted, replacement-created, or suppressed.
- Timestamp.

Suppressed edges must not remain active solely to preserve audit history. Suppression metadata or inactive rows are excluded from traversal, callers, callees, impact, search, and flow-building surfaces by default.

## Invariants

- Existing `null` and `heuristic` provenance semantics remain unchanged unless LSP verifies or corrects the active edge.
- Ambiguous LSP output never creates speculative replacement edges.
- External/unindexed targets never create new external graph nodes.
- Duplicate active edges for the same semantic reference identity are not emitted.
- Node and edge counts must remain stable aside from intentional correction/suppression effects, and validation records the expected count delta for every correction/suppression fixture.
