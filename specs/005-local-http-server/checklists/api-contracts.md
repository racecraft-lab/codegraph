# API Contracts Checklist: Local HTTP Server & REST API

**Purpose**: Validate that the Local HTTP Server & REST API *requirements* are complete, unambiguous, and mutually consistent across `spec.md`, `plan.md`, `data-model.md`, and `contracts/openapi.yaml` — every endpoint's params, status codes, and response shapes; the paging contract; the error envelope; and node-id / repo-id addressing. Unit-tests the requirements, not the implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · [openapi.yaml](../contracts/openapi.yaml)

**Scope note**: The five Clarify-settled decisions (6-code envelope FR-015a, mode-400 FR-006a, node-id encoding FR-004a, Host allowlist FR-012, per-mode result union FR-023/024) are treated as SETTLED — items covering them VERIFY consistency, they do not reopen the decision.

## Endpoint Contract Completeness & Consistency (spec FR ↔ openapi)

- [x] CHK001 Is every documented path+method present in BOTH the spec FRs and `openapi.yaml` (10 path items: 8 read + 2 job)? [Consistency, Spec §FR-004/009/020/023, openapi paths]
- [x] CHK002 Is the addressing mechanism for a repo-scoped READ specified — how a client names the target repo on `/api/search`, `/api/node`, `/api/callers`, `/api/callees`, `/api/impact`, `/api/graph` (no read operation carries a repo param today, yet FR-010/US2 mandate repo-scoped reads with lazy attach)? [Resolved → FR-010a: optional `?repo=` on the 6 reads, omit ⇒ default repo, unknown/malformed ⇒ 404 resource:repo, lazy attach; + openapi RepoQuery param + /api/search 404. Consensus-flagged: mechanism choice]
- [x] CHK003 Are the HTTP methods for each endpoint pinned (reads GET, reindex POST+GET, events GET — the GET-events choice justified by `EventSource`)? [Completeness, Spec §FR-023, openapi]
- [x] CHK004 Does a requirement pin the required `q` (search-term) query parameter for `GET /api/search` (the contract requires `q`, but no FR states it)? [Resolved → FR-006a: required `q`, absent/empty ⇒ 400; + openapi `q` minLength:1]

## Status-Code Coverage (contract-test walk, FR-025)

