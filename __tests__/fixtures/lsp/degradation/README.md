# LSP Degradation Fixtures

This directory documents the local failure cases covered by the SPEC-008 US3
tests. The fixtures use small in-process or temporary stdio servers only; they
do not install language servers and do not contact external projects.

Covered scenarios:

- missing server: the selected command cannot be resolved, so only that language
  is marked unavailable/degraded and structural indexing remains valid.
- server crash: the process exits or a request fails with a crash reason, then
  the language gets at most one fresh-session restart before remaining work is
  degraded.
- initialize timeout: the initialize request times out and maps to a timed-out
  server status.
- request timeout: a definition/reference request times out and maps to a
  degraded language status.
- malformed response: invalid JSON-RPC framing or JSON maps to malformed
  protocol degradation.
- shutdown failure: shutdown errors are recorded without failing the enclosing
  index or sync run.

Performance fixtures also cover full-index file caps, work-item caps, bounded
batch size, request high-water reporting, and no repository-wide fallback for
absent, unbounded, or oversized watch scopes.
