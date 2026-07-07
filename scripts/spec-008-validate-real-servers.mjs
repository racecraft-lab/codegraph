#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SLICE_LANGUAGES = {
  us1: ['typescript', 'tsx', 'javascript', 'jsx'],
  us2: ['python', 'go', 'rust', 'c', 'cpp', 'swift', 'java'],
  us3: ['csharp', 'kotlin', 'php', 'ruby', 'dart', 'vue', 'cobol'],
};

const VALIDATION_ROWS = {
  javascript: implementedRow('javascript', 'JavaScript', 'us1', [
    {
      serverCommand: ['typescript-language-server', '--stdio'],
      versionCommand: ['typescript-language-server', '--version'],
    },
  ], {
    sdk: 'typescript',
    smokeEvidence: ['TypeScript SDK is resolvable from the current project.'],
  }),
  jsx: implementedRow('jsx', 'JSX', 'us1', [
    {
      serverCommand: ['typescript-language-server', '--stdio'],
      versionCommand: ['typescript-language-server', '--version'],
    },
  ], {
    sdk: 'typescript',
    smokeEvidence: ['TypeScript SDK is resolvable from the current project for JSX validation.'],
  }),
  typescript: implementedRow('typescript', 'TypeScript', 'us1', [
    {
      serverCommand: ['typescript-language-server', '--stdio'],
      versionCommand: ['typescript-language-server', '--version'],
    },
  ], {
    sdk: 'typescript',
    smokeEvidence: ['TypeScript SDK is resolvable from the current project.'],
  }),
  tsx: implementedRow('tsx', 'TSX', 'us1', [
    {
      serverCommand: ['typescript-language-server', '--stdio'],
      versionCommand: ['typescript-language-server', '--version'],
    },
  ], {
    sdk: 'typescript',
    smokeEvidence: ['TypeScript SDK is resolvable from the current project for TSX validation.'],
  }),
  python: implementedRow('python', 'Python', 'us2', [
    {
      serverCommand: ['pyright-langserver', '--stdio'],
      versionCommand: ['pyright', '--version'],
    },
    {
      serverCommand: ['basedpyright-langserver', '--stdio'],
      versionCommand: ['basedpyright', '--version'],
    },
  ], {
    smokeEvidence: ['Selected stdio server command is available for Python definition/reference validation.'],
  }),
  go: implementedRow('go', 'Go', 'us2', [
    {
      serverCommand: ['gopls'],
      versionCommand: ['gopls', 'version'],
    },
  ], {
    smokeEvidence: ['Selected gopls command is available for module workspace validation.'],
  }),
  rust: implementedRow('rust', 'Rust', 'us2', [
    {
      serverCommand: ['rust-analyzer'],
      versionCommand: ['rust-analyzer', '--version'],
    },
  ], {
    smokeEvidence: ['Selected rust-analyzer command is available for cargo workspace validation.'],
  }),
  c: implementedRow('c', 'C', 'us2', [
    {
      serverCommand: ['clangd'],
      versionCommand: ['clangd', '--version'],
    },
  ], {
    smokeEvidence: ['Selected clangd command is available for compile-command-aware C validation.'],
  }),
  cpp: implementedRow('cpp', 'C++', 'us2', [
    {
      serverCommand: ['clangd'],
      versionCommand: ['clangd', '--version'],
    },
  ], {
    smokeEvidence: ['Selected clangd command is available for compile-command-aware C++ validation.'],
  }),
  swift: implementedRow('swift', 'Swift', 'us2', [
    {
      serverCommand: ['sourcekit-lsp'],
      versionCommand: ['sourcekit-lsp', '--help'],
    },
  ], {
    smokeEvidence: ['Selected sourcekit-lsp command is available for package/source workspace validation.'],
  }),
  java: implementedRow('java', 'Java', 'us2', [
    {
      serverCommand: ['jdtls', '-configuration', '<validation-config-dir>', '-data', '<validation-workspace-dir>'],
      versionCommand: ['jdtls', '--help'],
    },
  ], {
    smokeEvidence: ['Selected JDT LS command is available for workspace initialization validation.'],
  }),
  csharp: implementedRow('csharp', 'C#', 'us3', [
    {
      serverCommand: ['csharp-ls'],
      versionCommand: ['csharp-ls', '--version'],
    },
  ], {
    smokeEvidence: ['Selected csharp-ls command is available for workspace validation.'],
  }),
  kotlin: implementedRow('kotlin', 'Kotlin', 'us3', [
    {
      serverCommand: ['kotlin-language-server'],
      versionCommand: ['kotlin-language-server'],
      validationMode: 'lsp-stdio',
    },
    {
      serverCommand: ['kotlin-lsp'],
      versionCommand: ['kotlin-lsp', '--version'],
    },
  ], {
    smokeEvidence: ['Selected Kotlin server command is available for workspace validation.'],
  }),
  php: implementedRow('php', 'PHP', 'us3', [
    {
      serverCommand: ['intelephense', '--stdio'],
      versionCommand: ['intelephense', '--stdio'],
      validationMode: 'lsp-stdio',
    },
    {
      serverCommand: ['phpactor', 'language-server'],
      versionCommand: ['phpactor', '--version'],
    },
  ], {
    smokeEvidence: ['Selected PHP server command is available for definition/reference validation.'],
  }),
  ruby: implementedRow('ruby', 'Ruby', 'us3', [
    {
      serverCommand: ['ruby-lsp'],
      versionCommand: ['ruby-lsp', '--version'],
    },
    {
      serverCommand: ['solargraph', 'stdio'],
      versionCommand: ['solargraph', '--version'],
    },
  ], {
    smokeEvidence: ['Selected Ruby server command is available for definition/reference validation.'],
  }),
  dart: implementedRow('dart', 'Dart', 'us3', [
    {
      serverCommand: ['dart', 'language-server'],
      versionCommand: ['dart', '--version'],
    },
  ], {
    smokeEvidence: ['Selected dart language-server command is available for package validation.'],
  }),
  vue: implementedRow('vue', 'Vue', 'us3', [
    {
      serverCommand: ['vue-language-server', '--stdio'],
      versionCommand: ['vue-language-server', '--version'],
    },
  ], {
    sdk: 'typescript',
    smokeEvidence: [
      'Selected vue-language-server command is available for component validation.',
      'TypeScript SDK is resolvable for Vue server startup when a tsdk path is required.',
    ],
  }),
  cobol: {
    language: 'cobol',
    displayName: 'COBOL',
    slice: 'us3',
    disposition: 'future-owned',
    owner: 'SPEC-024',
    detail: 'Parser/resolver parity remains SPEC-008 evidence; local LSP parity is owned by SPEC-024.',
  },
};

