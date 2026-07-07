# UAT Runbook: 002-local-embedding-fallback

| Field | Value |
|-------|-------|
| Spec | 002-local-embedding-fallback |
| Branch | 002-local-embedding-fallback |
| PR | Pending until PR is opened |
| Generated from | 2026-07-05T20:20:32Z |

## Env Setup

Start from a checkout of this pull request's branch. From the repository root, run `npm run build` once — this compiles the CLI and the new local-embedding worker (`dist/embeddings/local-embed-worker.js`) into `dist/`. Every command below then runs the freshly built CLI directly, e.g. `node dist/bin/codegraph.js status` (if you have the CLI linked globally, plain `codegraph status` works too — no need to rebuild between commands). If you'd rather run the project's automated checks instead of walking the manual steps below, run `npm test` from the repo root (or a single suite, e.g. `npx vitest run __tests__/embeddings-local-index.test.ts`).

## Per-Story Acceptance Tests

### User Story 1 - Embed locally with no endpoint configured (Priority: P1)

1. From the project root, build the structural graph first:
   ```bash
   node dist/bin/codegraph.js init
   ```
   **Expected:** the tool prints a summary line naming how many files and symbols it found — for example, on this repository it reported `Indexed 415 files, 6,086 nodes`. No embedding happens at this point.

2. Turn on local embedding and index again:
   ```bash
   CODEGRAPH_EMBEDDING_PROVIDER=local node dist/bin/codegraph.js index
   ```
   **Expected:** the first time you do this, you'll see a short "downloading model…" message while the tool fetches the ~22 MB embedding model and tokenizer into `~/.codegraph/models/all-MiniLM-L6-v2/`, then "loading model…", then the index finishes normally. At no point is an external embedding endpoint contacted — everything runs on your machine.

3. Check the result:
   ```bash
   node dist/bin/codegraph.js status
   ```
   **Expected:** the Embeddings section reads:
   ```
   Embeddings:
     Provider:  local
     Model:     Xenova/all-MiniLM-L6-v2
     Dims:      384
     Coverage:  3,733/3,733 (100%)
   ```
   100% coverage confirms every eligible symbol was embedded, entirely locally.

- [ ] Story 1 verified: turning on the local provider embeds every symbol with no external endpoint involved, confirmed by `codegraph status`.

### User Story 2 - Fresh-machine model acquisition and reuse (Priority: P2)

1. Right after Story 1, note when the model files were last written:
   ```bash
   ls -la ~/.codegraph/models/all-MiniLM-L6-v2/
   ```
   Record the timestamps shown.

2. Run the same local index command again:
   ```bash
   CODEGRAPH_EMBEDDING_PROVIDER=local node dist/bin/codegraph.js index
   ```
   **Expected:** no "downloading model…" message this time — the run goes straight to embedding because the model is already cached.

3. Re-check the timestamps:
   ```bash
   ls -la ~/.codegraph/models/all-MiniLM-L6-v2/
   ```
   **Expected:** identical to step 1 — nothing was re-downloaded.

4. Run `node dist/bin/codegraph.js status` once more.
   **Expected:** coverage still reads 100%, unchanged from Story 1.

- [ ] Story 2 verified: the second run reuses the already-downloaded model with zero new downloads, and coverage stays complete.

### User Story 3 - Offline first run degrades gracefully (Priority: P2)

1. Force the tool into "can't reach the model" conditions using an empty cache folder and an address nothing answers on:
   ```bash
   CODEGRAPH_MODEL_CACHE_DIR=/tmp/codegraph-empty-cache \
   CODEGRAPH_MODEL_BASE_URL=http://127.0.0.1:1/ \
   CODEGRAPH_EMBEDDING_PROVIDER=local node dist/bin/codegraph.js index
   ```
   (Port 1 has nothing listening, so every request fails immediately — simulating being offline with a model that was never downloaded.)

2. Watch it run to completion.
   **Expected:** the command does not hang and does not crash — it finishes normally. The structural index (files, symbols, relationships) is still built in full. Instead of embeddings, you see a plain-English message telling you where it looked for the model and how to supply it yourself.

3. Run `node dist/bin/codegraph.js status` for that same project.
   **Expected:** the Embeddings section shows 0% coverage and states why (e.g., that the model could not be reached).

- [ ] Story 3 verified: an unreachable model source degrades gracefully — the structural index still finishes, the command exits cleanly, and the reason for 0% coverage is shown.

### User Story 4 - Status shows the active local provider (Priority: P3)

1. With local embedding already active and the model downloaded (as in Story 1), run:
   ```bash
   node dist/bin/codegraph.js status
   ```
2. **Expected:** one glance at the output tells you everything about what's embedding the project — the provider (`local`), the exact model name (`Xenova/all-MiniLM-L6-v2`), the vector size (384 dimensions), and the current coverage percentage. No digging through config files required.

- [ ] Story 4 verified: `codegraph status` clearly reports the active provider, model, and vector size in one command.

## FR Coverage Matrix

The spec's individual requirements (FR-001 through FR-024) all roll up into eleven measurable Success Criteria — verifying each Success Criterion below verifies every requirement that feeds it, so this table maps those, not each requirement individually.

