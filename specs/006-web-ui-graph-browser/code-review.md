# SPEC-006 Code Review

Date: 2026-07-15

## Scope

Reviewed the SPEC-006 working tree from the review extension changed-file
detector plus untracked source files under `web/`, new server chat/package
files, tests, docs, and workflow artifacts.

Configured review aspects were all enabled: code, comments, tests, errors,
types, and simplify. RepoPrompt MCP subagent dispatch was attempted for the
built-in review track, but `agent_manage` returned `Transport closed` twice, so
the review was completed directly in the parent session.

## Findings Fixed

### Important: chat request body could masquerade as an internal router result

`src/server/chat.ts` returned `ChatRequestBody | ApiError` and checked
`'status' in body`. A user JSON object containing a `status` field could be
misclassified as an internal handler result. The parser now returns a
discriminated `ChatBodyResult`, and
`__tests__/server-chat-adapter.test.ts` covers a body with `status`.

### Important: search could show stale results after repo/query changes

`web/src/components/search/GlobalSearch.tsx` now reloads from the URL query when
the selected repo changes and ignores stale async responses with a request id.
Empty searches also clear the URL query and reset visible state.

### Important: re-analysis UI could retain stale progress/error state

`web/src/routes/ReindexRoute.tsx` now ignores late SSE callbacks after teardown,
clears prior progress when a new job starts, and uses the same terminal handling
for snapshot/done/error events. `web/src/components/reindex/ReindexProgress.tsx`
now shows terminal error reasons before stale progress phase text.

### Important: chat panel could retain stale context output

`web/src/components/chat/ChatPanel.tsx` now clears status errors and previous
answers when repo, selected node, or view context changes.

### Cleanup: generated web artifacts were in commit scope

Removed the nested `web/package-lock.json`, ignored `web/test-results/`, and
replaced the default Vite/shadcn README with project-specific web UI guidance.

## Verification

- `npm --prefix web run lint`: passed with six non-blocking Fast Refresh
  warnings from shadcn-style exports.
- `npm --prefix web run test -- reindex-panel chat-panel search-symbol`:
  passed, 3 files, 4 tests.
- `npm exec -- vitest run __tests__/server-chat-adapter.test.ts __tests__/package-web-assets.test.ts`:
  passed, 2 files, 8 tests.

## Remaining Review Notes

No high-confidence blocking issues remain from the local review pass. Remaining
Fast Refresh warnings are development-only and come from component files that
also export shadcn variant helpers or hooks.
