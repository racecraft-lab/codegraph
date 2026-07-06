#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const commands = [
  ['typescript', ['typescript-language-server', '--version']],
  ['python', ['pyright-langserver', '--version']],
  ['go', ['gopls', 'version']],
  ['rust', ['rust-analyzer', '--version']],
  ['c', ['clangd', '--version']],
  ['cpp', ['clangd', '--version']],
  ['swift', ['sourcekit-lsp', '--version']],
  ['java', ['jdtls', '--version']],
  ['csharp', ['csharp-ls', '--version']],
  ['kotlin', ['kotlin-language-server', '--version']],
  ['php', ['intelephense', '--version']],
  ['ruby', ['ruby-lsp', '--version']],
  ['dart', ['dart', '--version']],
  ['vue', ['vue-language-server', '--version']],
];

const observed = [];
const missing = [];

for (const [language, argv] of commands) {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  if (result.error) {
    missing.push({ language, expected: argv.join(' '), error: result.error.message });
    continue;
  }
  observed.push({
    language,
    command: argv.join(' '),
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0] || '',
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  observed,
  missing,
  paritySummary: {
    verified: observed.length,
    futureOwned: 1,
    missing: missing.length,
  },
};

console.log(JSON.stringify(report, null, 2));
if (missing.length > 0) {
  console.error(`SPEC-008 real-server validation prerequisites failed. Missing required local language servers: ${missing.map((item) => `${item.language}: expected ${item.expected}`).join('; ')}. Install the server or configure codegraph.json/environment overrides. Normal codegraph index --lsp still degrades per language; this failure applies only to SPEC-008 validation.`);
  process.exit(1);
}
