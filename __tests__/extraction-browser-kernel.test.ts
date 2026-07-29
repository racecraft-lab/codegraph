import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { extractFromSource } from '../src/extraction';
import {
  clearParserCache,
  detectLanguage,
  initGrammars,
  isLanguageSupported,
  loadGrammarsForLanguages,
} from '../src/extraction/grammars';
import type { ExtractionResult, Language } from '../src/types';
import {
  browserIndexingFixture,
  expectedBrowserFixture,
  semanticGraphProjection,
  type BrowserFixtureEntry,
} from './fixtures/browser-indexing';

interface BrowserKernelResult {
  acceptedManifest: Array<{
    path: string;
    contentHash: string;
    size: number;
    language: Language;
  }>;
  nodes: ExtractionResult['nodes'];
  edges: ExtractionResult['edges'];
  unresolvedReferences: ExtractionResult['unresolvedReferences'];
  errors: ExtractionResult['errors'];
  warnings: Array<{ path: string; code: string }>;
  grammarLoads: Language[];
}

interface BrowserKernelModule {
  requiredGrammarLanguages(language: Language, source: string): Language[];
  extractBrowserSources(
    entries: readonly BrowserFixtureEntry[],
    options: {
      ignorePatterns: readonly string[];
      extensionOverrides: Record<string, Language>;
      maxFileBytes: number;
      hashContent(content: string): string;
      detectLanguage(path: string, source: string, overrides: Record<string, Language>): Language;
      isLanguageSupported(language: Language): boolean;
      loadGrammars(languages: Language[]): Promise<void>;
      extract(path: string, source: string, language: Language): ExtractionResult;
      releaseFile?(path: string): void;
    },
  ): Promise<BrowserKernelResult>;
}

const browserKernelPath = path.join(__dirname, '..', 'src', 'extraction', 'browser-kernel.ts');

describe('browser extraction kernel fixtures', () => {
  afterAll(() => clearParserCache());

  it('defines deterministic cross-runtime manifest and projection expectations', async () => {
    expect(expectedBrowserFixture.acceptedPaths).toEqual([
      'src/Widget.vue',
      'src/main.ts',
      'src/rating.widget',
    ]);
    expect(Object.keys(expectedBrowserFixture.languageMap).sort()).toEqual(
      expectedBrowserFixture.acceptedPaths,
    );
    expect(expectedBrowserFixture.grammarLoads).toEqual(['typescript']);
    expect(expectedBrowserFixture.warningCodes).toHaveLength(6);

    const first = semanticGraphProjection([], []);
    const second = semanticGraphProjection([], []);
    expect(first).toEqual(second);

    await initGrammars();
    await loadGrammarsForLanguages(['typescript']);
    const nodes: ExtractionResult['nodes'] = [];
    const edges: ExtractionResult['edges'] = [];
    for (const entry of browserIndexingFixture.entries.slice(0, 3)) {
      const source = new TextDecoder().decode(entry.bytes);
      const language = detectLanguage(
        entry.path,
        source,
        browserIndexingFixture.rules.extensionOverrides,
      );
      const result = extractFromSource(entry.path, source, language);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
    }
    expect(semanticGraphProjection(nodes, edges)).toEqual(expectedBrowserFixture.graphProjection);
  });

  it('projects the accepted fixture identically through the browser-safe kernel', async () => {
    const exists = fs.existsSync(browserKernelPath);
    expect(exists, 'T004 must provide src/extraction/browser-kernel.ts').toBe(true);
    if (!exists) return;

    const source = fs.readFileSync(browserKernelPath, 'utf8');
    expect(source).not.toMatch(/(?:from|require\()\s*['"](?:node:|fs|path|crypto|child_process)/);

    const kernel = await import(
      /* @vite-ignore */ pathToFileURL(browserKernelPath).href
    ) as BrowserKernelModule;
    expect(kernel.requiredGrammarLanguages('vue', '<script setup lang="ts"></script>')).toEqual([
      'typescript',
    ]);
    expect(kernel.requiredGrammarLanguages('razor', '@code { void Render() {} }')).toEqual([
      'csharp',
    ]);
    expect(kernel.requiredGrammarLanguages('cfml', '<cfscript>run()</cfscript>')).toEqual([
      'cfml',
      'cfscript',
      'cfquery',
    ]);
    const run = async (): Promise<{ result: BrowserKernelResult; released: string[] }> => {
      const released: string[] = [];
      const result = await kernel.extractBrowserSources(browserIndexingFixture.entries, {
        ...browserIndexingFixture.rules,
        hashContent: (content) => createHash('sha256').update(content).digest('hex'),
        detectLanguage,
        isLanguageSupported,
        loadGrammars: loadGrammarsForLanguages,
        extract: extractFromSource,
        releaseFile: (file) => released.push(file),
      });
      return { result, released };
    };
    const first = await run();
    const second = await run();
    const result = first.result;

    expect(result.acceptedManifest.map(({ path: file }) => file)).toEqual(
      expectedBrowserFixture.acceptedPaths,
    );
    expect(Object.fromEntries(
      result.acceptedManifest.map(({ path: file, language }) => [file, language]),
    )).toEqual(expectedBrowserFixture.languageMap);
    expect(result.warnings.map(({ path: file, code }) => `${file}|${code}`).sort()).toEqual(
      [...expectedBrowserFixture.warningCodes].sort(),
    );
    expect(result.grammarLoads).toEqual(expectedBrowserFixture.grammarLoads);
    expect(semanticGraphProjection(result.nodes, result.edges)).toEqual(
      expectedBrowserFixture.graphProjection,
    );
    expect(first.released.sort()).toEqual(expectedBrowserFixture.acceptedPaths);
    expect(second.result.acceptedManifest).toEqual(result.acceptedManifest);
    expect(semanticGraphProjection(second.result.nodes, second.result.edges)).toEqual(
      expectedBrowserFixture.graphProjection,
    );
    expect(result.unresolvedReferences).toEqual(expect.any(Array));
    expect(result.errors).toEqual(expect.any(Array));
    expect(second.result.unresolvedReferences).toEqual(result.unresolvedReferences);
    expect(second.result.errors).toEqual(result.errors);
  });
});
