#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SERVER_COMMANDS = {
  javascript: { commands: [['typescript-language-server', '--version']], sdk: 'typescript' },
  jsx: { commands: [['typescript-language-server', '--version']], sdk: 'typescript' },
  typescript: { commands: [['typescript-language-server', '--version']], sdk: 'typescript' },
  tsx: { commands: [['typescript-language-server', '--version']], sdk: 'typescript' },
  python: { commands: [['pyright-langserver', '--version'], ['basedpyright-langserver', '--version']] },
  go: { commands: [['gopls', 'version']] },
  rust: { commands: [['rust-analyzer', '--version']] },
  c: { commands: [['clangd', '--version']] },
  cpp: { commands: [['clangd', '--version']] },
  swift: { commands: [['sourcekit-lsp', '--version']] },
  java: { commands: [['jdtls', '--version']] },
  csharp: { commands: [['csharp-ls', '--version']] },
  kotlin: { commands: [['kotlin-language-server', '--version'], ['kotlin-lsp', '--version']] },
  php: { commands: [['intelephense', '--version'], ['phpactor', '--version']] },
  ruby: { commands: [['ruby-lsp', '--version'], ['solargraph', '--version']] },
  dart: { commands: [['dart', '--version']] },
  vue: { commands: [['vue-language-server', '--version']], sdk: 'typescript' },
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

  const selected = selectWorkingCommand(entry);
  if (selected.missing) {
    missing.push({ language, ...selected.missing });
    continue;
  }

  const sdkEvidence = entry.sdk ? resolveNodePackage(entry.sdk) : null;
  if (entry.sdk && !sdkEvidence) {
    missing.push({ language, expected: `${entry.sdk} SDK resolvable from current project`, error: 'SDK package not resolvable' });
    continue;
  }

  observed.push({
    language,
    command: selected.command.join(' '),
    resolvedPath: selected.resolvedPath,
    status: selected.result.status,
    output: selected.output,
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
  if (valueFor(args, '--slice') === 'us1') return ['typescript', 'tsx', 'javascript', 'jsx'];
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

function selectWorkingCommand(entry) {
  const expected = expectedLabel(entry);
  let lastFailure = null;

  for (const command of entry.commands) {
    const resolvedPath = resolveExecutablePath(command[0]);
    if (!resolvedPath) {
      lastFailure ??= { expected, error: 'command not found on PATH' };
      continue;
    }

    const result = spawnSync(resolvedPath, command.slice(1), {
      encoding: 'utf8',
      shell: shouldSpawnWithShell(resolvedPath),
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0] || '';
    if (result.error) {
      lastFailure = { expected, resolvedPath, error: result.error.message };
      continue;
    }
    if (result.status !== 0) {
      lastFailure = {
        expected,
        resolvedPath,
        status: result.status,
        signal: result.signal,
        output,
        error: `validation command exited ${result.status ?? 'without status'}`,
      };
      continue;
    }

    return { command, resolvedPath, result, output };
  }

  return { missing: lastFailure ?? { expected, error: 'command not found on PATH' } };
}

function expectedLabel(entry) {
  return entry.commands.map((command) => command.join(' ')).join(' or ');
}

function resolveExecutablePath(command) {
  if (!command) return null;
  if (path.isAbsolute(command)) return executablePath(command);
  if (command.includes('/') || command.includes('\\')) return executablePath(path.resolve(process.cwd(), command));

  const pathValue = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const ext of executableExtensions(command, extensions)) {
      const resolved = executablePath(path.join(dir, command + ext));
      if (resolved) return resolved;
    }
  }
  return null;
}

function executableExtensions(command, extensions) {
  if (process.platform !== 'win32') return extensions;
  const commandExt = path.extname(command).toUpperCase();
  const pathExts = extensions.map((ext) => ext.toUpperCase());
  return commandExt && pathExts.includes(commandExt) ? [''] : extensions;
}

function executablePath(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function shouldSpawnWithShell(executable) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
}
