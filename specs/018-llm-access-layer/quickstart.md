# Quickstart: validating the LLM Access Layer

Runnable validation scenarios proving the feature works end-to-end. Implementation detail lives in
`plan.md`/`research.md`/`contracts/`; this is the run/verify guide. All commands run from the worktree
root. `npm run build` compiles; `npm test` is vitest.

## Test-env rule (carry forward — binding)

The dormancy suites assert **byte-identical, unconfigured** behavior. The maintainer's `.envrc.local`
may configure a live LLM endpoint (for the US5 research note), so the ambient shell can carry
`CODEGRAPH_LLM_*`. Run the CODEGRAPH_LLM_* dormancy suites with those unset:

```bash
env -u CODEGRAPH_LLM_URL -u CODEGRAPH_LLM_MODEL -u CODEGRAPH_LLM_API_KEY -u CODEGRAPH_LLM_PROVIDER npm test
```

Config resolution and status take an explicit `env` argument (`loadLlmConfig(env)`,
`resolveLlmStatus(env)`), so unit tests pass a controlled env object and are hermetic regardless of
the shell. The `env -u …` guard is the belt-and-suspenders for suites that exercise the
`process.env` boundary.

---

## Slice 1 — endpoint path end-to-end

### S1.1 Dormancy (US1 / SC-002 / FR-004)

```bash
env -u CODEGRAPH_LLM_URL -u CODEGRAPH_LLM_MODEL -u CODEGRAPH_LLM_API_KEY -u CODEGRAPH_LLM_PROVIDER \
  npx vitest run __tests__/llm-dormancy.test.ts
```

Expect: `generate(root, task)` with a clean env returns `{ source:'fallback', text: task.fallback }`;
**zero** outbound requests and **zero** filesystem writes observed for any number of calls; behavior
byte-identical to an unconfigured build.

### S1.2 Guaranteed degradation + source discriminator (US1 / FR-008, FR-009, FR-012)

```bash
npx vitest run __tests__/llm-generate.test.ts
```

Expect: against a local fake HTTP server, an endpoint success returns `{ source:'endpoint', text }`;
after the retry limit + timeout are exhausted the seam returns `{ source:'fallback', text }` and never
throws; the caller can always read `result.source`.

### S1.3 Endpoint completion, streaming + non-streaming (US2 / FR-015, FR-016, FR-016a)

```bash
npx vitest run __tests__/llm-client.test.ts
```

Expect (fake server): the request body carries `model` / composed `messages` / per-call `stream` /
`max_tokens`, no `temperature`; streaming assembles SSE deltas into one final string; non-streaming
returns `choices[0].message.content`; both yield exactly one final result (no partial output surfaced).

### S1.4 Token-budget guard determinism (US2 / SC-003 / FR-018, FR-019)

```bash
npx vitest run __tests__/llm-prompt.test.ts
```

Expect: an over-budget task trims only graph-context items to the 8000-char budget, appends
`[context truncated: N of M]`, and produces **identical** trimmed output for identical input across
runs; no auto-chunking occurs.

### S1.5 Timeouts + response-size ceiling (US2 / FR-017)

Within `llm-client.test.ts` (overrides shrink the deadlines to ms and `maxResponseBytes` to a small
cap): a non-streaming request past the flat total deadline aborts and degrades; a streaming request
with a chunk gap past the inter-chunk idle deadline aborts, while a slow-but-steady stream (gaps under
the idle deadline) completes; and a response body that exceeds the hard total-response-size ceiling
(`MAX_RESPONSE_BYTES`, streamed byte-counting read) is aborted mid-read and degrades to the consumer
fallback — never returned as `endpoint` output (maintainer security-consensus decision, CRL 9).

### S1.6 Status `LLM:` block + redaction (US2 / FR-006, SC-004)

```bash
npx vitest run __tests__/llm-status.test.ts
CODEGRAPH_LLM_URL=http://10.0.0.5:1234/v1/chat/completions CODEGRAPH_LLM_MODEL=x \
  node dist/bin/codegraph.js status        # after: npm run build
```

Expect: an `LLM:` block after `Embeddings:` shows `Provider: endpoint`, a redacted `Endpoint:`
(scheme+host+port), the model, and — for a plaintext non-loopback URL — a cleartext advisory; a
misconfig names the missing variable; dormant is neutral; the API key never appears. `status --json`
carries a parallel `llm` field.

