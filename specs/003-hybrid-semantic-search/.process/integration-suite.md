# Post: Integration Suite — SPEC-003 (Hybrid Semantic Search)

- **Date**: 2026-07-10
- **Commit**: `c9cb5ff` (HEAD advanced from `3f6ec9e` to `c9cb5ff` mid-run by a
  concurrent pipeline step — Reviewability Diff Gate — committing
  `docs/ai/specs/.process/autopilot-state.json` only; no source/test files
  touched, so it does not affect this step's results)

## 1. Full suite (official integration pass, post-remediation)

```
npm run build && npm test
```

- Build: clean (`tsc` + `copy-assets` + chmod), no errors.
- Result: **Test Files 165 passed (165) · Tests 2806 passed | 7 skipped (2813)**
- Duration: 51.48s
- Matches expected **2806 passed / 0 failed / 7 skipped** exactly. No
  failures observed (assertion-shaped or timeout/RPC-shaped) — no re-run
  needed.

Isolated confirmation of the FR-014 deterministic CI gate
(`__tests__/hybrid-search.test.ts`, injected fixture vectors, no live
provider) also run standalone: **84/84 passed**, including the SC-002 p95
fusion-compute gate: `p95=85.204ms` vs the `150ms` budget (informational
"within 2x" self-check logged, not a failure).

## 2. Scored eval (`npm run eval`) — BLOCKED, not run to completion

Read `__tests__/evaluation/runner.ts` and `__tests__/evaluation/test-cases.ts`
first, per instructions.

**How the harness acquires embeddings**: `runner.ts` does not inject fixture
vectors itself. It takes `EVAL_CODEBASE` (env or argv), requires a
**pre-existing** `<EVAL_CODEBASE>/.codegraph/codegraph.db` (`CodeGraph.openSync`
against it — exits 1 if absent), and calls `cg.searchNodes(tc.query, {..., mode:
tc.mode})` / `cg.findRelevantContext(...)` against whatever is already indexed
there. Query-time embeddings for `mode: 'hybrid'` cases therefore come from
whatever embedding provider is configured (live) plus whatever vectors were
produced when that external codebase was indexed — nothing in the eval harness
itself seeds deterministic vectors (that seeding only happens in
`hybrid-search.test.ts`'s CI gate, per FR-014 / spec.md and confirmed by
`quickstart.md`: "No embedding provider required for the CI gates (they inject
fixture vectors). A live provider is only needed for the dogfood UAT" and
"Not a `npm test` gate — the richer scored view").

**The blocker**: `test-cases.ts`'s 12 pre-existing cases plus the 4 new
`hybrid-paraphrase-*` cases (T028) all target **Elasticsearch-shaped symbols**
(`TransportService`, `RestHandler`, `BaseRestHandler`, `BulkRequest`,
`AllocationService`, `InternalEngine`, `ReadOnlyEngine`, `SearchShardsRequest`,
etc.) — this is a fixed, pre-existing external corpus assumption (present since
the original eval-framework commit `13d3ff3`, unrelated to SPEC-003), not
something SPEC-003 introduced or can supply. No such indexed codebase exists
on this machine:

- Confirmed `.envrc.local` at the main checkout root (`../../.envrc.local`)
  has a live embedding provider configured (`CODEGRAPH_EMBEDDING_URL`/`_MODEL`/
  `_DIMS`/`_TIMEOUT_MS` present — names only checked, no values echoed/persisted,
  per instructions), so the provider side is NOT the blocker.
- Searched for an Elasticsearch clone or any other `.codegraph/`-indexed
  project on disk (`find / -iname elasticsearch`, `find / -iname '*.codegraph*'`)
  — none found beyond scratch/smoke-test dirs and this repo's own worktrees.
  `TransportService`/etc. do not appear anywhere in this repo outside
  `test-cases.ts` and `quickstart.md`'s illustrative snippet.
- A stale, git-ignored prior report already in `__tests__/evaluation/results/`
  (`2026-07-10T16-03-44-025Z.json`, commit `8247afb`) shows exactly this
  failure mode: someone ran `npm run eval` with `EVAL_CODEBASE` pointed at
  **this worktree itself** (the only locally indexed target) — all 16 cases
  scored `pass: false, recall: 0` because this repo doesn't contain any of the
  expected Elasticsearch symbols. Re-running against this worktree would only
  reproduce that same non-signal, so it is not reported here as if it were
  FR-014 evidence.

**Did not improvise a workaround** (e.g., did not clone/index Elasticsearch —
out of scope for this read-only step and a multi-GB undertaking; did not
fabricate scores). Flagging per the "STOP and report" / "SendMessage the
specific blocker" instruction.

## Verdict

1. **Full suite: PASS** — 2806/0/7, exact match to expected, no anomalies,
   no re-run required. FR-014's deterministic CI gate (`hybrid-search.test.ts`)
   independently reconfirmed 84/84, p95 85.2ms < 150ms budget.
2. **Scored eval: BLOCKED (not a code/test regression)** — `npm run eval`
   requires an external, pre-indexed large real-world codebase
   (Elasticsearch-shaped) that does not exist in this environment; no scored
   report was produced. This is a pre-existing eval-harness environment
   dependency (predates SPEC-003), not a new failure introduced by this spec.
