# LLM Access Layer — endpoint vs agent-bundle paths (self-repo UAT note)

> SPEC-018 · US5 / FR-030 / SC-007. This note is the recorded **self-repo UAT
> outcome** for the LLM access layer. It compares the two first-class paths —
> the BYO OpenAI-compatible **endpoint** path and the **agent-bundle** path — on
> cost, quality, and latency, exercised against this repository's own slice-2
> build. Per FR-030 it deliberately contains **no cloud-endpoint comparison
> arm**: the only endpoint contemplated is a local/self-hosted one. The
> **agent-bundle arm is measured live** below; the **endpoint arm's live
> quality/latency is a formally accepted deviation from SC-007** (see *Endpoint
> arm — accepted deviation from SC-007*), because no local chat-completions
> model is available in this environment and FR-030 bars a cloud stand-in.

## What was exercised

Both paths were driven through the same two prose tasks, produced against this
repo's slice-2 worktree build (`npm run build`; agent mode is filesystem-only
and needs no graph index to emit a bundle):

1. **A wiki chapter** — "The Agent Task-Bundle Lifecycle", grounded in
   graph-context describing `emitBundle` / `generate` / `ingestBundle` /
   `redeemHandle`.
2. **A PR narrative** — a 3–4 sentence narrative for the slice-2 change set.

The produced artifacts are reproduced in the appendix.

## The two paths in one line each

- **Endpoint** — `generate()` composes a chat prompt and calls a configured
  OpenAI-compatible endpoint (`CODEGRAPH_LLM_URL` / `_MODEL` / optional `_API_KEY`);
  the model's completion is returned synchronously as `{ source: "endpoint", text }`.
- **Agent bundle** — `generate()` writes a self-contained
  `.codegraph/tasks/<id>/` bundle and returns `{ source: "pending-bundle", text,
  handle }` immediately; any subscription coding agent completes the bundle out
  of band, `codegraph tasks ingest <id>` validates the answer into
  `result.json`, and `redeemHandle` returns the finished text.

## Comparison

| Axis | Endpoint path | Agent-bundle path |
|---|---|---|
| **Cost** | Marginal per-call cost of the configured endpoint. For a local/self-hosted model (Ollama, LM Studio, vLLM) this is **$0 marginal** (compute you already run); a hosted OpenAI-compatible API bills per token. | **$0 marginal** — the answer is produced by a subscription coding agent the user already pays a flat rate for (Claude Code, Cursor, …). No per-token metering; cost is amortized into the existing subscription. |
| **Quality** | Bounded by the configured model. A small local model is fast but weaker; a large hosted model is stronger but metered. Deterministic prompt composition follows a fixed priority — instructions > contract > graph context — and, because the endpoint model has a hard token window, **only the lowest-priority graph-context tier is trimmed**, to the FR-007 conservative token budget sized for small-context local models (FR-018). The instructions and output contract are never truncated. (The agent-bundle path composes the same instructions and contract but hands the graph context *verbatim* — see the read below.) | Bounded by the coding agent completing the bundle — typically a frontier model already driving the user's IDE, so **quality tracks the best model the user has on hand**. The output contract enforces *structure* (required fields, non-empty), not semantic quality. Judged quality of the two artifacts below: coherent, on-topic, correctly grounded in the supplied graph context. |
| **Latency** | One synchronous round-trip: prompt compose + a single non-streaming completion (streaming also supported), bounded by a total-request deadline (default 300s) with bounded retries and a response-size ceiling. Wall-clock is dominated by model inference time. | **Two phases.** Emit is effectively instant — **~1 ms/bundle** measured (`emitMs: 2` for two bundles). Completion is asynchronous (human-in-the-loop or an agent turn), so end-to-end latency is unbounded by design — the caller is never blocked and gets usable fallback text immediately. Ingestion + structural validation of a completed bundle is **~150 ms/bundle** measured (`315 ms` for two `codegraph tasks ingest` invocations, including Node process startup). |
| **Blocking** | Blocks the caller until the deadline; on failure degrades to the consumer fallback string, never throws. | Never blocks — returns a handle plus fallback text at once; the result is redeemed later. |
| **Config needed** | A running chat endpoint. | None beyond opting into agent mode — no endpoint to host. |

## Measured evidence (agent arm)

Ran fully end-to-end against the slice-2 build:

- **Emit** — `generate(root, task)` in agent mode wrote two pending bundles,
  each `.codegraph/tasks/<id>/` with `instructions.md`, `graph-context.json`,
  `output-contract.json`, and a `manifest.json` (`status: "pending"`);
  `emitMs: 2` for both.
- **Complete** — each bundle was completed by a coding agent (Claude Code, via
  the companion `codegraph-tasks` skill) reading only the bundle's own files and
  writing `output.json` to the contract shape.
- **Ingest** — `codegraph tasks ingest <id>` returned exit 0 for both
  (`✓ Ingested … result stored; manifest marked completed.`); structural
  validation passed, `result.json = { text }` written, manifest stamped
  `completed`. ~315 ms for the two invocations.
- **Verify** — `codegraph tasks list` reported both `completed`;
  `redeemHandle(root, handle)` returned `{ status: "completed", text }` with
  1721- and 718-character results respectively.

## Endpoint arm — accepted deviation from SC-007 (deferred, not measured)

The live endpoint arm's cost/quality/latency numbers are **not** reported here.
This is a **formally accepted deviation** from SC-007's endpoint-arm
quality/latency measurement, decided at review time — **not an oversight**.

**Why the deferral is accepted, not a coverage gap:**