const argv = process.argv.slice(2);
const languages = selectedLanguages(argv);
const observed = [];
const missing = [];
const dispositions = [];

for (const language of languages) {
  const row = VALIDATION_ROWS[language];
  if (!row) {
    missing.push({
      language,
      expected: 'known SPEC-008 validation row',
      reasonCode: 'validation-only-prereq-missing',
      error: 'unsupported SPEC-008 validation row',
    });
    continue;
  }

  if (row.disposition === 'future-owned') {
    dispositions.push({
      language: row.language,
      displayName: row.displayName,
      status: 'future-owned',
      owner: row.owner,
      detail: row.detail,
    });
    continue;
  }

  const selected = await selectWorkingCandidate(row);
  if (!selected) {
    missing.push({
      language,
      expected: expectedLabel(row),
      reasonCode: 'validation-only-prereq-missing',
      error: `no accepted server candidate passed validation${row.lastCandidateError ? `: ${row.lastCandidateError}` : ''}`,
    });
    continue;
  }

  const sdkEvidence = row.sdk ? resolveNodePackage(row.sdk) : null;
  if (row.sdk && !sdkEvidence) {
    missing.push({
      language,
      expected: `${row.sdk} SDK resolvable from current project`,
      selectedCommand: commandLabel(selected.candidate.versionCommand),
      resolvedExecutable: selected.resolvedServerExecutable,
      resolvedProbeExecutable: selected.resolvedProbeExecutable,
      reasonCode: 'validation-only-prereq-missing',
      error: 'SDK package not resolvable',
    });
    continue;
  }

  observed.push({
    language,
    displayName: row.displayName,
    slice: row.slice,
    command: commandLabel(selected.candidate.versionCommand),
    serverCommand: commandLabel(selected.candidate.serverCommand),
    expectedAlternatives: row.candidates.map((candidate) => commandLabel(candidate.serverCommand)),
    resolvedExecutable: selected.resolvedServerExecutable,
    resolvedProbeExecutable: selected.resolvedProbeExecutable,
    status: selected.result.status,
    statusText: `exit ${selected.result.status}`,
    output: probeOutput(selected.candidate, selected.result),
    minimumRuntimeEvidence: sdkEvidence ? `${row.sdk} SDK: ${sdkEvidence}` : undefined,
    smokeValidation: {
      status: 'prereq-only',
      evidence: [
        ...row.smokeEvidence,
        'Validation records local prerequisites only; it does not auto-install or keep a language-server session running.',
      ],
    },
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}/${process.arch}`,
  codegraphVersion: process.env.npm_package_version ?? readPackageVersion(),
  observed,
  missing,
  dispositions,
  paritySummary: {
    verified: observed.length,
    futureOwned: dispositions.length,
    missing: missing.length,
    unowned: 0,
  },
};

console.log(JSON.stringify(report, null, 2));
if (missing.length > 0) {
  console.error(`SPEC-008 real-server validation prerequisites failed. Missing required local language servers: ${missing.map((item) => `${item.language}: expected ${item.expected}`).join('; ')}. Install the server or configure codegraph.json/environment overrides. Normal codegraph index --lsp still degrades per language; this failure applies only to SPEC-008 validation.`);
  process.exit(1);
}

function implementedRow(language, displayName, slice, candidates, options = {}) {
  return {
    language,
    displayName,
    slice,
    disposition: 'implemented',
    candidates,
    sdk: options.sdk,
    smokeEvidence: options.smokeEvidence ?? [],
  };
}

function selectedLanguages(args) {
  const explicit = valueFor(args, '--languages');
  if (explicit) return explicit.split(',').map((item) => item.trim()).filter(Boolean);

  const slice = valueFor(args, '--slice');
  if (slice && SLICE_LANGUAGES[slice]) return SLICE_LANGUAGES[slice];

  return [
    ...SLICE_LANGUAGES.us1,
    ...SLICE_LANGUAGES.us2,
    ...SLICE_LANGUAGES.us3,
  ];
}

function valueFor(args, name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

async function selectWorkingCandidate(row) {
  let lastCandidateError = null;
  for (const candidate of row.candidates) {
    const resolvedServerExecutable = resolveExecutablePath(candidate.serverCommand[0]);
    const resolvedProbeExecutable = resolveExecutablePath(candidate.versionCommand[0]);
    if (!resolvedServerExecutable || !resolvedProbeExecutable) {
      lastCandidateError = `${commandLabel(candidate.serverCommand)} or ${commandLabel(candidate.versionCommand)} was not found`;
      continue;
    }
    const result = candidate.validationMode === 'lsp-stdio'
      ? await runLspStdioProbe(resolvedProbeExecutable, candidate.versionCommand.slice(1))
      : spawnSync(resolvedProbeExecutable, candidate.versionCommand.slice(1), {
        encoding: 'utf8',
        env: process.env,
        shell: shouldSpawnWithShell(resolvedProbeExecutable),
        timeout: 5000,
      });
    if (result.error) {
      lastCandidateError = `${commandLabel(candidate.versionCommand)} failed: ${result.error.message}`;
      continue;
    }
    if (result.status !== 0 || result.signal) {
      const status = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
      lastCandidateError = `${commandLabel(candidate.versionCommand)} returned ${status}`;
      continue;
    }
    return { candidate, resolvedServerExecutable, resolvedProbeExecutable, result };
  }
  row.lastCandidateError = lastCandidateError;
  return null;
}

function runLspStdioProbe(executable, args) {
  return new Promise((resolve) => {
    const child = spawnForProbe(executable, args);
    let stdout = '';
    let stderr = '';
    let responded = false;
    let finished = false;
    let shutdownTimer = null;
    let responseTimer = null;
    let cleanupTimedOut = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (shutdownTimer) clearTimeout(shutdownTimer);
      if (responseTimer) clearTimeout(responseTimer);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (!responded && hasLspInitializeResponse(stdout)) {
        responded = true;
        child.stdin.write(lspFrame({ jsonrpc: '2.0', method: 'initialized', params: {} }));
        child.stdin.write(lspFrame({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: null }));
        child.stdin.write(lspFrame({ jsonrpc: '2.0', method: 'exit', params: null }));
        shutdownTimer = setTimeout(() => {
          cleanupTimedOut = true;
          child.kill();
        }, 1500);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on('error', () => {
      // A short-lived fake or real server can close after initialize before our
      // shutdown writes flush. The close event below remains authoritative.
    });
    child.on('error', (error) => {
      finish({ status: null, signal: null, stdout, stderr, error });
    });
    child.on('close', (status, signal) => {
      if (responded && cleanupTimedOut) {
        finish({ status: 0, signal: null, stdout, stderr });
        return;
      }
      finish({
        status: responded ? status : (status === 0 ? 1 : status),
        signal,
        stdout,
        stderr,
      });
    });

    child.stdin.write(lspFrame({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: null,
        rootUri: null,
        capabilities: {},
      },
    }));

    responseTimer = setTimeout(() => {
      if (!responded) {
        child.kill();
        finish({ status: null, signal: 'TIMEOUT', stdout, stderr });
      }
    }, 5000);
  });
}

function spawnForProbe(executable, args) {
  return spawn(executable, args, {
    env: process.env,
    shell: shouldSpawnWithShell(executable),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function hasLspInitializeResponse(output) {
  return output.includes('"id":1') && output.includes('"capabilities"');
}

function lspFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function resolveExecutablePath(command) {
  if (!command) return null;
  if (path.isAbsolute(command)) return executablePath(command);
  if (command.includes('/') || command.includes('\\')) return executablePath(path.resolve(process.cwd(), command));

  const pathValue = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  const commandExtensions = executableExtensions(command, extensions);
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const ext of commandExtensions) {
      const resolved = executablePath(path.join(dir, command + ext));
      if (resolved) return resolved;
    }
  }
  return null;
}

function executableExtensions(command, extensions) {
  if (process.platform !== 'win32') return extensions;
  const commandExt = path.extname(command).toUpperCase();
  if (commandExt && extensions.map((ext) => ext.toUpperCase()).includes(commandExt)) return [''];
  return extensions;
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

function resolveNodePackage(packageName) {
  const result = spawnSync(process.execPath, [
    '-e',
    `console.log(require.resolve(${JSON.stringify(`${packageName}/package.json`)}))`,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim();
}

function expectedLabel(row) {
  return row.candidates.map((candidate) => commandLabel(candidate.serverCommand)).join(' or ');
}

function commandLabel(command) {
  return command.join(' ');
}

function probeOutput(candidate, result) {
  if (candidate.validationMode === 'lsp-stdio') {
    return 'LSP initialize response observed';
  }
  return sanitizeOutput(firstLine(`${result.stdout || ''}${result.stderr || ''}`));
}

function firstLine(output) {
  return output.trim().split(/\r?\n/)[0] || '';
}

function sanitizeOutput(output) {
  return output.replace(/https?:\/\/\S+/g, '[redacted-url]');
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
