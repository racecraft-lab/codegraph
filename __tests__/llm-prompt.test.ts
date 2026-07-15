/**
 * Prompt composition + deterministic token-budget guard — unit tests (SPEC-018 slice 1, T007).
 *
 * Pins `src/llm/prompt.ts` against research D5, spec FR-018/FR-019, data-model §1
 * (ProseTask), and the archived endpoint-wire contract recoverable from
 * `git show 4acfa1b:specs/018-llm-access-layer/contracts/endpoint-wire.md`:
 *   - estimateTokens(s) = ceil(s.length / CHARS_PER_TOKEN), CHARS_PER_TOKEN = 4 (no external tokenizer).
 *   - GRAPH_CONTEXT_TOKEN_BUDGET = 2000 → GRAPH_CONTEXT_CHAR_BUDGET = 8000 (2000 × 4).
 *   - composePrompt composes the chat messages in the FIXED priority order
 *     instructions > output contract > graph context. Instructions and the output
 *     contract are NEVER trimmed; ONLY the graph-context tier is trimmed to the char
 *     budget by dropping WHOLE trailing items (never mid-item byte truncation) and
 *     appending the marker `[context truncated: N of M]` (N kept of M total).
 *   - Deterministic: identical input → byte-identical output (SC-003). No auto-chunk (FR-019).
 *
 * Pure functions over plain values — hermetic (no fs, no env, no network, no teardown).
 * Message lookups are defensive (`.find`/`?? ''`) so a wrong-shaped result fails on a real
 * assertion rather than a TypeError.
 */
import { describe, it, expect } from 'vitest';
import {
  CHARS_PER_TOKEN,
  GRAPH_CONTEXT_TOKEN_BUDGET,
  GRAPH_CONTEXT_CHAR_BUDGET,
  estimateTokens,
  trimToBudget,
  composePrompt,
} from '../src/llm/prompt';
import type { ChatMessage } from '../src/llm/prompt';
import type { ProseTask, OutputContract } from '../src/llm/generate';

const CONTRACT: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };

function makeTask(over: Partial<ProseTask> = {}): ProseTask {
  return {
    instructions: 'Write a concise summary of the module.',
    graphContext: [],
    outputContract: CONTRACT,
    fallback: 'FALLBACK_SENTINEL',
    ...over,
  };
}

const roles = (messages: ChatMessage[]): string[] => messages.map((m) => m.role);
const contentOf = (messages: ChatMessage[], role: ChatMessage['role']): string =>
  messages.find((m) => m.role === role)?.content ?? '';

describe('estimateTokens — ceil(length / CHARS_PER_TOKEN) (FR-018)', () => {
  it('is 0 for the empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('is length/4 on an exact multiple of 4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('rounds UP a partial token (ceil, not floor)', () => {
    expect(estimateTokens('abcde')).toBe(2); // 5 / 4 = 1.25 -> 2
    expect(estimateTokens('a')).toBe(1); //     1 / 4 = 0.25 -> 1
  });
});

describe('token-budget constants (research D5 / CRL 3)', () => {
  it('CHARS_PER_TOKEN is 4', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });

  it('GRAPH_CONTEXT_TOKEN_BUDGET is 2000', () => {
    expect(GRAPH_CONTEXT_TOKEN_BUDGET).toBe(2000);
  });

  it('GRAPH_CONTEXT_CHAR_BUDGET is 8000 = 2000 tokens x 4 chars', () => {
    expect(GRAPH_CONTEXT_CHAR_BUDGET).toBe(8000);
    expect(GRAPH_CONTEXT_CHAR_BUDGET).toBe(GRAPH_CONTEXT_TOKEN_BUDGET * CHARS_PER_TOKEN);
  });
});

