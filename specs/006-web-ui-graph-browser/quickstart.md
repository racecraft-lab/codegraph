# Quickstart: Web UI Graph Browser Validation

## Prerequisites

- Node version accepted by the repo engine range: `>=20.0.0 <25.0.0`.
- Existing CodeGraph build and test prerequisites.
- At least one local repository initialized/indexed by CodeGraph for manual UAT.
- For final SPEC-006 dogfood UAT, run at least one full pass against this CodeGraph repository as the indexed self-repo fixture.
- Optional SPEC-018 endpoint config for configured-chat UAT:
  - `CODEGRAPH_LLM_PROVIDER=endpoint`
  - `CODEGRAPH_LLM_URL`
  - `CODEGRAPH_LLM_MODEL`
  - `CODEGRAPH_LLM_API_KEY` when required by the endpoint

Provider config remains backend-only. Do not enter provider secrets in the browser.

## Local Development Validation

1. Install dependencies from the repository root.

```bash
npm install
```

2. Initialize and build the web app after implementation tasks create `web/`.

```bash
npm --prefix web install
npm --prefix web run build
```

3. Run repository verification.

```bash
npm run build
npm run typecheck
npm test
```

Expected outcome:

- TypeScript succeeds.
- Vitest suites pass.
- `dist/web/index.html` and `dist/web/assets/` exist after the integrated build/copy step.

## Browser UAT: Repo, Search, Symbol, Graph

1. Start the local web server.

```bash
node dist/bin/codegraph.js serve --web --path <indexed-repo>
```

2. Open the printed local URL.

3. Validate the primary path:

- The app opens directly to the graph-browsing tool surface.
- Repo switcher/status is visible.
- Search finds a known symbol.
- Opening a symbol shows metadata, source context, and relationship summaries.
- Graph view renders a nonblank neighborhood.
- Pan, zoom, fit/reset, filter, select/focus, and expand controls are visible and keyboard-operable.
- A non-canvas selected-node/neighbor summary remains available.

Expected outcome:

- Repository context remains visible.
- Empty, stale, unavailable, loading, truncated, and error states do not erase the shell.
- No critical text overlap or unreachable primary controls on desktop or mobile viewport checks.

## Browser UAT: Impact And Re-analysis

1. Select a symbol with known downstream usage.
2. Open the impact view.
3. Trigger re-analysis for an eligible repository.
4. Observe progress until terminal success or failure.

Expected outcome:

- Impact shows affected symbols/files or an explicit unavailable/truncated state.
- Re-analysis prevents duplicate ambiguous starts while active.
- SSE progress shows snapshot, progress, heartbeat tolerance, and terminal state.
- Repository freshness updates after completion.

## Browser UAT: Performance

Validate the NFR thresholds with Playwright traces, browser performance marks, or equivalent instrumentation.

Expected outcome:

- Repository selection, search submission, symbol opening, graph opening, re-analysis start, and chat submission show visible feedback within 100 ms.
- Search results and symbol details render within 500 ms after successful local API responses on a representative indexed repo.
- Representative graph payloads up to 500 nodes and 1,000 edges produce a nonblank canvas or documented summary-first fallback within 2,000 ms after receipt.
- Graph interactions avoid validation-visible main-thread stalls over 100 ms.
- Re-analysis accepted starts and received SSE events are reflected within the NFR thresholds, with stalled or disconnected streams surfaced.
- Build or package evidence records JS/CSS asset sizes and documents any accepted runtime asset over 1.5 MB uncompressed.

## Browser UAT: Chat

Validate three chat states:

1. Dormant or disabled: run without `CODEGRAPH_LLM_*` endpoint activation.
2. Misconfigured: set an incomplete endpoint config.
3. Configured endpoint or agent mode: use a valid SPEC-018 setup, or agent mode where available.

Expected outcome:

- Browser sends only same-origin `/api/chat/*` requests.
- Browser request contains repo id, prompt, and selected symbol/view hints only.
- Browser never sends or receives provider URL, model, API key, provider bearer token, raw provider response body, or secret surrogate.
- Disabled, dormant, misconfigured, pending-bundle, fallback, answer, and error states are visually distinct.
- Chat responses include visible graph-context boundaries or truncation metadata.

## Package And Offline Validation

1. Build the package assets.

