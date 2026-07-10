# Contract: Degradation Hints + Status Availability Line

The four literal footer strings and the `codegraph status` availability line. These strings are **normative** — copy them verbatim from spec.md's "Degradation Hint Wording (FR-015)" table; the tests assert exact literals.

## The four degraded conditions → literal footer strings (FR-015)

Appended AFTER results (results lead, note follows — FR-005), emitted on **every** query while the condition holds (not one-shot). Model mismatch is **not** a fifth condition — it renders **string 2**.

| # | Condition | Owning FR | Literal string (verbatim from spec.md FR-015 table) |
|---|-----------|-----------|-----------------------------------------------------|
| 1 | No provider configured | FR-002, FR-015 | `\n\n> **Note:** semantic ranking is off — no embedding provider configured; showing keyword matches. Set CODEGRAPH_EMBEDDING_PROVIDER=local for the bundled model, or CODEGRAPH_EMBEDDING_URL and CODEGRAPH_EMBEDDING_MODEL for an endpoint, to enable.` |
| 2 | No matching-model vectors (folds model mismatch) | FR-015, Edge Cases | `\n\n> **Note:** no semantic vectors for the active model yet; showing keyword matches. Run \`codegraph sync\` to embed.` |
| 3 | Provider warming | FR-005 | `\n\n> **Note:** semantic ranking is warming up; showing keyword matches — later queries will fuse.` |
| 4 | Embed timeout or provider failure | FR-006 | `\n\n> **Note:** semantic ranking failed or timed out this query; showing keyword matches.` |

**Success-shaped invariant (SC-003, Constitution VI)**: every degraded response is normal keyword `SearchResult[]` + one footer string. **Zero `isError` responses** under any degraded condition.

**String 4 is the catch-all (FR-006)**: any unexpected exception on the semantic/hybrid path — staleness-probe read (FR-008b), matrix decode/build (FR-008a), query-embed, or fusion step throwing, plus the FR-009c memory-guard skip — degrades to keyword + **string 4**, never `isError`. A query-embed that completes AFTER its budget is discarded and MUST NOT mutate cache/provenance or the already-returned response (FR-006).

**No-abandonment invariant (Constitution VI)**: none of the four strings instructs the caller to use Read/Grep or abandon the tool; each states keyword results are shown and, where actionable, the enabling config / `codegraph sync` step. Enforced verbatim by the FR-014 literal-string assertions.

**Empty semantic arm is NOT degraded (FR-011 / Edge Cases)**: when the filter-stripped query embed input is empty, the semantic arm is empty on a healthy provider — no hint footer and no timing footer are emitted (byte-identical to keyword); this is not one of the four conditions.

## Status availability line (FR-017 / SC-007)

Under the existing `Embeddings:` block in `codegraph status`, add one derived line:

```
Hybrid search available: yes
```
or
```
Hybrid search available: no (no embedding provider configured)
Hybrid search available: no (no matching-model vectors — run `codegraph sync`)
```

### Derivation (no new probe)

Purely a function of the existing `getEmbeddingStatus()` snapshot (research D12):

- **`yes`** ⟺ `status.active === true && status.coverage.embedded > 0`.
- **`no (no embedding provider configured)`** ⟺ status dormant or misconfigured.
- **`no (no matching-model vectors …)`** ⟺ status active AND `coverage.embedded === 0`.

Reason vocabulary is drawn from the same success-shaped wording as the search-time hints (strings 1 and 2). The line MUST NOT report live per-daemon provider warmth (transient / would be stale in a point-in-time snapshot).

### `--json` shape

The same derived availability appears in `codegraph status --json` as two additive
fields, so machine consumers do not have to parse the human line:

```jsonc
{
  // ... existing status fields (embeddings snapshot, etc.) unchanged ...
  "hybridSearchAvailable": true,        // boolean — the yes/no predicate
  "hybridSearchReason": null            // string | null — null when available;
                                        // otherwise the `no (...)` reason text
                                        // ("no embedding provider configured" /
                                        //  "no matching-model vectors — run `codegraph sync`")
}
```

Both fields are **additive** — no existing `status --json` property changes, keeping the
`status-embedding-json` contract's existing shape byte-stable. `hybridSearchAvailable`
is derived from the same `getEmbeddingStatus()` predicate as the human line (no new
probe), and `hybridSearchReason` reuses the search-time hint vocabulary (strings 1/2).
`hybridSearchReason` is `null` if and only if `hybridSearchAvailable` is `true`.

### Truthfulness (SC-007)

The line's yes/no MUST agree with the actual `auto`-mode search outcome for the same index state across all three reachable states — provider+vectors, no provider, provider-but-no-matching-vectors — with zero discrepancy (both derive from the same predicate).
