/**
 * Agent-mode bundle ingest — unit tests (SPEC-018 slice 2, T023).
 *
 * Pins `ingestBundle(root, id)` in `src/llm/ingest.ts` (contracts/bundle-files.md,
 * contracts/tasks-cli.md, data-model §4/§5, research D10, spec FR-027/FR-028/FR-028a/
 * FR-029/SC-006):
 *   - STRUCTURAL validation (FR-027, deterministic, never semantic): each
 *     `requiredField` present, of the declared `type` ('string' | 'string[]'), and
 *     non-empty when `nonEmpty`.
 *   - On PASS (FR-028): store the canonical `result.json = { text }` INSIDE the bundle
 *     dir and stamp `manifest.status = 'completed'`. `text` is derived from the
 *     validated output by concatenating the contract's required fields in declared
 *     order (a `string` field contributes its value; a `string[]` field its items
 *     joined by "\n"); fields are separated by a blank line. For the first-consumer
 *     single `prose: string` contract this reduces to exactly `output.prose`.
 *   - On FAIL (FR-028a): leave `status:'pending'`, return a reason, write NO consumer
 *     artifact and NO file outside the bundle dir, never throw / never `isError`.
 *   - Absent / empty / unreadable / malformed `output.json` (ingested too early) →
 *     the same FR-028a-shaped rejection (FR-027).
 *   - missing / already-completed / malformed-manifest bundles → rejected, never a
 *     false `completed` stamp (Edge Case).
 *   - End-to-end: emit → write conforming output.json → ingest → `redeemHandle` =
 *     `{ status:'completed', text }` (FR-010a).
 *
 * Real temp roots via `fs.mkdtempSync`, cleaned in `afterEach`; real files, real fs —
 * no mocking (root CLAUDE.md → Tests). Ingest is user-invoked only (FR-029); nothing
 * here wires it into a watcher/daemon.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ingestBundle } from '../src/llm/ingest';
import { emitBundle, redeemHandle, MAX_BUNDLE_INPUT_BYTES } from '../src/llm/agent-bundle';
import type { ProseTask, OutputContract } from '../src/llm/generate';
import { getCodeGraphDir } from '../src/directory';

// --- temp roots -----------------------------------------------------------
const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-ingest-'));
  tempDirs.push(dir);
  return dir;
}

const PROSE_CONTRACT: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };

function makeTask(overrides: Partial<ProseTask> = {}): ProseTask {
  return {
    instructions: 'Summarize the change in prose.',
    graphContext: ['ctx-item-a', 'ctx-item-b'],
    outputContract: PROSE_CONTRACT,
    fallback: 'HEURISTIC FALLBACK',
    ...overrides,
  };
}

function tasksDir(root: string): string {
  return path.join(getCodeGraphDir(root), 'tasks');
}
function bundleDirOf(root: string, id: string): string {
  return path.join(tasksDir(root), id);
}
function writeOutput(root: string, id: string, obj: unknown): void {
  fs.writeFileSync(path.join(bundleDirOf(root, id), 'output.json'), JSON.stringify(obj), 'utf8');
}
/** Write output.json with raw (possibly non-JSON) bytes. */
function writeOutputRaw(root: string, id: string, raw: string): void {
  fs.writeFileSync(path.join(bundleDirOf(root, id), 'output.json'), raw, 'utf8');
}
function readManifest(root: string, id: string): { status?: string } {
  return JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'utf8'));
}
function resultExists(root: string, id: string): boolean {
  return fs.existsSync(path.join(bundleDirOf(root, id), 'result.json'));
}
/** Every regular-file path under `dir`, recursively (for the SC-006 no-escape check). */
function listAllFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
describe('ingestBundle — structural validation + finalization (FR-027/FR-028)', () => {
  it('accepts a conforming prose output: stores result.json={text}, stamps completed, redeems to text (end-to-end FR-010a)', () => {
    const root = makeRoot();
    const { id, handle } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'The change adds a bounded safe-read.' });

    const result = ingestBundle(root, id);
    expect(result).toEqual({ ok: true, text: 'The change adds a bounded safe-read.' });

    // Canonical result stored INSIDE the bundle dir as exactly { text }.
    expect(JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'result.json'), 'utf8'))).toEqual({
      text: 'The change adds a bounded safe-read.',
    });
    // Manifest stamped completed (the only transition).
    expect(readManifest(root, id).status).toBe('completed');
    // FR-010a: the handle now redeems to the finalized text.
    expect(redeemHandle(root, handle)).toEqual({ status: 'completed', text: 'The change adds a bounded safe-read.' });
  });

  it('derives text = output.prose for the first-consumer single-field contract', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'exact prose value', extra: 'ignored' });
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'exact prose value' });
  });

  it('derives text by concatenating declared fields in order (string as-is, string[] joined by newlines)', () => {
    const root = makeRoot();
    const contract: OutputContract = {
      requiredFields: [
        { name: 'title', type: 'string', nonEmpty: true },
        { name: 'bullets', type: 'string[]', nonEmpty: true },
      ],
    };
    const { id } = emitBundle(root, makeTask({ outputContract: contract }));
    writeOutput(root, id, { title: 'My Title', bullets: ['first', 'second'] });
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'My Title\n\nfirst\nsecond' });
  });

  it('rejects output missing a required field (manifest stays pending, no result.json)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { notProse: 'x' });

    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    expect(result.ok === false && typeof result.reason).toBe('string');
    expect(readManifest(root, id).status).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it('rejects output whose required field has the wrong type (prose is a number)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 42 });
    expect(ingestBundle(root, id).ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it('rejects an empty string for a nonEmpty string field', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: '' });
    expect(ingestBundle(root, id).ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it('rejects a string[] field with a non-string item', () => {
    const root = makeRoot();
    const contract: OutputContract = { requiredFields: [{ name: 'bullets', type: 'string[]', nonEmpty: true }] };
    const { id } = emitBundle(root, makeTask({ outputContract: contract }));
    writeOutput(root, id, { bullets: ['ok', 3] });
    expect(ingestBundle(root, id).ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
  });

  it('rejects an empty array for a nonEmpty string[] field', () => {
    const root = makeRoot();
    const contract: OutputContract = { requiredFields: [{ name: 'bullets', type: 'string[]', nonEmpty: true }] };
    const { id } = emitBundle(root, makeTask({ outputContract: contract }));
    writeOutput(root, id, { bullets: [] });
    expect(ingestBundle(root, id).ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
  });

  it('ignores undeclared output keys (incl. __proto__) and validates only the contract fields', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    // Extra keys — including a literal __proto__ own-key — must not affect validation.
    writeOutputRaw(root, id, '{"prose":"valid answer","__proto__":{"x":1},"unused":true}');
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'valid answer' });
  });
});

