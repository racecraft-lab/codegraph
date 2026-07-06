#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const SERVER_COMMANDS = {
  javascript: { command: ['typescript-language-server', '--version'], sdk: 'typescript' },
  typescript: { command: ['typescript-language-server', '--version'], sdk: 'typescript' },
  python: { command: ['pyright-langserver', '--version'] },
  go: { command: ['gopls', 'version'] },
  rust: { command: ['rust-analyzer', '--version'] },
  c: { command: ['clangd', '--version'] },
  cpp: { command: ['clangd', '--version'] },
  swift: { command: ['sourcekit-lsp', '--version'] },
  java: { command: ['jdtls', '--version'] },
  csharp: { command: ['csharp-ls', '--version'] },
  kotlin: { command: ['kotlin-language-server', '--version'] },
  php: { command: ['intelephense', '--version'] },
  ruby: { command: ['ruby-lsp', '--version'] },
  dart: { command: ['dart', '--version'] },
  vue: { command: ['vue-language-server', '--version'], sdk: 'typescript' },
};

const argv = process.argv.slice(2);
const languages = selectedLanguages(argv);
const observed = [];
const missing = [];

for (const language of languages) {
  const entry = SERVER_COMMANDS[language];
  if (!entry) {
    missing.push({ language, expected: 'owned by future SPEC-024 disposition', error: 'unsupported SPEC-008 runtime row' });
    continue;
  }

  const result = spawnSync(entry.command[0], entry.command.slice(1), { encoding: 'utf8' });
  if (result.error) {
    missing.push({ language, expected: entry.command.join(' '), error: result.error.message });
    continue;
  }

  const sdkEvidence = entry.sdk ? resolveNodePackage(entry.sdk) : null;
  if (entry.sdk && !sdkEvidence) {
    missing.push({ language, expected: `${entry.sdk} SDK resolvable from current project`, error: 'SDK package not resolvable' });
    continue;
  }

  observed.push({
    language,
    command: entry.command.join(' '),
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0] || '',
    minimumRuntimeEvidence: sdkEvidence ? `${entry.sdk} SDK: ${sdkEvidence}` : undefined,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  codegraphVersion: process.env.npm_package_version ?? 'unknown',
  observed,
  missing,
  paritySummary: {
    verified: observed.length,
    futureOwned: languages.includes('cobol') ? 1 : 0,
    missing: missing.length,
    unowned: 0,
  },
};

console.log(JSON.stringify(report, null, 2));
if (missing.length > 0) {
  console.error(`SPEC-008 real-server validation prerequisites failed. Missing required local language servers: ${missing.map((item) => `${item.language}: expected ${item.expected}`).join('; ')}. Install the server or configure codegraph.json/environment overrides. Normal codegraph index --lsp still degrades per language; this failure applies only to SPEC-008 validation.`);
  process.exit(1);
}

function selectedLanguages(args) {
  const explicit = valueFor(args, '--languages');
  if (explicit) return explicit.split(',').map((item) => item.trim()).filter(Boolean);
  if (valueFor(args, '--slice') === 'us1') return ['typescript', 'javascript'];
  return Object.keys(SERVER_COMMANDS);
}

function valueFor(args, name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function resolveNodePackage(packageName) {
  const result = spawnSync(process.execPath, [
    '-e',
    `console.log(require.resolve(${JSON.stringify(`${packageName}/package.json`)}))`,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim();
}
