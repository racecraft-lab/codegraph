/**
 * LLM slice-1 dormancy gate — the final acceptance test (SPEC-018 T015, FR-004/FR-011, SC-002).
 *
 * Pins the dormant contract the whole slice rests on: with NO `CODEGRAPH_LLM_*` variable set, ANY
 * number of `generate(root, task)` calls return the EXACT consumer-supplied `task.fallback` while
 * performing ZERO outbound requests and ZERO filesystem writes — observably byte-identical to a
 * build without the LLM feature at all (SC-002). And `resolveLlmStatus` stays neutral (dormant),
 * never a misconfiguration.
 *
 * This is a GUARD, not a feature test: the dormant behavior it pins already exists (config resolves
 * to `null` → `generate` returns the consumer fallback before constructing any client). It MUST STAY
 * green through every later phase — any change that makes an unconfigured `generate` touch the
 * network or write a file is a dormancy regression, full stop, not a TDD violation to "fix" by
 * editing this test.
 *
 * Network absence is proven by spying on the platform global `fetch`: `LlmEndpointClient` is the
 * only `fetch` call site in the LLM layer, so a call count of 0 here is a whole-seam guarantee that
 * a dormant call never reached the network. Env is scrubbed in `beforeEach` (mirrors the embeddings
 * dormancy suite), so the gate is hermetic regardless of the ambient runner environment; the run is
 * additionally invoked env-clean.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generate } from '../src/llm/generate';
import type { ProseTask } from '../src/llm/generate';
import { resolveLlmStatus } from '../src/llm/config';

/** Every variable that could activate or misconfigure the LLM layer — all cleared for a clean env. */
const LLM_ENV_KEYS = ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL', 'CODEGRAPH_LLM_API_KEY', 'CODEGRAPH_LLM_PROVIDER'];
const ACTIVATION_VARS = ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'];

/** Replace the global `fetch` with a throwing counter so any stray outbound call is a hard failure. */
function installFetchGuard(): { calls: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let calls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = (...args: unknown[]) => {
    calls += 1;
    throw new Error(`llm-dormancy: unexpected outbound fetch while dormant: ${String(args[0])}`);
  };
  return {
    calls: () => calls,
    restore: () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = real;
    },
  };
}

function makeTask(fallback = 'consumer-precomputed heuristic fallback'): ProseTask {
  return {
    instructions: 'Summarize the change.',
    graphContext: ['ctx-item-a', 'ctx-item-b'],
    outputContract: { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] },
    fallback,
  };
}

describe('LLM slice-1 dormancy gate (T015, FR-004/FR-011, SC-002)', () => {
  const tempDirs: string[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const k of LLM_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of LLM_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (tempDirs.length) {
      const dir = tempDirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A fresh, EMPTY project root; the gate asserts it stays empty (no `.codegraph`, no bundle dir). */
  function makeRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-dormancy-'));
    tempDirs.push(dir);
    return dir;
  }

  it('any number of generate(root, task) calls return the EXACT consumer fallback with zero fetch and zero fs writes — byte-identical to an unconfigured install', async () => {
    // Precondition: nothing ambient leaked past beforeEach — the gate truly runs against a clean env.
    for (const k of LLM_ENV_KEYS) expect(process.env[k]).toBeUndefined();

    const guard = installFetchGuard();
    try {
      const root = makeRoot();
      const task = makeTask();
      const canonical = { source: 'fallback', text: task.fallback };

      // "Any number" — every call returns the exact consumer fallback, identical across calls
      // (no cross-call drift, FR-024a). generate reads the ambient (clean) process.env: no overrides.
      for (let i = 0; i < 5; i++) {
        const result = await generate(root, task);
        expect(result).toEqual(canonical);
      }

      // Zero network: the dormant seam never reached the one fetch call site.
      expect(guard.calls()).toBe(0);
      // Zero filesystem writes: the project root is untouched — no `.codegraph`, no bundle dir.
      expect(fs.existsSync(path.join(root, '.codegraph'))).toBe(false);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      guard.restore();
    }
  });

  it('resolveLlmStatus stays neutral (dormant) under a clean env — never a misconfiguration, never active', () => {
    for (const k of LLM_ENV_KEYS) expect(process.env[k]).toBeUndefined();
    const dormant = { active: false, activationVars: ACTIVATION_VARS };
    // From the ambient clean process.env AND from an explicitly empty env — both neutral-dormant.
    expect(resolveLlmStatus(process.env)).toEqual(dormant);
    expect(resolveLlmStatus({})).toEqual(dormant);
  });
});
