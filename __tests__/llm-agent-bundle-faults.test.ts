/**
 * Agent-mode task bundles — fault-injection tests (SPEC-018 slice 2, round-2 review).
 *
 * These pin the *resilience* contracts in `src/llm/agent-bundle.ts` that CANNOT be
 * reproduced with real filesystem inputs — they require a descriptor operation to fail
 * on an already-open fd (EIO), a file to grow between the fstat size check and the read
 * (a TOCTOU append by the untrusted writer), or the emit cleanup `rmSync` to fail. Real
 * fs cannot produce any of those deterministically, and this vitest/ESM setup cannot
 * `vi.spyOn` the frozen `node:fs` namespace, so this file fault-injects `node:fs` via
 * `vi.mock` + `importOriginal` passthrough — overriding ONLY the specific method under
 * test, gated behind a flag that is off except around the exact call being exercised.
 * Every other fs call (mkdir/open/read/write/rename/rm during seeding and cleanup) runs
 * against the real filesystem, so the bundles here are real on-disk bundles.
 *
 * The behavior-preserving, real-fs assertions for these fixes (open classification,
 * staging-dir invisibility, symlinked bundle entry) live in `llm-agent-bundle.test.ts`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as realNodeFs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Mutable fault switches, shared with the `node:fs` mock factory. `vi.hoisted` runs
 * before the hoisted `vi.mock` factory so the closure can capture this object.
 */
const faults = vi.hoisted(() => ({
  /** When true, `fstatSync` throws a simulated EIO on the open fd (Fix A). */
  fstatThrows: false,
  /** When a number, `fstatSync` reports this size + isFile:true (Fix B: under-report). */
  fstatSize: null as number | null,
  /** When true, `rmSync` throws a simulated cleanup failure (Fix C: must not mask). */
  rmThrows: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fstatSync = (fd: number, options?: unknown) => {
    if (faults.fstatThrows) throw Object.assign(new Error('simulated EIO on fd'), { code: 'EIO' });
    if (faults.fstatSize !== null) {
      return { isFile: () => true, size: faults.fstatSize } as unknown as ReturnType<typeof actual.fstatSync>;
    }
    return (actual.fstatSync as (fd: number, options?: unknown) => ReturnType<typeof actual.fstatSync>)(fd, options);
  };
  const rmSync = (target: unknown, options?: unknown) => {
    if (faults.rmThrows) throw Object.assign(new Error('simulated rmSync cleanup failure'), { code: 'EPERM' });
    return (actual.rmSync as (t: unknown, o?: unknown) => void)(target, options);
  };
  return { ...actual, default: { ...actual }, fstatSync, rmSync };
});

// Imported AFTER the mock so the module under test binds the mocked `node:fs`.
import { emitBundle, readBundleFileSafely, MAX_BUNDLE_INPUT_BYTES } from '../src/llm/agent-bundle';
import type { ProseTask } from '../src/llm/generate';
import { getCodeGraphDir } from '../src/directory';

const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = realNodeFs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-bundle-fault-'));
  tempDirs.push(dir);
  return dir;
}
function makeTask(overrides: Partial<ProseTask> = {}): ProseTask {
  return {
    instructions: 'Summarize the change in prose.',
    graphContext: ['ctx-item-a'],
    outputContract: { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] },
    fallback: 'HEURISTIC FALLBACK',
    ...overrides,
  };
}
function bundleDirOf(root: string, id: string): string {
  return path.join(getCodeGraphDir(root), 'tasks', id);
}

afterEach(() => {
  // Always clear faults first so the real-fs cleanup below is never sabotaged.
  faults.fstatThrows = false;
  faults.fstatSize = null;
  faults.rmThrows = false;
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (realNodeFs.existsSync(dir)) realNodeFs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
describe('readBundleFileSafely — never throws on a descriptor-operation failure (Fix A)', () => {
  it('returns { ok:false } (never throws) when fstat fails on the OPEN descriptor (e.g. EIO)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask()); // real on-disk bundle (faults off)
    const dir = bundleDirOf(root, id);
    // The pre-fix code ran fstatSync inside `try { … } finally { closeSync }` with NO
    // catch, so an fstat failure on the open fd propagated OUT — breaking the closed
    // SafeReadResult contract that listBundles/redeemHandle/ingestBundle/status rely on.
    faults.fstatThrows = true;
    let res: ReturnType<typeof readBundleFileSafely> | undefined;
    expect(() => {
      res = readBundleFileSafely(root, dir, 'manifest.json');
    }).not.toThrow();
    faults.fstatThrows = false;
    expect(res && res.ok).toBe(false);
    // Bounded reason — relPath only, no raw errno text leaked.
    if (res && !res.ok) {
      expect(res.reason).toContain('manifest.json');
      expect(res.reason).not.toContain('EIO');
    }
  });
});

describe('readBundleFileSafely — enforces the size ceiling DURING the read, not just at fstat (Fix B)', () => {
  it('rejects a file whose read exceeds MAX_BUNDLE_INPUT_BYTES even when fstat under-reports the size (TOCTOU append)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    const dir = bundleDirOf(root, id);
    // A real oversized, otherwise-valid JSON string on disk.
    const huge = '"' + 'A'.repeat(MAX_BUNDLE_INPUT_BYTES + 64) + '"';
    realNodeFs.writeFileSync(path.join(dir, 'grew.json'), huge, 'utf8');
    // Model the untrusted writer appending AFTER the fstat size check: fstat reports a
    // small size (the early cheap reject passes), but the descriptor read observes the
    // real, oversized content. Only a read-time bound can catch this — the pre-fix
    // readFileSync(fd,'utf8') read to EOF and pulled the whole oversized string in.
    faults.fstatSize = 10;
    const res = readBundleFileSafely(root, dir, 'grew.json');
    faults.fstatSize = null;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe(`file exceeds ${MAX_BUNDLE_INPUT_BYTES} bytes: grew.json`);
  });
});

describe('emitBundle — a mid-emit cleanup failure never masks the original emit error (Fix C)', () => {
  it('surfaces the original emit error, not the cleanup rmSync failure', () => {
    const root = makeRoot();
    // A circular graphContext makes JSON.stringify throw DURING emit (after the staging
    // dir + first file exist) — the deterministic mid-emit failure generate() must see.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const task = makeTask({ graphContext: circular as unknown as string[] });
    // Force the cleanup rmSync to throw: if it isn't guarded, its error propagates and
    // MASKS the original circular-structure emit error that generate() needs to see.
    faults.rmThrows = true;
    let caught: unknown;
    expect(() => {
      try {
        emitBundle(root, task);
      } catch (e) {
        caught = e;
        throw e;
      }
    }).toThrow();
    faults.rmThrows = false;
    // The ORIGINAL emit error surfaced, not the cleanup rmSync error.
    expect(String((caught as Error).message)).not.toContain('simulated rmSync cleanup failure');
    expect(String((caught as Error).message).toLowerCase()).toContain('circular');
  });
});
