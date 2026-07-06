# Slice 1 Validation

## Scope

Completed tasks: T019-T037.

Slice 1 proves explicit LSP opt-in, default-off behavior, JSON-RPC stdio
lifecycle, status rendering, and one complete TypeScript/JavaScript precision
path.

## Commands

```text
npm test -- __tests__/lsp-disabled.test.ts __tests__/lsp-client.test.ts __tests__/lsp-precision-pass.test.ts
```

Result: 3 files passed, 14 tests passed.

```text
npx vitest run __tests__/lsp-disabled.test.ts __tests__/lsp-config.test.ts __tests__/lsp-client.test.ts __tests__/lsp-precision-pass.test.ts __tests__/lsp-status.test.ts __tests__/lsp-real-server-validation.test.ts
```

Result: 6 files passed, 24 tests passed.

```text
npm run typecheck
```

Result: passed.

```text
npm run build
```

Result: passed.

```text
git diff --check
```

Result: passed.

## Real-Server Validation

```text
node scripts/spec-008-validate-real-servers.mjs --slice us1
```

Result: passed.

| Language | Command | Resolved Path | Observed Version | SDK Evidence |
|----------|---------|---------------|------------------|--------------|
| TypeScript | `typescript-language-server --version` | `/opt/homebrew/bin/typescript-language-server` | `5.3.0` | `node_modules/typescript/package.json` |
| JavaScript | `typescript-language-server --version` | `/opt/homebrew/bin/typescript-language-server` | `5.3.0` | `node_modules/typescript/package.json` |

Coverage summary: 2 verified, 0 missing, 0 future-owned, 0 unowned.

## Evidence

- `codegraph index` remains default-off; disabled index, sync, and watch-triggered sync paths record no LSP status or `lsp` provenance.
- `codegraph index --lsp` and `codegraph index --no-lsp` activation precedence is covered, including last-flag-wins CLI behavior.
- `LspJsonRpcClient` covers initialize, request routing, timeout rejection, shutdown/exit, stdout framing, stderr buffering, process exit rejection, and malformed response handling.
- The TypeScript/JavaScript precision pass selects existing structural candidates after reference resolution and marks only matching in-workspace targets as `lsp`.
- LSP status serialization preserves activation source, observed server evidence, coverage, edge counts, performance, and warnings.
- `codegraph status --json` reads persisted LSP status, and human status renders LSP state without starting servers.
- The real-server helper validates TypeScript and JavaScript server availability and TypeScript SDK evidence.
- Restricted-name scrub passed with no matches.
- Outbound-link scrub for SPEC-008 artifacts passed with no matches.

## Scope Budget

Slice 1 changed the intended activation, client, status, validation, and first
precision-pass surfaces. It also added minimal database helpers in
`src/db/queries.ts` so T030 can locate existing targets and mark verified
edges without creating new graph nodes.

## Non-Goals Preserved

- No language servers are installed by CodeGraph.
- LSP is not auto-enabled when a server is present on PATH.
- CodeGraph is not exposed as an LSP server.
- Rename/refactor behavior is not implemented.
- Missing or crashed servers remain a per-language degradation path for later
  slices, not a whole-index failure.

## Rollback

Disable LSP by omitting `--lsp`, passing `--no-lsp`, or setting
`codegraph.json.lsp.enabled` to `false`. Existing structural extraction and
reference resolution remain the fallback.

## Known Gaps

- US2 still owns full project/environment command and timeout override behavior.
- US3 still owns broader degradation, restart, and cap-enforcement behavior.
- US4 still owns correction/suppression semantics, retrieval regression probes,
  remaining real-server rows, bounded watch verification, parity gates, and
  self-repo dogfood.
