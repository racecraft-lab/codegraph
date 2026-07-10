# Retrieval Guardian — SPEC-003 (Hybrid Semantic Search)

**Scope:** `git diff main...HEAD` on `003-hybrid-semantic-search`.
**Changed source of interest:** `src/mcp/tools.ts`, `src/index.ts`, `src/bin/codegraph.ts`, `src/search/hybrid.ts` (new), `src/db/queries.ts`, `src/types.ts`.
**Posture:** read-only. Evidence is file:line against the diff.
**Overall verdict: PASS — no retrieval do-not-regress violation. 0 blocking. 1 advisory.**

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Explore path zero behavioral diff (`codegraph_explore` handler, `getExploreBudget`, `getExploreOutputBudget`, flow-building) | **PASS** | Diff of `src/mcp/tools.ts` contains zero explore identifiers — grep for `explore\|getExploreBudget\|getExploreOutputBudget\|buildFlow\|maxCharsPerFile\|handleExplore` over the diff returns NONE. The two budget functions and the explore handler are not in the changeset; definitionally unchanged. Only `handleSearch` (~1530) and `formatSearchResults` (~4562) were touched. |
| 2 | Error shaping on NEW search paths — degradation must be SUCCESS-shaped, never `isError:true` | **PASS** | Every degradation condition returns a success-shaped `SearchNodesDetailed` via `degraded(...)`: no-provider (`index.ts` runFusedSearch, diff L288), no-vectors (L302), warming (L318–320), embed-failure incl. probe throw (L300), matrix decode throw (L329), **FR-009c memory guard** (L331, `matrixResult.guarded`). `acquireQueryVectorForSearch` NEVER rejects — both `.then` handlers return a value and the budget branch returns `{vector:null,model:null}` (diff L498–555). Grep for added `isError` across all changed source = NONE. No new stop-trying signal introduced. |
| 3 | Hint footers never steer to Read/Grep; steer within the tool surface | **PASS** | The four `DEGRADATION_HINT_STRINGS` (`hybrid.ts:303–338`) each say "showing keyword matches" and point to config (`CODEGRAPH_EMBEDDING_PROVIDER/URL/MODEL`) or `codegraph sync` — none mention Read/Grep/"open the file". Grep for Read/Grep-steering across all added output strings = NONE. No-abandonment invariant is documented (`hybrid.ts:296–302`) and asserted verbatim by US3 tests. |
| 4 | Keyword-mode byte stability; truncateOutput × footer interaction | **PASS** | Keyword mode: `searchNodesDetailed` returns `{results, degradation:null}` with no `timing` (`index.ts` L246–249), so in `tools.ts` (L1578–1583) neither branch fires → `output === truncateOutput(formatted)`, byte-identical to today (SC-004). `provenanceTag('')` returns `''` for hits with no `matchType` (`hybrid.ts:259–261`), so the per-result line is unchanged in keyword mode. Footer is appended **after** truncation, so it can never be truncated away, and a fused/degraded response may exceed `MAX_OUTPUT_LENGTH=15000` by only the footer (~40–350 chars) → ceiling ≈15.35K, comfortably under the ~25K inline-result externalization cap. No budget blowout. |
| 5 | Latency posture — bounded embed, keyword zero-touch | **PASS** | `acquireQueryVectorForSearch` races the embed against a `setTimeout(resolveEmbedBudgetMs())` budget (`index.ts` L488–535); `resolveEmbedBudgetMs()` returns the test override or the hard constant `EMBED_BUDGET_MS = 2000` (`hybrid.ts:87`) — no env knob, cannot be unbounded. A slow/unreachable endpoint resolves `EMBED_BUDGET_TIMEOUT` at ≤2s → keyword fallback + `embed-failure`, never hangs, never rejects (L537–551); the late vector is discarded (L505–510). MCP + CLI both gate the await behind `if (mode !== 'keyword')` (`tools.ts:1544–1546`; `codegraph.ts:1277–1279`), so keyword mode makes zero embed round-trip. |
| 6 | `server-instructions.ts` untouched (single source of truth) | **PASS** | `git diff main...HEAD -- src/mcp/server-instructions.ts` is empty. Tool-behavior guidance was not duplicated into tool descriptions elsewhere; the only description change is the additive `mode` param enum on `codegraph_search` (`tools.ts:579–583`), which documents an argument, not agent workflow. |

## Supplementary (guardian mandate, surface touched)

| Check | Verdict | Evidence |
|---|---|---|
| Explore budget monotonicity | **PASS (untouched)** | Budget functions not in diff; tiers unchanged. |
| A/B evidence for retrieval-affecting change | **PASS** | `specs/003-hybrid-semantic-search/.process/ab-evidence.md` (T029): ≥2 runs/arm, both arms `--model sonnet --effort high`, dormant/control zero-delta, keyword default byte-parity. Dogfood UAT recorded (T030). Satisfies the ≥2-runs/Sonnet-floor/control bar. |

## Blocking
- None.

## Advisory
- `handleSearch` returns early on empty results (`tools.ts` ~1556, `if (results.length === 0) return "No results found for ..."`) **before** the footer logic, so a *degraded-and-empty* search shows no degradation hint. Byte-identical to today and not a retrieval regression (keyword mode unaffected), but the FR-015 hint is silently dropped in that one corner — worth a one-line note to the US3 owner, not a block.
