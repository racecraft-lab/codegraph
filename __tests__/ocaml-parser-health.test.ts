import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  getParser,
  initGrammars,
  loadGrammarsForLanguages,
} from '../src/extraction/grammars';

const FIXTURES = path.resolve(__dirname, 'fixtures/ocaml/parser-health');

beforeAll(async () => {
  await initGrammars();
  await loadGrammarsForLanguages(['ocaml']);
});

describe('OCaml parser health', () => {
  it('parses implementation and interface fixtures with separate grammars', () => {
    const implementation = fs.readFileSync(path.join(FIXTURES, 'implementation.ml'), 'utf-8');
    const intf = fs.readFileSync(path.join(FIXTURES, 'interface.mli'), 'utf-8');

    const implTree = getParser('ocaml', 'implementation.ml')!.parse(implementation);
    const intfTree = getParser('ocaml', 'interface.mli')!.parse(intf);

    expect(implTree.rootNode.hasError).toBe(false);
    expect(intfTree.rootNode.hasError).toBe(false);
  });

  it('copies both OCaml WASM artifacts through the build output', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../dist/extraction/wasm/tree-sitter-ocaml.wasm'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../dist/extraction/wasm/tree-sitter-ocaml_interface.wasm'))).toBe(true);
  });
});
