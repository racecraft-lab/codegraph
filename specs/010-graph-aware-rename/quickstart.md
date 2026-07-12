# Quickstart & Validation Runbook: Graph-Aware Rename

Runnable scenarios that prove SPEC-010 end-to-end, organized by slice. Each scenario names the requirement(s) and success criteria it exercises. Implementation detail lives in `plan.md` / `data-model.md` / `contracts/`; this file is the *run guide*.

## Prerequisites

```bash
# From the worktree root
npm install
npm run build            # tsc + copy-assets; also builds dist/bin/codegraph.js

# Index a target project (a temp fixture, or this repo for the dogfood step)
node dist/bin/codegraph.js init <project>
node dist/bin/codegraph.js status     # confirm indexed; LSP enabled where servers exist
```

- Tests: `npx vitest run __tests__/refactor-plan.test.ts` (Slice 1), `npx vitest run __tests__/refactor-apply.test.ts __tests__/rename-mcp.test.ts` (Slice 2). Full gate: `npm run build && npm test`.
- All fixtures are built with `fs.mkdtempSync` and torn down in `afterEach`; real files + real SQLite, no mocking.
- Platform-sensitive assertions are `it.runIf`-gated; Windows is deferred (see Known Gaps).

---

## Slice 1 — read-only plan engine + CLI dry-run

### S1-A · Preview a rename (US1 / SC-001 / FR-001,002)

```bash
node dist/bin/codegraph.js rename oldFn newFn
```

**Expect**: a human table listing every affected file, the range per edit, a before/after preview, and a per-edit confidence tier; **no file on disk changes**; exit `0`. Re-run with `-j/--json` and expect the `rename-plan.schema.json` object (`applied:false`).

### S1-B · LSP path vs graph path (US1 / FR-003)

Run S1-A once against a symbol in an LSP-covered language (a configured+available server, e.g. TypeScript) and once against a language with no configured server. **Expect**: both produce a plan; edits from the server carry `source:"lsp"`, edits from graph references carry `source:"graph"`.

### S1-C · Empty-reference plan is valid (US1 / FR-002)

Rename a symbol with no references beyond its declaration. **Expect**: the plan still lists the declaration edit; it is a valid plan, not an error; exit `0`.

### S1-D · Ambiguity refusal teaches the retry (US2 / SC-003 / FR-007,008)

```bash
node dist/bin/codegraph.js rename handle process     # name matches several symbols
```

**Expect**: refusal, **zero writes**, exit `2`; output lists every candidate with kind, `file:line`, and the exact qualifier that selects it. Retry with the printed `Class.method` (or `--file`/`--kind`) qualifier ⇒ a plan is produced, exit `0`, **with zero files read to disambiguate**.

### S1-E · Kind-coverage refusals (US2 / FR-010,011)

- Graph-path rename of a local/parameter ⇒ refusal "no local usage tracking — needs a language server", exit `2`.
- Rename of a `file`/`route`/`import`/`export` kind ⇒ refusal "out of scope", exit `2` (every path).

### S1-F · Confidence tiers + false-positive exclusion (US2 / FR-004,005 / SC-008)

Against a fixture containing a shadowing declaration, an import alias, and a string-similar name, plus references of differing provenance. **Expect**: shadowing/alias/string-similar occurrences are **absent** from the edits (span verification dropped them); each surviving edit's tier matches the FR-004 `resolvedBy`/provenance table (data-model.md); a comment/string containing the old name is never in the edits.

---

## Slice 2 — apply safety ladder + MCP tool

### S2-A · Apply an all-exact plan (US3 / SC-002 / FR-014,020)

```bash
node dist/bin/codegraph.js rename oldFn newFn --apply
```

**Expect**: files rewritten within the workspace jail, touched files re-synced via the resolution-complete path, post-check green, exit `0`. Verify the graph now resolves `newFn` and reports zero dangling `oldFn` references in the touched files.

### S2-B · Heuristic gate (US3 / FR-015)

On a plan containing a `heuristic` edit: `--apply` **without** `--include-heuristic` ⇒ refusal listing the gated edits, exit `2`, zero writes. Re-run **with** `--include-heuristic` ⇒ proceeds.

### S2-C · Stale-span abort (US3 / SC-004 / FR-016)

Index a fixture, then mutate a target file on disk (so bytes drift from the index). `--apply`. **Expect**: span verification aborts the **entire** apply with a "stale index — run codegraph sync" refusal, exit `2`, **zero writes**.

### S2-D · Post-check rollback (US3 / SC-002 / FR-018,019)

Force a post-check failure (induce a dangling old-name reference after writing). **Expect**: every touched file restored **byte-identically** from its snapshot, the index re-synced, the refusal reports which references dangled, exit `3`; the workspace is byte-identical to pre-apply.

### S2-E · Workspace jail (US3 / FR-017 / SC-006)

- A plan whose LSP workspace edit names a file whose symlink-resolved path is **outside** the root ⇒ whole-plan refusal naming the file, success-shaped, at plan and apply time; zero writes.
- A plan touching an **in-root but scope-ignored** file (gitignored / `codegraph.json`-excluded) ⇒ whole-plan refusal naming the file; never a silent write, never a silent skip.

### S2-F · Failed-rollback malfunction (edge case / FR-019a / exit 4)

Induce a restore failure during rollback (e.g. a touched file made unwritable after the write). **Expect**: an **error-shaped** response (CLI exit `4`; MCP `isError:true`); it reports which files were restored and which were not, and persists unrestored snapshots to `.codegraph/rename-recovery-<pid>-<hex>/`; it may note that retrying the *restore step* is safe but never invites re-running the rename.

### S2-G · MCP parity + success-shaped refusals (US4 / SC-005,006,007 / FR-021,022,023,028)

- Call `codegraph_rename` over MCP without `apply` ⇒ plan payload, nothing on disk changed; the JSON is byte-identical to the CLI `--json` for the same request.
- Call with `apply: true` ⇒ mirrors the CLI apply ladder.
- Trigger each recoverable refusal (ambiguous, heuristic-gated, stale span, not indexed, unsupported kind, out-of-root, scope-ignored) ⇒ every response is **success-shaped** (`textResult`, no `isError`); only the failed-rollback case is `isError`.
- Confirm the tool is listed in the default set (second after `explore`) and its annotations are `readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false`.

### S2-H · Retrieval no-regression A/B (SC-007 / FR-024)

Run `scripts/agent-eval/` with vs without the new default surface on a control repo, ≥2 runs/arm, `--model sonnet --effort high`. **Expect**: no measurable retrieval regression (Read/Grep count and wall-clock within noise). Record the numbers in the PR packet.

### S2-I · Self-repo dogfood UAT (SC-009 / constitution Dogfooding)

Run a dry-run — and, where safe, an apply — of an internal rename **against this repository itself**. Record the outcome in the UAT runbook.

---

## Known Gaps (carry into the PR packet)

- **Windows validation deferred** (Q10): the write path uses cross-platform Node `fs`; byte-exact span verification turns CRLF/encoding drift into a safe refusal. A Windows apply-path pass and un-gating of `it.runIf(win32)` tests is a tracked follow-up once the VM is restored.
- **Mid-write hard process-kill window** (FR-020): snapshots are held only until the post-check passes, so a hard kill during the write window is a documented v1 durability limitation (best-effort atomicity through verification, not crash-durable).
