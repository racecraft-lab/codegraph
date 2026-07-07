# UAT Runbook: 008-lsp-client-integration

| Field | Value |
|-------|-------|
| Spec | 008-lsp-client-integration |
| Branch | 008-lsp-client-integration |
| PR | Pending until PR is opened |
| Generated from | 2026-07-06T02:32:35Z |



## Env Setup

Use the SPEC-008 worktree as the repository root: from the main checkout, run `cd .worktrees/008-lsp-client-integration`. Build and check the project with `npm run build`, `npm run typecheck`, and `npm test`; the combined check is `npm run build && npm run typecheck && npm test`, and focused checks use `npm test -- path/to/test.ts`.

If `node dist/bin/codegraph.js status . --json` reports `"initialized": false`, run `node dist/bin/codegraph.js init .` once before using the indexing commands below.

## Per-Story Acceptance Tests

### User Story 1 - Opt into compiler-accurate graph precision (Priority: P1)

1. Confirm this baseline run has no project opt-in file:

   ```bash
   test ! -f codegraph.json && echo "no project LSP config"
   ```

   Expect the terminal to print `no project LSP config`. If it does not, remove the temporary `codegraph.json` from a previous UAT step or make sure it does not set `lsp.enabled` to `true`.

2. Run the normal structural index:

   ```bash
   node dist/bin/codegraph.js index .
   node dist/bin/codegraph.js status . --json
   ```

   Expect indexing to complete normally. In the JSON status, language-server precision is disabled or absent for the run, and no LSP-only coverage or `provenance: "lsp"` result is reported.

3. Run the explicit opt-in index:

   ```bash
   node dist/bin/codegraph.js index . --lsp
   node dist/bin/codegraph.js status . --json
   ```

   Expect indexing to complete. In the JSON status, language-server precision is enabled from the CLI, available local servers show observed server details and coverage, and unavailable servers are listed as unavailable or degraded instead of stopping the whole index.

4. Run the library-level retrieval probe:

   ```bash
   node scripts/spec-008-retrieval-probes.mjs
   ```

   Expect the terminal to print `SPEC-008 retrieval probe passed` and to say that public search, callers, callees, impact, and explore-equivalent surfaces are clean.

- [ ] Story accepted: default indexing stays structural until `--lsp` is used, and the library retrieval probe shows LSP audit-only data is hidden from normal graph lookups.

### User Story 2 - Configure local language-server behavior (Priority: P2)

1. Create a temporary `codegraph.json` at the repository root with this content:

   ```json
   {
     "lsp": {
       "enabled": true,
       "defaultTimeoutMs": 5000,
       "watch": { "enabled": true },
       "servers": {
         "typescript": {
           "command": ["typescript-language-server", "--stdio"],
           "timeoutMs": 5000
         }
       }
     }
   }
   ```

2. Run indexing without an LSP command-line flag:

   ```bash
   node dist/bin/codegraph.js index .
   node dist/bin/codegraph.js status . --json
   ```

   Expect the JSON status to show language-server precision enabled from project configuration. If the TypeScript server is installed, the TypeScript-family rows show coverage; if it is missing, those rows are reported as unavailable or degraded while indexing still completes.

3. Run one index with machine-local overrides:

   ```bash
   CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON='["typescript-language-server","--stdio"]' CODEGRAPH_LSP_TYPESCRIPT_TIMEOUT_MS=9000 node dist/bin/codegraph.js index .
   node dist/bin/codegraph.js status . --json
   ```

   Expect the run to use the environment command and timeout for this one shell command. Open `codegraph.json` afterward and confirm the file still contains the original command and `5000` timeout.

4. Prove the command line can disable LSP for one run even when project config opts in:

   ```bash
   node dist/bin/codegraph.js index . --no-lsp
   node dist/bin/codegraph.js status . --json
   ```

   Expect indexing to complete. `codegraph index` is a full structural reindex, so it recreates the database before indexing. The disabled-path contract is that this run performs zero LSP runtime work and writes no new LSP status metadata. In the JSON status, do not use the top-level `lsp.enabled` value alone as proof of the last run because project config may still be enabled. Verify `lsp.lastRunAt` is `null`, LSP edge counters are all zero, and LSP coverage and server rows are empty.

