import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import CodeGraph from '../src';
import { DatabaseConnection, getDatabasePath, QueryBuilder } from '../src';
import { LSP_STATUS_METADATA_KEY } from '../src/lsp';
import { __emitWatchEventForTests } from '../src/sync/watcher';

const dirs: string[] = [];
const CI_ON = !['', '0', 'false'].includes((process.env.CI ?? '').trim().toLowerCase());
const WATCH_SYNC_TIMEOUT_MS = CI_ON ? 20000 : 4000;

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('LSP disabled path', () => {
  it('indexes with zero LSP metadata writes or provenance mutations when CLI disables project opt-in', async () => {
    const baseline = createProject();
    const disabled = createProject({ lsp: { enabled: true } });

    const baselineGraph = await CodeGraph.init(baseline);
    const disabledGraph = await CodeGraph.init(disabled);
    try {
      await baselineGraph.indexAll();
      await disabledGraph.indexAll({ lsp: 'disable' });

      expect(disabledGraph.getStats().nodeCount).toBe(baselineGraph.getStats().nodeCount);
      expect(disabledGraph.getStats().edgeCount).toBe(baselineGraph.getStats().edgeCount);
      expect(readMetadata(disabled, LSP_STATUS_METADATA_KEY)).toBeNull();
      expect(countLspEdges(disabled)).toBe(0);
    } finally {
      baselineGraph.close();
      disabledGraph.close();
    }
  });

  it('syncs with zero LSP work when explicitly disabled', async () => {
    const dir = createProject({ lsp: { enabled: true } });
    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll({ lsp: 'disable' });
      fs.appendFileSync(path.join(dir, 'b.ts'), '\nexport const changed = main();\n');
      await cg.sync({ lsp: 'disable' });

      expect(readMetadata(dir, LSP_STATUS_METADATA_KEY)).toBeNull();
      expect(countLspEdges(dir)).toBe(0);
    } finally {
      cg.close();
    }
  });

  it('records bounded project-enabled LSP status during sync', async () => {
    const dir = createProject({ lsp: { enabled: true } });
    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll({ lsp: 'disable' });
      fs.appendFileSync(path.join(dir, 'b.ts'), '\nexport const changed = main();\n');
      await cg.sync();

      expect(JSON.parse(readMetadata(dir, LSP_STATUS_METADATA_KEY) ?? '{}')).toMatchObject({
        enabled: true,
        activationSource: 'project-config',
      });
      expect(countLspEdges(dir)).toBe(0);
    } finally {
      cg.close();
    }
  });

  it('watch-triggered sync stays zero-work when no opt-in exists', async () => {
    const dir = createProject();
    const cg = await CodeGraph.init(dir);
    try {
      await cg.indexAll();
      const completed = waitForWatchSync(cg);
      fs.appendFileSync(path.join(dir, 'b.ts'), '\nexport const watched = main();\n');
      expect(__emitWatchEventForTests(dir, 'b.ts')).toBe(true);
      await completed;

      expect(readMetadata(dir, LSP_STATUS_METADATA_KEY)).toBeNull();
      expect(countLspEdges(dir)).toBe(0);
    } finally {
      cg.close();
    }
  });
});

function createProject(config?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-disabled-'));
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
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify(config));
  }
  return dir;
}

function readMetadata(dir: string, key: string): string | null {
  const db = DatabaseConnection.open(getDatabasePath(dir));
  try {
    return new QueryBuilder(db.getDb()).getMetadata(key);
  } finally {
    db.close();
  }
}

function countLspEdges(dir: string): number {
  const db = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const row = db.getDb().prepare("SELECT COUNT(*) AS count FROM edges WHERE provenance = 'lsp'").get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

function waitForWatchSync(cg: CodeGraph): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('watch sync did not complete')), WATCH_SYNC_TIMEOUT_MS);
    const started = cg.watch({
      debounceMs: 50,
      inertForTests: true,
      onSyncComplete: () => {
        clearTimeout(timeout);
        resolve();
      },
      onSyncError: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    if (!started) {
      clearTimeout(timeout);
      reject(new Error('watch did not start'));
    }
  });
}
