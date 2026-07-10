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

Reason vocabulary is drawn from the same success-shaped wording as the search-time hints (strings 1 and 2). The line MUST NOT report live per-daemon provider warmth (transient / would be stale in a point-in-time snapshot). Included in `--json` status output as well.

### Truthfulness (SC-007)

The line's yes/no MUST agree with the actual `auto`-mode search outcome for the same index state across all three reachable states — provider+vectors, no provider, provider-but-no-matching-vectors — with zero discrepancy (both derive from the same predicate).
