# T029 — Scoped Agent A/B Evidence (SPEC-003 Hybrid Semantic Search)

**Date:** 2026-07-10 (UTC)
**Executor:** speckit-pro implement-executor (resumed after predecessor API stall)
**Task ID:** T029 (Phase 7 Polish, SPEC-003)

## 1. What was measured & why the harness is bespoke

Goal: isolate the retrieval effect of SPEC-003's **query-time hybrid semantic
search** — the WORKTREE build (NEW, SPEC-003) vs the MAIN-checkout build
(BASELINE, pre-SPEC-003) — both reading the **same already-embedded index**, on
a natural-language / paraphrase-flavored search task that avoids exact symbol
tokens.

**Harness decision — kept the predecessor's `ab-spec003.sh`, did not use the
canonical `scripts/agent-eval/ab-new-vs-baseline.sh` verbatim.** The canonical
script (a) rsyncs the target **excluding `.codegraph`** and re-runs `codegraph
init` with **no embedding env**, so the per-arm copy carries **zero vectors**,
and (b) spawns the daemon with no endpoint env. Under both conditions SPEC-003's
hybrid path is **dormant in both arms** → a null A/B that proves nothing about
the feature. The wrapper keeps the canonical methodology identical (pre-warmed
persistent daemon, `CODEGRAPH_WASM_RELAUNCHED=1` fast attach, Sonnet floor, ≥2
runs/arm, judge by `parse-run.mjs` "by type") but:

