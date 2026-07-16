# SPEC-006 Integration Suite Evidence

Date: 2026-07-15

Status: passed

## Commands

- `npm --prefix web run lint`
  - Result: passed with 0 errors and 6 Fast Refresh warnings from shadcn-style component exports.
- `npx vitest run __tests__/server-chat-adapter.test.ts __tests__/server-openapi-contract.test.ts __tests__/package-web-assets.test.ts __tests__/server-reindex-jobs.test.ts`
  - Result: passed, 4 files, 100 tests.
- `npm run typecheck`
  - Result: passed for root TypeScript and web TypeScript.
- `npm --prefix web run test`
  - Result: passed, 17 files, 19 tests.
- `npm run build`
  - Result: passed. Web assets were built and copied into `dist/web/`.
- `npm --prefix web run test:e2e`
  - Result: passed, 13 Playwright tests.
- `npm test`
  - Result: passed outside the sandbox with Node 24.11.1 and a temporary Git signing override for test fixtures: 233 files, 3,922 passed, 7 skipped.
- Playwright MCP packaged-browser UAT
  - Result: passed against `codegraph serve --web --port 0 --path .`.

## Playwright MCP UAT Notes

- Root route loaded with page title `CodeGraph` and repository summary.
- Search for `startWebServer` returned 17 matches.
- Symbol detail rendered callers, callees, flows, and selected context.
- Graph route rendered 33 nodes and 55 edges; Cytoscape canvas layer 2 sampled 356 nonblank points out of 7,055.
- Impact route rendered 20 affected symbols and 161 graph edges.
- Chat route showed dormant no-provider state, disabled Ask, and no provider key-like strings in page text.
- Re-analysis reached terminal `done`: checked 712 files, 0 changed, updated 0 nodes.
- Mobile 390x844 search route had no horizontal overflow: document scroll width 375.
