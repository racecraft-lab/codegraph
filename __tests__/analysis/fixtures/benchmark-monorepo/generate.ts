/**
 * SPEC-011 (T003) — deterministic benchmark-monorepo fixture generator.
 *
 * Materializes a small, fixed multi-language/-framework repo used by both the
 * SC-004 determinism fixture (T060) and the SC-006 paired benchmark (T061). The
 * committed generator is the source of truth; every call writes byte-identical
 * files in a fixed order, so re-materializing (or re-indexing) yields identical
 * graphs — the property SC-004 depends on.
 *
 * Coverage (spec Assumptions / SC-006):
 *   - ≥3 languages/frameworks: TypeScript+Express (route entry point),
 *     TypeScript+commander (CLI entry point), Python, Go.
 *   - one route entry point:  app.get('/api/users', ...) in services/api.
 *   - one commander CLI entry point:  program.command('sync').action(...).
 *   - a god-function fan-out:  orchestrate() calls 25 step helpers (exceeds the
 *     20-edge width cap so real-index truncation is exercised).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * The fixture's files as a fixed relativePath -> content map. Declared as a
 * literal (not generated from Object.keys iteration order guarantees alone) and
 * written in sorted-path order so materialization is deterministic on every
 * platform.
 */
function fixtureFiles(): Record<string, string> {
  // God-function fan-out: 25 helpers so the flow tracer's 20-edge width cap
  // truncates on a real index.
  const stepHelpers = Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return `export function step${n}(x: number): number {\n  return x + ${n};\n}`;
  }).join('\n\n');
  const stepCalls = Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return `  total = step${n}(total);`;
  }).join('\n');
  const stepImports = Array.from({ length: 25 }, (_, i) => `step${i + 1}`).join(', ');

  return {
    'package.json': JSON.stringify(
      {
        name: 'benchmark-monorepo',
        version: '0.0.0',
        private: true,
        dependencies: { express: '^4.0.0', commander: '^12.0.0' },
      },
      null,
      2,
    ) + '\n',

    // ── TypeScript + Express: route entry point ────────────────────────────
    'services/api/handlers.ts':
      `import { fetchUsers } from '../users/repository';\n\n` +
      `export function getUsersHandler(req: unknown, res: { json: (b: unknown) => void }): void {\n` +
      `  const users = fetchUsers();\n` +
      `  res.json(users);\n` +
      `}\n`,
    'services/api/server.ts':
      `import express from 'express';\n` +
      `import { getUsersHandler } from './handlers';\n\n` +
      `export function createServer(): express.Express {\n` +
      `  const app = express();\n` +
      `  app.get('/api/users', getUsersHandler);\n` +
      `  return app;\n` +
      `}\n`,
    'services/users/repository.ts':
      `export interface User {\n  id: number;\n  name: string;\n}\n\n` +
      `export function fetchUsers(): User[] {\n` +
      `  return [{ id: 1, name: 'ada' }];\n` +
      `}\n`,

    // ── TypeScript + commander: CLI entry point ────────────────────────────
    'cli/steps.ts': `${stepHelpers}\n`,
    'cli/orchestrate.ts':
      `import { ${stepImports} } from './steps';\n\n` +
      `export function orchestrate(seed: number): number {\n` +
      `  let total = seed;\n` +
      `${stepCalls}\n` +
      `  return total;\n` +
      `}\n`,
    'cli/main.ts':
      `import { Command } from 'commander';\n` +
      `import { orchestrate } from './orchestrate';\n\n` +
      `export function syncHandler(): void {\n` +
      `  const result = orchestrate(0);\n` +
      `  process.stdout.write(String(result));\n` +
      `}\n\n` +
      `export function buildProgram(): Command {\n` +
      `  const program = new Command();\n` +
      `  program.command('sync').action(syncHandler);\n` +
      `  return program;\n` +
      `}\n`,

    // ── Python ─────────────────────────────────────────────────────────────
    'analytics/pipeline.py':
      `def load(source):\n` +
      `    return [1, 2, 3]\n\n\n` +
      `def transform(rows):\n` +
      `    return [r * 2 for r in rows]\n\n\n` +
      `def run(source):\n` +
      `    return transform(load(source))\n`,

    // ── Go ─────────────────────────────────────────────────────────────────
    'worker/worker.go':
      `package worker\n\n` +
      `func Enqueue(job string) int {\n` +
      `\treturn process(job)\n` +
      `}\n\n` +
      `func process(job string) int {\n` +
      `\treturn len(job)\n` +
      `}\n`,
  };
}

/**
 * Write the fixture into `destDir` (created if absent). Returns the sorted list
 * of relative paths written, so the harness can assert determinism.
 */
export function materializeBenchmarkMonorepo(destDir: string): string[] {
  const files = fixtureFiles();
  const relPaths = Object.keys(files).sort();
  for (const rel of relPaths) {
    const abs = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel]!);
  }
  return relPaths;
}
