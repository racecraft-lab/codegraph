import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../../src';

export interface DetectChangesFixture {
  dir: string;
  cg: CodeGraph;
  write(rel: string, content: string | Buffer): void;
  remove(rel: string): void;
  git(args: string[]): string;
  close(): void;
}

export function createDetectChangesFixture(): DetectChangesFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-detect-changes-'));

  const git = (args: string[]): string => execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const write = (rel: string, content: string | Buffer): void => {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  const remove = (rel: string): void => {
    fs.rmSync(path.join(dir, rel), { force: true });
  };

  git(['init', '-q']);
  write('src/calculator.ts', [
    'export function computeTotal(value: number) {',
    '  return value + 1;',
    '}',
    '',
    'export function renderTotal() {',
    '  return computeTotal(41);',
    '}',
    '',
  ].join('\n'));
  write('src/rename-me.ts', 'export function movedOnly() {\n  return true;\n}\n');
  write('src/delete-me.ts', 'export function deletedSymbol() {\n  return 1;\n}\n');
  write('assets/logo.bin', Buffer.from([0, 1, 2, 3, 4, 5]));
  git(['add', '.']);
  git([
    '-c', 'user.email=test@example.com',
    '-c', 'user.name=Test User',
    '-c', 'commit.gpgsign=false',
    'commit', '-m', 'initial', '-q',
  ]);

  const cg = CodeGraph.initSync(dir);
  return {
    dir,
    cg,
    write,
    remove,
    git,
    close() {
      cg.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function indexFixture(fixture: DetectChangesFixture): Promise<void> {
  await fixture.cg.indexAll();
}