- copies the already-embedded `.codegraph` (DB paths are **relative** — verified
  `files.path` = `.claude/hooks/...`, not absolute — so vectors survive the
  copy and resolve against the daemon's `--path` root);
- sources the private HAL embedding endpoint into the daemon env so the NL query
  is embedded **at query time** (the semantic arm actually runs);
- NEW = worktree build, BASELINE = main-checkout build (main == pre-SPEC-003),
  no `src` checkout gymnastics. `schema.sql` is byte-identical (schema v8), so
  both builds read the same DB with no migration.

The wrapper adds genuine, necessary value over the canonical script, so it was
invoked directly (not discarded).

## 2. Readiness verification (all passed before any run)

| Check | Result |
|---|---|
| Main checkout embeddings | `4,473 / 4,473` vectors, coverage **100%** (`node_vectors` table) |
| HAL endpoint reachable | `http://hal:1234/v1/embeddings` → returns real 3584-dim embeddings (probe) |
| Env sourcing | `.envrc.local` sources via **absolute** path (wrapper's `$MAIN/.envrc.local`); vars `CODEGRAPH_EMBEDDING_URL/MODEL/DIMS/TIMEOUT_MS` |
| NEW build query-time semantic | `query --mode semantic` fires; footer `semantic: embed 121ms · fusion 31ms`; results tagged `[semantic]` |
| BASE build isolation | main `query` has **no `--mode` flag** → clean pre-SPEC-003 baseline (no query-time semantic path) |
| DB path portability | paths stored **relative** → copy-to-/tmp + `--path` works |

## 3. Model policy compliance

**Every arm ran `claude --model sonnet --effort high`** (the scripts' default;
not overridden). Both arms identical model. No Opus/Fable. Verified in the live
process table (e.g. `claude -p ... --model sonnet --effort high
--max-budget-usd 4`).

## 4. Experimental A/B — agent runs (embedded target)

Target: `/tmp/ab-spec003/experimental/{t-new,t-base}` (copies of the MAIN
checkout, embedded `.codegraph` preserved, 4,473 vectors in each copy).
Task (verbatim):

> Locate the part of this codebase that decides, at runtime, which mechanism is
> used to turn source code into numeric vector representations when more than one
> option is configured, and explain the order of precedence it applies. Do not
> modify any files; report your findings only.

Invocation (per run, via wrapper): pre-warm persistent daemon for the arm's
target, then
`(cd <target> && claude -p "<task>" --output-format stream-json --verbose
--permission-mode bypassPermissions --model sonnet --effort high
--max-budget-usd 4 --strict-mcp-config --mcp-config <arm.json>)`, parsed with
`scripts/agent-eval/parse-run.mjs`.

| Arm | Run | Duration | Bash | Read | **codegraph** | Turns | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| NEW  | 1 | 39s | 5 | 3 | **0** | 9 | 444,679 / 2,032 | $0.389 |
| NEW  | 2 | 25s | 3 | 2 | **0** | 6 | 249,673 / 1,651 | $0.276 |
| BASE | 1 | 32s | 5 | 2 | **0** | 8 | 362,715 / 1,848 | $0.367 |
| BASE | 2 | 41s | 5 | 3 | **0** | 9 | 436,029 / 2,266 | $0.337 |

**Per-arm aggregates (ranges — n=2, variance is real):**

- NEW:  duration **25–39s**, Bash **3–5**, Read **2–3**, codegraph **0**, cost $0.28–0.39
- BASE: duration **32–41s**, Bash **5**, Read **2–3**, codegraph **0**, cost $0.34–0.37

**Agent-A/B verdict: NULL (no measurable delta).** The ranges overlap entirely,
and — the decisive point — **Sonnet did not call `codegraph_explore` in either
arm** (confirmed: 0 `mcp__codegraph__*` tool_use blocks in the new-arm jsonl).
The daemon attached fine ("codegraph tools exposed: 1"), but with only the
single `explore` tool surfaced and a warm shell available, the agent chose
`grep`/`Read` in both arms. This is exactly the low-salience / Read-displacement
wall documented in `CLAUDE.md` ("the agent falls back to Read/Grep the instant a
codegraph answer is insufficient" / "the agent under-picks even `explore`"). It
is an honest result about **agent adoption**, and it means the agent A/B **cannot
isolate the semantic feature's retrieval quality** — so a deterministic probe was
added (§5).

## 5. Deterministic probe A/B — isolates the feature (independent of agent adoption)

Per `CLAUDE.md`'s validation methodology, step 2 (deterministic probes) is
separate from step 3 (agent A/B). Same NL query run through each mode of the NEW
build vs the BASE build, judged against **ground truth**.

- **Query:** `decide at runtime which mechanism turns source code into embeddings
  when multiple are configured and the precedence order it applies`
- **Ground truth:** `src/embeddings/config.ts` → **`loadEmbeddingConfig(env,
  providerOverride)`** (line 257) — reads `CODEGRAPH_EMBEDDING_PROVIDER` and
  applies the SPEC-002 explicit-selection precedence (local / endpoint / off).
  This is the exact answer the NL task asks for.

| Engine | Rank of ground truth (`loadEmbeddingConfig`) | Top hit | Tags |
|---|---|---|---|
| BASE keyword-only (main) | **MISS** (not in top 6) | `Order` (test fixture), `source` constants | — |
| NEW `--mode keyword` | **MISS** (byte-identical to BASE) | same as BASE | — |
| NEW `--mode semantic` | **#1** ✓ | `loadEmbeddingConfig` | `[semantic]` |
| NEW `--mode hybrid` | **#1** ✓ | `loadEmbeddingConfig` | `[both]` (kw+sem fused) |
| NEW `--mode auto` | **#1** ✓ | `loadEmbeddingConfig` | `[both]` |

**Probe verdict: decisive feature win.** The NL query — which uses "source code"
and "mechanism", tokens that keyword FTS matches against irrelevant symbols
(`source` string properties, an `Order` fixture) — buries the correct answer
**outside the top 6** under keyword-only. The SPEC-003 semantic/hybrid path ranks
it **#1**. `NEW --mode keyword` == `BASE` byte-for-byte confirms the ONLY
difference between the builds is the new semantic/hybrid capability (clean
isolation). Query-time cost is small (embed ~121ms · fusion ~31ms).

This is the measurement the agent A/B could not provide: with the semantic path
actually exercised, SPEC-003 turns a keyword miss into a rank-1 hit on a
paraphrased query.

## 6. Control — zero delta when the feature is dormant

### 6a. Deterministic dormancy control (ran; passed)

NEW build, `--mode auto`, with the embedding endpoint env **unset**
(`env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL ...`):

- Output degrades to **exactly the keyword results** (`Order`, `source`
  constants/properties) — **no `[semantic]`/`[both]` tags, no crash**.
- **Zero delta vs BASE keyword.** Confirms SPEC-003's dormancy guarantee: when
  embeddings can't run, the new build behaves identically to the pre-SPEC-003
  baseline. (Consistent with dormancy proofs T025–T027.)

### 6b. Agent-level control (wrapper `control 2` — no-vectors, no endpoint) — ran

Strips `node_vectors` from both `/tmp/ab-spec003/control/{t-new,t-base}` copies
(verified `control vectors after strip: 0`) and sources **no** endpoint env →
hybrid dormant in both arms → expect new ≈ base.

| Arm | Run | Duration | Bash | Read | **codegraph** | Turns | Notes |
|---|---|---|---|---|---|---|---|
| NEW  | 1 | 41s | 5 | 4 | **0** | 10 | clean grep+read |
| NEW  | 2 | 47s | 8 | 4 | **0** | 13 | clean grep+read |
| BASE | 1 | — | 12 | 7 | **0** | 1 | spawned `Agent` subagent (delegated) |
| BASE | 2 | — | 4 | 4 | **0** | 2 | spawned `Agent` + `ScheduleWakeup` |

All 4 runs `subtype:success`, `is_error:false`, empty stderr.

**Control verdict at the feature level: zero delta (consistent).** No arm made
any `codegraph` call (0 in all four), so with vectors stripped the SPEC-003 path
was never a factor — exactly the dormant-feature expectation. The two BASE runs
exhibited erratic *agent-side* behavior (delegating to a subagent, scheduling a
wakeup) with very short top-level `num_turns`; this is Claude harness variance,
**not** a SPEC-003 signal — the BASE build is pre-SPEC-003 and the copies had
zero vectors, so it is structurally impossible for the feature to have caused
it. The load-bearing dormancy evidence is the deterministic §6a result (clean
keyword parity, no crash); this agent-level control corroborates "no
feature-driven delta when dormant" while illustrating the same agent-adoption
noise seen in §4. Reported honestly rather than smoothed over.

## 7. Honest interpretation

1. **Feature works, measured deterministically (§5).** On a paraphrased NL query
   where keyword search misses the answer entirely (rank > 6), SPEC-003's
   semantic and hybrid modes rank the correct symbol #1. `--mode keyword` on the
   new build reproduces the baseline exactly, isolating the win to the new
   capability. This is the core SPEC-003 value proposition, confirmed.

2. **Agent adoption is the bottleneck, not retrieval quality (§4).** Sonnet did
   not invoke `codegraph_explore` in any arm, so the end-to-end agent A/B shows
   no delta. This reproduces the documented salience wall (`CLAUDE.md`:
   "Adapt the tool to the agent"): the feature can only help an agent that calls
   the tool, and on this NL task the floor model chose `grep`. Improving that is
   an agent-steering problem (out of SPEC-003's scope), **not** a retrieval-
   quality problem — §5 shows the retrieval itself is strong.

3. **Dormancy is clean (§6a).** With embeddings unavailable the new build is
   byte-for-byte baseline behavior — no regression, no crash.

4. **Variance caveat.** n=2/arm; agent-run durations reported as ranges. No
   conclusion is drawn from any single run. The deterministic probe (§5) is not
   subject to run-to-run agent variance and carries the load-bearing verdict.

## 8. Reproduction

```bash
# Experimental agent A/B (new×2, base×2):
bash specs/003-hybrid-semantic-search/.process/ab-spec003.sh experimental 2

# Agent-level control (vectors stripped, no endpoint):
bash specs/003-hybrid-semantic-search/.process/ab-spec003.sh control 2

# Deterministic probe A/B (feature isolation) — from the MAIN checkout:
Q="decide at runtime which mechanism turns source code into embeddings when multiple are configured and the precedence order it applies"
( set -a; . ./.envrc.local; set +a
  for m in keyword semantic hybrid auto; do
    CODEGRAPH_WASM_RELAUNCHED=1 node .worktrees/003-hybrid-semantic-search/dist/bin/codegraph.js query "$Q" --mode $m --limit 6 --path .
  done
  node dist/bin/codegraph.js query "$Q" --limit 6 --path . )   # BASE keyword-only

# Deterministic dormancy control:
env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL CODEGRAPH_WASM_RELAUNCHED=1 \
  node .worktrees/003-hybrid-semantic-search/dist/bin/codegraph.js query "$Q" --mode auto --limit 6 --path .
```

Raw logs: `/tmp/ab-spec003/{experimental,control}/` (`run-*.jsonl`, `run-*.err`,
`daemon-*.log`, driver logs one level up).
