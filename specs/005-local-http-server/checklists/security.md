# Security Checklist: Local HTTP Server & REST API

**Purpose**: Unit-test the *security requirements* of the Local HTTP Server & REST API for completeness, clarity, and consistency across `spec.md`, `plan.md`, `data-model.md`, and `contracts/openapi.yaml` — safe-by-default network binding, loopback determination, token auth, the `/api/*` (incl. SSE) vs public-shell auth boundary, the static mount, cross-origin posture, error-envelope info-leak, and request-logging content rules. Tests the requirements, not the implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · [openapi.yaml](../contracts/openapi.yaml)

**Scope note**: The security posture was settled by HUMAN-APPROVED Clarify sessions (S3-Q1/Q2/Q5 and S1-Q2/Q3) — FR-012 (loopback default + shared predicate + Host allowlist), FR-013 (fail-closed non-loopback bind), FR-014 (constant-time Bearer, `/api/*` incl. SSE scope, public shell), FR-015a (closed 6-code envelope, whitelisted details, generic 401), FR-017a (data-free placeholder), FR-019 (no CORS), FR-004a (opaque node-id keys). Items covering these VERIFY coverage/clarity/consistency; they do NOT reopen the decision. Only genuinely missing requirement-level coverage is marked as a Gap.

## Network Binding & Loopback Determination (FR-012/013)

- [x] CHK001 Is the default bind explicitly pinned to a concrete loopback host+port (`127.0.0.1:11235`) rather than a host-less/all-interfaces listen? [Clarity, Spec §FR-012]
- [x] CHK002 Is the loopback set for the no-auth path enumerated exactly (`127.0.0.0/8`, IPv6 `::1`, `localhost`) and evaluated by ONE shared loopback predicate reused by both security gates? [Completeness/Consistency, Spec §FR-012, plan.md §III]
- [x] CHK003 Are the wildcard hosts (`0.0.0.0`, `::`) explicitly declared NON-loopback and bound to FR-013's fail-closed rule regardless of the literal host argument? [Clarity, Spec §FR-012/013]
- [x] CHK004 Is fail-closed startup specified as release-blocking — binding any non-loopback host with no `CODEGRAPH_SERVER_TOKEN` refuses to start and nothing binds? [Completeness, Spec §FR-013, SC-002]
- [x] CHK005 Is the `Host`-header allowlist (DNS-rebinding defense) required on EVERY request even on loopback, with a non-allowlisted `Host` → 400 `invalid_request` inside the closed vocabulary (no new 403)? [Completeness, Spec §FR-012, quickstart Scenario 3]

## Token Authentication (FR-014)

- [x] CHK006 Is the token-required scope specified as every `/api/*` route INCLUDING the SSE endpoint `GET /api/reindex/:repo/events`? [Coverage, Spec §FR-014]
- [x] CHK007 Is the constant-time comparison pinned unambiguously — empty/missing presented token rejected BEFORE any compare, then SHA-256 digests compared with `crypto.timingSafeEqual` (length-hiding, never-throws), zero new dependency? [Clarity, Spec §FR-014]
- [x] CHK008 Is the 401 body required to be generic and identical regardless of failure reason (enumeration prevention)? [Consistency, Spec §FR-014/015a]
- [x] CHK009 Is the forward constraint recorded that a browser `EventSource` cannot send an `Authorization` header, so a token-bound SSE client MUST use `fetch`+`ReadableStream` and MUST NOT pass a token in the query string? [Completeness, Spec §FR-014]

## Auth Boundary — SSE & Static Mount posture (Clarify S3)

- [x] CHK010 Is the auth boundary drawn unambiguously — authenticated data (`/api/*`, incl. SSE) vs public shell (static mount + placeholder `/` served without a token even on a token-bound non-loopback bind)? [Consistency, Spec §FR-014/017/017a]
- [x] CHK011 Is the placeholder page required to embed NO repo-identifying data (repo id/root/name/list) and be byte-identical regardless of which repos are registered, precisely because it sits outside the auth boundary? [Completeness, Spec §FR-017a]

