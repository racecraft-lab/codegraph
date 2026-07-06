import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';

describe('OCaml status reporting', () => {
  let tempDir: string | null = null;
  let cg: CodeGraph | null = null;

  afterEach(() => {
    cg?.close();
    cg = null;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('counts .ml and .mli files under the public ocaml language only', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ocaml-status-'));
    fs.cpSync(path.resolve(__dirname, 'fixtures/ocaml/status'), tempDir, { recursive: true });

    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    const stats = cg.getStats();
    expect(stats.filesByLanguage.ocaml).toBe(2);
    expect((stats.filesByLanguage as Record<string, number>).ocaml_interface).toBeUndefined();
  });
});
