# Quickstart: Bundled Local Embedding Fallback (SPEC-002)

**Branch**: `002-local-embedding-fallback` | **Spec**: [spec.md](./spec.md)
| **Contracts**: [local-provider.md](./contracts/local-provider.md), [model-fetch.md](./contracts/model-fetch.md)

Runnable validation scenarios that prove the feature works end-to-end. Prerequisites:
`npm run build` (compiles the worker to `dist/`), Node ≥20, `onnxruntime-web@1.27.0`
installed as a dependency.

---

## Scenario 1 — Embed locally with no endpoint (US1 / SC-001)

```bash
# Opt in via env (also reaches the daemon/MCP context)…
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph index

# …or per-invocation via the flag (overrides env for this run):
codegraph index --embeddings local
```

**Expected**: every indexed symbol is embedded locally, in-process, with **no endpoint
URL configured or contacted**. On a machine that already has the model cached, this runs
with zero network. An explicit `--embeddings local` wins even when an endpoint URL is set
in the environment (spec AS-1.3).

## Scenario 2 — Fresh-machine lazy download + reuse (US2 / SC-002)

```bash
# Empty cache, network available:
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph index
# → downloads model_quantized.onnx (~22 MB) + tokenizer.json to the shared cache,
#   verifies each against its pinned SHA-256, then embeds.

# Run again:
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph index
# → reuses the cached, verified model — zero additional downloads.
```

Shared cache location (FR-016): POSIX `~/.codegraph/models` (or
`$XDG_CACHE_HOME/codegraph/models`); Windows `%LOCALAPPDATA%\codegraph\models`. Override
with `CODEGRAPH_MODEL_CACHE_DIR`. Air-gapped mirror: set `CODEGRAPH_MODEL_BASE_URL` — the
same pinned checksum still verifies the bytes.

## Scenario 3 — `codegraph status` shows the active local provider (US4 / SC-006)

```bash
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph status
```

**Expected** (Embeddings block): provider `local`, the model
(`Xenova/all-MiniLM-L6-v2`), dims `384`, and live coverage `embedded/embeddable (percent)`.

## Scenario 4 — Offline first run degrades gracefully (US3 / SC-005)

```bash
# No network, empty cache:
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph index
```

**Expected**: the **structural index completes fully**; the embed pass is **skipped**; an
**actionable message** names the resolved cache dir, `CODEGRAPH_MODEL_BASE_URL`, and the
exact filename to pre-seed. `codegraph status` then reports coverage 0% **with the reason**.
The process never hangs (the session-create timeout guards the corrupt-`.wasm` case).

## Scenario 5 — Checksum mismatch is distinct + tamper-aware (SC-003)

Point `CODEGRAPH_MODEL_BASE_URL` at a mirror serving wrong bytes, then index. **Expected**:
the bytes fail SHA-256, are **discarded (never used)**, and a **distinct** message says the
download failed verification (possible corruption or a tampered mirror) — different from the
offline message. Structural index still completes.

## Scenario 6 — Switch endpoint → local re-embeds, graph unchanged (SC-007 / SC-008)

```bash
# Previously embedded via an endpoint; now switch:
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph sync
```

**Expected**: the active `model` column changes, so SPEC-001's
`selectEmbeddableNodesMissingVector(model)` re-selects **all** symbols and re-embeds them
with the local model — **no manual migration**. **Node and edge counts are identical
before and after** (0 graph growth):

```bash
codegraph status   # compare Nodes/Edges before and after — must match
```

## Scenario 7 — Dormancy is byte-identical when unconfigured (SC-004)

```bash
# No embedding configuration at all:
codegraph index
```

**Expected**: zero model download, zero network request, zero embedding-related schema
write — observably identical to today's dormant behavior. `codegraph status` shows the
Embeddings block as `Dormant`.

---

## Self-repo dogfood UAT (binding — Dogfooding Protocol)

Switch **this repository** from the HAL endpoint to the local provider and re-embed:

```bash
npm run build
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph sync   # re-embeds this repo locally
CODEGRAPH_EMBEDDING_PROVIDER=local codegraph status # provider=local, model, dims=384, coverage
```

Record the outcome (provider, model, dims, coverage before/after, node/edge stability) in
the spec's UAT runbook + retrospective.

## Automated validation

```bash
npm run build
npm test                                              # full suite
npx vitest run __tests__/embeddings-local-tokenizer.test.ts
npx vitest run __tests__/embeddings-model-fetch.test.ts
npx vitest run __tests__/embeddings-local-provider.test.ts
npx vitest run __tests__/embeddings-config-selection.test.ts
```

Tests write real files and exercise real SQLite (no DB mocking). Platform-divergent cache
paths (POSIX XDG vs Windows `%LOCALAPPDATA%`) are `it.runIf`-gated and validated on the real
platform. Implementation detail (worker code, tokenizer body, test bodies) belongs in
`tasks.md` and the implement phase — this guide only proves the feature runs.