5. Set `"enabled": false` in the temporary `codegraph.json`, then run an environment override without `--lsp`:

   ```bash
   CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON='["typescript-language-server","--stdio"]' node dist/bin/codegraph.js index .
   node dist/bin/codegraph.js status . --json
   ```

   Expect language-server precision to remain disabled. The environment value may choose a command when LSP is active, but it must not activate LSP by itself.

- [ ] Story accepted: project config can opt in, environment values can override command and timeout for one run, CLI disablement wins for one run, and environment variables alone do not turn LSP on.

### User Story 3 - Understand LSP availability and graceful degradation (Priority: P2)

1. Replace the temporary `codegraph.json` with a deliberately unavailable TypeScript command:

   ```json
   {
     "lsp": {
       "enabled": true,
       "servers": {
         "typescript": {
           "command": ["missing-spec008-typescript-lsp", "--stdio"],
           "timeoutMs": 5000
         }
       }
     }
   }
   ```

2. Run the LSP-enabled index and status:

   ```bash
   node dist/bin/codegraph.js index .
   node dist/bin/codegraph.js status . --json
   ```

   Expect structural indexing to complete. In the JSON status, the TypeScript-family server is reported as unavailable or degraded, the selected command is the missing command above, and the report does not silently fall back to a lower-priority default command.

3. Run a focused prerequisite validation for TypeScript-family support:

   ```bash
   node scripts/spec-008-validate-real-servers.mjs --languages=typescript,tsx,javascript,jsx
   ```

   Expect one of two visible results. If the real server and TypeScript SDK are installed, the JSON report lists those rows under `observed`. If anything required is missing, the command exits with a clear message that names the missing language and expected command; that failure applies to validation only, not to normal indexing.

4. Restore the valid config from User Story 2 or delete `codegraph.json` before continuing.

- [ ] Story accepted: missing local servers are visible in status, normal indexing still works, and strict prerequisite validation clearly names what is missing.

### User Story 4 - Complete SPEC-008 with no unowned parity gaps (Priority: P3)

1. Run the full real-server validation:

   ```bash
   node scripts/spec-008-validate-real-servers.mjs
   ```

   Expect a JSON report with a timestamp, platform, CodeGraph version, observed server rows, missing rows, and future-owned dispositions. For final SPEC-008 completion, the `missing` list must be empty for all implemented language rows.

2. Run the coverage ownership check:

   ```bash
   node scripts/spec-008-parity-gate.mjs
   ```

   Expect the terminal to print that the SPEC-008 parity gate passed, including the language-row count, capability-row count, and `0 unowned rows`.

3. Run the retrieval regression probe:

   ```bash
   node scripts/spec-008-retrieval-probes.mjs
   ```

   Expect the terminal to print that the probe passed, including node and edge deltas, one active outgoing edge, hidden inactive audit rows, and clean public retrieval surfaces.

4. Run the bounded watch evidence check:

   ```bash
   npm test -- __tests__/lsp-watch.test.ts
   ```

   Expect the output to show the watch test file completed without a failure block. The named checks cover bounded changed-file batches, absent or unbounded batch skips, oversized batch skips, and reuse of the restart budget for the same changed-file batch.

- [ ] Story accepted: real-server prerequisites, coverage ownership, retrieval behavior, and bounded watch behavior all produce clear completion evidence.



## FR Coverage Matrix

| Promised behavior | Check that proves it |
|---|---|
| Normal indexing stays unchanged until the user opts in | User Story 1, steps 1-2 |
| `codegraph index --lsp` activates language-server precision for one run | User Story 1, step 3 |
| Library retrieval hides inactive audit-only data and keeps public graph lookups clean | User Story 1, step 4 and User Story 4, step 3 |
| Project configuration can enable language-server precision without a CLI flag | User Story 2, steps 1-2 |
| Environment variables can override command and timeout values without editing project config | User Story 2, step 3 |
| CLI disablement wins for one run, and environment variables alone do not activate LSP | User Story 2, steps 4-5 |
| Missing, crashed, or unavailable local servers degrade by language and appear in status | User Story 3, steps 1-3 and Negative-Path Tests, steps 2-4 |
| Strict completion requires real local server evidence | User Story 4, step 1 |
| Language and capability ownership must have no unowned rows | User Story 4, step 2 |
| Bounded watch verification only processes bounded changed-file sets and records skip reasons otherwise | User Story 4, step 4 and Negative-Path Tests, step 7 |