describe('ingestBundle — early / missing / already-completed / malformed (Edge Cases, FR-028a)', () => {
  it('rejects when output.json is absent (ingested too early), leaving the bundle re-ingestable', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask()); // no output.json written yet
    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
    expect(resultExists(root, id)).toBe(false);

    // Re-ingestable once the agent writes conforming output.
    writeOutput(root, id, { prose: 'now present' });
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'now present' });
    expect(readManifest(root, id).status).toBe('completed');
  });

  it('rejects an empty output.json file (0 bytes) as a validation failure', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutputRaw(root, id, '');
    expect(ingestBundle(root, id).ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
  });

  it('rejects a malformed (non-JSON) output.json', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutputRaw(root, id, 'not json {{{');
    expect(ingestBundle(root, id).ok).toBe(false);
    expect(readManifest(root, id).status).toBe('pending');
  });

  it('rejects an id that has no bundle directory (never throws)', () => {
    const root = makeRoot();
    fs.mkdirSync(tasksDir(root), { recursive: true });
    const result = ingestBundle(root, 'does-not-exist');
    expect(result.ok).toBe(false);
  });

  it('rejects an already-completed bundle without re-stamping or rewriting the result', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'first' });
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'first' });

    // Tamper output, then re-ingest: an already-completed bundle is rejected and the
    // canonical result is NOT overwritten.
    writeOutput(root, id, { prose: 'second' });
    const again = ingestBundle(root, id);
    expect(again.ok).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'result.json'), 'utf8'))).toEqual({ text: 'first' });
    expect(readManifest(root, id).status).toBe('completed');
  });

  it('rejects a malformed manifest without a false completed stamp', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'ok' });
    fs.writeFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), '{ not json', 'utf8');
    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    // Manifest is left as-is (still not a completed JSON) — no false stamp, no result.
    expect(fs.readFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'utf8')).toBe('{ not json');
    expect(resultExists(root, id)).toBe(false);
  });
});

describe('ingestBundle — never throws, writes nothing outside the bundle dir (SC-006, FR-029)', () => {
  it('writes no file outside the bundle directory on a successful ingest', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'contained' });

    const before = listAllFiles(root);
    ingestBundle(root, id);
    const after = listAllFiles(root);

    const created = after.filter((p) => !before.includes(p));
    // The only new file is result.json inside the bundle dir.
    expect(created).toEqual([path.join(bundleDirOf(root, id), 'result.json')]);
    for (const p of created) expect(p.startsWith(bundleDirOf(root, id) + path.sep)).toBe(true);
  });

  it('writes no new file anywhere on a rejected ingest', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: '' }); // non-conforming

    const before = listAllFiles(root);
    ingestBundle(root, id);
    const after = listAllFiles(root);
    expect(after).toEqual(before);
  });

  it('returns a value (never throws) for conforming, non-conforming, early, and missing inputs', () => {
    const root = makeRoot();
    const conforming = emitBundle(root, makeTask());
    writeOutput(root, conforming.id, { prose: 'ok' });
    const nonconforming = emitBundle(root, makeTask());
    writeOutput(root, nonconforming.id, { prose: 123 });
    const early = emitBundle(root, makeTask()); // no output.json

    expect(() => ingestBundle(root, conforming.id)).not.toThrow();
    expect(() => ingestBundle(root, nonconforming.id)).not.toThrow();
    expect(() => ingestBundle(root, early.id)).not.toThrow();
    expect(() => ingestBundle(root, 'no-such-id')).not.toThrow();

    expect(ingestBundle(root, nonconforming.id).ok).toBe(false);
  });

  it('accepts output at the size ceiling boundary (does not spuriously reject a large-but-legal output)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    // A large prose value that keeps the whole file under MAX_BUNDLE_INPUT_BYTES.
    const big = 'x'.repeat(MAX_BUNDLE_INPUT_BYTES - 64);
    writeOutput(root, id, { prose: big });
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: big });
  });
});