## Static Mount — path resolution safety (FR-017/018)

- [x] CHK012 Are requirements defined to confine the hand-rolled static file server's resolved paths WITHIN the web build directory — rejecting `..`/dot-segment traversal, absolute-path escape, encoded-separator (`%2e%2e`, `%2f`) traversal, and symlink escape — so no URL path can resolve to a file outside `dist/web/`? [Resolved → FR-017b + Edge Case "Static request path attempts to escape the web root": the static mount MUST route file resolution through the repo's established content-serving chokepoint `validatePathWithinRoot` (`src/utils.ts`, #527 — lexical containment then symlink-aware `fs.realpathSync`-both-sides re-check), decode once (bounded), reject `..`/absolute/encoded-separator/NUL, and return 404 `not_found` (`resource:route`) on any escape — never the file contents, never 403; a surface distinct from FR-004a's opaque DB-key node ids; the FR-025 contract test adds a traversal probe. plan.md static.ts bullet updated.]

## Cross-Origin Posture (FR-019)

- [x] CHK013 Is the same-origin/no-CORS posture specified unambiguously — the server emits NO CORS headers and does not honor cross-origin requests? [Clarity, Spec §FR-019, openapi info]

## Error-Envelope Information Leak (FR-015a)

- [x] CHK014 Is `message`/`details` constrained to whitelisted, schema-defined fields — never raw exception text, absolute filesystem paths, stack traces, or cause chains? [Completeness, Spec §FR-015a, data-model Error envelope]
- [x] CHK015 Is a malformed id required to be INDISTINGUISHABLE from an unknown one (node → 404 `resource:node`; repo → 404 `resource:repo`; never 400), preventing probe-based enumeration of what exists? [Consistency, Spec §FR-004a/011/015a]
- [x] CHK016 Is the token guaranteed never to appear in a response body — 401 generic (FR-014), error details whitelisted (FR-015a), placeholder data-free (FR-017a)? [Coverage, Spec §FR-014/015a/017a]

## Request Logging & Secret Handling (Non-Functional Security)

- [x] CHK017 Are request-logging content rules defined — that any request/diagnostic log the server emits stays local (no external egress, Constitution VII) and MUST NOT record the `CODEGRAPH_SERVER_TOKEN`, the `Authorization` header, or other secret material? [Resolved → FR-014a: any request/diagnostic logging MUST stay local (no egress — Constitution VII / FR-019) and MUST NOT record the token value, the `Authorization` header, or the presented Bearer, extending the constitution's "never persisted, logged, or echoed" secret rule (applied there to `CODEGRAPH_EMBEDDING_API_KEY`) to the server token; binds the `node:http` request logger, the library `Logger` (`src/errors.ts`), and bare `console.*`. plan.md auth.ts bullet updated.]

## Dependencies & Assumptions

- [x] CHK018 Is the loopback-plus-token interaction pinned — on a loopback bind no auth is required even if `CODEGRAPH_SERVER_TOKEN` is set (Bearer is a property of non-loopback binds only)? [Assumption, Spec §Assumptions/FR-012/014]
- [x] CHK019 Is the zero-new-dependency constraint for the security primitives explicit (token compare via `node:crypto` only), so no third-party auth/crypto surface is introduced? [Consistency, Spec §FR-003/014, plan.md Constraints]

## Notes

- A standalone Gap marker on an item denotes a requirement-quality problem to remediate (missing, ambiguous, or inconsistent requirement). Non-marked (`[x]`) items are verified complete/clear/consistent on the current artifacts and do NOT reopen the human-approved Clarify decisions.
- Traceability: 19/19 items carry a spec §, plan, data-model, or openapi reference (≥80% target met).
- Remediation flips a resolved item's checkbox to `[x]` and replaces its Gap marker with `[Resolved → <artifact ref>]`.
