# Contract: model-fetch (lazy, checksum-verified model acquisition)

**Module**: `src/embeddings/model-fetch.ts` | **Spec**: FR-012 – FR-019a
| **Security**: adversarially verified in the Phase-4 `security` checklist

Lazily acquires the pinned model + tokenizer on first local use, verifies bytes against a
SHA-256 pinned in CodeGraph source, and returns a usable local path. The download host is
**untrusted** — the checksum is the only trust anchor.

## Interface

```ts
interface LocalModelArtifacts { modelPath: string; tokenizerPath: string; }

type ModelUnavailableReason = 'offline' | 'checksum' | 'cache';
interface LocalModelUnavailable { unavailable: ModelUnavailableReason; message: string; }

/** Never throws — returns verified paths or a typed, actionable unavailability. */
function acquireLocalModel(opts: {
  env: NodeJS.ProcessEnv;   // reads CODEGRAPH_MODEL_BASE_URL, CODEGRAPH_MODEL_CACHE_DIR, XDG_CACHE_HOME, LOCALAPPDATA
}): Promise<LocalModelArtifacts | LocalModelUnavailable>;
```

## Inputs

- **Pinned artifacts** (compiled into source): the checkpoint id, each artifact's
  repo-relative path + filename, and its pinned **SHA-256** (see data-model.md §3 /
  research.md OQ-2).
- **Default base URL**: commit-pinned HF `resolve/751bff37182d3f1213fa05d7196b954e230abad9/`.
  `CODEGRAPH_MODEL_BASE_URL` overrides the **base/prefix** only (the repo-relative path +
  filename are appended); it is NOT a full file URL (FR-015).
- **Cache dir**: the 4-case platform formula (FR-016), overridable by
  `CODEGRAPH_MODEL_CACHE_DIR` (FR-017), then validated (FR-017a).

## Behavior (verify-before-use)

1. **Resolve + validate the cache dir** (FR-017a): reject `../` traversal and
   `SENSITIVE_PATHS`; use a **cache-appropriate** validator (NOT `validateProjectPath`,
   which rejects `~/.config` and would false-reject a valid `XDG_CACHE_HOME`). An invalid
   or unwritable dir → `{ unavailable: 'cache', message }`.
2. **Reuse if present + verified** (FR-018): if the cached file exists AND its SHA-256
   matches the pin, return it with **no download**.
3. **Download to a temp file** under the cache dir (base URL + repo-relative path). A
   network failure → `{ unavailable: 'offline', message }` (FR-019).
4. **Verify** the temp file's SHA-256 against the pin. Mismatch → **discard the temp**,
   `{ unavailable: 'checksum', message }` (FR-019a). Verified bytes are never bypassed
   (FR-014 / SC-003).
5. **Atomic promote**: rename the verified temp → final path. A `path` that exists is thus
   always complete + verified; a partial/interrupted temp is treated as absent and
   re-acquired (never used as if complete).
6. The same pinned verification (steps 4–5) applies to bytes from `CODEGRAPH_MODEL_BASE_URL`
   — the override host cannot inject unverified bytes (FR-015).

## Messages (distinct per reason — FR-019 / FR-019a / FR-020)

- **`offline`**: names (a) the resolved cache dir, (b) `CODEGRAPH_MODEL_BASE_URL`, and
  (c) how to pre-seed — the exact filename to drop in the cache dir so the next run
  verifies-then-uses it.
- **`checksum`**: tamper-aware — the downloaded bytes failed SHA-256 and were discarded
  (possible corruption or an incorrect/tampered mirror); advise retry or checking
  `CODEGRAPH_MODEL_BASE_URL`.
- **`cache`**: the resolved cache dir is unwritable/invalid; names the dir and
  `CODEGRAPH_MODEL_CACHE_DIR`.

All three degrade identically: **structural index completes, embed pass skipped**,
`codegraph status` reports the reason (coverage 0%). `acquireLocalModel` **never throws**.

## Security surface (Phase-4 `security` checklist)

- SHA-256 pinned in source is the trust anchor; host (default or override) is untrusted.
- Atomic verify-before-rename closes the TOCTOU / partial-write window.
- `CODEGRAPH_MODEL_BASE_URL` as an SSRF/mirror vector is bounded by the pinned checksum.
- Cache-dir traversal / sensitive-path rejection (FR-017a) prevents writing outside a safe
  cache root.
- The timeout-wrapped session `create()` (see local-provider.md) prevents the
  missing/corrupt-`.wasm` **infinite hang** from turning a degrade into a freeze.