describe('trimToBudget — deterministic whole-item graph-context trim (FR-018)', () => {
  it('keeps every item verbatim when the tier fits the budget (no marker)', () => {
    const items = ['a'.repeat(3000), 'b'.repeat(3000)]; // sum 6000 <= 8000
    const r = trimToBudget(items);
    expect(r.kept).toEqual(items);
    expect(r.kept[0]).toBe(items[0]); // byte-identical, same reference — no mid-item truncation
    expect(r.total).toBe(2);
    expect(r.truncated).toBe(false);
    expect(r.marker).toBeUndefined();
  });

  it('treats a tier whose SERIALIZED length is EXACTLY the budget as fitting (inclusive of \\n\\n separators)', () => {
    // 3999 + 2 (the \n\n join separator) + 3999 = 8000 == budget once the separator is counted.
    // (The naive char sum is 7998; the guard must measure the real serialized length.)
    const items = ['a'.repeat(3999), 'b'.repeat(3999)];
    const r = trimToBudget(items);
    expect(r.kept).toEqual(items);
    expect(r.truncated).toBe(false);
    expect(r.marker).toBeUndefined();
  });

  it('drops WHOLE trailing items and appends [context truncated: N of M]', () => {
    const items = ['x'.repeat(5000), 'y'.repeat(4000), 'z'.repeat(100)];
    // 5000 fits; 5000 + 4000 = 9000 > 8000 -> stop. Keep only the first item.
    const r = trimToBudget(items);
    expect(r.kept).toEqual([items[0]]);
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.marker).toBe('[context truncated: 1 of 3]');
  });

  it('keeps ZERO items when the first item alone exceeds the budget', () => {
    const items = ['x'.repeat(8001)];
    const r = trimToBudget(items);
    expect(r.kept).toEqual([]);
    expect(r.truncated).toBe(true);
    expect(r.marker).toBe('[context truncated: 0 of 1]');
  });

  it('returns an empty, untruncated result for no items', () => {
    const r = trimToBudget([]);
    expect(r.kept).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.marker).toBeUndefined();
  });

  it('is deterministic — identical input yields identical output (SC-003)', () => {
    const items = ['a'.repeat(6000), 'b'.repeat(6000), 'c'.repeat(100)];
    const a = trimToBudget(items);
    const b = trimToBudget(items);
    expect(a).toEqual(b);
    expect(a.marker).toBe('[context truncated: 1 of 3]'); // concrete pin, not just self-equality
  });
});

describe('composePrompt — fixed priority order, only graph context trimmed (FR-018/FR-019)', () => {
  it('emits exactly two messages: [system, user]', () => {
    const messages = composePrompt(makeTask({ graphContext: ['ctx'] }));
    expect(roles(messages)).toEqual(['system', 'user']);
  });

  it('puts instructions THEN the output contract in the system message (never the graph context)', () => {
    const task = makeTask({
      instructions: 'INSTRUCTIONS_SENTINEL',
      graphContext: ['CONTEXT_SENTINEL'],
    });
    const system = contentOf(composePrompt(task), 'system');
    const contractJson = JSON.stringify(task.outputContract);
    expect(system).toContain('INSTRUCTIONS_SENTINEL');
    expect(system).toContain(contractJson);
    // Fixed priority order within the protected tier: instructions precede the contract.
    expect(system.indexOf('INSTRUCTIONS_SENTINEL')).toBeLessThan(system.indexOf(contractJson));
    // Graph context never rides in the protected (system) tier.
    expect(system).not.toContain('CONTEXT_SENTINEL');
  });

  it('puts the graph context (verbatim) in the user message', () => {
    const task = makeTask({ graphContext: ['CONTEXT_SENTINEL_A', 'CONTEXT_SENTINEL_B'] });
    const user = contentOf(composePrompt(task), 'user');
    expect(user).toContain('CONTEXT_SENTINEL_A');
    expect(user).toContain('CONTEXT_SENTINEL_B');
  });

  it('never leaks the consumer fallback into the model prompt', () => {
    const messages = composePrompt(makeTask({ graphContext: ['ctx'], fallback: 'FALLBACK_SENTINEL' }));
    expect(contentOf(messages, 'system')).not.toContain('FALLBACK_SENTINEL');
    expect(contentOf(messages, 'user')).not.toContain('FALLBACK_SENTINEL');
  });

  it('NEVER trims instructions or the contract, even when far larger than the budget', () => {
    const bigInstructions = 'I'.repeat(GRAPH_CONTEXT_CHAR_BUDGET * 3); // 24000 >> 8000
    const task = makeTask({ instructions: bigInstructions, graphContext: [] });
    const system = contentOf(composePrompt(task), 'system');
    expect(system).toContain(bigInstructions); // present in full — untrimmed
    expect(system).toContain(JSON.stringify(task.outputContract));
  });

  it('trims ONLY the graph-context tier and marks it, leaving instructions intact', () => {
    const task = makeTask({
      instructions: 'KEEP_INSTRUCTIONS',
      graphContext: ['KEEP' + 'a'.repeat(6000), 'DROP' + 'z'.repeat(3000)], // 6004 kept, +3004 over -> drop
    });
    const messages = composePrompt(task);
    const user = contentOf(messages, 'user');
    expect(user).toContain('[context truncated: 1 of 2]');
    expect(user).toContain('KEEP');
    expect(user).not.toContain('DROP'); // whole trailing item dropped, not byte-truncated
    expect(contentOf(messages, 'system')).toContain('KEEP_INSTRUCTIONS'); // protected tier untouched
  });

  it('appends NO marker when the graph context fits', () => {
    const task = makeTask({ graphContext: ['a'.repeat(1000), 'b'.repeat(1000)] });
    expect(contentOf(composePrompt(task), 'user')).not.toContain('context truncated');
  });

  it('is deterministic — identical task yields byte-identical messages (SC-003)', () => {
    const task = makeTask({ graphContext: ['a'.repeat(6000), 'b'.repeat(6000)] });
    const a = composePrompt(task);
    const b = composePrompt(task);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(contentOf(a, 'user')).toContain('[context truncated: 1 of 2]'); // concrete pin
  });
});