- [x] CHK005 Is the 503 `unavailable` response (daemon attach/spawn failure, with `Retry-After`) documented on every read endpoint — Edge Cases L89 says any read against an unattachable daemon returns 503, but the contract lists 503 only on `POST /api/reindex`? [Resolved → FR-025: per-endpoint status-code completeness; + openapi 503 added to all 7 daemon-backed reads (status/search/node/callers/callees/impact/graph)]
- [x] CHK006 Is the 400 `invalid_request` response (malformed/negative params) documented on the param-taking read endpoints (`callers`, `callees`, `graph`, `impact`) and not only on `/api/search`, given FR-015a mandates 400 for malformed params? [Resolved → FR-025 + openapi 400 added to /api/callers, /api/callees, /api/graph, /api/impact (each accepts a client `limit`/`offset`/`depth`; impact carries its own `?depth` default 3/max 3 per FR-004/T018, so a malformed/negative `depth` ⇒ 400 — CHK012 settled impact's *response shape* as a subgraph, NOT that it takes no params; reconciled 2026-07-11)]
- [x] CHK007 Are the reindex POST status codes (202/404/409/503) each mapped to a requirement? [Completeness, Spec §FR-020/022/021a/011/015a, openapi]
- [x] CHK008 Is the over-cap "clamp, don't error" rule for `limit`/`depth` (echo the effective clamped value; never 400) specified consistently in the spec and contract? [Consistency, Spec §FR-006/007/015a, openapi Limit/depth]
- [x] CHK009 Is the response for an unsupported HTTP method on a KNOWN path defined within the closed six-code vocabulary (there is no 405; FR-018 covers only unknown paths)? [Resolved → FR-018: unsupported method on a known path ⇒ 404 not_found resource:route (no 405 in the closed vocab)]

## Paging Contract (Q12)

- [x] CHK010 Are the `limit` default (100) and hard cap (500) specified consistently across the spec and contract for every paged endpoint? [Consistency, Spec §FR-006, openapi Limit]
- [x] CHK011 Does every paged list response carry `total` and echo the effective (clamped) `limit`/`offset` window? [Completeness, Spec §FR-006, openapi ListResult]
- [x] CHK012 Is the `/api/impact` response shape specified consistently — the contract types it as a paged `ListResult`, but FR-006 and the data model exclude impact from paged list endpoints and the library returns a node+edge subgraph? [Resolved → FR-004: impact = node+edge subgraph (GraphResult shape); + openapi impact 200 ⇒ GraphResult (was ListResult); + data-model Impact-radius bullet. Consensus-flagged: codebase confirm (getImpactRadius→Subgraph)]
- [x] CHK013 Are the graph-neighborhood `depth` default (1), max (3), node cap (2000), and `truncated` flag specified consistently? [Consistency, Spec §FR-007, openapi GraphResult]
- [x] CHK014 Is `/api/repos`' non-paged (whole-list) shape an intentional, documented exclusion from the paging contract? [Coverage, Spec §FR-009, openapi]

## Error Envelope (Q9, Q11)

- [x] CHK015 Is the single envelope shape `{ error: { code, message, details? } }` required on EVERY non-2xx across the API? [Consistency, Spec §FR-015/015a, openapi ErrorEnvelope]
- [x] CHK016 Is `error.code` constrained to exactly the six settled values, with `details.resource` discriminating not-found among `node|repo|route`? [Consistency-settled, Spec §FR-015a, openapi ErrorEnvelope enum]
- [x] CHK017 Is the not-found discriminator specified for `GET /api/reindex/:repo` (and `/events`) when the repo is registered but no job has ever run (the contract returns 404 but pins no `details.resource` for that case)? [Resolved → FR-024: registered-repo-no-job ⇒ 404 resource:repo, deliberately indistinguishable from unknown repo (no vocab extension); + openapi 404 comments]
- [x] CHK018 Are 401 bodies required to be generic/identical regardless of reason (enumeration prevention), and is the 401 shape covered by the contract test's token-bound fixture? [Consistency, Spec §FR-014/015a/025, openapi Unauthorized + prose]
- [x] CHK019 Are the same-origin/no-CORS posture and the static/route 404-fallback rules (unknown `/api/*` → 404 JSON; missing asset-extension → 404 no fallback; extensionless → app shell) specified unambiguously? [Consistency, Spec §FR-018/019, Edge Cases]

## Node-id & Repo-id Addressing (Q2)

- [x] CHK020 Is node-id percent-encoding, single-decode-site, opaque-key resolution, and malformed/unknown→404 specified unambiguously and mirrored in the contract? [Clarity-settled, Spec §FR-004a, openapi NodeId]
- [x] CHK021 Is the repo-id format (16-hex realpath SHA-256 prefix = registry key) and the `{id,root,name,default}` shape specified consistently? [Consistency, Spec §FR-010, data-model, openapi RepoId/Repo]
- [x] CHK022 Is the behavior for a syntactically-malformed repo id (fails the `^[0-9a-f]{16}$` format) specified — 400 vs 404 — consistently with the node-id malformed rule? [Resolved → FR-011: malformed repo id ⇒ 404 resource:repo, never 400, mirroring FR-004a; applies to `:repo` path + `?repo=` query; + openapi RepoId/RepoQuery notes]
- [x] CHK023 Are lazy (first-access) daemon attach for a non-default repo and the unregistered-repo→404 `resource:repo` rule specified? [Completeness, Spec §FR-010/011, quickstart] (Read-scoping *trigger* mechanism tracked separately by CHK002.)

## Jobs & SSE Contract (Slice 2)

- [x] CHK024 Is the job descriptor shape (`id/repo/mode/status/startedAt/finishedAt?/reason?/result?`) and lifecycle (`running`→`done|error`, no `queued`) specified consistently across data-model and contract? [Consistency, Spec §Key Entities/FR-023/024, data-model, openapi Job]
- [x] CHK025 Is the terminal `result` union discriminated on `mode` (sync vs full shapes, FR-015a whitelisting applied) specified consistently? [Consistency-settled, Spec §FR-023/024, data-model, openapi SyncModeResult/FullModeResult]
- [x] CHK026 Are the SSE event names (`snapshot`/`progress`/`done|error`), payloads, heartbeats, no-Last-Event-ID, and disconnect-doesn't-cancel rules specified consistently? [Consistency, Spec §FR-023, data-model, openapi events]
- [x] CHK027 Is the 409 vs 503 vs `lock_unavailable` boundary (duplicate active job vs daemon attach failure vs external lock contention) specified without overlap? [Consistency, Spec §FR-021a/022/015a, data-model]

## Notes

- A standalone Gap marker on an item denotes a requirement-quality problem to remediate (missing, ambiguous, or inconsistent requirement). Non-marked items are verified consistent on the current artifacts.
- Traceability: 27/27 items carry a spec §, data-model, or openapi reference.
- Remediation flips a resolved item's checkbox to `[x]` and replaces its marker with `[Resolved → <artifact ref>]`.
