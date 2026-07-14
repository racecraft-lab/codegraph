# Contract: `codegraph tasks` CLI

**Surface**: scheduler/runtime (`src/bin/codegraph.ts`). **Slice**: 2. Flat positional shape
`tasks [action] [id]`, mirroring the in-repo `telemetry [action]` command (minimal upstream diff).
User-invoked only — never auto-run from the watcher/daemon (FR-029).

## `codegraph tasks list`

Enumerate bundles under `.codegraph/tasks/`, one row per bundle: **id**, **status**
(`pending`/`completed`), **age** (from `manifest.createdAt`). No id argument. Surfaces pending bundles
so stale ones are findable (Assumptions — no `prune` verb in v1). Exit 0.

**Resilient enumeration** (FR-026; `daemon-registry.ts` precedent): a bundle whose `manifest.json` is
missing / malformed / unreadable is surfaced with an **unreadable/unknown** status rather than aborting
the listing; an empty or absent `.codegraph/tasks/` directory prints an empty listing and still exits 0
(never an error).

Requirements: FR-026.

## `codegraph tasks ingest <id>`

Validate + finalize one completed bundle (FR-026/FR-028):

| Outcome | Effect | Exit | Req |
|---|---|---|---|
| output validates against the contract | store canonical `result.json` inside the bundle dir; stamp `manifest.status = 'completed'`; print confirmation | 0 | FR-028 |
| output violates the contract | reject; print reason to **stderr**; manifest stays `pending` (re-runnable); **no** consumer artifact written | non-zero | FR-027, FR-028a |
| output file absent / empty / unreadable (ingested too early) | reject (cannot satisfy the contract); reason to stderr; manifest stays `pending` (re-runnable once the agent writes output); **no** consumer artifact | non-zero | FR-027, FR-028a |
| `<id>` not a single segment under `.codegraph/tasks/` (e.g. `../../src`) | reject BEFORE resolving the bundle dir (anchor containment); reason to stderr; no read/write | non-zero | FR-029a |
| FR-029a hardening rejection (path escapes bundle dir / symlink / oversize / deep JSON) | reject; reason to stderr; manifest stays `pending`; never `isError`-style crash | non-zero | FR-029a |
| bundle missing / already `completed` / malformed manifest | report the problem; write no consumer artifacts; do not falsely stamp `completed` | non-zero | Edge Case |

**Never** writes a downstream feature's own output files — ingest stops at the bundle directory
(FR-029). The `<id>` is first validated as a single segment resolving to a direct child of
`.codegraph/tasks/` (anchor containment), then every path read/written resolves within that bundle dir
via `validatePathWithinRoot` (FR-029a); see `bundle-files.md`.

## Unknown action

`codegraph tasks <unknown>` → error message + non-zero exit (telemetry precedent).
