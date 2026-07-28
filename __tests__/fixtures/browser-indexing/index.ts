import type { Edge, Language, Node } from '../../../src/types';

export const BROWSER_MAX_FILE_BYTES = 1024 * 1024;

export interface BrowserFixtureEntry {
  kind: 'file' | 'directory';
  path: string;
  bytes: Uint8Array;
}

const utf8 = new TextEncoder();

export const browserIndexingFixture = {
  rules: {
    ignorePatterns: ['src/generated/'],
    extensionOverrides: {
      '.widget': 'typescript',
    } satisfies Record<string, Language>,
    maxFileBytes: BROWSER_MAX_FILE_BYTES,
  },
  entries: [
    {
      kind: 'file',
      path: 'src/main.ts',
      bytes: utf8.encode([
        'export function normalizeName(value: string): string {',
        '  return value.trim().toLowerCase();',
        '}',
        '',
        'export function greet(name: string): string {',
        '  return `Hello ${normalizeName(name)}`;',
        '}',
        '',
      ].join('\n')),
    },
    {
      kind: 'file',
      path: 'src/rating.widget',
      bytes: utf8.encode([
        'export const score = (value: number): number => {',
        '  return Math.max(0, value);',
        '};',
        '',
      ].join('\n')),
    },
    {
      kind: 'file',
      path: 'src/Widget.vue',
      bytes: utf8.encode([
        '<template><article>{{ title }}</article></template>',
        '<script setup lang="ts">',
        'const title: string = "Browser graph";',
        'function formatTitle(value: string): string {',
        '  return value.toUpperCase();',
        '}',
        'formatTitle(title);',
        '</script>',
        '',
      ].join('\n')),
    },
    {
      kind: 'file',
      path: 'src/generated/ignored.ts',
      bytes: utf8.encode('export const ignored = true;\n'),
    },
    {
      kind: 'file',
      path: 'src/binary.ts',
      bytes: Uint8Array.from([0, 255, 0, 65]),
    },
    {
      kind: 'file',
      path: 'src/oversized.ts',
      bytes: utf8.encode('x'.repeat(BROWSER_MAX_FILE_BYTES + 1)),
    },
    {
      kind: 'file',
      path: '../outside.ts',
      bytes: utf8.encode('export const escaped = true;\n'),
    },
    {
      kind: 'file',
      path: '/host/private.ts',
      bytes: utf8.encode('export const absolute = true;\n'),
    },
    {
      kind: 'directory',
      path: 'src/not-a-file.ts',
      bytes: new Uint8Array(),
    },
  ] satisfies BrowserFixtureEntry[],
} as const;

export interface SemanticGraphProjection {
  nodes: string[];
  edges: string[];
}

export function semanticGraphProjection(
  nodes: readonly Node[],
  edges: readonly Edge[],
): SemanticGraphProjection {
  const keys = new Map(
    nodes.map((node) => [
      node.id,
      [node.filePath, node.kind, node.qualifiedName].join('|'),
    ]),
  );

  return {
    nodes: [...keys.values()].sort(),
    edges: edges
      .map((edge) => [
        keys.get(edge.source) ?? edge.source,
        edge.kind,
        keys.get(edge.target) ?? edge.target,
        edge.line ?? '',
        edge.column ?? '',
      ].join('|'))
      .sort(),
  };
}

export const expectedBrowserFixture = {
  acceptedPaths: [
    'src/Widget.vue',
    'src/main.ts',
    'src/rating.widget',
  ],
  languageMap: {
    'src/Widget.vue': 'vue',
    'src/main.ts': 'typescript',
    'src/rating.widget': 'typescript',
  } satisfies Record<string, Language>,
  warningCodes: [
    '../outside.ts|invalid_source_path',
    '/host/private.ts|invalid_source_path',
    'src/binary.ts|binary_file',
    'src/generated/ignored.ts|ignored_path',
    'src/not-a-file.ts|unsupported_entry_kind',
    'src/oversized.ts|file_too_large',
  ],
  grammarLoads: ['typescript'],
  graphProjection: {
    nodes: [
      'src/Widget.vue|component|src/Widget.vue::Widget',
      'src/Widget.vue|constant|title',
      'src/Widget.vue|file|src/Widget.vue',
      'src/Widget.vue|function|formatTitle',
      'src/main.ts|file|src/main.ts',
      'src/main.ts|function|greet',
      'src/main.ts|function|normalizeName',
      'src/rating.widget|file|src/rating.widget',
      'src/rating.widget|function|score',
    ],
    edges: [
      'src/Widget.vue|component|src/Widget.vue::Widget|contains|src/Widget.vue|constant|title||',
      'src/Widget.vue|component|src/Widget.vue::Widget|contains|src/Widget.vue|file|src/Widget.vue||',
      'src/Widget.vue|component|src/Widget.vue::Widget|contains|src/Widget.vue|function|formatTitle||',
      'src/Widget.vue|file|src/Widget.vue|contains|src/Widget.vue|constant|title||',
      'src/Widget.vue|file|src/Widget.vue|contains|src/Widget.vue|function|formatTitle||',
      'src/main.ts|file|src/main.ts|contains|src/main.ts|function|greet||',
      'src/main.ts|file|src/main.ts|contains|src/main.ts|function|normalizeName||',
      'src/rating.widget|file|src/rating.widget|contains|src/rating.widget|function|score||',
    ],
  } satisfies SemanticGraphProjection,
} as const;
