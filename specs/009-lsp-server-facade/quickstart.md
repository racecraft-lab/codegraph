# Quickstart: Validate the LSP Server Facade

This guide is the implementation/UAT target. Commands run from the SPEC-009
worktree with repository-pinned Node 24.11.1.

## Prerequisites

```bash
nvm use 24.11.1
npm install
npm run build
npm run typecheck
```

The target repository must already be initialized and indexed. The feature never
auto-initializes or auto-indexes.

## Slice 1: Core and Stdio

Run focused behavior and black-box conformance:

```bash
npx vitest run __tests__/lsp-server.test.ts
npx vitest run __tests__/lsp-stdio-black-box.test.ts
```

Expected evidence:

- a built `node dist/bin/codegraph.js lsp .` process accepts standard
  Content-Length JSON-RPC over stdin/stdout
- initialize advertises only UTF-16 read capabilities and the experimental
  CodeGraph content method
- definition, references, hover, document symbols, workspace symbols, and
  source content return deterministic graph/snapshot-backed results
- ambiguous positions return null/empty and unsupported writes return `-32601`
- malformed JSON in a valid frame returns `-32700`, while invalid framing exits
  nonzero without corrupting stdout
- shutdown/exit, EOF, signals, and stream failure release the daemon lease and
  leave no orphan process

Verify the slice:

```bash
npm run build
npm run typecheck
npm test
```

## Slice 2: WebSocket and Viewer

Run focused server/browser tests:

```bash
npx vitest run __tests__/lsp-websocket.test.ts
npm --prefix web exec vitest run -- src/tests/source-pane.test.tsx
npm run test:web
```

Expected server evidence:

- `/lsp?repo=<id>` rejects invalid Host/Origin before repository lookup
- absent Origin works only for otherwise-valid scripted local clients
- malformed text uses JSON-RPC errors; binary/UTF-8/oversize use 1003/1007/1009
- request 17 is rejected without queueing, five-second requests settle once,
  2 MiB backpressure drains or closes 1013, and late results are discarded
- disconnect, daemon loss, and shutdown release only the owning session while an
  unrelated session remains usable

Expected browser evidence:

- no WebSocket exists until Open source is activated
- source opens on the selected symbol and preserves existing symbol metadata
- keyboard and pointer select the same token; named hover/definition actions are
  usable with visible focus
- exact definitions and grouped references push repo-relative URL state;
  back/forward restores without leaking a file URI or absolute path
- empty, stale, unavailable, timeout, disconnected, and manual Retry states are
  truthful and announced accessibly
- closing/unmounting/changing repository tears down work; no state reconnects in
  the background

## Packaged Local UAT

Start the packaged server from one terminal:

```bash
node dist/bin/codegraph.js serve --web --path . --port 11235
```

Open `http://127.0.0.1:11235`, select this repository, open a symbol, and choose
Open source. Record:

1. Source selects the indexed symbol range.
2. Hover metadata contains only persisted fields.
3. Go to definition and a reference navigate the same pane.
4. Browser Back and Forward restore both locations.
5. Keyboard-only use reaches active token, hover, definition, references, and
   Retry without a per-token tab sequence.
6. Closing the pane closes the socket; reopening creates one fresh session.

Run browser/package UAT:

```bash
npm --prefix web exec playwright test -- src/tests/source-viewer-uat.spec.ts
npm --prefix web exec playwright test -- src/tests/package-offline.spec.ts
```

## Stale and Unavailable UAT

On a disposable indexed fixture, modify a source file without syncing and retry
that file through the viewer. Expected: `stale`, no old/new source mixing, and a
re-index instruction. Stop the fixture daemon or disconnect its socket. Expected:
the source pane becomes unavailable/disconnected, the rest of symbol detail stays
usable, and only explicit Retry starts another connection.

## Final Verification

```bash
npm run build
npm run typecheck
npm test
npm run test:web
```

Also record:

- `retrieval-guardian` review for the additive `src/mcp/read-ops.ts` change
- package dependency audit confirming `ws` has no required native addon
- package/offline evidence showing zero external requests
- self-repo stdio and browser UAT evidence
- no `.envrc.local`, `.codegraph/`, token, source, path, or snapshot value in the
  committed diff or logs
