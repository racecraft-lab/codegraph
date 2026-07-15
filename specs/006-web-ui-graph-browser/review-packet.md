# SPEC-006 Review Packet

## Review Order

1. Package and server seams: `package.json`, `scripts/copy-web-assets.mjs`, `src/server/static.ts`, `src/server/index.ts`, `src/server/chat.ts`, `src/server/openapi.yaml`.
2. Web foundation: `web/index.html`, `web/src/app/`, shared API clients, layout, and state components.
3. User workflows: repository status, search, symbol detail, relationships, graph, impact, re-analysis, and chat.
4. Validation and docs: Playwright specs, Vitest coverage, `docs/web-server.md`, `README.md`, `CHANGELOG.md`, and this packet.

## Scope Budget

- SPEC-006 was accepted as a one-spec split exception with three review slices: foundation/search/symbol, graph canvas, and impact/reindex/chat/package validation.
- Runtime behavior remains local-first: no browser-side indexing, no Cypher backend, no hosted web service, and no browser provider secrets.
- Packaged assets are copied into `dist/web/`; `/api/*` remains JSON-only and is not swallowed by SPA fallback.

## Traceability

- US1 repo/status: `web/src/components/layout/RepositorySwitcher.tsx`, `RepositoryStatus.tsx`, `RepositoryOverview.tsx`, `web/src/tests/repository-status.spec.ts`.
- US2 search/symbol: `web/src/routes/SearchRoute.tsx`, `SymbolDetailRoute.tsx`, `web/src/tests/search-symbol.test.tsx`.
- US3 relationships/flows/clusters: `RelationshipPanels.tsx`, `FlowSections.tsx`, catalog API tests.
- US4 graph: `GraphRoute.tsx`, `GraphCanvas.tsx`, `GraphToolbar.tsx`, `web/src/tests/graph-view.test.tsx`, `graph-uat.spec.ts`.
- US5 impact: `ImpactRoute.tsx`, `ImpactTables.tsx`, `impact-route.test.tsx`.
- US6 re-analysis: `ReindexRoute.tsx`, `ReindexProgress.tsx`, `server-reindex-jobs.test.ts`, `reindex-panel.test.tsx`.
- US7 chat: `src/server/chat.ts`, `web/src/components/chat/ChatPanel.tsx`, `chat-network.spec.ts`.

## Verification Evidence

- `npm --prefix web run test`: passed after the MCP UAT fix with 17 files and 19 tests.
- `npm --prefix web run test -- src/tests/reindex-panel.test.tsx`: passed after the MCP UAT fix; 1 file, 2 tests.
- `npm --prefix web run typecheck`: passed.
- `npm --prefix web run test:e2e`: passed with 13 Playwright tests.
- `npm exec -- vitest run __tests__/server-chat-adapter.test.ts __tests__/server-openapi-contract.test.ts __tests__/package-web-assets.test.ts __tests__/server-reindex-jobs.test.ts`: passed with 99 tests.
- `npm run build`: passed after final UI fixes. Vite reported a 967.53 kB minified JS chunk, below the SPEC-006 1.5 MB uncompressed runtime-asset threshold.

## Playwright MCP UAT

Packaged server command:

```bash
node dist/bin/codegraph.js serve --web --port 0 --path .
```

Evidence:

- Opened the packaged app through Playwright MCP at `http://127.0.0.1:<port>`.
- Verified title `CodeGraph`, repo picker/status, and self-repo counts.
- Opened `/search?q=startWebServer`; saw 17 matches and opened `startWebServer`.
- Symbol detail rendered signature, callers, callees, execution flows, and clusters.
- Graph route rendered toolbar and summary; Cytoscape canvas layer 2 had 356 nonblank sampled points out of 7,055.
- Impact route rendered 20 affected symbols and 161 graph edges.
- Chat route rendered dormant no-provider state with disabled submit.
- Re-analysis route accepted incremental sync and rendered terminal `done` with `Checked 712 files; 0 changed; updated 0 nodes.`
- Mobile check at 390x844 showed no horizontal overflow: `scrollWidth=375`, `innerWidth=390`.

The MCP pass found one real issue: quick terminal EventSource close left the UI on `Disconnected` even though `GET /api/reindex/:repo` had a terminal `done` snapshot. Fixed in `ReindexRoute.tsx` by polling the latest job on disconnect and covered in `reindex-panel.test.tsx`.

## Known Gaps

- Configured endpoint chat was not exercised with real provider credentials in this pass; dormant/no-provider and no-browser-secret boundaries were validated.
- The Vite default chunk warning remains. The built JS asset is below the accepted SPEC-006 threshold, so no code splitting was added in this slice.
- Full `npm test` has a known local Git signing hazard from inherited machine config; focused affected suites and web suites were run. A temporary `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false` override was previously validated for the affected Git-signing case.

## Rollback Notes

- Disable the browser app by reverting `copy-web-assets`, the `web/` workspace, and the static mount changes; `/api/*` contracts should remain independently reviewable.
- Remove the chat adapter by reverting `src/server/chat.ts`, its route wiring, and the OpenAPI chat paths.
- Re-analysis recovery is isolated to `web/src/routes/ReindexRoute.tsx` and `web/src/components/reindex/ReindexProgress.tsx`.

## Clean-Room Ledger

- Allowed sources: GitNexus public README and LICENSE behavior inventory only.
- Prohibited sources: GitNexus source code, assets, screenshots, UI text, CSS, visual design, and implementation structure.
- Implemented parity is behavior-level only: local graph browser, search, graph exploration, impact-style inspection, and chat-like graph question states.
- Deferred/out of scope: browser-side indexing, Cypher backend, hosted demo, and production Docker image.