```bash
npm run build
```

2. Serve the built app.

```bash
node dist/bin/codegraph.js serve --web --path <indexed-repo>
```

3. Use browser network inspection or Playwright network interception.

Expected outcome:

- `dist/web/index.html` serves for `/` and extensionless browser routes.
- `/api/*` routes return API responses or API errors, never `index.html`.
- Missing asset-extension URLs return 404.
- No external CDN, hosted asset, hosted auth, hosted database, remote telemetry, or direct provider request is made by the browser.
- All runtime assets load from the local backend.

## Container Or Non-loopback Guidance Validation

Use existing server options and auth behavior only:

```bash
node dist/bin/codegraph.js serve --web --host 0.0.0.0 --port 8080 --path <indexed-repo>
```

Expected outcome:

- Non-loopback `/api/*` access follows existing `CODEGRAPH_SERVER_TOKEN` rules.
- Static shell serving does not weaken API auth.
- Documentation explains host, port, and token requirements without adding hosted auth or a production Dockerfile requirement.

## Clean-room Verification

Before PR:

- Confirm `research.md` contains the GitNexus README/license source ledger.
- Confirm no GitNexus source, assets, screenshots, UI text, visual design, CSS, or implementation structure were inspected or copied.
- Confirm parity gaps are marked implemented, deferred, backend-blocked, or out of scope.

Expected outcome:

- PR evidence can trace clean-room parity only to allowed README/license URLs and original CodeGraph implementation files.

## Self-Repo Dogfood UAT

Run one final UAT pass with this repository as the indexed target:

```bash
node dist/bin/codegraph.js serve --web --path .
```

Expected outcome:

- Repository selection, search, symbol detail, graph, impact, re-analysis, chat state handling, package/offline behavior, accessibility, and performance checks run against the CodeGraph repository itself.
- Results are recorded in `specs/006-web-ui-graph-browser/review-packet.md`.

## Validation Evidence (2026-07-15)

Environment:

- Worktree: `.worktrees/006-web-ui-graph-browser`
- Node: `24.11.1`
- Indexed self-repo fixture: 712 files, 10,187 symbols, 42,483 edges after final browser-triggered sync

Automated checks:

- `npm --prefix web run test`: passed after the MCP UAT fix with 17 files and 19 tests.
- `npm --prefix web run test -- src/tests/reindex-panel.test.tsx`: passed after the MCP UAT found the terminal-snapshot recovery issue; 1 file, 2 tests.
- `npm --prefix web run typecheck`: passed.
- `npm --prefix web run test:e2e`: passed with 13 Playwright tests.
- `npm exec -- vitest run __tests__/server-chat-adapter.test.ts __tests__/server-openapi-contract.test.ts __tests__/package-web-assets.test.ts __tests__/server-reindex-jobs.test.ts`: passed with 99 tests.
- `npm run build`: passed after the final UI fixes and copied `web/dist` into `dist/web`; Vite reported a 967.53 kB minified JS chunk, which is below the SPEC-006 1.5 MB uncompressed runtime-asset threshold.

Packaged server and Playwright MCP browser UAT:

- `node dist/bin/codegraph.js serve --web --port 0 --path .`: passed from the packaged `dist/` app.
- Browser title and favicon were corrected from the scaffold defaults to `CodeGraph` with no missing `/vite.svg` request.
- `/`, `/search?q=startWebServer`, `/symbol/<startWebServer>`, `/graph/<startWebServer>`, `/impact/<startWebServer>`, `/chat`, and `/reindex` were opened through Playwright MCP against the live self-repo backend.
- Search returned 17 `startWebServer` matches; symbol detail rendered signature, callers, callees, flows, and clusters.
- Graph route rendered the toolbar, summary, and nonblank Cytoscape canvas layer with 356 nonblank sampled points out of 7,055 sampled points.
- Impact route rendered 20 affected symbols and 161 graph edges.
- Chat route rendered the expected dormant state with no provider configured and no browser provider-secret exposure.
- Re-analysis route accepted an incremental sync, recovered from EventSource close via the latest terminal snapshot, and rendered `done` with `Checked 712 files; 0 changed; updated 0 nodes.`
- Mobile MCP check at 390x844 reported no horizontal overflow (`scrollWidth` 375, `innerWidth` 390) on the search results route.
