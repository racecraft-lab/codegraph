# Contract: Repository-Bound LSP

## Transport-Neutral Envelope

JSON-RPC 2.0 requests use string or number IDs. Notifications have no ID and
never receive a response. Batch arrays are not supported and are Invalid Request.

## Lifecycle

| State | Accepted messages | Other requests | Other notifications |
|---|---|---|---|
| created | `initialize` request; `exit` notification | `-32002` | ignored |
| initialized | allowlisted reads; `shutdown` request; `exit` | `-32601` when unsupported | ignored |
| shutdown | `exit` notification | `-32600` | ignored |
| terminated | none | no response | no response |

Duplicate initialize is `-32600`. Exit status is 0 after shutdown and 1
otherwise. EOF, signal, fatal framing, or transport loss terminates and cleans
pending work.

## Initialize

Every supplied non-null `workspaceFolders[].uri`, `rootUri`, and legacy
`rootPath` is canonicalized and validated against the prebound repository.
Workspace folders are the preferred effective field, then rootUri, then
rootPath; precedence never exempts another supplied value from validation.
Absent roots are valid. Invalid/non-file/conflicting/mismatched/multi-root input
is `-32602`.

Capabilities:

```json
{
  "positionEncoding": "utf-16",
  "definitionProvider": true,
  "referencesProvider": true,
  "hoverProvider": true,
  "documentSymbolProvider": true,
  "workspaceSymbolProvider": true,
  "experimental": {
    "codegraphTextDocumentContent": {
      "method": "codegraph/textDocumentContent",
      "version": 1
    }
  }
}
```

`textDocumentSync` and diagnostics are not advertised.

## Read Allowlist

### `textDocument/definition`

Input: standard text document position params.

Result: one exact target declaration `Location` or `null`. Exact covering
evidence may collapse only when all candidates resolve to the same stable target.

### `textDocument/references`

Input: standard reference params.

Result: `Location[]`, deduplicated and ordered by normalized URI plus complete
range before a 500-result cap. Occurrence ranges come from located semantic
edges. The target declaration is added only when `includeDeclaration` is true.
Structural containment and heuristic name matches are excluded.

### `textDocument/hover`

Result: `Hover` with bounded Markdown or `null`. Content may include only
persisted signature, kind, qualified name, and documentation metadata; no source
excerpt is embedded.

### `textDocument/documentSymbol`

Result: hierarchical `DocumentSymbol[]`, stable source order and deterministic
parent-before-child traversal, capped at 500 after deduplication/order.
Truncation cannot retain an orphaned child.

### `workspace/symbol`

Result: `SymbolInformation[]`, capped at 100 after full order: existing search
rank, qualified name, normalized URI, and complete range.

### `codegraph/textDocumentContent`

This is a CodeGraph experimental extension, not LSP 3.18's standardized
`workspace/textDocumentContent` method.

Params:

```json
{
  "textDocument": {
    "uri": "file:///canonical/indexed/file.ts"
  }
}
```

Result:

```json
{
  "text": "bounded UTF-8 source",
  "languageId": "typescript",
  "contentHash": "opaque-persisted-hash",
  "snapshotToken": "opaque-equality-token"
}
```

`snapshotToken` is stable for one indexed snapshot, changes when that indexed
snapshot/version changes, is non-secret, and is forbidden from URLs/logs.

## Position Contract

- Returned positions are zero-based UTF-16 and ranges are half-open.
- Incoming character offsets beyond line length normalize to line end.
- Outgoing graph-native columns are converted only against the hash-matching
  source snapshot and exact token evidence.
- Ambiguous or unprovable boundaries return the method-appropriate null/empty or
  typed content error; never approximate.

## Error Vocabulary

| Code | Name | Use |
|---:|---|---|
| `-32700` | Parse Error | Valid message boundary, malformed JSON. |
| `-32600` | Invalid Request | Invalid JSON-RPC envelope or lifecycle state. |
| `-32601` | Method Not Found | Unsupported initialized-state request. |
| `-32602` | Invalid Params | Malformed params, roots, or URI scheme. |
| `-32002` | Server Not Initialized | Read before initialize. |
| `-32801` | Content Modified | Verified disk/index hash drift. |
| `-32803` | Request Failed | Safe operational failures, overload, or timeout. |

`-32803` content `data.reason` is one of `not_found`,
`outside_repository`, `unindexed`, `not_regular`, `too_large`, or `unreadable`.
Transport overload and deadline use `overloaded` and `timeout`. Error messages
and data are bounded/redacted and never echo paths, params, source, hashes, or
raw causes.

## Determinism and Read-Only Rule

The dispatcher has no default route to an implementation method. Every
allowlisted method maps to one typed read handler. Unsupported requests cannot
reach rename, format, edit, indexing, diagnostics, external-LSP, or filesystem
write paths. Identical snapshot/input produces byte-stable semantic results on
stdio and WebSocket.
