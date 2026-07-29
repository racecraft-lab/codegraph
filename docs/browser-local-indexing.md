# Browser-Local Indexing

## Prerequisites

- A Node version supported by the repository root `package.json`.
- Chromium for the full folder-open and reconnect path.
- Firefox and WebKit for degradation checks.
- A local fixture repository or the CodeGraph repository for scale validation.

## Development Setup

```bash
npm ci
npm run build
npm --prefix web run test
npm --prefix web run dev
```

Use the Vite development URL for local browser iteration. `localhost` is
treated as a secure context for File System Access and OPFS capability checks.

## Chromium Full Local Index

1. Open the web app in Chromium.
2. Choose the local repository mode from the repository switcher.
3. Use the folder picker to select a fixture repository.
4. Confirm indexing starts only after the user gesture.
5. Observe source-read, grammar-load, parse, store, and publish progress.
6. Verify the UI remains responsive during indexing.
7. After completion, run search, source view, graph, relationship, and impact
   queries from the existing routes.

Expected result:

- No repository-derived, external-origin, daemon, WebSocket, beacon, or
  embedding request occurs before semantic opt-in. Only enumerated same-origin
  shipped assets may load.
- A local repository appears with ready status.
- Query results use the same response shapes as daemon-backed repositories.
- Oversized, binary, ignored, and unsupported files appear as warnings without
  failing the whole index.

## Reconnect, Refresh, Cancel, And Delete

1. Reload the page after a successful Chromium index.
2. Reconnect the stored handle after a user gesture if permission is `prompt`.
3. Refresh the repository after changing a fixture file.
4. Start another refresh and cancel it before publish.
5. Delete the local repository.

Expected result:

- Reconnect does not require selecting the folder again when permission is
  granted.
- Refresh publishes a new generation atomically.
- Cancel keeps the previous generation readable.
- Delete removes registry data, source cache, graph database files, and
  vectors.

## Snapshot Or Unsupported Browser Flow

1. Open the app in Firefox or WebKit.
2. View the capability report for folder picker, OPFS, Web Locks, module
   worker, and WASM.
3. Use drag/drop or import snapshot only when supported by detected
   capabilities.
4. Try search/source/graph reads after snapshot indexing if the browser
   supports enough local storage and worker capabilities.

Expected result:

- Unsupported full-folder controls are disabled or replaced by snapshot
  actions.
- Missing capabilities produce clear recoverable states.
- Browser-name checks are not used as the source of truth.

## Semantic Indexing Opt-In

1. Complete a keyword/static graph index.
2. Enable optional semantic indexing explicitly.
3. Enter a direct HTTPS endpoint and model profile.
4. Provide an API key for the current session only.
5. Start vector generation while continuing to use keyword search, graph, and
   impact reads.
6. Reload the page and verify the profile persists without the key.

Expected result:

- Semantic indexing starts only after explicit consent and never disables the
  completed keyword index.
- API keys are never written to IndexedDB, OPFS, localStorage, sessionStorage,
  or URL state.
- HTTP endpoints from secure pages, URL userinfo, query-string secrets,
  fragments, CORS failures, TLS failures, and mixed-content failures produce
  stable redacted errors.

## Packaged Asset Validation

```bash
npm run build
```

Then serve the packaged web app from `dist/web` through the project server path
and verify:

- The local-indexing worker loads from the packaged app.
- SQLite WASM loads.
- `tree-sitter.wasm` loads.
- Required grammar WASM assets load.
- Routes do not depend on Vite dev-server-only paths.
- The browser can continue local search, graph, and impact reads after network
  access is disabled once the app and required same-origin assets are loaded.

For a trusted HTTPS static host, serve all files from the same origin. The
validated minimum policy is:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'
```

Add an explicitly approved semantic endpoint origin to `connect-src` only when
that optional endpoint is used. The selected SQLite SAH-pool path does not
require COOP or COEP headers.

## Verification Commands

```bash
npm run build
npm test
npm --prefix web run test
npm --prefix web run test:e2e -- --project=chromium src/tests/local-indexing-full.spec.ts
npm --prefix web run test:e2e -- --project=chromium src/tests/local-indexing-network.spec.ts src/tests/local-indexing-packaged.spec.ts
npm --prefix web run test:e2e -- --project=firefox --project=webkit src/tests/local-indexing-degradation.spec.ts
```

Expected result:

- Build succeeds and copies shipped static assets.
- Root tests cover shared schema migration and extraction-kernel parity.
- Web tests cover worker protocol, repository-client routing, capability
  detection, no-default-network behavior, semantic opt-in, and UI status.
- Chromium UAT meets the self-repository scale target.
- Chromium network/package tests cover true-offline local reads, no-consent
  egress, trusted-host CSP, fail-closed assets, and lazy same-origin requests.
- Firefox/WebKit tests verify graceful degradation rather than full feature
  parity.

## Benchmark Capture

Capture these values after implementation:

- Browser, version, OS, and hardware class.
- File, node, edge, skipped, and warning counts.
- Cold-index and warm-refresh duration.
- Search, graph, and impact p95 latency after warmup.
- Main-thread heartbeat maximum gap during indexing.
- OPFS quota estimate before and after indexing.

Acceptance targets:

- The CodeGraph repository keyword-only index completes within 60 seconds on
  reference hardware.
- Local read p95 stays below 150 ms after warmup.
- No default network request appears before semantic opt-in.
