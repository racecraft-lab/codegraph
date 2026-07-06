# Slice 3 Validation

## Real-Server Validation (T084-T089, T094)

```text
node scripts/spec-008-validate-real-servers.mjs --slice us3
```

Result: passed on `darwin/arm64`.

| Language | Server command | Probe command | Resolved executable | Version/status evidence | SDK/disposition evidence |
|---|---|---|---|---|---|
| C# | `csharp-ls` | `csharp-ls --version` | `/opt/homebrew/bin/csharp-ls` | exit 0; `csharp-ls, 0.25.0 (Punia)+19a9574d7577521555f49bf49e94688a3ba67dd2` | n/a |
| Kotlin | `kotlin-language-server` | `kotlin-language-server --version` | `/opt/homebrew/bin/kotlin-language-server` | exit 1; probe reported unsupported `--version` flag | n/a |
| PHP | `intelephense --stdio` | `intelephense --version` | `/opt/homebrew/bin/intelephense` | exit 1; probe reached the installed executable and emitted its local error banner | n/a |
| Ruby | `ruby-lsp` | `ruby-lsp --version` | `/opt/homebrew/bin/ruby-lsp` | exit 0; `0.26.9` | n/a |
| Dart | `dart language-server` | `dart --version` | `/opt/homebrew/bin/dart` | exit 0; Dart SDK `3.12.2` on `macos_arm64` | n/a |
| Vue | `vue-language-server --stdio` | `vue-language-server --version` | `/opt/homebrew/bin/vue-language-server` | exit 0; `3.3.6` | TypeScript SDK resolved at `node_modules/typescript/package.json` |
| COBOL | n/a | n/a | n/a | n/a | future-owned by `SPEC-024`; parser/resolver parity remains SPEC-008 evidence |

Coverage summary: 6 verified, 1 future-owned, 0 missing, 0 unowned.

Validation remains prerequisite-only: the helper records command availability,
resolved executable paths, TypeScript SDK evidence for Vue, and the COBOL
future-owned disposition without installing servers or holding long-running
stdio sessions open. Normal `codegraph index --lsp` degradation remains
per-language runtime behavior if a resolved server later fails initialize,
request, or shutdown.

## Bounded Watch Verification (T068-T069, T091-T095)

```text
npm test -- __tests__/lsp-watch.test.ts
```

RED result before implementation: failed 5/5 on missing watch batch context,
unfiltered watch candidates, missing absent/unbounded/oversized skip reasons,
missing watch work-cap skip, and restart budget resetting for the same material
watch batch.

GREEN result after implementation: passed 5/5.

```text
npm test -- __tests__/lsp-watch.test.ts __tests__/lsp-status.test.ts __tests__/lsp-precision-pass.test.ts
```

Regression result: passed 19/19.

Evidence recorded:

- Watcher debounce callbacks now receive a bounded `changedSourceFiles` batch
  and sorted `materialBatchKey`.
- Watch LSP precision filters candidate work to the bounded changed-file set
  at candidate discovery and again before server probing or JSON-RPC requests.
- Absent, unbounded, and oversized changed-file sets record
  `watch-changed-files-absent`, `watch-changed-files-unbounded`, or
  `watch-changed-files-cap-exceeded` without server starts.
- Per-language watch candidate work over cap records `watch-work-cap-exceeded`
  and leaves structural sync unaffected.
- Watch restart exhaustion is keyed by language plus material changed-file
  batch; the same failed batch does not start another server pair, while a new
  changed-file batch gets its own one-restart budget.

## Self-Repo Dogfood (T102-T104)

Self-repo dogfood evidence is recorded in `validation/self-repo-dogfood.md`.

Summary:

- The worktree-local `.codegraph/` index was initialized before final dogfood
  so status evidence did not reuse the parent checkout index.
- Non-LSP baseline: `node dist/bin/codegraph.js index` passed with 425 files,
  6,233 nodes, and 25,189 edges in 2.3s.
- Explicit LSP opt-in: `node dist/bin/codegraph.js index --lsp` passed with the
  same graph shape in 2.2s.
- Status evidence reported `worktreeMismatch: null`, LSP enabled by
  `cli-enable`, initialized JavaScript, TypeScript, and Python servers, and a
  deterministic TypeScript `full-index-work-cap-exceeded` skip for 2,001
  candidate work items.

## Representative Validation Packet (T105)

| Size class | Evidence | Result |
|---|---|---|
| Small | Focused fake-server and graph fixtures in `__tests__/lsp-precision-pass.test.ts`, `__tests__/lsp-watch.test.ts`, and `__tests__/lsp-retrieval-regression.test.ts` | Validates correction, suppression, ambiguity no-op, bounded watch skip reasons, restart budgets, and retrieval hiding of inactive audit rows. |
| Medium | Self-repo dogfood in this feature worktree | Validates default structural indexing, explicit LSP opt-in, status reporting, initialized local servers, and no duplicate active node or edge growth. |
| Large or bounded-cap representative | Self-repo TypeScript full-index work cap plus watch oversized-batch tests | Validates deterministic capped completion with `full-index-work-cap-exceeded`, `watch-changed-files-cap-exceeded`, and `watch-work-cap-exceeded` instead of an unbounded repository-wide LSP pass. |

Traceability:

- Correction and suppression behavior traces to T063-T076.
- Slice-2 and slice-3 real-server rows trace to T077-T089 and T094.
- Bounded watch behavior traces to T068-T069 and T091-T095.
- Language and capability parity traces to T096-T101.
- Self-repo dogfood traces to T102-T104.

Scope budget and non-goals:

- SPEC-008 remains opt-in and does not install language servers.
- SPEC-008 does not add a CodeGraph-as-LSP-server facade.
- SPEC-008 does not implement rename/refactor operations.
- SPEC-008 does not activate LSP from PATH discovery alone.
- SPEC-008 does not add remote network dependencies.

Parity closure:

- `scripts/spec-008-parity-gate.mjs` passes with 18 language rows, 17
  capability rows, and zero unowned rows.
- Future-owned parser/resolver and non-LSP product capabilities are explicitly
  assigned to SPEC-024 in the parity artifacts.

Known gaps:

- COBOL LSP parity remains future-owned by SPEC-024.
- Capability rows outside SPEC-008's LSP precision scope remain future-owned by
  SPEC-024 where recorded.
- Self-repo dogfood validates only languages present in this repository; other
  language-server rows are validated through real-server prereq/smoke coverage.

Rollback:

- Omit `--lsp`, pass `--no-lsp`, or set `codegraph.json.lsp.enabled` to
  `false`.
- Structural indexing remains the default and continues to produce the baseline
  graph without starting LSP subprocesses.

Review order:

1. Review `src/lsp/` foundation, client, status, correction, and precision-pass
   logic.
2. Review `src/index.ts` and `src/sync/` integration points.
3. Review database query filtering for inactive LSP audit rows.
4. Review validation scripts and SPEC-008 validation artifacts.
5. Review tests last against the story boundaries in `tasks.md`.