- **FR-030 forbids a cloud-endpoint comparison arm** — the only endpoint
  SPEC-018 contemplates is a local/self-hosted one, so a hosted model cannot be
  substituted to produce numbers.
- This repo's dogfood `.envrc.local` configures an **embeddings** endpoint only
  (`CODEGRAPH_EMBEDDING_*`); there is **no `CODEGRAPH_LLM_*` chat-completions
  model** available in this environment. With no local chat model and no
  permitted cloud arm, **no honest real-model quality or latency can be measured
  here**, and fabricating numbers is not acceptable.

**What IS proven — the endpoint code path itself is validated.** The endpoint
**transport** is exercised end-to-end by the client test suite
(`__tests__/llm-client.test.ts`, 31 tests) against a local OpenAI-compatible
HTTP stub: streaming and non-streaming assembly, exponential-backoff retry with
`Retry-After`, the flat total-request deadline and the streaming inter-chunk
idle deadline, the total-response-size ceiling, and redaction-safe
(secret-free) errors. So the code that would carry a real model's output is
proven end-to-end; **only the model-quality comparison is deferred.** (Counting
the slice-1 config suite too, the endpoint path is covered by 78 tests across
`__tests__/llm-config.test.ts` and `__tests__/llm-client.test.ts` — request
shape and vendor-neutrality, keyed vs keyless auth, the empty-completion gate,
and cross-origin `Authorization` stripping.)

**Maintainer follow-up to close the deferral:** point `CODEGRAPH_LLM_URL` /
`CODEGRAPH_LLM_MODEL` at a local chat model (e.g. an Ollama or LM Studio server)
and re-run the same two prose tasks through the endpoint path to fill in the
endpoint-arm cost/quality/latency here. This is a local-endpoint measurement
only — no hosted/cloud arm (FR-030).

## Read of the comparison

For CodeGraph's own use (prose generation for future features like a wiki or PR
narratives), the two paths are complementary rather than competing:

- The **agent-bundle path** is the better default when a strong coding agent is
  already in the loop: zero marginal cost, best-available model quality, and it
  never blocks the calling feature. Its cost is asynchronous completion and a
  filesystem round-trip.
- The **endpoint path** is the better fit for unattended/batch generation where
  a synchronous answer is required and a (local) model is available to serve it.

Both share the same `generate()` seam and the same dormancy guarantee: with no
`CODEGRAPH_LLM_*` set, the layer performs zero network calls and zero filesystem
writes and returns the consumer's fallback — behavior byte-identical to an
unconfigured install.

They **deliberately differ in how the graph context is delivered**, and this is
by design — not an inconsistency:

- The **endpoint path trims** the lowest-priority graph-context tier to the
  FR-007 conservative token budget (sized for small-context local models),
  because the endpoint model has a hard token window (FR-018).
- The **agent-bundle path writes the graph context verbatim** — per the
  `contracts/bundle-files.md` contract — because the subscription coding agent
  completing the bundle has a large context window, so trimming it down to a
  small-local-model budget would degrade the handoff for no benefit.

What **is** invariant across both paths is the guarantee that matters: the task
**instructions and the output contract are always delivered intact — never
trimmed**, so the endpoint model and the bundle-completing agent each receive
them in full.

## Appendix — produced artifacts (agent arm)

### Wiki chapter (redeemed, 1721 chars)

> # The Agent Task-Bundle Lifecycle
>
> When CodeGraph's LLM layer runs in *agent mode*, a consumer feature never
> calls a chat endpoint. Instead it hands a prose task to `generate(root,
> task)`, which takes the agent branch: it calls `emitBundle`, writing a
> self-contained directory `.codegraph/tasks/<id>/` that holds
> `instructions.md`, the `graph-context.json` the feature assembled, and an
> `output-contract.json` describing the fields the answer must contain. A
> `manifest.json` is written alongside with `status: "pending"`. `generate`
> returns immediately as `{ source: "pending-bundle", text, handle }` — the
> caller gets usable fallback text now and a handle to redeem later.
>
> The bundle is then completed *out of band* by any subscription coding agent
> (Claude Code, Cursor, and so on) using the companion `codegraph-tasks` skill.
> The agent reads only the bundle's own files, writes its answer to
> `output.json` in the shape the contract requires, and finishes by running
> `codegraph tasks ingest <id>`.
>
> Ingestion is where trust is enforced. `ingestBundle` reads `output.json`
> through a bounded, symlink-rejecting safe-read, validates it *structurally*
> against the contract (every required field present, correctly typed, non-empty
> where required), and only then writes the canonical `result.json = { text }`
> and stamps the manifest `completed`. A malformed, oversized, or early output
> leaves the manifest `pending` and writes nothing. Finally the consumer calls
> `redeemHandle(root, handle)`, which — after confirming the handle names a
> contained bundle — returns `{ status: "completed", text }`, or
> `pending`/`missing` otherwise. The prose task has become a validated result
> without the layer ever opening a network socket.

### PR narrative (redeemed, 718 chars)

> SPEC-018 slice 2 adds the agent-driven path to CodeGraph's LLM access layer: a
> feature can now turn a prose task into a self-contained bundle under
> `.codegraph/tasks/`, have any coding agent you already run complete it, and
> validate the result back in with `codegraph tasks ingest`. The new `codegraph
> tasks list` and `tasks ingest` commands let you see pending work and install a
> finished answer, and a companion skill walks an agent through completing a
> bundle. This means CodeGraph can produce prose (wiki chapters, PR narratives)
> using the subscription agent you already pay for, with no chat endpoint to
> host — and like the endpoint path, it stays completely dormant until you opt
> in by configuring the LLM layer.
