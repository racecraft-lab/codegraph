# Contract: `codegraph_rename` MCP tool

Added to the `tools` array in `src/mcp/tools.ts` (Slice 2, additive) and joined to `DEFAULT_MCP_TOOLS` (currently `new Set(['explore'])` at tools.ts:832) so it becomes the **second default-served tool** (FR-022). The first write-capable tool on the surface (explore/node are read-only). Backs FR-021/FR-022/FR-023/FR-025/FR-028.

## Identity

- **name**: `codegraph_rename`
- **description**: a short write-tool description that preserves `codegraph_explore` as the retrieval PRIMARY and states the dry-run-by-default / explicit-`apply` contract (mirrors FR-025's guidance obligation).

## Input schema (FR-021 — camelCase mirror of the CLI)

```jsonc
{
  "type": "object",
  "properties": {
    "target":          { "type": "string",  "description": "Symbol name, optionally qualified Class.method." },
    "newName":         { "type": "string",  "description": "Replacement identifier." },
    "apply":           { "type": "boolean", "description": "Execute the apply safety ladder. Default false (dry-run)." },
    "includeHeuristic":{ "type": "boolean", "description": "Permit apply when the plan has heuristic-tier edits. Default false." },
    "file":            { "type": "string",  "description": "Narrow the target to one file." },
    "kind":            { "type": "string",  "description": "Narrow the target to one NodeKind." },
    "projectPath":     { "type": "string",  "description": "Project root (shared optional convention)." }
  },
  "required": ["target", "newName"]
}
```

- `apply` / `includeHeuristic` default to `false` — side effects occur **only** on an explicit `apply: true` (FR-021, Q7).

## Annotations (FR-028 — the mirror image of `READ_ONLY_ANNOTATIONS`)

```jsonc
{
  "readOnlyHint": false,
  "destructiveHint": true,
  "idempotentHint": false,
  "openWorldHint": false
}
```

- Defines its **own** annotations object; it does NOT reference the shared `READ_ONLY_ANNOTATIONS` (whose comment at tools.ts:532-542 anticipates exactly this: "a hypothetical mutating tool would simply not reference it").
- `destructiveHint: true` — in-place overwrite of existing spans; rollback protects the *outcome*, not the *envelope* a truthful annotation must describe.
- `idempotentHint: false` — repeated `apply: true` retry-safety was never designed; MUST NOT be asserted unverified.
- `openWorldHint: false` — closed local workspace incl. locally-spawned language servers (Principle VII).
- **Accepted consequence**: a client that gates tool availability on `readOnlyHint: true` in a read-only mode (e.g. Cursor Ask mode, tools.ts:532-542 / #1018) will refuse `codegraph_rename` there — including a dry-run call — because annotations are declared once per tool, not per call, and there is no split plan-tool/apply-tool exposure (Q7 rejected MCP-is-plan-only). FR-025's guidance must make the Agent-mode requirement legible. A client that reads `readOnlyHint` for call-parallelism correctly serializes rename calls — intended for a write tool.

## Result (SC-005 — byte-identical to CLI `--json`)

Success-shaped result whose **text** payload (`textResult`, matching the repo's text-payload tool convention — `src/mcp/tools.ts` uses no `structuredContent`) is the `RenamePlan` JSON (see `rename-plan.schema.json`), canonically serialized (stable key order, UTF-8, no insignificant whitespace) so it is **byte-identical** to the CLI `-j/--json` stdout (SC-005/FR-027). Field names identical to the CLI `--json` output; `edits` (and the `candidates`/`gatedEdits`/`files` arrays) carry the deterministic ordering FR-027 pins. Each edit carries `lineText` (the source line before the edit) so the agent renders before/after without a Read (SC-001). A dry-run returns `applied: false`; an `apply: true` call returns the apply `outcome`, plus `danglingReferences` on `rolled-back` and the `recovery` object on `rollback-failed`.

## Error shaping (FR-023 — success-shaped except one malfunction)

Follows the existing `ToolHandler.execute` discipline (tools.ts:1449-1465):

| Condition | Shape | Mechanism |
|---|---|---|
| ambiguous target, unsupported/excluded kind, invalid argument (empty/invalid new name, no-op rename, unknown kind — FR-021a), heuristic-gated apply, stale span, out-of-root plan, scope-ignored plan, project not indexed, target not found | **success-shaped** guidance (`textResult`, no `isError`) carrying the `refusal` object that names the fix | like `NotIndexedError → textResult` |
| **failed rollback restore** (FR-019a) — side effects already landed, restore failed partway | **error-shaped** (`isError: true`, `errorResult`) carrying the restored/unrestored file lists and the `.codegraph/rename-recovery-<pid>-<hex>/` directory; MAY note that retrying the restore step alone is safe; MUST NOT invite re-running the rename | the sole malfunction on this surface |

`isError: true` is otherwise reserved (security refusals / real malfunctions) — reserved so agents don't abandon the tool (Principle VI; `src/mcp/CLAUDE.md`).

## Parity & no-regression invariants

- Same request ⇒ same plan and same apply outcome as the CLI (SC-005).
- Adding the tool (growing the default set 1→2) MUST NOT regress retrieval on a control repo — A/B, ≥2 runs/arm, Sonnet floor model (FR-024/SC-007). This A/B is a Slice-2 merge gate. The `retrieval-guardian` review applies (diff touches `src/mcp/`).
- The `SERVER_INSTRUCTIONS` guidance update lands in the same slice and keeps explore-first steering intact (FR-025).
