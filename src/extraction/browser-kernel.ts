import ignore from 'ignore';
import type { Edge, ExtractionResult, Language, Node } from '../types';

export interface BrowserSourceEntry {
  kind: 'file' | 'directory';
  path: string;
  bytes: Uint8Array;
}

export interface BrowserSourceManifestEntry {
  path: string;
  contentHash: string;
  size: number;
  language: Language;
}

export interface BrowserSourceWarning {
  path: string;
  code:
    | 'invalid_source_path'
    | 'duplicate_source_path'
    | 'unsupported_entry_kind'
    | 'ignored_path'
    | 'file_too_large'
    | 'binary_file'
    | 'unsupported_language';
}

export interface BrowserExtractionAdapters {
  ignorePatterns: readonly string[];
  extensionOverrides: Record<string, Language>;
  maxFileBytes: number;
  hashContent(content: string): string;
  detectLanguage(
    path: string,
    source: string,
    overrides: Record<string, Language>,
  ): Language;
  isLanguageSupported(language: Language): boolean;
  loadGrammars(languages: Language[]): Promise<void>;
  extract(path: string, source: string, language: Language): ExtractionResult;
  releaseFile?(path: string): void;
}

export interface BrowserExtractionResult {
  acceptedManifest: BrowserSourceManifestEntry[];
  nodes: Node[];
  edges: Edge[];
  unresolvedReferences: ExtractionResult['unresolvedReferences'];
  errors: ExtractionResult['errors'];
  warnings: BrowserSourceWarning[];
  grammarLoads: Language[];
}

interface AcceptedSource extends BrowserSourceManifestEntry {
  source: string;
}

const NO_WASM_GRAMMAR = new Set<Language>([
  'liquid',
  'properties',
  'razor',
  'twig',
  'unknown',
  'xml',
  'yaml',
]);

function normalizedSourcePath(candidate: string): string | null {
  if (!candidate || candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate)) {
    return null;
  }
  const normalized = candidate.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
}

export function requiredGrammarLanguages(language: Language, source: string): Language[] {
  if (language === 'svelte' || language === 'vue') {
    if (!/<script\b/i.test(source)) return [];
    return /<script\b[^>]*\blang\s*=\s*["']ts["']/i.test(source)
      ? ['typescript']
      : ['javascript'];
  }
  if (language === 'astro') {
    return source.trimStart().startsWith('---') || /<script\b/i.test(source)
      ? ['typescript']
      : [];
  }
  if (language === 'cfml') return ['cfml', 'cfscript', 'cfquery'];
  if (language === 'razor') return ['csharp'];
  if (NO_WASM_GRAMMAR.has(language)) return [];
  return [language];
}

function decodeSource(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Runtime-neutral source admission and graph extraction.
 *
 * Every environment-specific operation (hashing, language detection, grammar
 * loading, and parsing) is injected. This module intentionally imports no
 * Node-only API, so browser workers can own the same deterministic boundary.
 */
export async function extractBrowserSources(
  entries: readonly BrowserSourceEntry[],
  adapters: BrowserExtractionAdapters,
): Promise<BrowserExtractionResult> {
  const matcher = ignore().add([...adapters.ignorePatterns]);
  const seen = new Set<string>();
  const accepted: AcceptedSource[] = [];
  const warnings: BrowserSourceWarning[] = [];

  for (const entry of entries) {
    const normalizedPath = normalizedSourcePath(entry.path);
    if (!normalizedPath) {
      warnings.push({ path: entry.path, code: 'invalid_source_path' });
      continue;
    }
    if (seen.has(normalizedPath)) {
      warnings.push({ path: entry.path, code: 'duplicate_source_path' });
      continue;
    }
    seen.add(normalizedPath);

    if (entry.kind !== 'file') {
      warnings.push({ path: normalizedPath, code: 'unsupported_entry_kind' });
      continue;
    }
    if (matcher.ignores(normalizedPath)) {
      warnings.push({ path: normalizedPath, code: 'ignored_path' });
      continue;
    }
    if (entry.bytes.byteLength > adapters.maxFileBytes) {
      warnings.push({ path: normalizedPath, code: 'file_too_large' });
      continue;
    }

    const source = decodeSource(entry.bytes);
    if (source === null) {
      warnings.push({ path: normalizedPath, code: 'binary_file' });
      continue;
    }
    const language = adapters.detectLanguage(
      normalizedPath,
      source,
      adapters.extensionOverrides,
    );
    if (!adapters.isLanguageSupported(language)) {
      warnings.push({ path: normalizedPath, code: 'unsupported_language' });
      continue;
    }

    accepted.push({
      path: normalizedPath,
      contentHash: adapters.hashContent(source),
      size: entry.bytes.byteLength,
      language,
      source,
    });
  }

  accepted.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const grammarLoads = [...new Set(
    accepted.flatMap(({ language, source }) => requiredGrammarLanguages(language, source)),
  )].sort() as Language[];
  await adapters.loadGrammars(grammarLoads);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const unresolvedReferences: ExtractionResult['unresolvedReferences'] = [];
  const errors: ExtractionResult['errors'] = [];
  for (const entry of accepted) {
    try {
      const result = adapters.extract(entry.path, entry.source, entry.language);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      unresolvedReferences.push(...result.unresolvedReferences);
      errors.push(...result.errors);
    } finally {
      adapters.releaseFile?.(entry.path);
    }
  }

  return {
    acceptedManifest: accepted.map(({ source: _source, ...entry }) => entry),
    nodes,
    edges,
    unresolvedReferences,
    errors,
    warnings,
    grammarLoads,
  };
}
