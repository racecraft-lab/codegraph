/**
 * LLM seam public types — unit tests (SPEC-018 slice 1, T002).
 *
 * Pins the STABLE Slice-1 public type surface declared in `src/llm/generate.ts`:
 * `ProseTask` (data-model §1), `OutputContract` (§5), and the three-kind
 * `GenerationResult` discriminated union (§6) — including the `pending-bundle`
 * kind, which is DEFINED in slice 1 for a stable public type even though it is
 * only produced in slice 2. These are the types the config/prompt/client tests
 * import, so locking their shape here guards the seam contract.
 *
 * A types-only module has no runtime behaviour, so the genuine red-before-green
 * signal is the module failing to resolve (the dynamic-import test) plus the
 * shape-construction assertions that exercise every discriminated-union arm.
 *
 * Traceability: FR-008 (fallback string), FR-013/FR-018 (opaque graphContext),
 * FR-021/FR-027 (OutputContract carried into the bundle), FR-009/FR-010/FR-011/
 * FR-012 (three-kind result the caller can always discriminate).
 */
import { describe, it, expect } from 'vitest';
import type { ProseTask, OutputContract, GenerationResult } from '../src/llm/generate';

describe('llm/generate — module surface (T002)', () => {
  it('resolves at runtime — the stable slice-1 seam module exists', async () => {
    // A pure `import type` is erased, so this dynamic import is what actually
    // fails when the module is absent (the honest red for a types-only stub).
    const mod = await import('../src/llm/generate');
    expect(mod).toBeDefined();
  });
});

describe('OutputContract (data-model §5 / FR-027)', () => {
  it('carries requiredFields with name + type, and an OPTIONAL nonEmpty flag', () => {
    const contract: OutputContract = {
      requiredFields: [
        { name: 'prose', type: 'string', nonEmpty: true },
        { name: 'tags', type: 'string[]' },
      ],
    };
    expect(contract.requiredFields).toHaveLength(2);
    expect(contract.requiredFields[0]).toEqual({ name: 'prose', type: 'string', nonEmpty: true });
    expect(contract.requiredFields[1]?.type).toBe('string[]');
    expect(contract.requiredFields[1]?.nonEmpty).toBeUndefined();
  });

  it('accepts the first-consumer prose shape (single required non-empty string field)', () => {
    const contract: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };
    expect(contract.requiredFields[0]?.name).toBe('prose');
    expect(contract.requiredFields[0]?.type).toBe('string');
  });
});

describe('ProseTask (data-model §1)', () => {
  it('embeds instructions, opaque graphContext items, an OutputContract, and a fallback string', () => {
    const task: ProseTask = {
      instructions: 'Summarize the change.',
      graphContext: ['ctx-item-1', 'ctx-item-2'],
      outputContract: { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] },
      fallback: 'heuristic fallback text',
    };
    expect(task.instructions).toBe('Summarize the change.');
    expect(task.graphContext).toEqual(['ctx-item-1', 'ctx-item-2']);
    expect(task.outputContract.requiredFields[0]?.name).toBe('prose');
    expect(task.fallback).toBe('heuristic fallback text');
  });

  it('allows an empty graphContext array (opaque items, layer never enriches them)', () => {
    const task: ProseTask = {
      instructions: 'Do the thing.',
      graphContext: [],
      outputContract: { requiredFields: [] },
      fallback: 'fallback',
    };
    expect(task.graphContext).toEqual([]);
  });
});

describe('GenerationResult — three-kind discriminated union (data-model §6 / FR-012)', () => {
  it('endpoint kind carries source + text (FR-009 success)', () => {
    const r: GenerationResult = { source: 'endpoint', text: 'generated prose' };
    expect(r.source).toBe('endpoint');
    expect(r.text).toBe('generated prose');
  });

  it('pending-bundle kind carries source + text + a redeemable handle (defined slice 1, produced slice 2 — FR-010)', () => {
    const r: GenerationResult = { source: 'pending-bundle', text: 'fallback now', handle: 'bundle-uuid' };
    expect(r.source).toBe('pending-bundle');
    expect(r.text).toBe('fallback now');
    // `handle` lives only on this arm — narrow the discriminant to read it.
    if (r.source === 'pending-bundle') expect(r.handle).toBe('bundle-uuid');
  });

  it('fallback kind carries source + text (FR-009 failure / FR-011 dormant)', () => {
    const r: GenerationResult = { source: 'fallback', text: 'verbatim consumer fallback' };
    expect(r.source).toBe('fallback');
    expect(r.text).toBe('verbatim consumer fallback');
  });

  it('the source discriminant distinguishes all three kinds', () => {
    const kinds: GenerationResult[] = [
      { source: 'endpoint', text: 'a' },
      { source: 'pending-bundle', text: 'b', handle: 'h' },
      { source: 'fallback', text: 'c' },
    ];
    expect(kinds.map((k) => k.source)).toEqual(['endpoint', 'pending-bundle', 'fallback']);
  });
});
