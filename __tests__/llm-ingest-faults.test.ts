/**
 * Agent-mode bundle ingest — fault-injection tests (SPEC-018 slice 2, round-2 review).
 *
 * Pins the `ingestBundle` finalization-rollback contract in `src/llm/ingest.ts` that
 * CANNOT be reproduced with real filesystem inputs: the exclusive `O_CREAT|O_EXCL`
 * `openSync` for `result.json` SUCCEEDS (creating the file), but the SUBSEQUENT
 * `fs.writeFileSync(resultFd, …)` fails (ENOSPC/EIO). Real fs cannot make a write to an
 * already-open fd fail deterministically, and this vitest/ESM setup cannot `vi.spyOn` the
 * frozen `node:fs` namespace, so this file fault-injects `node:fs` via `vi.mock` +
 * `importOriginal` passthrough — overriding ONLY `writeFileSync`, behind a flag that is off
 * except around the exact call being exercised. Every other fs call (open/read/rename/rm
 * during seeding and cleanup) runs against the real filesystem, so the bundles here are
 * real on-disk bundles.
 *
 * The behavior-preserving, real-fs assertions for ingest live in `llm-ingest.test.ts` /
 * `llm-ingest-security.test.ts`.
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
  /** When true, `fs.writeFileSync` throws a simulated ENOSPC (Fix F: post-open write failure). */
  writeThrows: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const writeFileSync = (...args: unknown[]) => {
    if (faults.writeThrows) throw Object.assign(new Error('simulated ENOSPC on write'), { code: 'ENOSPC' });
    return (actual.writeFileSync as (...a: unknown[]) => void)(...args);
  };
  return { ...actual, default: { ...actual }, writeFileSync };
});

// Imported AFTER the mock so the modules under test bind the mocked `node:fs`.
import { ingestBundle } from '../src/llm/ingest';
import { emitBundle } from '../src/llm/agent-bundle';
import type { ProseTask, OutputContract } from '../src/llm/generate';
import { getCodeGraphDir } from '../src/directory';

const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = realNodeFs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-ingest-fault-'));
  tempDirs.push(dir);
  return dir;
}
const PROSE_CONTRACT: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };
function makeTask(overrides: Partial<ProseTask> = {}): ProseTask {
  return { instructions: 'Summarize.', graphContext: [], outputContract: PROSE_CONTRACT, fallback: 'FB', ...overrides };
}
function bundleDirOf(root: string, id: string): string {
  return path.join(getCodeGraphDir(root), 'tasks', id);
}
function writeOutput(root: string, id: string, obj: unknown): void {
  realNodeFs.writeFileSync(path.join(bundleDirOf(root, id), 'output.json'), JSON.stringify(obj), 'utf8');
}
function resultExists(root: string, id: string): boolean {
  return realNodeFs.existsSync(path.join(bundleDirOf(root, id), 'result.json'));
}
function manifestStatus(root: string, id: string): string {
  return JSON.parse(realNodeFs.readFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'utf8')).status;
}

afterEach(() => {
  faults.writeThrows = false; // clear first so real-fs cleanup below is never sabotaged
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (realNodeFs.existsSync(dir)) realNodeFs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
describe('ingestBundle — a failed result.json write rolls back the orphan (Fix F)', () => {
  it('removes the orphaned empty result.json and stays re-ingestable when the write fails after the exclusive open', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask()); // real on-disk bundle (faults off)
    writeOutput(root, id, { prose: 'valid answer' });

    // The exclusive O_CREAT|O_EXCL open for result.json SUCCEEDS (the empty file now exists on
    // disk), then the write fails. Pre-fix, `resultCreated` was set to true only AFTER the write,
    // so the outer catch's rollback (rmSync result.json) never ran — leaving an orphan EMPTY
    // result.json that then permanently blocks every re-ingest via O_EXCL EEXIST.
    faults.writeThrows = true;
    let result: ReturnType<typeof ingestBundle> | undefined;
    expect(() => {
      result = ingestBundle(root, id);
    }).not.toThrow();
    faults.writeThrows = false;

    // FR-028a-shaped rejection.
    expect(result && result.ok).toBe(false);
    // Orphan rolled back — no result.json is left behind (pre-fix: the empty file lingers).
    expect(resultExists(root, id)).toBe(false);
    // Manifest untouched — the bundle stays pending / re-ingestable.
    expect(manifestStatus(root, id)).toBe('pending');

    // Re-ingest (fault cleared) SUCCEEDS — pre-fix, the leftover result.json makes the
    // exclusive create fail with EEXIST ("refusing to write result.json: it already exists"),
    // wedging the bundle permanently.
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'valid answer' });
    expect(manifestStatus(root, id)).toBe('completed');
  });
});
