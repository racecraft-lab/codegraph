/**
 * SPEC-011 (PR #50 round-2 review) — indexAll runs catalog analysis on EVERY
 * successful index, not only when filesIndexed > 0.
 *
 * The catalog call was nested inside `result.filesIndexed > 0` (unlike sync(),
 * which already runs it on every successful sync). So an enabled-but-empty
 * project — zero indexable files — skipped analysis entirely and its flows
 * catalog read `disabled` instead of the correct available-but-empty `empty`
 * (FR-020: fully recompute after every successful index/sync). Real CodeGraph +
 * real SQLite in a temp dir (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodeGraph } from '../../src';
import { clearProjectConfigCache } from '../../src/project-config';

describe('indexAll catalog lifecycle on an empty enabled project (PR #50 review, FR-020)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearProjectConfigCache();
    for (const d of dirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('computes an available-but-empty flows catalog (empty, not disabled) when zero files index', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-empty-catalog-'));
    dirs.push(dir);
    // Opt into the flows catalog; the project has NO indexable source (only the
    // config file), so the index is successful with filesIndexed === 0.
    fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ analysis: { flows: true } }));
    clearProjectConfigCache();

    const cg = CodeGraph.initSync(dir);
    const result = await cg.indexAll();
    expect(result.filesIndexed).toBe(0); // nothing indexable → the guarded case

    const flows = cg.listFlows(20, 0);
    // Was 'disabled' before the fix (catalog analysis skipped on filesIndexed===0).
    expect(flows.state).toBe('empty');
    expect(flows.items).toEqual([]);
    cg.close();
  });
});
