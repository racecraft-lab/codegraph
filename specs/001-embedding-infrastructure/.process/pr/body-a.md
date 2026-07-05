<!-- speckit-pro-review-packet-source: specs/001-embedding-infrastructure/.process/pr/packet-a.json -->

## Summary

<!-- speckit-pro-editable:summary:start -->
**Slice A of SPEC-001 (stacked PR 1 of 2).** Adds the embedding substrate: every declaration-level symbol gets a persisted vector computed through a user-configured OpenAI-compatible endpoint on a full index, with the feature fully dormant when unconfigured (byte-identical behavior, zero network). Slice B (incremental freshness + backfill heal + outage resilience) follows in a stacked PR based on this branch. Split per the ratified reviewability budget (the combined diff exceeds block thresholds); stacked sequentially because the schema-version pin (v7→v8) is a hard-atomic seam that lands exactly once, here.
<!-- speckit-pro-editable:summary:end -->

Source: feature specification defines reviewer-ready PR packet behavior.

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- New `src/embeddings/` module: env-driven config (activation = `CODEGRAPH_EMBEDDING_URL` + `CODEGRAPH_EMBEDDING_MODEL`; key optional; endpoint redaction to scheme+host+port), `EmbeddingProvider` interface, OpenAI-compatible fetch client (batching, bounded concurrency, jittered backoff, 401/403 + terminal-4xx fast-abort, strict response validation, full error replacement so no credential can leak through message/cause/props), little-endian f32 codec, deterministic LF-normalized input composition + SHA-256 input hash, and the advisory embed pass (batch-sized transactions, dims infer→persist→enforce via project-metadata scalars, WAL checkpoint, lock-freshness refresh).
- Schema migration v8: `node_vectors(node_id TEXT PK, model, dims, vector BLOB, input_hash)` — deliberately **no foreign key** (vectors survive node delete/re-insert; cleanup is an explicit reconciliation) — in lockstep in `schema.sql` + `migrations.ts`, with a fresh-vs-upgraded convergence test.
- `indexAll()` wiring in the established advisory slot (never fails an index), `'embedding'` progress phase, `codegraph status` Embeddings section with `--json` parity (active/dormant/prior-run/misconfigured states).
- 115+ new tests across 5 suites (real SQLite temp dirs + mock `node:http` endpoint; no DB mocking), including byte-level secret-absence scans and a single-host code-egress pin.
- Process artifacts (spec/plan/contracts/checklists/workflow) ride under `specs/001-embedding-infrastructure/` and `docs/ai/specs/.process/` — skim-review these; the code is the review target.
<!-- speckit-pro-editable:what_changed:end -->

Source: schema contract defines editable field markers.

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
This is the Tier-0 substrate the Intelligence Platform stands on: SPEC-003 (semantic retrieval), SPEC-011 (labels), and SPEC-019 (wiki) all consume the provider interface and persisted vectors. Shipping it dormant-by-default keeps every existing user byte-identical (proven by test) while letting endpoint users opt in with two env vars. Zero new dependencies (the dependency set is pinned by a test), zero telemetry, and the retrieval/MCP surface is untouched (`src/mcp/` diff vs main is empty).
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

1. Inspect the generated packet JSON for mode, target, title, body path, and validation path.
2. Inspect this body for required reviewer headings, editable markers, and source evidence.

## How To UAT

Use the UAT Runbook below for reviewer-facing acceptance checks. If this PR only changes packet metadata, the runbook explains why no manual product path is required.

## UAT Runbook

# UAT Runbook: 001-embedding-infrastructure

| Field | Value |
|-------|-------|
| Spec | 001-embedding-infrastructure |
| Branch | 001-embedding-infrastructure |
| PR | Pending until PR is opened |
| Generated from | 2026-07-05T03:43:10Z |



## Env Setup

