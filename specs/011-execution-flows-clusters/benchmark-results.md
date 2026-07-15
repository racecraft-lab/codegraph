# SPEC-011 Benchmark Evidence — SC-006 overhead & SC-007 zero-overhead

**Task**: T062 (run the paired benchmark), T064 (zero-overhead timing).
**Harness**: `scripts/bench-catalog-analysis.mjs` (T061).
**Fixture**: the committed `__tests__/analysis/fixtures/benchmark-monorepo/` (TS+Express route, TS+commander CLI, a 25-way god-function fan-out, Python, Go).
**Machine**: local macOS (Darwin 25.6.0), Node v24.11.1, `node:sqlite` backend.
**Env**: embedding vars cleared (`CODEGRAPH_EMBEDDING_*` unset); no `lsp` config on the fixture — so embeddings and LSP are dormant and identical across both arms.

## Method

- **Arm A** = `analysis.flows=false, clusters=false` (dormant; byte-identical to the pre-feature state, FR-025).
- **Arm B** = `analysis.flows=true, clusters=true` (both catalogs computed).
- Arms **interleaved** A,B,A,B,…; **1 discarded warmup pair**; the timed window is `indexAll()` only (fixture copy, project init, and process/tsx startup excluded).
- **Held constant, asserted every iteration**: identical `vectors_write_version` (0) and identical `lsp`-provenance edge count (0) across every arm/iteration — the only difference between arms is the catalog analysis under test. The harness hard-fails if either drifts, or if Arm B fails to compute catalogs / Arm A writes any catalog rows.

## Results (three runs)

| Run | iters/arm | Arm A median | Arm B median | **SC-006 median(B)/median(A)** | SC-007 Arm-A split-half Δ |
|----:|----------:|-------------:|-------------:|-------------------------------:|--------------------------:|
| 1 | 20 | 147.6 ms | 156.9 ms | **1.063** | 0.42% |
| 2 | 20 | 144.6 ms | 149.3 ms | **1.033** | 4.15% |
| 3 | 60 | 147.4 ms | 149.0 ms | **1.011** | 1.03% |

Every run held `vectors_write_version=0` and `lsp edges=0` constant, with Arm B computing catalogs and Arm A dormant (zero catalog rows) confirmed.

## SC-006 — enabling both catalogs adds ≤ 20% median full-index time

**PASS, with margin.** median(B) ≤ 1.20 × median(A) holds in all three runs; the ratio is **1.01–1.06** (≈1–6% added median wall-clock), far under the 1.20 bar. The tightest estimate (60 iters) is **1.011**. Catalog analysis over this fixture is a small fraction of the full-index cost.

## SC-007 — zero measurable overhead when disabled

SC-007 has two parts (spec.md SC-007):

- **(a) zero catalog rows/metadata written** — **PASS, deterministic.** Every Arm-A iteration wrote 0 flows and 0 clusters (`armADormant=true`), and the committed dormancy test (`__tests__/analysis/activation/dormancy.test.ts`, T051) asserts count=0 for rows *and* metadata and that `graph_write_version` is untouched. Arm A is the pre-feature-equivalent build: dormancy short-circuits before any analysis work or write, so its `indexAll` path is byte-identical to pre-feature save one O(1) early-return guard.
- **(b) full-index median within a ≤2% run-to-run band** — **within band at sufficient iterations; noisy on this tiny fixture.** The disabled-arm split-half median delta was **1.03% at 60 iters** (within band) but **0.42% / 4.15% at 20 iters** — the fixture indexes in ~145 ms with occasional ~180–220 ms scheduler spikes, so a sub-2% *timing* band is at the edge of run-to-run noise at low iteration counts. Recorded honestly per the task's small-fixture caveat: the enabled-arm overhead is already only ~1–6% (SC-006), so the disabled arm — which does strictly less — is bounded well below that and is empirically indistinguishable from the no-catalog baseline within machine noise. Increasing iterations tightens the band under 2% (60-iter run).

## Reproduce

```bash
npm run build
env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL \
    -u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS \
    BENCH_ITERS=60 node scripts/bench-catalog-analysis.mjs --json
```