---

## Slice 2 — agent-bundle path, CLI, companion skill, research note

### S2.1 Self-describing bundle emission (US3 / SC-005 / FR-021–FR-024a)

```bash
npx vitest run __tests__/llm-agent-bundle.test.ts
```

Expect: with `CODEGRAPH_LLM_PROVIDER=agent`, `generate()` creates `.codegraph/tasks/<id>/` with
`instructions.md`, `graph-context.json`, `output-contract.json`, and `manifest.json` (status
`pending`), and returns `{ source:'pending-bundle', text: fallback, handle:<id> }`; two near-concurrent
calls get distinct ids and neither overwrites the other; **no** SQLite schema is created/modified; a
reader given only the directory has everything needed to produce conforming output.

### S2.2 Redemption lookup (FR-010a)

Within `llm-agent-bundle.test.ts`: `redeemHandle(root, handle)` returns `{status:'pending'}` before
ingest, `{status:'completed', text}` after a successful ingest, and `{status:'missing'}` after the
bundle dir is removed.

### S2.3 Ingest validate + finalize; rejection semantics (US4 / SC-006 / FR-027, FR-028, FR-028a)

```bash
npx vitest run __tests__/llm-ingest.test.ts
```

Expect: conforming output → validated, canonical `result.json` stored inside the bundle dir, manifest
→ `completed`; non-conforming output → rejected, reason to stderr, manifest stays `pending`
(re-runnable), and **no** file is written outside the bundle dir; ingest never runs on its own from
the watcher/daemon.

### S2.4 Untrusted-input hardening (FR-029a)

```bash
npx vitest run __tests__/llm-ingest-security.test.ts
```

Expect each rejected and FR-028a-shaped (manifest stays `pending`, reason to stderr, never `isError`):
a contract- or output-named path resolving outside the bundle dir; a symlink at a path ingest opens
(POSIX-gated — symlink creation needs privilege on Windows); output over the 1 MiB ceiling; JSON past
the depth ceiling; a `__proto__`/`constructor` key in the output leaves no prototype pollution
(read-expected-fields-only).

### S2.5 `codegraph tasks` CLI (US4 / FR-025, FR-026)

```bash
npm run build
node dist/bin/codegraph.js tasks list                 # id, status, age per bundle
node dist/bin/codegraph.js tasks ingest <id>           # validate + finalize; exit 0 on success
npx vitest run __tests__/llm-tasks-cli.test.ts
```

Expect: `list` enumerates bundles with age; `ingest <id>` exits 0 on success and non-zero (reason to
stderr) on rejection; an unknown action errors with a non-zero exit.

### S2.6 Companion skill (FR-025)

Confirm `.claude/skills/codegraph-tasks/SKILL.md` exists and instructs an agent to find pending
bundles under `.codegraph/tasks/`, complete a bundle from its directory, and — as its final step —
run `codegraph tasks ingest <id>`.

### S2.7 Research note + self-repo UAT (US5 / SC-007 / FR-030, FR-031)

Timeboxed spike, run against the slice-2 worktree's own build and this repo's live index (no prior
merge to `main`):

```bash
# preflight (per CLAUDE.md): npm install && npm run build; codegraph init .; codegraph status
# endpoint arm: source .envrc.local (hal endpoint) → generate one wiki chapter + one PR narrative
# agent arm: generate the same two as bundles; complete each with Claude Code via the companion skill;
#            codegraph tasks ingest <id>; redeemHandle → finalized text
```

Expect: `docs/design/llm-paths-note.md` committed **inside slice 2's PR**, recording cost, quality,
and latency for both paths on one wiki chapter + one PR narrative generated against this repository,
naming which inputs were used, with **no** cloud-endpoint arm. This file is the recorded self-repo UAT
outcome.

---

## Full gate (both slices)

```bash
npm run build
env -u CODEGRAPH_LLM_URL -u CODEGRAPH_LLM_MODEL -u CODEGRAPH_LLM_API_KEY -u CODEGRAPH_LLM_PROVIDER npm test
npx tsc --noEmit
```

Expect: build green, full vitest suite green (LLM suites included), no type errors. Each slice ships as
its own PR with a New Features CHANGELOG entry under `## [Unreleased]`.