This is a Node.js project. From the repository root, run `npm install` once
(skip if you've already done this), then `npm run build` to compile the
`codegraph` CLI you'll use in every step below. To confirm the change is
healthy, run `npm run typecheck` (checks the code for type errors) and
`npm test` (the full automated test suite, including the tests written for
this feature) — both should finish with no failures. There is no separate
lint command in this repo. The manual walkthrough below additionally needs a
local embedding server; Story 1, step 1 shows how to set one up with Ollama.

## Per-Story Acceptance Tests

### User Story 1 - Configure and embed on index (Slice A) (Priority: P1)

This story is the foundation: a user points CodeGraph at their own embedding
server, indexes their project, and every function/class/etc. gets a vector —
visible and countable through `codegraph status`.

1. Get a local embedding server running. The simplest option is Ollama:
   install it from https://ollama.com, then run `ollama pull nomic-embed-text`
   to download a small embedding model. Ollama serves it automatically at
   `http://localhost:11434` once it's running (start it with `ollama serve`
   if it isn't already running in the background).
2. In the terminal you'll run `codegraph` from, turn embeddings on:
   ```
   export CODEGRAPH_EMBEDDING_URL=http://localhost:11434/v1/embeddings
   export CODEGRAPH_EMBEDDING_MODEL=nomic-embed-text
   ```
   Notice you did not set `CODEGRAPH_EMBEDDING_API_KEY` — Ollama needs no key
   for a local endpoint, and the next steps confirm indexing still succeeds
   without one.
3. In a project folder CodeGraph can index, run `codegraph index` for a full
   index.
   - See: the index finishes normally, and while it runs you should see a
     progress step labeled "Embedding symbols."
4. Run `codegraph status`.
   - See: an "Embeddings:" section showing Endpoint (e.g.
     `http://localhost:11434`), Model (`nomic-embed-text`), Dims (a real
     number — you never set this yourself; CodeGraph inferred it from the
     endpoint's first answer), and Coverage at `100%` (e.g. `42/42 (100%)`).
5. Run `codegraph status --json | jq .embedding` (or open the raw JSON
   output if you don't have `jq` installed).
   - See: `"active": true` and `"coverage": {"percent": 100, ...}`, matching
     what you just saw in the plain-text output.
6. Now unset both variables (`unset CODEGRAPH_EMBEDDING_URL
   CODEGRAPH_EMBEDDING_MODEL`) and index a fresh copy of the same project.
   - See: indexing finishes exactly as it always has — no errors, nothing
     about embeddings failing — and `codegraph status` now shows a plain,
     neutral "Dormant" line naming the two variables to set, instead of an
     Embeddings section with numbers. Dormant is not an error; it just means
     the feature is off.
7. Compare `codegraph status --json | jq '{nodeCount, edgeCount}'` from the
   run with embeddings on (step 4) against the run with them off (step 6).
   - See: the same node and edge counts either way — turning embeddings on
     or off never changes the code graph itself, only whether vectors exist
     on the side.

- [ ] Story 1 confirmed: a configured endpoint fully embeds a project and
      `codegraph status` shows 100% coverage with the right model and
      dimension; an unconfigured project indexes exactly as before and
      reports itself as dormant, not broken; the graph's node/edge counts
      never change either way.

### User Story 2 - Incremental freshness on edit (Slice B) (Priority: P2)

Continue from Story 1 with a fully-embedded project (100% coverage) and the
two environment variables still set.

1. Open one source file and make a small but real change to a function or
   class — edit its body or its parameters.
2. In a different file, delete an entire function or class outright.
3. Run `codegraph sync`.
   - See: sync finishes normally, and the "Embedding symbols" progress step
     is brief — it is not re-embedding the whole project, just what changed.
4. Run `codegraph status`.
   - See: Coverage is still `100%` — the symbol you edited got a fresh
     vector, the vector for the symbol you deleted is gone, and every symbol
     you didn't touch was left alone.
5. Rename a symbol, or move it without changing its body (for example, add a
   blank line above it so it shifts down), then run `codegraph sync` again.
   - See: coverage stays at `100%`. CodeGraph may quietly re-embed a shifted
     symbol behind the scenes, but nothing is ever left uncounted.
6. If CodeGraph's background file-watcher is running for this project (for
   example, through an installed AI-agent integration, or `codegraph
   daemon`), save an edit to a watched file instead of running `sync`
   yourself, then check `codegraph status` a few seconds later.
   - See: coverage still reaches `100%` on its own — the same embedding step
     ran automatically in the background, without you typing `codegraph
     sync`.

- [ ] Story 2 confirmed: editing or deleting code and running `sync` keeps
      coverage at 100% by touching only what changed — never the whole
      project — and the same freshness happens automatically when the
      background watcher triggers the sync.

### User Story 3 - Late configuration and endpoint resilience (Slice B) (Priority: P3)

1. Make sure `CODEGRAPH_EMBEDDING_URL` and `CODEGRAPH_EMBEDDING_MODEL` are
   both unset, then run `codegraph index` on a project (or reuse Story 1's
   dormant run).
   - See: `codegraph status` shows the project fully indexed but Embeddings
     "Dormant" — zero vectors.
2. Now set the same two variables from Story 1, step 2, and run a single
   plain `codegraph sync` — no special command, no flags.
   - See: `codegraph status` now reports Coverage at `100%` — one ordinary
     sync backfilled every vector that was missing.
3. Simulate an outage: start a fresh `codegraph index` (pick a project large
   enough that the "Embedding symbols" step takes a few seconds), and while
   that step is showing progress, stop your embedding server (quit the
   Ollama application, or press Ctrl+C in the terminal window running
   `ollama serve`).
   - See: the index still finishes and reports success (check the command
     didn't print a failure, and that its exit code is `0` — run `echo $?`
     right after it finishes). `codegraph status` shows Coverage below
     `100%` (partial), not an error.
4. Restart your embedding server (`ollama serve` again, or restart Ollama),
   then run `codegraph sync` once more.
   - See: Coverage climbs back to `100%` with no extra flags and no special
     resume command — the pass simply continues from wherever it stopped.
5. Set `CODEGRAPH_EMBEDDING_DIMS` to a number that does not match what your
   model actually returns (for example `1`, when `nomic-embed-text` normally
   returns 768-number vectors), then run `codegraph sync`.
   - See: an error message naming `CODEGRAPH_EMBEDDING_DIMS`, but the
     overall `sync` command still reports success — the mismatch is called
     out, not silently ignored and not fatal. Unset
     `CODEGRAPH_EMBEDDING_DIMS` afterward to go back to normal.

- [ ] Story 3 confirmed: turning on embeddings after the fact backfills to
      100% with one plain sync, and a mid-run outage never breaks index or
      sync — it always resumes cleanly once the endpoint is back.



## FR Coverage Matrix

| Success criterion | What it guarantees | Proven by |
|---|---|---|
| SC-001 | A configured endpoint gets every symbol a vector, and status reports 100% with the right model/dimension | Story 1, steps 3-5 |
| SC-002 | With nothing configured, indexing behaves exactly as before — zero vectors, zero network calls | Story 1, step 6 |
| SC-003 | A sync after an edit re-embeds only what changed, and removes vectors for deleted symbols | Story 2, steps 3-4 |
| SC-004 | Turning on the endpoint after the fact backfills to 100% with a single plain sync | Story 3, steps 1-2 |
| SC-005 | An outage mid-pass never breaks index/sync, and a later run finishes the job | Story 3, steps 3-4 |
| SC-006 | Turning embeddings on or off never changes the number of symbols or relationships in the graph | Story 1, step 7 |
| SC-007 | The API key and any endpoint credentials never show up in logs, errors, or saved files | Negative-Path Tests, "Credential safety" check |
| SC-008 | No new software dependency is added, and no usage data is collected | Negative-Path Tests, "Nothing calls home" check |
| SC-009 | Setting only one of the two variables produces a clear "you're missing X" message instead of silence | Negative-Path Tests, "Only one variable set" check |
| SC-010 | The embedding step is capped in memory, batch size, and per-request time, so it can never hang forever | Story 3, step 3 (outage aborts, doesn't hang) |
| SC-011 | Your source code only ever leaves the machine to the one endpoint you configured, never anywhere else | Negative-Path Tests, "Nothing calls home" check |


## Negative-Path Tests

- **Only one variable set (half-configuration)**: Set just
  `CODEGRAPH_EMBEDDING_URL` and leave `CODEGRAPH_EMBEDDING_MODEL` unset, then
  run `codegraph status`. Expect: embeddings stay off (no network calls, no
  vectors written, index/sync still finishes normally), but instead of the
  plain "Dormant" message you see a clear one naming the missing variable
  (`CODEGRAPH_EMBEDDING_MODEL`). Try it the other way — only
  `CODEGRAPH_EMBEDDING_MODEL` set — and expect the same, naming
  `CODEGRAPH_EMBEDDING_URL` instead.
- **Endpoint rejects the request outright**: Point `CODEGRAPH_EMBEDDING_URL`
  at a wrong path on your own endpoint (e.g.
  `http://localhost:11434/wrong-path`), or at an endpoint that requires a key
  you don't provide, then run `codegraph index`. Expect: the embedding step
  fails quickly — it does not sit and retry something that can't succeed —
  and reports the problem, while the overall index/sync still finishes and
  reports success.
- **You switch embedding models**: On an already-100%-covered project,
  change `CODEGRAPH_EMBEDDING_MODEL` to a different model name and run
  `codegraph sync`. Expect: every symbol gets a fresh vector under the new
  model (a full re-embed, so it may take longer than a normal edit-and-sync),
  and `codegraph status` reports the new model with coverage back at `100%`.
- **The endpoint's answer size stops matching**: also exercised as Story 3,
  step 5 — set `CODEGRAPH_EMBEDDING_DIMS` to a number your model doesn't
  actually produce and confirm you get a clear error naming
  `CODEGRAPH_EMBEDDING_DIMS`, never silently-wrong data.
- **You interrupt an index partway through**: Start a `codegraph index` on a
  project with enough code that embedding takes a few seconds, then stop it
  with Ctrl+C partway through. Run `codegraph index` or `codegraph sync`
  again. Expect: it continues from wherever it left off — nothing already
  written is lost, and no special recovery step is needed. (The same holds
  on very large projects: memory use stays reasonable rather than climbing
  with project size.)
- **You insert a line above existing code**: Add a blank line near the top
  of a file that has several functions below it, then run `codegraph sync`.
  Expect: coverage still reaches `100%` afterward — CodeGraph may re-embed
  some of the functions that shifted down as a result, which is expected and
  harmless; nothing is left uncounted.
- **An empty or trivial project**: Run `codegraph index` in a folder with no
  code (or only a README). Expect: indexing finishes normally, no embedding
  requests are made, and status reports embeddings as complete — there's
  nothing to embed, so there's nothing pending.
- **(Advanced/optional) The endpoint accepts the connection but never
  answers**: If you can point the URL at something that accepts a connection
  and then goes silent, run an index and expect CodeGraph to give up on that
  one request after about 30 seconds (or your `CODEGRAPH_EMBEDDING_TIMEOUT_MS`
  setting) rather than hanging forever, and the index/sync still finishes and
  reports success.
- **The endpoint answers with the wrong shape of data**: Point
  `CODEGRAPH_EMBEDDING_URL` at a real endpoint URL that returns JSON but not
  an embeddings response — for example Ollama's own
  `http://localhost:11434/api/tags` — then run `codegraph index`. Expect:
  the embedding step reports a failure rather than saving mismatched or
  corrupted data, and the index/sync still finishes and reports success.
- **Credential safety**: Set `CODEGRAPH_EMBEDDING_API_KEY` to a made-up value
  (e.g. `test-secret-key-123`), run an index, then check the terminal output
  and `codegraph status` for that value and for your endpoint's full URL.
  Expect: the key never appears anywhere, and the endpoint is always shown
  reduced to just its address and port (e.g. `http://localhost:11434`) —
  never a full URL with a path, query string, or embedded username/password.
- **Nothing calls home**: While embeddings are configured, index or sync a
  project and, if you're able to, watch your network activity (e.g. your
  operating system's network/activity monitor). Expect: the only new
  outbound connection goes to the endpoint you configured — nothing else —
  and no new usage-tracking data is produced by turning embeddings on.

## Self-Review Findings

**Self-Review:** <not available — workflow file not provided>

## Sign-off

Advisory only — these checkboxes block nothing.

- [ ] Reviewer walked every Per-Story Acceptance Test above.
- [ ] Reviewer confirmed the Negative-Path Tests behave as described.
- [ ] Reviewer is satisfied the PR delivers the behavior the spec promised.

## Rollback

git revert <SHA>; see plan.md for data-migration considerations
## Verification

- Focused packet generation checks passed.
- Packet metadata and rendered body assertions passed.

Source: generated PR packet.

## Scope

- Source feature: recorded in packet metadata.
- Scope: this PR is limited to generated PR packet title and body behavior.
- Traceability: source feature, rendered body, validation, and changed-file scope are recorded in the packet metadata.
- Non-goals: split title generation and multi-PR emission behavior.

## Known Gaps

No known gaps for single-PR packet title metadata. Split packet title generation remains deferred.
