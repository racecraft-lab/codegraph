import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDGE_PROVENANCES } from '../src/types';
import CodeGraph, { DatabaseConnection, getDatabasePath, QueryBuilder } from '../src';
import { canUseLspProvenanceForDecision, isKnownEdgeProvenance, resolveLspConfig, runLspPrecisionPass } from '../src/lsp';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('LSP precision provenance foundation', () => {
  it('adds lsp provenance without removing existing provenance values', () => {
    expect([...EDGE_PROVENANCES]).toEqual(['tree-sitter', 'scip', 'heuristic', 'lsp']);
    expect(isKnownEdgeProvenance('tree-sitter')).toBe(true);
    expect(isKnownEdgeProvenance('heuristic')).toBe(true);
    expect(isKnownEdgeProvenance('lsp')).toBe(true);
  });

  it('limits active lsp provenance to verified or corrected decisions', () => {
    expect(canUseLspProvenanceForDecision('verified')).toBe(true);
    expect(canUseLspProvenanceForDecision('corrected')).toBe(true);
    expect(canUseLspProvenanceForDecision('unchanged')).toBe(false);
    expect(canUseLspProvenanceForDecision('suppressed')).toBe(false);
    expect(canUseLspProvenanceForDecision('skipped')).toBe(false);
  });

  it('marks a matching TypeScript definition edge as lsp without changing edge count', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-precision-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a.ts'), [
      'export function helper(): number {',
      '  return 1;',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'b.ts'), [
      "import { helper } from './a';",
      'export function main(): number {',
      '  return helper();',
      '}',
      '',
    ].join('\n'));

    const fakeServer = path.join(dir, 'typescript-language-server');
    fs.writeFileSync(fakeServer, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeServer, 0o755);

    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const db = DatabaseConnection.open(getDatabasePath(dir));
      try {
        const queries = new QueryBuilder(db.getDb());
        const before = queries.getNodeAndEdgeCount();
        const config = resolveLspConfig({
          projectRoot: dir,
          cliActivation: 'enable',
          env: {
            CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON: JSON.stringify([fakeServer, '--stdio']),
          },
        });

        const status = await runLspPrecisionPass({
          projectRoot: dir,
          queries,
          config,
          clientFactory: {
            create: () => ({
              initialize: async () => ({ serverInfo: { name: 'fake-ts-lsp', version: '1.0.0' } }),
              request: async () => ({
                uri: pathToFileURL(path.join(dir, 'a.ts')).href,
                range: { start: { line: 0, character: 16 }, end: { line: 2, character: 1 } },
              }),
              shutdown: async () => undefined,
            }),
          },
        });

        const after = queries.getNodeAndEdgeCount();
        const lspRows = db.getDb().prepare("SELECT COUNT(*) AS count FROM edges WHERE provenance = 'lsp'").get() as { count: number };
        expect(after).toEqual(before);
        expect(lspRows.count).toBeGreaterThan(0);
        expect(status.edgeCounts.checked).toBeGreaterThan(0);
        expect(status.edgeCounts.verified).toBeGreaterThan(0);
        expect(status.coverage.some((record) => record.language === 'typescript' && record.checkedWorkItems > 0)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      cg.close();
    }
  });
});