| Success Criterion | What it guarantees | Proven by |
|---|---|---|
| SC-001 | Local provider embeds 100% of indexed symbols with no endpoint configured | User Story 1 |
| SC-002 | First local run downloads the model once; every later run reuses it | User Story 2 |
| SC-003 | A model download that fails its integrity check is never used | Negative-Path Tests — "A corrupted or tampered download" |
| SC-004 | With embeddings unconfigured, indexing is untouched — no network call, no embedding data written | Negative-Path Tests — "Nothing configured (dormancy)" |
| SC-005 | If the model can't be obtained, the structural index still completes and the reason is shown | User Story 3 |
| SC-006 | `codegraph status` names the active provider, model, and vector size | User Story 4 |
| SC-007 | Re-embedding unchanged code doesn't add or remove graph nodes/edges | Negative-Path Tests — "Switching from a remote endpoint to local" (self-repo dogfood) |
| SC-008 | Switching from an endpoint to local re-embeds everything automatically, with no manual step | Negative-Path Tests — "Switching from a remote endpoint to local" (self-repo dogfood) |
| SC-009 | Warmed local embedding is fast (single-digit milliseconds per symbol), even on large codebases | Automated performance test suite — not manually timed in this runbook |
| SC-010 | A full local embedding pass doesn't freeze other CodeGraph activity | Negative-Path Tests — "A very large project's embedding pass running in the background" |
| SC-011 | Turning on local embedding doesn't change how AI assistants query the codebase | Automated retrieval-regression check — not part of manual UAT |

FR-024 (keeping the supported Node version range, not meaningfully growing the npm package, and documenting the runtime's size in `BUNDLING.md`) is a packaging/docs constraint checked during code review, not something this runbook exercises interactively.

## Negative-Path Tests

The checks below are the spec's edge cases, rewritten as plain try-this/expect-this steps. Most are easy for anyone to reproduce by hand. A few need adversarial setups (a tampered download source, precisely timed concurrent processes, long-running memory profiling) that aren't practical to stage manually — those are called out separately, with what they guarantee explained in plain language.

**Try these yourself:**

1. **Nothing configured (dormancy).** Try this: with no `CODEGRAPH_EMBEDDING_*` variable set at all, run `node dist/bin/codegraph.js index`. Expect this: the run behaves exactly as it did before this feature existed — no model download, no network call, no embedding data written. (This exact check has already been run clean on this repository: zero network calls, zero embedding writes.)

2. **Provider turned off on purpose.** Try this: set `CODEGRAPH_EMBEDDING_PROVIDER=off` (even with an endpoint URL also set) and run index. Expect this: no embedding happens at all — same as if nothing were configured.

3. **Contradictory settings.** Try this: set an endpoint URL but leave out the endpoint's model name (or vice versa), or set `CODEGRAPH_EMBEDDING_PROVIDER` to a made-up value like `bogus`, then run index. Expect this: the structural index still finishes; instead of crashing, you see a plain message explaining what's misconfigured.

4. **A cache directory that can't be written to.** Try this:
   ```bash
   mkdir -p /tmp/codegraph-ro-cache && chmod 555 /tmp/codegraph-ro-cache
   CODEGRAPH_MODEL_CACHE_DIR=/tmp/codegraph-ro-cache CODEGRAPH_EMBEDDING_PROVIDER=local node dist/bin/codegraph.js index
   ```
   Expect this: a plain message names the cache directory it tried to use and explains it isn't writable; the structural index still completes.

5. **Switching from a remote endpoint to local on a project that's already been embedded.** Try this: on a project previously embedded through a remote endpoint, switch to the local provider and re-index or re-sync. Expect this: every symbol is automatically re-embedded with the local model — no manual data migration — and the number of nodes and edges in the graph is unchanged before and after. **This exact check has already been run against this repository itself:** switching this repo from its remote (HAL) endpoint to the local provider re-embedded everything, landing at 3,733/3,733 (100%) local coverage with node and edge counts unchanged.

**Confirmed by the automated test suite (`npm test`), not something to reproduce by hand:**

- **A corrupted or tampered download.** If the downloaded model bytes don't match the expected checksum, they're discarded and never used — a distinct message says the download failed verification, separate from the "couldn't reach it at all" message.
- **A download that stops partway through.** A half-downloaded file is never treated as usable — the next run re-downloads from scratch instead of trying to use a partial file.
- **A trusted internal mirror.** Pointing the download address at an internal/company-hosted copy of the model still applies the same integrity check to whatever bytes come back.
- **Multiple projects sharing one downloaded model.** Several projects (and CodeGraph's background process for each) can share the single machine-wide copy of the model without corrupting it for one another.
- **A very large project's embedding pass running in the background.** Embedding a big codebase doesn't freeze CodeGraph's other work — answering questions about the code, watching files for changes — while it runs.
- **A broken local runtime.** If the piece that runs the model locally is missing or damaged, the tool doesn't hang forever — it gives up after a short wait and degrades the same way as "model not available."
- **A slow or untrustworthy download source.** A download source that streams extremely slowly, or sends more data than expected, is cut off rather than allowed to hang the tool or fill up disk space.
- **Many projects running at once on one machine.** Each project's embedding work stays isolated to that project — one project's indexing run never gets tangled up with another's.
- **A very long embedding run.** Embedding a huge codebase over a long stretch of time doesn't slowly consume more and more memory without bound.

## Self-Review Findings

**Self-Review:** <not available — workflow file not provided>

## Sign-off

Advisory only — these checkboxes block nothing.

- [ ] Reviewer walked every Per-Story Acceptance Test above.
- [ ] Reviewer confirmed the Negative-Path Tests behave as described.
- [ ] Reviewer is satisfied the PR delivers the behavior the spec promised.

## Rollback

git revert <SHA>; see plan.md for data-migration considerations
