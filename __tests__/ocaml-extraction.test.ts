import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractFromSource } from '../src/extraction/tree-sitter';
import {
  detectLanguage,
  getParser,
  getSupportedLanguages,
  initGrammars,
  isGrammarLoaded,
  isLanguageSupported,
  isSourceFile,
  loadGrammarsForLanguages,
} from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadGrammarsForLanguages(['ocaml']);
});

describe('OCaml language support', () => {
  it('detects OCaml source and interface files as one public language', () => {
    expect(detectLanguage('src/main.ml')).toBe('ocaml');
    expect(detectLanguage('src/main.mli')).toBe('ocaml');
    expect(isSourceFile('src/main.ml')).toBe(true);
    expect(isSourceFile('src/main.mli')).toBe(true);
    expect(isLanguageSupported('ocaml')).toBe(true);
    expect(getSupportedLanguages()).toContain('ocaml');
  });

  it('loads implementation and interface parsers for the public OCaml language', () => {
    expect(isGrammarLoaded('ocaml')).toBe(true);

    const implParser = getParser('ocaml', 'src/main.ml');
    const intfParser = getParser('ocaml', 'src/main.mli');
    expect(implParser).not.toBeNull();
    expect(intfParser).not.toBeNull();

    const implTree = implParser!.parse('let add x y = x + y');
    const intfTree = intfParser!.parse('val add : int -> int -> int');
    expect(implTree?.rootNode.hasError).toBe(false);
    expect(intfTree?.rootNode.hasError).toBe(false);
  });

  it('extracts modules, records, variants, functions, classes, and methods from .ml files', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, 'fixtures/ocaml/broad-syntax/implementation.ml'),
      'utf-8',
    );
    const result = extractFromSource('src/sample.ml', code);

    expect(result.errors).toEqual([]);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file', language: 'ocaml', name: 'sample.ml' }),
      expect.objectContaining({ kind: 'module', language: 'ocaml', name: 'Sample', qualifiedName: 'Sample' }),
      expect.objectContaining({ kind: 'module', language: 'ocaml', name: 'Make', qualifiedName: 'Sample::Make' }),
      expect.objectContaining({ kind: 'struct', language: 'ocaml', name: 'person' }),
      expect.objectContaining({ kind: 'field', language: 'ocaml', name: 'name' }),
      expect.objectContaining({ kind: 'enum', language: 'ocaml', name: 'color' }),
      expect.objectContaining({ kind: 'enum_member', language: 'ocaml', name: 'Red' }),
      expect.objectContaining({ kind: 'enum', language: 'ocaml', name: 'poly' }),
      expect.objectContaining({ kind: 'enum_member', language: 'ocaml', name: '`A' }),
      expect.objectContaining({ kind: 'enum', language: 'ocaml', name: 'expr' }),
      expect.objectContaining({ kind: 'enum_member', language: 'ocaml', name: 'Int' }),
      expect.objectContaining({ kind: 'function', language: 'ocaml', name: 'map' }),
      expect.objectContaining({ kind: 'parameter', language: 'ocaml', name: 'default' }),
      expect.objectContaining({ kind: 'function', language: 'ocaml', name: 'with_local' }),
      expect.objectContaining({ kind: 'constant', language: 'ocaml', name: 'first_class' }),
      expect.objectContaining({ kind: 'interface', language: 'ocaml', name: 'counter_like' }),
      expect.objectContaining({ kind: 'class', language: 'ocaml', name: 'counter' }),
      expect.objectContaining({ kind: 'field', language: 'ocaml', name: 'count' }),
      expect.objectContaining({ kind: 'method', language: 'ocaml', name: 'inc' }),
    ]));
  });

  it('extracts public interface declarations from .mli files with the interface grammar', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, 'fixtures/ocaml/broad-syntax/interface.mli'),
      'utf-8',
    );
    const result = extractFromSource('src/sample.mli', code);

    expect(result.errors).toEqual([]);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file', language: 'ocaml', name: 'sample.mli' }),
      expect.objectContaining({ kind: 'module', language: 'ocaml', name: 'Sample', isExported: true }),
      expect.objectContaining({ kind: 'function', language: 'ocaml', name: 'map', isExported: true }),
      expect.objectContaining({ kind: 'function', language: 'ocaml', name: 'now', isExported: true }),
      expect.objectContaining({ kind: 'parameter', language: 'ocaml', name: 'default' }),
      expect.objectContaining({ kind: 'struct', language: 'ocaml', name: 'person' }),
      expect.objectContaining({ kind: 'field', language: 'ocaml', name: 'count' }),
      expect.objectContaining({ kind: 'enum', language: 'ocaml', name: 'color' }),
      expect.objectContaining({ kind: 'enum_member', language: 'ocaml', name: 'Blue' }),
      expect.objectContaining({ kind: 'enum', language: 'ocaml', name: 'expr' }),
      expect.objectContaining({ kind: 'enum_member', language: 'ocaml', name: 'Int' }),
      expect.objectContaining({ kind: 'enum', language: 'ocaml', name: 'poly' }),
      expect.objectContaining({ kind: 'enum_member', language: 'ocaml', name: '`B' }),
      expect.objectContaining({ kind: 'module', language: 'ocaml', name: 'M' }),
      expect.objectContaining({ kind: 'interface', language: 'ocaml', name: 'S' }),
      expect.objectContaining({ kind: 'interface', language: 'ocaml', name: 'counter_like' }),
      expect.objectContaining({ kind: 'class', language: 'ocaml', name: 'counter' }),
      expect.objectContaining({ kind: 'method', language: 'ocaml', name: 'inc' }),
    ]));
  });

  it('records conservative module references for open, include, and functor applications', () => {
    const code = `open Foo
include Bar
module R = F(M)
`;
    const result = extractFromSource('src/refs.ml', code);
    const refs = result.unresolvedReferences.map((ref) => ({
      name: ref.referenceName,
      kind: ref.referenceKind,
    }));

    expect(refs).toEqual(expect.arrayContaining([
      { name: 'Foo', kind: 'imports' },
      { name: 'Bar', kind: 'references' },
      { name: 'F', kind: 'references' },
    ]));
  });
});
