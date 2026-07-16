# SPEC-006 Reviewability Diff Gate

Date: 2026-07-15

Status: warn/proceed

## Inputs

- Prior scaffold estimate: 1,115 projected reviewable LOC, suggested 3 slices, status `warn`.
- Atomicity route: `one-navigable-PR`.
- Final reviewability helper status: `final-reviewability-backstop` is deferred for installed workflows, so no active helper was invoked.
- Current changed-file inventory: 135 files.

## Full Worktree Diff Summary

| Area | Files | Added | Deleted |
|---|---:|---:|---:|
| Production code | 77 | 5,332 | 0 |
| Tests | 31 | 1,229 | 5 |
| Web config | 14 | 340 | 0 |
| Docs/specs | 10 | 629 | 135 |
| Package lock | 1 | 8,775 | 1,320 |
| Package/scripts | 2 | 26 | 2 |
| Total | 135 | 16,331 | 1,462 |

## Assessment

This is larger than the original warning estimate, mostly because SPEC-006 adds
a greenfield packaged React web app and the npm lockfile changes for the web
workspace. The implementation remains one cohesive, navigable feature:

- server/static/chat seams are small and tested;
- the web app is under one new `web/` workspace with route-level tests;
- Playwright and Playwright MCP cover the user-facing flows;
- the package lockfile is large generated dependency churn, not hand-authored logic.

Proceed as a single navigable PR with a review guide that asks reviewers to read
the diff in this order:

1. package/server/API changes;
2. web app routes/components/API clients;
3. tests, docs, and SpecKit evidence.

PR side effects remain blocked by the official packet boundary unless a current
feature-local PR packet already exists and validates.
