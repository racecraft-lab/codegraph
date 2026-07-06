import {
  DEFAULT_LSP_TIMEOUT_MS,
  LSP_LANGUAGES,
  LspLanguage,
  LspServerRegistryEntry,
} from './types';

const entry = (
  language: LspLanguage,
  displayName: string,
  commands: string[][],
): LspServerRegistryEntry => ({
  language,
  displayName,
  disposition: 'implemented',
  commands: commands.map((argv) => ({ argv, label: argv.join(' ') })),
  defaultTimeoutMs: DEFAULT_LSP_TIMEOUT_MS,
});

export const LSP_SERVER_REGISTRY: Record<LspLanguage, LspServerRegistryEntry> = {
  javascript: entry('javascript', 'JavaScript', [['typescript-language-server', '--stdio']]),
  jsx: entry('jsx', 'JSX', [['typescript-language-server', '--stdio']]),
  typescript: entry('typescript', 'TypeScript', [['typescript-language-server', '--stdio']]),
  tsx: entry('tsx', 'TSX', [['typescript-language-server', '--stdio']]),
  python: entry('python', 'Python', [['pyright-langserver', '--stdio'], ['basedpyright-langserver', '--stdio']]),
  java: entry('java', 'Java', [['jdtls']]),
  c: entry('c', 'C', [['clangd']]),
  cpp: entry('cpp', 'C++', [['clangd']]),
  csharp: entry('csharp', 'C#', [['csharp-ls']]),
  go: entry('go', 'Go', [['gopls']]),
  ruby: entry('ruby', 'Ruby', [['ruby-lsp'], ['solargraph', 'stdio']]),
  rust: entry('rust', 'Rust', [['rust-analyzer']]),
  php: entry('php', 'PHP', [['intelephense', '--stdio'], ['phpactor', 'language-server']]),
  kotlin: entry('kotlin', 'Kotlin', [['kotlin-language-server'], ['kotlin-lsp']]),
  swift: entry('swift', 'Swift', [['sourcekit-lsp']]),
  dart: entry('dart', 'Dart', [['dart', 'language-server']]),
  vue: entry('vue', 'Vue', [['vue-language-server', '--stdio']]),
  cobol: {
    language: 'cobol',
    displayName: 'COBOL',
    disposition: 'future-owned',
    commands: [],
    defaultTimeoutMs: DEFAULT_LSP_TIMEOUT_MS,
    futureOwner: 'SPEC-024',
    validationNote: 'Parser/resolver parity remains SPEC-008 evidence; LSP parity is owned by SPEC-024.',
  },
};

export function getLspServerRegistry(): readonly LspServerRegistryEntry[] {
  return LSP_LANGUAGES.map((language) => LSP_SERVER_REGISTRY[language]);
}

export function getLspServerEntry(language: LspLanguage): LspServerRegistryEntry {
  return LSP_SERVER_REGISTRY[language];
}
