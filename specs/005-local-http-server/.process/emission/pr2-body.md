## What changed

Building on the read API (previous PR in this stack), `codegraph serve --web` can now **re-index a repository on demand and stream live progress to the browser**:

- `POST /api/reindex/:repo` starts a background re-index in the server — an incremental sync by default, or a full rebuild with `?full=true` — and immediately returns a job descriptor.
- `GET /api/reindex/:repo/events` is a Server-Sent Events stream: subscribers get an instant snapshot, live progress frames (phase, counts, current file), and exactly one terminal event when the job finishes or fails. Reconnecting mid-job re-snapshots; a slow or disconnected browser never stalls the job or other subscribers.
- One active job per repository — a duplicate request while one is running gets a clear conflict response, and the latest outcome stays readable until the server restarts.
- Real-world failure modes are contained: if another process holds the index lock, the job retries briefly and then reports it plainly; shutting the server down aborts an in-flight job cleanly and releases the lock; and a long rebuild automatically restores the background daemon's file watcher if it had given up during the contention.

This PR also folds in the post-implementation review remediation: server-side diagnostic logging so an operator can see *why* something failed (HTTP responses still never leak internals, and the auth token still never appears in logs), a socket-leak fix on failed daemon handshakes, containment of streaming faults after headers are sent, an honest documentation fix for the search result cap, and 15 new guard tests. User documentation for the whole `serve --web` feature landed in `docs/web-server.md`.

## Why it matters

The upcoming web dashboard needs a "re-index now" button with a live progress bar. This gives it one, with the same safety story as the rest of the server: everything runs locally, jobs can't pile up, failures are reported instead of crashing the process, and the shared index the MCP tools use stays consistent.

## Anything reviewers should know

- Suggested review order, traceability, and the review-panel outcome (including three deliberately deferred refactors) are in the committed packet: `specs/005-local-http-server/.process/slice2-pr-packet.md`; hands-on evidence is in `slice2-quickstart-evidence.md`, including a self-hosted run against this repository's own index (7/7 checks).
- The daemon gained one more additive control method so a finished job can re-arm the file watcher. As with slice 1, an adversarial check confirmed the MCP tool surface is byte-for-byte unaffected.
- Two edge behaviors are pinned by unit tests rather than end-to-end runs (watcher restore after degradation, and catching a live mid-index abort — this machine indexes the fixture too fast); the evidence file says so explicitly.
- Rollback lever: omit `--web`; the job subsystem only exists inside the web server process.

## Self-Review Findings

No gaps. See the workflow log Self-Review block (`docs/ai/specs/.process/SPEC-005-workflow.md`); the full test suite ran after remediation with 3,167 passing.

## UAT Runbook

Skipped: the runbook generator is deferred on the installed runner. Committed acceptance evidence stands in: `specs/005-local-http-server/.process/slice2-quickstart-evidence.md` (scenarios 8–11 + self-repo dogfood UAT, 7/7 PASS).

<details><summary>Reviewer checklist &amp; scope details</summary>

- Scope: 9 production files under `src/` (+1,195 / −51) since the slice-1 checkpoint, tests +65 (jobs suite + guard tests), plus docs and process evidence
- Verification: full suite 3,167 passed / 7 skipped, exit 0 after remediation; typecheck exit 0; zero new runtime dependencies
- Rollback: omit `--web` (job subsystem is web-server-internal)
</details>
