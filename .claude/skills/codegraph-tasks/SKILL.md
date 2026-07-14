---
name: codegraph-tasks
description: Complete pending CodeGraph agent-mode task bundles under .codegraph/tasks/ — read a self-describing bundle, write conforming output, then ingest it. Use when the user asks to work/complete/finish pending codegraph tasks or bundles, mentions .codegraph/tasks/, or runs /codegraph-tasks.
---

# Complete CodeGraph task bundles

When CodeGraph runs in agent mode (`CODEGRAPH_LLM_PROVIDER=agent`), a consumer that
needs prose — a summary, a narrative, a doc chapter — does **not** call a remote
model. Instead it writes a self-describing **task bundle** to disk and hands its
caller a handle. Each bundle is a directory under `.codegraph/tasks/<id>/` that
carries everything needed to complete the task. Your job with this skill is to find
those bundles, complete them **using only the files in the bundle directory**, and
hand them back through `codegraph tasks ingest`.

This runs **fully autonomously**. **Never commit, push, publish, or tag** (house
rule) — leave all changes for the user to review.

## A bundle directory

```
.codegraph/tasks/<id>/
  instructions.md        # the task, in prose — what to produce
  graph-context.json     # a JSON array of opaque context strings, provided verbatim
  output-contract.json   # the machine-checkable shape your answer MUST satisfy
  manifest.json          # { id, status, contract, createdAt } — DO NOT edit by hand
  output.json            # YOU write this: your answer (created in step 3)
  result.json            # ingest writes this on success — DO NOT edit by hand
```

The bundle is **self-contained**: `instructions.md` + `graph-context.json` +
`output-contract.json` are all the context you need. Do **not** go spelunking the
wider repo for a bundle — if the instructions reference a symbol, the relevant
context is already in `graph-context.json`.

## Steps

### 1. Find pending bundles

```bash
codegraph tasks list
```

This prints one row per bundle — **id**, **status** (`pending` / `completed`), and
**age**. Work the `pending` ones. If there are none, say so and stop.

### 2. Read the bundle

For a pending `<id>`, read the three input files in `.codegraph/tasks/<id>/`:

- **`instructions.md`** — the task to perform. This is the primary directive.
- **`graph-context.json`** — a JSON array of context strings. Treat them as the
  supporting material for the task; they are provided verbatim and need no parsing
  beyond reading them.
- **`output-contract.json`** — the structural contract your answer must satisfy:

  ```json
  { "requiredFields": [ { "name": "prose", "type": "string", "nonEmpty": true } ] }
  ```

  Each entry names a field your output must contain, its `type` (`"string"` or
  `"string[]"`), and whether it must be non-empty. The check is **structural only** —
  ingest verifies the shape, never the quality — so make sure every required field is
  present, of the right type, and non-empty where required.

### 3. Write `output.json`

Produce your answer and write it as `.codegraph/tasks/<id>/output.json`, conforming
to the contract. For the contract above, that is:

```json
{ "prose": "Your completed prose answer goes here." }
```

Include **every** `requiredField` with the declared type. Extra fields are harmless,
but a missing/empty required field will be rejected. Write **only** `output.json` —
do not touch `manifest.json`, `result.json`, or any file outside the bundle dir.

### 4. Ingest (the final step)

```bash
codegraph tasks ingest <id>
```

On success this validates `output.json` against the contract, stores the canonical
`result.json` inside the bundle dir, stamps the manifest `completed` (exit 0), and
the consumer can now redeem the handle. If it **rejects** (non-zero exit, reason on
stderr — e.g. a missing/empty field, or output written to the wrong place), the
manifest stays `pending`: fix `output.json` per the reason and re-run
`codegraph tasks ingest <id>`. Ingest is **idempotent to retry** and never writes
anything outside the bundle directory.

## Notes

- Repeat steps 2–4 for each pending bundle.
- `codegraph tasks ingest` is **user/agent-invoked only** — it is never auto-run by a
  watcher or daemon, so nothing finalizes a bundle behind your back.
- If a bundle's directory is gone or its manifest is unreadable, skip it and move on;
  a stale bundle is safe to leave for the user to delete manually.
