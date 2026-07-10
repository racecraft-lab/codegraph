# Quickstart & Validation Guide: Hybrid Semantic Search

Runnable scenarios that prove SPEC-003 end-to-end. Details live in [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), and [contracts/](./contracts/).

## Prerequisites

```bash
# From the worktree root:
npm install
npm run build            # tsc + copy-assets (no new asset to wire — pure JS)
npm run typecheck        # tsc --noEmit
```

- Node ≥ 22.5 from source (for `node:sqlite`).
- No embedding provider required for the CI gates (they inject fixture vectors). A live provider is only needed for the dogfood UAT.

## Deterministic CI gates (FR-014 / SC-001,002,004) — the primary proof

The gates live in a new top-level test file picked up by `npm test` (the `__tests__/**/*.test.ts` glob; `__tests__/evaluation/` is excluded):

```bash
npx vitest run __tests__/hybrid-search.test.ts    # the three FR-014 clauses
npm test                                          # full suite stays green
```

Expected — three clauses assert (see research.md D11):
- **(a) Hit-rate**: aggregate hybrid hit-rate ≥ aggregate keyword hit-rate over a ≥3-case paraphrase fixture with ≥1 semantic-only case; that case's own contribution **strictly greater** under hybrid; the **semantic arm alone** surfaces its target. Fixture obeys the non-tautology rules (spec Assumptions): target avoids FTS token-prefix match on `name`+`qualified_name`+`docstring`+`signature`; ≥1 decoy token-matches; vectors hand-built unit-normalized, seeded via `upsertNodeVector` under the **exact model id the test query-provider seam reports**.
- **(b) Byte-stability**: existing keyword cases structurally deep-equal + `matchType`/`fusedScore` **absent** (not undefined); internal callers make **zero** query-embed calls (provider-seam spy). Asserted independently of (a).
- **(c) p95**: generated 50k×384 fixture from a seeded pure-JS PRNG (no committed binary, no `Math.random`), fusion leg only, `performance.now()`, 10-iteration warmup discard, N=200, nearest-rank `sorted[189]`, single `expect(p95).toBeLessThanOrEqual(150)`, no retry.

## Scored eval report (Q9)

```bash
npm run eval             # builds, then runs __tests__/evaluation/runner.ts
```

Expected: the report includes the new semantic/paraphrase cases (added to `__tests__/evaluation/test-cases.ts`; `EvalTestCase` gains an optional `mode`). Not a `npm test` gate — the richer scored view.

## Surface smoke checks (US1–US4)

```bash
# US4 — dormant (no provider): keyword-shape results, no [tag]. Default (auto) appends
# the FR-015 degradation footer; only explicit --mode keyword is footer-free / byte-identical.
node dist/bin/codegraph.js query "TransportService" --limit 5

# US2 — explicit modes at the CLI surface
node dist/bin/codegraph.js query "retry failed http calls" --mode hybrid --json   # matchType + fusedScore present
node dist/bin/codegraph.js query "retry failed http calls" --mode keyword         # no new fields

# US3 — degradation is success-shaped (no vectors / no provider): keyword results + a footer note, exit 0
node dist/bin/codegraph.js query "retry failed http calls" --mode hybrid          # expect string 1 or 2 footer

# FR-017 — status availability line
node dist/bin/codegraph.js status                                                 # "Hybrid search available: yes|no (reason)"
```

MCP surface: `codegraph_search` accepts optional `mode`; semantic/hybrid hits carry the `[keyword]/[semantic]/[both]` tag and (non-degraded) the timing footer; degraded → success-shaped hint, never `isError`.

## Dormancy check (Constitution VII / SC-004)

On a project with **no vectors and no provider**, the dormant surfaces stay byte-identical to pre-feature under explicit `--mode keyword`, in the `--json` result shape, and on the produce side — zero network calls, zero schema writes. The default-`auto` TEXT surface additively gains the FR-015 degradation footer by design (US3/FR-015); it is not part of the byte-identity claim. Proven by the FR-014(b) gate and verified by running the smoke checks against an un-embedded project.

## Pre-merge agent A/B (Q10 / Constitution VI)

```bash
# New build vs baseline, BOTH codegraph-on, ≥2 runs/arm, Sonnet floor:
scripts/agent-eval/ab-new-vs-baseline.sh <indexed-embedded-repo> "<NL-flavored search task>" [baseline-ref]
# Plus a no-vectors CONTROL repo — expect zero delta.
```

Record results in the UAT runbook. Add the self-repo dogfood step: paraphrase NL queries through `codegraph_search` on this repo's live index (HAL endpoint), plus the dormancy check on an unconfigured project.

## Full verification

```bash
npm run build && npm run typecheck && npm test
```

All green is the floor (Constitution IV). Completion claims carry this evidence plus the A/B numbers.
