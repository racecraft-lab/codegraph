/**
 * SPEC-011 (T003) — the benchmark-monorepo fixture generator is deterministic
 * and carries the required entry points. Shared by the SC-004 determinism
 * fixture (T060) and the SC-006 benchmark (T061), so byte-level determinism is
 * the load-bearing property.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { materializeBenchmarkMonorepo } from './fixtures/benchmark-monorepo/generate';

function readAll(dir: string, rels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of rels) out[rel] = fs.readFileSync(path.join(dir, rel), 'utf-8');
  return out;
}

describe('benchmark-monorepo fixture generator', () => {
  const dirs: string[] = [];
  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-fixture-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('materializes byte-identical files on repeat runs (determinism)', () => {
    const a = tmp();
    const b = tmp();
    const relsA = materializeBenchmarkMonorepo(a);
    const relsB = materializeBenchmarkMonorepo(b);
    expect(relsA).toEqual(relsB);
    expect(readAll(a, relsA)).toEqual(readAll(b, relsB));
  });

  it('spans ≥3 languages and carries the route + commander CLI + god-function entry points', () => {
    const dir = tmp();
    const rels = materializeBenchmarkMonorepo(dir);
    const exts = new Set(rels.map((r) => path.extname(r)).filter((e) => e === '.ts' || e === '.py' || e === '.go'));
    expect(exts.size).toBeGreaterThanOrEqual(3);

    const server = fs.readFileSync(path.join(dir, 'services/api/server.ts'), 'utf-8');
    expect(server).toContain("app.get('/api/users'");

    const cli = fs.readFileSync(path.join(dir, 'cli/main.ts'), 'utf-8');
    expect(cli).toMatch(/\.command\('sync'\)\.action\(/);

    const orchestrate = fs.readFileSync(path.join(dir, 'cli/orchestrate.ts'), 'utf-8');
    const stepCalls = (orchestrate.match(/step\d+\(/g) ?? []).length;
    expect(stepCalls).toBeGreaterThan(20); // god-function fan-out exceeds the width cap
  });
});
