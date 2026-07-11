# Contract: `codegraph rename` CLI command

Commander subcommand added to `src/bin/codegraph.ts` (additive). Drives the `src/refactor/` engine through the thin `CodeGraph` entry points. Backs FR-001/FR-006/FR-014/FR-015/FR-026/FR-027.

## Synopsis

```
codegraph rename <target> <new-name> [options]
```

- `<target>` — required. A symbol name, optionally qualified `Class.method` (FR-006).
- `<new-name>` — required. The replacement identifier.

## Options

| Flag | Slice | Type | Default | Meaning |
|---|---|---|---|---|
| `--file <path>` | 1 | string | — | Narrow the target to one file (qualifier). |
| `--kind <kind>` | 1 | string | — | Narrow the target to one NodeKind (qualifier). |
| `-j, --json` | 1 | boolean | false | Emit the plan as the stable JSON schema (`rename-plan.schema.json`) instead of the human table. Byte-identical to the MCP result (SC-005). |
| `--apply` | 2 | boolean | false | Recompute the plan from the live index and execute the apply safety ladder (FR-014). **Absent in a Slice-1 build** — a Slice-1 binary rejects `--apply` with commander's standard unknown-option error (Assumptions), not a bespoke refusal. |
| `--include-heuristic` | 2 | boolean | false | Permit apply when the plan contains `heuristic`-tier edits (FR-015). No effect on a dry-run. |
| `--path <dir>` | 1 | string | cwd | Project root (existing global convention; shown for completeness). |

Slice 1 ships **only** `--file`, `--kind`, `-j/--json`, `--path`. `--apply`/`--include-heuristic` arrive with the Slice-2 apply engine.

## Default behavior (dry-run — FR-001)

With no `--apply`, the command **always** produces a plan and writes nothing. Default output is a human-readable table grouped by file: each group lists the file path, and per edit the range, a before/after preview, and the per-edit confidence tier; the footer shows the aggregate confidence and (when computed) the leftover-mention FYI count (FR-002/FR-027). `-j/--json` emits the schema object instead.

## Exit codes (FR-026)

| Code | State | Reachable in |
|---|---|---|
| `0` | A dry-run plan was produced, **or** an `--apply` completed post-check-green. The two success states deliberately share `0` (the caller knows whether it passed `--apply`; a non-zero for the common dry-run success would break shell chaining). | Slice 1 (dry-run) / Slice 2 (apply) |
| `1` | Unexpected internal or usage error. | Slice 1 & 2 |
| `2` | A recoverable refusal with zero writes — the CLI-native encoding of the MCP success-shaped refusals (FR-023's list: ambiguous target, unsupported/excluded kind, heuristic-gated, stale span, out-of-root, scope-ignored, not indexed, target not found). | Slice 1 (targeting/kind/not-indexed) / Slice 2 (adds gate/span/jail) |
| `3` | An apply wrote then **rolled back** byte-identically (post-check found dangling refs — FR-019). | Slice 2 only |
| `4` | A **failed rollback restore** — the sole malfunction code (FR-019a). Carries the recovery-directory report. | Slice 2 only |

The rename command MUST NOT collapse these onto the generic error→exit-1 mapping the read-only CLI commands use. Slice 1 emits only `0`/`1`/`2`.

## Examples

```
# Dry-run plan (human table)
codegraph rename oldFn newFn

# Dry-run plan as JSON (schema-stable; == MCP result)
codegraph rename UserService.save persist --json

# Ambiguity refusal (exit 2) lists candidates with selecting qualifiers
codegraph rename handle process
#   → refuses; lists e.g. "handle (method) src/a.ts:12  → rename 'Worker.handle'"

# Apply an all-exact plan (Slice 2; exit 0 on green, 3 on rollback, 4 on failed rollback)
codegraph rename oldFn newFn --apply

# Apply a plan that contains heuristic edits (Slice 2)
codegraph rename oldFn newFn --apply --include-heuristic
```

## Invariants

- CLI and MCP share one engine and one plan/apply contract; the same request yields the same plan and apply outcome on both (SC-005).
- No interactive prompt on any path (FR-008) — an ambiguous target is a refusal, never a picker.
- A rename never edits comments/docstrings/strings (FR-012/SC-008).