## Negative-Path Tests


1. Try an LSP-enabled index on a temporary project with no supported source files:

   ```bash
   tmpdir="$(mktemp -d)"
   printf '# scratch\n' > "$tmpdir/README.md"
   node dist/bin/codegraph.js init "$tmpdir"
   node dist/bin/codegraph.js index "$tmpdir" --lsp
   node dist/bin/codegraph.js status "$tmpdir" --json
   ```

   Expect indexing to complete. Status should describe languages as not present or not applicable instead of treating the empty project as a failed LSP run.

2. Try a configured command that cannot be resolved by keeping the `missing-spec008-typescript-lsp` config from User Story 3:

   ```bash
   node dist/bin/codegraph.js index .
   node dist/bin/codegraph.js status . --json
   ```

   Expect indexing to complete and status to show the configured command as unavailable. It should not fall back to `typescript-language-server --stdio` while a valid but missing project command is configured.

3. Try invalid environment override values:

   ```bash
   CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON='{"bad":"shape"}' CODEGRAPH_LSP_TYPESCRIPT_TIMEOUT_MS=0 node dist/bin/codegraph.js index . --lsp
   node dist/bin/codegraph.js status . --json
   ```

   Expect a warning or fallback behavior for the invalid values. Status should show a usable project or default command and timeout instead of using the malformed environment values.

4. Try the degraded-server fixture checks:

   ```bash
   npm test -- __tests__/lsp-precision-pass.test.ts -t "degrades a missing server per language while another language still verifies"
   npm test -- __tests__/lsp-precision-pass.test.ts -t "attempts at most one fresh session restart per language before degrading remaining work"
   npm test -- __tests__/lsp-precision-pass.test.ts -t "records shutdown failure degradation without failing the enclosing pass"
   ```

   Expect each named check to complete without a failure block. The output should show that one bad language server does not stop other language work or the surrounding indexing pass.

5. Try ambiguous, external, generated, and unindexed LSP targets:

   ```bash
   npm test -- __tests__/lsp-precision-pass.test.ts -t "suppresses external, generated, and unindexed LSP targets without creating graph nodes"
   npm test -- __tests__/lsp-precision-pass.test.ts -t "leaves ambiguous LSP definitions as a no-op without speculative replacement edges"
   ```

   Expect the checks to complete without a failure block. Ambiguous output should leave the graph unchanged, and external or generated targets should not create new external graph nodes.

6. Try a known wrong graph target with one unique in-workspace LSP target:

   ```bash
   npm test -- __tests__/lsp-precision-pass.test.ts -t "retargets a corrected edge and leaves exactly one active edge at the call site"
   node scripts/spec-008-retrieval-probes.mjs
   ```

   Expect the named check to complete without a failure block, and expect the retrieval probe to say inactive audit rows are hidden from public graph lookups.

7. Try watch batches that are absent, unbounded, or too large:

   ```bash
   npm test -- __tests__/lsp-status.test.ts -t "rejects absent, unbounded, and oversized watch scopes without a repository-wide fallback"
   npm test -- __tests__/lsp-watch.test.ts -t "records absent, unbounded, and oversized changed-file skip reasons without probing servers"
   npm test -- __tests__/lsp-watch.test.ts -t "skips watch verification for a language whose changed-file candidate work exceeds the cap"
   ```

   Expect the output to show the named checks completed without a failure block. Status should record skip reasons, and no repository-wide LSP pass should start from an unsafe watch batch.

8. Try incomplete ownership evidence by running the normal coverage ownership check:

   ```bash
   node scripts/spec-008-parity-gate.mjs
   ```

   Expect the command to pass only when every language and capability row has evidence or a concrete numbered future owner. If a row is empty, generic backlog-owned, or unowned, the command should fail and print the specific row name.

## Self-Review Findings

**Self-Review:** No self-review findings were provided by the workflow.

## Sign-off

Advisory only — these checkboxes block nothing.

- [ ] Reviewer walked every Per-Story Acceptance Test above.
- [ ] Reviewer confirmed the Negative-Path Tests behave as described.
- [ ] Reviewer is satisfied the PR delivers the behavior the spec promised.

## Rollback

Use `git revert SHA` for the PR commit; see plan.md for data-migration considerations.
