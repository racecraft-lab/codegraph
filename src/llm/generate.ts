/**
 * LLM access layer — the `generate()` seam's public types (SPEC-018 slice 1).
 *
 * This module declares the STABLE Slice-1 public type surface together with the
 * `generate()` seam (added in Group D) that dispatches over them. The types are
 * defined up front so config/prompt/client can compile against a fixed seam, and
 * so the three-kind {@link GenerationResult} — including the `pending-bundle` arm
 * that only slice 2 ever produces — is a stable public type from slice 1 onward
 * (research D6). `src/llm` never imports `src/context`: graph context arrives as
 * consumer-supplied opaque strings (data-model §1).
 */

import { loadLlmConfig } from './config';
import { composePrompt } from './prompt';
import { LlmEndpointClient } from './client';
import type { LlmEndpointClientOverrides } from './client';
import { emitBundle } from './agent-bundle';

/**
 * Machine-checkable expected-output contract carried verbatim into an agent-mode
 * bundle (data-model §5 / D10 / FR-021, FR-027). Structural-only — never a
 * semantic/quality judgment. The first-consumer prose shape is a single required
 * non-empty `prose: string` field.
 */
export interface OutputContract {
  requiredFields: Array<{
    /** The output field's key. */
    name: string;
    /** Closed type enum keeps validation total and deterministic (D10). */
    type: 'string' | 'string[]';
    /** When set, the field must additionally be non-empty. */
    nonEmpty?: boolean;
  }>;
}

/**
 * The single input to `generate()` (data-model §1). Consumer-owned; the layer
 * embeds its parts verbatim and never enriches them (Q2 / FR-013).
 */
export interface ProseTask {
  /** Task instructions — highest composition priority (D5). */
  instructions: string;
  /**
   * Consumer-supplied opaque graph-context items, embedded verbatim; lowest
   * priority, the only tier the token guard trims (D5 / FR-018). The layer does
   * not parse or dedup them.
   */
  graphContext: string[];
  /** Machine-checkable expected-output contract carried into the bundle (D10 / FR-021, FR-027). */
  outputContract: OutputContract;
  /**
   * Consumer's precomputed heuristic fallback STRING (Q2 / FR-008) — always
   * present, and what every non-endpoint-success path returns (FR-009/010/011).
   */
  fallback: string;
}

/**
 * The `generate()` seam output (data-model §6). A three-kind discriminated union
 * so the caller can always tell which source produced the text (FR-012). Defined
 * in full in slice 1 for a stable public type; the `pending-bundle` kind is
 * produced only in slice 2.
 */
export type GenerationResult =
  | { source: 'endpoint'; text: string }                        // FR-009 success
  | { source: 'pending-bundle'; text: string; handle: string }  // FR-010: fallback text now + redeemable handle
  | { source: 'fallback'; text: string };                       // FR-009 failure / FR-011 dormant / emit-failure

/**
 * Test-only override seam for {@link generate} (contracts/generate-seam.md). `env` defaults to
 * `process.env`; tests inject a controlled env for hermetic dormancy/mode assertions. `client`
 * shrinks the endpoint client's retry / timeout / response-size ceilings so the failure path runs
 * in milliseconds under test; production always uses the client defaults.
 */
export interface GenerateOverrides {
  env?: NodeJS.ProcessEnv;
  client?: LlmEndpointClientOverrides;
}

/**
 * The single `generate()` library seam (data-model §6 / contracts/generate-seam.md / research D6).
 * Resolves the LLM config ONCE from the environment and dispatches over its four states, ALWAYS
 * returning usable text and NEVER throwing because configuration is absent or partial (FR-008 /
 * SC-001). The consumer-supplied `task.fallback` is the ONLY fallback the layer ever returns — it
 * owns no heuristic registry (FR-013):
 *
 *  - dormant (config `null`) or misconfig → `{ source:'fallback', text: task.fallback }` with ZERO
 *    network calls and ZERO filesystem writes — behavior byte-identical to an unconfigured install
 *    (FR-004 / FR-011, SC-002).
 *  - endpoint → compose the prompt, then ONE non-streaming `LlmEndpointClient.complete` (slice 1
 *    uses non-streaming; the client supports both). A clean completion → `{ source:'endpoint',
 *    text }` (FR-009); ANY ultimate failure the client raises after its bounded retries / timeout /
 *    response-size ceiling — INCLUDING the FR-009a empty-completion gate — is caught and degraded to
 *    `{ source:'fallback', text: task.fallback }`, never rethrown (FR-009, US1 AS-2).
 *  - agent → emit a self-describing task bundle under `.codegraph/tasks/<id>/` via `emitBundle` and
 *    return `{ source:'pending-bundle', text: task.fallback, handle }` — usable fallback text NOW
 *    plus a handle the consumer later redeems with `redeemHandle` (FR-010/FR-010a). If emission
 *    itself fails (a genuinely unwritable root), the throw is caught and degraded to
 *    `{ source:'fallback', text: task.fallback }` — the seam never throws, US1's always-usable-text
 *    guarantee is preserved, and the emit failure surfaces through status, not an exception (Edge Case).
 *
 * `root` anchors the agent-mode bundle directory (`.codegraph/tasks/<id>/`); the dormant/endpoint
 * branches ignore it. The seam never opens the graph DB nor writes LLM text into graph structure
 * (FR-014) — the agent bundle is plain filesystem state, never SQLite (FR-023) — and holds no
 * cross-call state: each call resolves config afresh and (in agent mode) emits its own fresh bundle
 * with no dedup (FR-024a). `result.source` always lets the caller tell endpoint / fallback /
 * pending-bundle apart (FR-012).
 */
export async function generate(
  root: string,
  task: ProseTask,
  overrides?: GenerateOverrides,
): Promise<GenerationResult> {
  const env = overrides?.env ?? process.env;
  const config = loadLlmConfig(env);

  // Dormant (null) or misconfig: behaviorally identical — zero network, zero fs, consumer fallback.
  if (config === null || 'misconfigured' in config) {
    return { source: 'fallback', text: task.fallback };
  }

  // Agent: emit a self-describing task bundle under `root/.codegraph/tasks/<id>/` and hand back the
  // fallback text NOW plus a redeemable handle (FR-010/FR-010a). A genuinely unwritable root makes
  // emitBundle throw; that degrades to the consumer fallback so the seam never throws (Edge Case; US1).
  if (config.mode === 'agent') {
    try {
      const { handle } = emitBundle(root, task);
      return { source: 'pending-bundle', text: task.fallback, handle };
    } catch {
      return { source: 'fallback', text: task.fallback };
    }
  }

  // Endpoint: compose the prompt once, then one non-streaming completion. Every LlmEndpointError the
  // client raises (retry-exhaustion, non-retryable status, the FR-009a empty completion, or a
  // size-ceiling breach) degrades to the consumer fallback — the seam never throws for a failed
  // endpoint call (FR-009, US1 AS-2).
  const messages = composePrompt(task);
  const client = new LlmEndpointClient(config, overrides?.client);
  try {
    const text = await client.complete(messages, { stream: false });
    return { source: 'endpoint', text };
  } catch {
    return { source: 'fallback', text: task.fallback };
  }
}
