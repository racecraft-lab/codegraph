# Contract: LSP Config and Activation

## Scope

This contract defines how SPEC-008 activates LSP precision, reads project configuration, applies machine-local overrides, and bounds watch verification.

## CLI Activation

| CLI input | Effective result |
|---|---|
| `codegraph index` | LSP disabled unless `codegraph.json.lsp.enabled === true` |
| `codegraph index --lsp` | LSP enabled for this run |
| `codegraph index --no-lsp` | LSP disabled for this run, even when project config enables it |

CLI activation applies only to commands that run indexing or sync-like verification paths. Status output may report configured and detected LSP state without enabling verification.

## Project Configuration

`codegraph.json` accepts a top-level `lsp` object.

```json
{
  "lsp": {
    "enabled": true,
    "defaultTimeoutMs": 5000,
    "watch": {
      "enabled": true
    },
    "servers": {
      "typescript": {
        "command": ["typescript-language-server", "--stdio"],
        "timeoutMs": 5000
      }
    }
  }
}
```

### Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `lsp.enabled` | boolean | no | Project-level opt-in when no CLI enable/disable is supplied |
| `lsp.defaultTimeoutMs` | positive integer | no | Default timeout for LSP requests |
| `lsp.watch.enabled` | boolean | no | Allows incremental watch verification when LSP is effectively enabled |
| `lsp.servers.<language>.command` | string array | no | Command argv for one language server |
| `lsp.servers.<language>.timeoutMs` | positive integer | no | Timeout for one language server |

Language keys use CodeGraph language ids: `javascript`, `typescript`, `python`, `java`, `c`, `cpp`, `csharp`, `go`, `ruby`, `rust`, `php`, `kotlin`, `swift`, `dart`, and `vue`.

## Environment Overrides

| Variable | Value type | Meaning |
|---|---|---|
| `CODEGRAPH_LSP_<LANG>_COMMAND_JSON` | JSON string array | Overrides command argv for one language |
| `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS` | positive integer string | Overrides timeout for one language |
| `CODEGRAPH_LSP_TIMEOUT_MS` | positive integer string | Overrides default timeout |

Environment overrides cannot activate LSP precision. Invalid JSON, non-array command values, non-string command elements, and invalid timeout values warn and fall back to the next lower-precedence value.

## Precedence

Activation precedence:

1. Explicit CLI enable/disable.
2. `codegraph.json.lsp.enabled === true`.
3. Default off.

Command precedence:

1. `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`.
2. `codegraph.json.lsp.servers.<language>.command`.
3. Registry default command.

Timeout precedence:

1. `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`.
2. `codegraph.json.lsp.servers.<language>.timeoutMs`.
3. `CODEGRAPH_LSP_TIMEOUT_MS`.
4. `codegraph.json.lsp.defaultTimeoutMs`.
5. Registry/default timeout.

## Watch Bounds

LSP watch verification runs only when all conditions hold:

- LSP is effectively enabled.
- `lsp.watch.enabled` is not explicitly false.
- The normal sync/watch pipeline has completed structural extraction and reference resolution.
- The change set is bounded to explicit changed files.
- The changed files map to languages with available LSP servers.

When the changed-file set is absent or unbounded, watch verification is skipped and status records the reason.

## Performance Bounds

When LSP is disabled for `index`, `sync`, or watch-triggered sync, the LSP runtime path is dormant: no server command probing, no server subprocess startup, no JSON-RPC messages, no LSP status/correction/audit writes, and no LSP graph mutations.

When LSP is enabled, SPEC-008 uses fixed default runtime bounds:

| Bound | Default |
|---|---:|
| Active language-server sessions per project | 2 |
| In-flight definition/reference requests per session | 8 |
| Full-index source files per language | 2,000 |
| Full-index candidate work items per language | 10,000 |
| Full-index LSP batch size | 250 work items |
| Watch changed source files per bounded batch | 100 |
| Watch candidate work items per language per batch | 1,000 |

Exceeded full-index bounds skip the excess LSP work for that language with `full-index-file-cap-exceeded` or `full-index-work-cap-exceeded`. Exceeded watch bounds use the watch skip reasons from the status contract. Structural indexing results remain intact, and CodeGraph must not replace skipped work with an unbounded repository-wide LSP pass.

## Non-Goals Enforced by This Contract

- No auto-install of language servers.
- No auto-enable based on `PATH` detection.
- No CodeGraph-as-LSP-server behavior.
- No rename or refactor behavior.