describe('composePrompt — user-message length never exceeds the budget (FR-018: \\n\\n separators + marker)', () => {
  // The guard operates on the graph-context tier's chars, and the user message is
  // `parts.join('\n\n')` — so the budget MUST account for the 2-char separators between
  // kept items and, on truncation, for the appended marker (+ its own separator). The
  // invariant across ALL inputs: the user-message content.length <= GRAPH_CONTEXT_CHAR_BUDGET.
  const userLen = (task: ProseTask): number => contentOf(composePrompt(task), 'user').length;

  it('(a) many empty-string items — separators alone must not overflow the budget', () => {
    // 10000 '' items each measure 0 chars, but the join inserts 2*(N-1) separator chars.
    const task = makeTask({ graphContext: Array<string>(10000).fill('') });
    expect(userLen(task)).toBeLessThanOrEqual(GRAPH_CONTEXT_CHAR_BUDGET);
  });

  it('(b) many 1-char items — item chars plus separators must not overflow the budget', () => {
    const task = makeTask({ graphContext: Array<string>(10000).fill('a') });
    expect(userLen(task)).toBeLessThanOrEqual(GRAPH_CONTEXT_CHAR_BUDGET);
  });

  it('(c) mid-size items whose inter-item separators + marker would overflow the raw-sum budget', () => {
    // Raw sum 3999+3999 = 7998 <= 8000, so a length-only guard keeps both; but the real
    // user message is 3999 + 2 + 3999 + 2 + len(marker) = 8029 > budget. Fix must trim more.
    const task = makeTask({ graphContext: ['a'.repeat(3999), 'b'.repeat(3999), 'c'.repeat(500)] });
    const user = contentOf(composePrompt(task), 'user');
    expect(user).toContain('context truncated'); // still truncated (a trailing item was dropped)
    expect(user.length).toBeLessThanOrEqual(GRAPH_CONTEXT_CHAR_BUDGET);
  });

  it('(boundary) a kept prefix filling the budget exactly still leaves room for the marker', () => {
    // item0 (7971) + \n\n (2) + marker `[context truncated: 1 of 2]` (27) = 8000 == budget.
    const task = makeTask({ graphContext: ['a'.repeat(7971), 'b'.repeat(500)] });
    const user = contentOf(composePrompt(task), 'user');
    expect(user).toContain('[context truncated: 1 of 2]');
    expect(user.length).toBe(GRAPH_CONTEXT_CHAR_BUDGET); // exactly at, never over
  });

  it('the budget invariant holds across a spread of item counts and sizes', () => {
    const cases: string[][] = [
      [],
      [''],
      ['a'.repeat(9000)], // single over-budget item -> kept 0, marker only
      Array<string>(5000).fill(''),
      Array<string>(5000).fill('ab'),
      ['x'.repeat(4000), 'y'.repeat(4000)],
      ['x'.repeat(2000), 'y'.repeat(2000), 'z'.repeat(2000), 'w'.repeat(2000), 'v'.repeat(2000)],
    ];
    for (const graphContext of cases) {
      expect(userLen(makeTask({ graphContext }))).toBeLessThanOrEqual(GRAPH_CONTEXT_CHAR_BUDGET);
    }
  });
});
