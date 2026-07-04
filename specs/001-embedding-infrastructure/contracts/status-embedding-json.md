# Contract: `codegraph status` embedding section (human + `--json` parity)

The observability contract (FR-022 / Session 3). `codegraph status` gains an embedding
section; `codegraph status --json` gains a parallel `embedding` object (required —
automated probes read machine output). Rendered in `src/bin/codegraph.ts` (status
command at `:761-920`); values come from a new library method (e.g.
`cg.getEmbeddingStatus()`) backed by `getEmbeddingCoverage` + the metadata scalars.

## `--json` object shape

Added as a top-level `embedding` key alongside the existing `status --json` fields
(`nodeCount`, `edgeCount`, `backend`, …).

### Active + embedded

```json
{
  "embedding": {
    "active": true,
    "endpoint": "https://api.example.com:8443",
    "model": "nomic-embed-text",
    "dims": 768,
    "coverage": { "embedded": 1240, "embeddable": 1240, "percent": 100 }
  }
}
```

### Dormant (unconfigured), no prior-run vectors

```json
{
  "embedding": {
    "active": false,
    "activationVars": ["CODEGRAPH_EMBEDDING_URL", "CODEGRAPH_EMBEDDING_MODEL"]
  }
}
```

### Dormant, but prior-run vectors exist on disk

```json
{
  "embedding": {
    "active": false,
    "activationVars": ["CODEGRAPH_EMBEDDING_URL", "CODEGRAPH_EMBEDDING_MODEL"],
    "previousRun": {
      "model": "nomic-embed-text",
      "dims": 768,
      "coverage": { "embedded": 1180, "embeddable": 1240, "percent": 95 }
    }
  }
}
```

### Field rules

| Field | Rule |
|---|---|
| `active` | `true` iff config active (URL+MODEL set). |
| `endpoint` | Redacted to **scheme + host + port only** — never userinfo/path/query, never the key (FR-023). Present only when `active`. |
| `model`, `dims` | The active model + enforced/inferred dimension (from `project_metadata`). |
| `coverage` | `{ embedded, embeddable, percent }` — `percent = round(embedded/embeddable*100)`; `embeddable === 0` ⇒ `percent = 100` (trivially complete). Computed by joining FROM live nodes to active-model vectors (orphans excluded). |
| `activationVars` | Present only when dormant; names the two variables needed to activate. |
| `previousRun` | Present only when dormant **and** on-disk vectors exist; model/dims/coverage read **from disk only** (no network — dormancy preserved), labeled as prior-run. |

## Human-readable section

Rendered after the existing Index Statistics block. Neutral styling when dormant (never
warning-styled — dormancy is not an error).

### Active

```text
Embeddings:
  Endpoint:  https://api.example.com:8443
  Model:     nomic-embed-text
  Dims:      768
  Coverage:  1240/1240 (100%)
```

### Dormant

```text
Embeddings:
  Dormant — set CODEGRAPH_EMBEDDING_URL and CODEGRAPH_EMBEDDING_MODEL to enable.
  (from a previous run: model nomic-embed-text, dims 768, coverage 1180/1240 (95%))   ← only if on-disk vectors exist
```

## Progress phase (FR-022 / Session 3 / D15)

- `IndexProgress.phase` (`src/extraction/index.ts:72`) gains `'embedding'`:
  `'scanning' | 'parsing' | 'storing' | 'resolving' | 'embedding'`.
- `PHASE_NAMES` (`src/ui/shimmer-progress.ts:4`) gains a matching label, e.g.
  `embedding: 'Embedding symbols'`.
- Emitted **only when the feature is active** (dormancy adds no phase). Progress =
  embedded-so-far ÷ eligible-to-embed.

## Verification (`embeddings-index.test.ts`)

- Active: `--json` `embedding.coverage.percent === 100` after a full index; human
  output shows the section; `endpoint` is scheme+host+port only.
- Dormant: `embedding.active === false`, `activationVars` present, no `endpoint`; human
  line is neutral; the API key / URL credentials appear nowhere (SC-007).
- Prior-run: after configuring→indexing→unsetting, dormant status shows `previousRun`
  read from disk with no network call.
- Zero embeddable symbols → `percent === 100` (trivially complete).
