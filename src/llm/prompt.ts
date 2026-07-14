/**
 * Prompt composition + deterministic token-budget guard (SPEC-018 slice 1).
 *
 * Composes a prose task into OpenAI-compatible chat `messages` and enforces the
 * FR-018 token-budget guard. Two responsibilities, both pure and deterministic
 * (no randomness, no Date/locale) so identical input yields byte-identical output
 * (SC-003); the guard never auto-chunks or map-reduces (FR-019).
 *
 * Composition follows a FIXED priority order (research D5 / FR-018):
 *   1. task instructions      — highest priority, NEVER trimmed
 *   2. expected-output contract — never trimmed
 *   3. graph context          — lowest priority, the ONLY tier the guard trims
 *
 * Messages array shape (minimal, OpenAI-chat-compatible):
 *   [ { role: 'system', content: <instructions> + <output contract> },   // protected tiers
 *     { role: 'user',   content: <trimmed graph context> [+ marker] } ]  // trimmed tier
 * The two protected tiers share the system message (they are always sent intact, so
 * the model — and, on the bundle path, the coding agent — always receives them in
 * full). The graph-context tier is the user message; the guard operates on ITS chars.
 * Both parts are embedded verbatim; the layer never enriches them (Q2 / FR-013).
 *
 * Token estimation is a fixed characters-per-token heuristic (no external tokenizer).
 * The budget is a conservative internal constant sized for the modal ~4,096-token
 * local-model window (CRL 3) — never derived from `CODEGRAPH_LLM_MODEL`, which the
 * layer has no channel to introspect.
 */

import type { ProseTask } from './generate';

/** Character-per-token heuristic denominator (FR-018; no external tokenizer). */
export const CHARS_PER_TOKEN = 4;

/** Graph-context token budget — the graph-context tier only (research D5 / CRL 3). */
export const GRAPH_CONTEXT_TOKEN_BUDGET = 2000;

/** Graph-context char budget the guard trims to: 2000 tokens × 4 chars = 8000. */
export const GRAPH_CONTEXT_CHAR_BUDGET = GRAPH_CONTEXT_TOKEN_BUDGET * CHARS_PER_TOKEN;

/** A single OpenAI-compatible chat message. Only `system`/`user` are ever produced. */
export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** Outcome of trimming the graph-context tier to {@link GRAPH_CONTEXT_CHAR_BUDGET}. */
export interface TrimResult {
  /** The graph-context items kept, in original order, byte-identical to the input. */
  kept: string[];
  /** Total graph-context items received (the `M` in the marker). */
  total: number;
  /** True iff at least one item was dropped. */
  truncated: boolean;
  /** `[context truncated: N of M]` — present ONLY when {@link truncated}. */
  marker?: string;
}

/**
 * Estimate token usage as `ceil(length / CHARS_PER_TOKEN)` (FR-018). Deterministic;
 * no external tokenizer.
 */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

/**
 * The 2-char `\n\n` that {@link composePrompt} joins successive user-message parts with.
 * The guard MUST count it, or the serialized message can exceed the budget on many items.
 */
const PART_SEPARATOR_LEN = 2;

/**
 * Deterministically trim the graph-context tier to {@link GRAPH_CONTEXT_CHAR_BUDGET}
 * (FR-018). Keeps the longest leading prefix of WHOLE items whose SERIALIZED length — the
 * items joined by the 2-char `\n\n` separator exactly as {@link composePrompt} joins them —
 * fits the budget (inclusive), dropping every trailing item that would push it over. Never
 * mid-item byte truncation, so each surviving item stays well-formed. When anything is
 * dropped, {@link TrimResult.marker} is `[context truncated: N of M]` (N kept of M total)
 * and is itself accounted for (plus its own `\n\n` separator) so the final user message —
 * kept items AND the marker — never exceeds the budget. When nothing is dropped there is no
 * marker. Never auto-chunks (FR-019). Deterministic — no randomness/Date/locale (SC-003).
 */
export function trimToBudget(items: string[]): TrimResult {
  const total = items.length;

  // Greedily keep the longest leading prefix whose serialized length (items + the `\n\n`
  // separators between them) fits the budget — this mirrors composePrompt's `join('\n\n')`,
  // so the accounting reflects the REAL user-message size, not the naive char sum.
  const kept: string[] = [];
  let used = 0; // serialized length of `kept` so far: item chars + inter-item separators
  for (const item of items) {
    const add = (kept.length === 0 ? 0 : PART_SEPARATOR_LEN) + item.length;
    if (used + add <= GRAPH_CONTEXT_CHAR_BUDGET) {
      used += add;
      kept.push(item);
    } else {
      // Drop this item and ALL trailing ones: whole-item, prefix-keeping trim.
      break;
    }
  }

  if (kept.length === total) {
    return { kept, total, truncated: false };
  }

  // Truncation: the marker (and its own `\n\n` separator) must ALSO fit within the budget,
  // since composePrompt appends it as a final part. Drop trailing kept items until the
  // marker-inclusive serialization fits. The marker's length only shrinks (or holds) as N
  // falls (fewer digits), so this converges; when no items remain the message is the marker
  // alone (always < budget), so the loop is guarded on a non-empty kept prefix.
  let marker = `[context truncated: ${kept.length} of ${total}]`;
  while (kept.length > 0 && used + PART_SEPARATOR_LEN + marker.length > GRAPH_CONTEXT_CHAR_BUDGET) {
    const removed = kept.pop();
    if (removed === undefined) break; // unreachable given the guard; satisfies strict null checks
    used -= removed.length + (kept.length === 0 ? 0 : PART_SEPARATOR_LEN);
    marker = `[context truncated: ${kept.length} of ${total}]`;
  }

  return { kept, total, truncated: true, marker };
}

/**
 * Compose a {@link ProseTask} into the chat `messages` (see the module comment for the
 * shape). Instructions + the output contract go in the system message intact; the
 * graph-context tier goes in the user message after the {@link trimToBudget} guard,
 * with its truncation marker appended when the tier was trimmed.
 */
export function composePrompt(task: ProseTask): ChatMessage[] {
  // Protected tiers (never trimmed): instructions first, then the output contract.
  const system = `${task.instructions}\n\nExpected output contract: ${JSON.stringify(task.outputContract)}`;

  // Trimmed tier: the graph context, with the marker appended when truncation occurred.
  const trimmed = trimToBudget(task.graphContext);
  const parts = trimmed.marker ? [...trimmed.kept, trimmed.marker] : trimmed.kept;
  const user = parts.join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
