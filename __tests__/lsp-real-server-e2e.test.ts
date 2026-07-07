/**
 * End-to-end regression: the precision pass never sent textDocument/didOpen,
 * so REAL language servers returned null for every definition request and the
 * pass verified 0 edges (every candidate skipped as language-not-applicable)
 * while unit fixtures — whose fake clients answer regardless — stayed green.
 *
 * This suite drives the real typescript-language-server binary when it is on
 * PATH and skips otherwise, mirroring the repo's real-server gating policy.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import CodeGraph from '../src';

function commandOnPath(name: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    return spawnSync(probe, [name], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

const hasServer = commandOnPath('typescript-language-server');

describe.runIf(hasServer)('LSP precision pass against a real typescript-language-server', () => {
  it('verifies or corrects at least one call edge end-to-end', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-real-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: false } }),
      );
      // helper2 is an arrow-function const: tsserver anchors its definition at
      // the identifier while the extractor anchors the node at the initializer
      // — the column-mismatch shape that used to suppress correct edges.
      fs.writeFileSync(
        path.join(dir, 'a.ts'),
        'export function helper(): number {\n  return 1;\n}\nexport const helper2 = (): number => 2;\n',
      );
      // Both shapes matter: a same-file call (definition lands directly on the
      // callee) and a cross-file call through an import (tsserver resolves to
      // the import BINDING — the alias case that must verify via the graph's
      // own imports edge, never suppress).
      fs.writeFileSync(
        path.join(dir, 'b.ts'),
        [
          "import { helper, helper2 } from './a';",
          'function local(): number {',
          '  return helper() + helper2();',
          '}',
          'export function main(): number {',
          '  return local();',
          '}',
          '',
        ].join('\n'),
      );

      const cg = await CodeGraph.init(dir);
      try {
        const result = await cg.indexAll({ lsp: 'enable', embeddingsProvider: 'off' });
        expect(result.success).toBe(true);

        const status = cg.getLspStatus();
        const ts = status.servers.find((server) => server.language === 'typescript');
        expect(ts?.state).toBe('initialized');
        // The heart of the regression: a real server must actually decide edges,
        // not skip every candidate.
        expect(status.edgeCounts.verified + status.edgeCounts.corrected).toBeGreaterThan(0);
        // And alias answers (definitions landing on import bindings) must never
        // be treated as disproof of valid structural edges.
        expect(status.edgeCounts.suppressed).toBe(0);
      } finally {
        cg.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
