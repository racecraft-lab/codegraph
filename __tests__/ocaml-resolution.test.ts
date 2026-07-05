import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';
import { isIgnoredOcamlPath, loadOcamlWorkspace } from '../src/resolution/ocaml-workspace';
import type { ResolutionContext } from '../src/resolution/types';
import type { Node } from '../src/types';

const RESOLUTION_FIXTURES = path.resolve(__dirname, 'fixtures/ocaml/resolution');

function findNode(cg: CodeGraph, kind: Node['kind'], name: string, filePath: string): Node {
  const node = cg.getNodesByKind(kind).find((candidate) =>
    candidate.name === name && candidate.filePath === filePath
  );
  if (!node) throw new Error(`missing ${kind} ${name} in ${filePath}`);
  return node;
}

describe('OCaml conservative resolution', () => {
  let tempDir: string | null = null;
  let cg: CodeGraph | null = null;

  afterEach(() => {
    cg?.close();
    cg = null;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  async function indexFixture(...fixtureDirs: string[]): Promise<CodeGraph> {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ocaml-resolution-'));
    for (const dir of fixtureDirs) {
      fs.cpSync(path.join(RESOLUTION_FIXTURES, dir), tempDir, { recursive: true });
    }
    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
    return cg;
  }

  it('resolves module opens, includes, functor applications, and qualified calls only when unique', async () => {
    const graph = await indexFixture('workspace', 'positive');

    const consumer = findNode(graph, 'module', 'Consumer', 'consumer.ml');
    const built = findNode(graph, 'module', 'Built', 'consumer.ml');
    const use = findNode(graph, 'function', 'use', 'consumer.ml');
    const leak = findNode(graph, 'function', 'leak', 'consumer.ml');
    const localOpen = findNode(graph, 'function', 'local_open', 'consumer.ml');
    const fooInterface = findNode(graph, 'module', 'Foo', 'foo.mli');
    const commonSignature = findNode(graph, 'interface', 'S', 'common.mli');
    const makeFunctor = findNode(graph, 'module', 'Make', 'functors.ml');
    const runImplementation = findNode(graph, 'function', 'run', 'foo.ml');
    const hiddenImplementation = findNode(graph, 'function', 'hidden', 'foo.ml');
    const buildSignature = findNode(graph, 'function', 'build', 'common.mli');

    expect(graph.getOutgoingEdges(consumer.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'imports', target: fooInterface.id }),
      expect.objectContaining({ kind: 'references', target: commonSignature.id }),
    ]));
    expect(graph.getOutgoingEdges(built.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'references', target: makeFunctor.id }),
      expect.objectContaining({ kind: 'references', target: fooInterface.id }),
    ]));
    expect(graph.getOutgoingEdges(use.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'calls', target: runImplementation.id }),
    ]));
    expect(graph.getOutgoingEdges(localOpen.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'imports', target: fooInterface.id }),
    ]));
    expect(graph.getOutgoingEdges(leak.id).some((edge) => edge.target === hiddenImplementation.id)).toBe(false);
    expect(graph.getOutgoingEdges(makeFunctor.id).some((edge) => edge.target === buildSignature.id)).toBe(false);
  });

  it('does not guess across duplicate modules or external package-looking paths', async () => {
    const graph = await indexFixture('workspace', 'negative');

    const ambiguous = findNode(graph, 'module', 'Ambiguous', 'ambiguous.ml');
    const call = findNode(graph, 'function', 'call', 'ambiguous.ml');
    const externalPackage = findNode(graph, 'module', 'External_package', 'external_package.ml');

    const utilTargets = [
      findNode(graph, 'module', 'Util', 'a/util.ml').id,
      findNode(graph, 'module', 'Util', 'b/util.ml').id,
    ];
    const runTargets = graph
      .getNodesByKind('function')
      .filter((node) => node.name === 'run' && node.filePath.endsWith('/util.ml'))
      .map((node) => node.id);

    expect(graph.getOutgoingEdges(ambiguous.id).some((edge) => utilTargets.includes(edge.target))).toBe(false);
    expect(graph.getOutgoingEdges(call.id).some((edge) => runTargets.includes(edge.target))).toBe(false);
    expect(graph.getOutgoingEdges(externalPackage.id).filter((edge) => edge.kind !== 'contains')).toHaveLength(0);
    expect((graph.getStats().nodesByKind as Record<string, number>).package).toBeUndefined();
  });

  it('ignores opam lock files as workspace metadata', () => {
    expect(isIgnoredOcamlPath('opam.locked')).toBe(true);
    expect(isIgnoredOcamlPath('nested/opam.locked')).toBe(true);
    expect(isIgnoredOcamlPath('nested/opam.locked/package.opam')).toBe(true);
  });

  it('discovers checked-in dune and opam metadata outside indexed source files', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ocaml-workspace-'));
    fs.cpSync(path.join(RESOLUTION_FIXTURES, 'workspace'), tempDir, { recursive: true });

    const context = {
      getProjectRoot: () => tempDir!,
      getAllFiles: () => [],
      fileExists: (filePath: string) => fs.existsSync(path.join(tempDir!, filePath)),
      readFile: (filePath: string) => {
        try {
          return fs.readFileSync(path.join(tempDir!, filePath), 'utf-8');
        } catch {
          return null;
        }
      },
    } as unknown as ResolutionContext;

    const workspace = loadOcamlWorkspace(context);

    expect(workspace.metadataPaths).toEqual(expect.arrayContaining([
      'demo.opam',
      'dune',
      'dune-project',
      'opam/extra.opam',
    ]));
    expect([...workspace.localPackageNames]).toContain('demo');
    expect([...workspace.localPackageNames]).toContain('extra');
  });
});
