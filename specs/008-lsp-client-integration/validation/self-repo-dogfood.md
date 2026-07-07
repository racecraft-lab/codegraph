# Self-Repo Dogfood

SPEC-008 self-repo validation ran against the feature worktree:

```text
/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/008-lsp-client-integration
```

The shell's default Node version is outside CodeGraph's runtime guard, so the
commands were executed after `nvm use`, which selected Node `24.11.1` from this
worktree's `.nvmrc`.

Because the worktree is nested under the main checkout, a worktree-local
`.codegraph/` directory was created before final dogfood evidence was recorded:

```text
node dist/bin/codegraph.js init /Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/008-lsp-client-integration
```

Result: initialized the worktree-local index and indexed 425 files, 6,233
nodes, and 25,189 edges in 2.3s.

## Non-LSP Baseline (T102)

```text
node dist/bin/codegraph.js index
```

Result: passed. The structural baseline indexed 425 files, 6,233 nodes, and
25,189 edges in 2.3s.

This command did not opt into LSP precision. It preserves the default
structural extraction and reference-resolution path as the rollback baseline.

## Explicit LSP Opt-In (T103)

```text
node dist/bin/codegraph.js index --lsp
```

Result: passed. The explicit LSP run indexed 425 files, 6,233 nodes, and 25,189
edges in 2.2s.

The equal graph shape between non-LSP and LSP runs shows no duplicate active
node or edge growth from the self-repo opt-in run.

## Status Evidence (T104)

```text
node dist/bin/codegraph.js status --json
```

Result: passed. Important status fields:

| Field | Evidence |
|---|---|
| `projectPath` | Worktree path |
| `indexPath` | Worktree-local `.codegraph` |
| `worktreeMismatch` | `null` |
| `fileCount` | 425 |
| `nodeCount` | 6,233 |
| `edgeCount` | 25,189 |
| `lsp.enabled` | `true` |
| `lsp.activationSource` | `cli-enable` |
| Initialized servers | JavaScript, TypeScript, Python |
| JavaScript coverage | 30 source files, 394 candidate work items, 394 checked |
| TypeScript coverage | 208 source files, 12,001 candidate work items, 10,000 checked |
| Python coverage | 36 source files, 226 candidate work items, 226 checked |
| Cap evidence | TypeScript recorded `full-index-work-cap-exceeded` for 2,001 skipped items |
| Active session high-water | 1 |
| In-flight request high-water | 8 |
| Structural elapsed | 4,587ms |
| LSP elapsed | 1,141ms |
| Enabled overhead ratio | 1.25 |

The self-repo only contains Astro, JavaScript, Python, TypeScript, and YAML
files. The remaining SPEC-008 server rows are covered by the real-server
validation script and parity gate rather than this repository's source mix.
