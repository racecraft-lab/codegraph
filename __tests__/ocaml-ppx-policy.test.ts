import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractFromSource } from '../src/extraction/tree-sitter';
import { initGrammars, loadGrammarsForLanguages } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadGrammarsForLanguages(['ocaml']);
});

describe('OCaml PPX policy', () => {
  it('preserves source-level attributes and extension nodes without generated symbols or edges', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'fixtures/ocaml/ppx/policy.ml'), 'utf-8');
    const result = extractFromSource('policy.ml', source);

    expect(result.errors).toEqual([]);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'function', name: 'marked', language: 'ocaml' }),
    ]));
    expect(result.nodes.some((node) => node.name.includes('generated'))).toBe(false);
    expect(result.unresolvedReferences).toEqual([]);
  });
});
