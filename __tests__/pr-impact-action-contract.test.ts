import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CODEGRAPH_VERSION,
  HELPER_VERSION,
  parseActionInputs,
  runAction,
  type ActionInputs,
  type DeliveryResult,
  type DetectorResult,
  type FinalConclusion,
  type NarrativeResult,
  type PullRequestContext,
} from '../actions/pr-impact/run';
import { prImpactGitHubEvent } from './fixtures/pr-impact';

const ROOT = path.resolve(__dirname, '..');
const ACTION_YML = path.join(ROOT, 'actions/pr-impact/action.yml');
const ACTION_README = path.join(ROOT, 'actions/pr-impact/README.md');
const DOGFOOD_WORKFLOW = path.join(ROOT, '.github/workflows/pr-impact.yml');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACK_NPM = path.join(ROOT, 'scripts/pack-npm.sh');

const INPUTS = [
  'codegraph-version',
  'base-ref',
  'fail-on-callers',
  'fail-on-hubs',
  'caller-depth',
  'max-callers',
  'narrative',
  'comment-write',
] as const;

const OUTPUTS = [
  'summary-status',
  'detector-exit-code',
  'conclusion',
  'threshold-breached',
  'cache-status',
  'delivery-status',
  'comment-url',
  'report-path',
  'artifact-name',
  'narrative-status',
  'codegraph-version',
  'helper-version',
] as const;

function readAction(): string {
  return fs.readFileSync(ACTION_YML, 'utf8');
}

function readPackage(): { version: string; files?: string[] } {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
}

function outputMap(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const eq = line.indexOf('=');
        return [line.slice(0, eq), line.slice(eq + 1)];
      }),
  );
}

describe('PR impact action contract', () => {
  it('declares the public action inputs, outputs, helper runtime, and package surface', () => {
    const action = readAction();
    const readme = fs.readFileSync(ACTION_README, 'utf8');
    const pkg = readPackage();

    for (const input of INPUTS) {
      expect(action).toMatch(new RegExp(`^  ${input}:`, 'm'));
      expect(action).toContain(`INPUT_${input.toUpperCase().replaceAll('-', '_')}:`);
    }

    for (const output of OUTPUTS) {
      expect(action).toMatch(new RegExp(`^  ${output}:`, 'm'));
      expect(action).toContain(`steps.finalize-pr-impact.outputs.${output}`);
    }

    expect(action).toContain(`default: "${pkg.version}"`);
    expect(DEFAULT_CODEGRAPH_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe('1.5.0');
    expect(action).toContain('INPUT_CODEGRAPH_VERSION: ${{ inputs.codegraph-version }}');
    expect(action).toContain('codegraph_spec="$INPUT_CODEGRAPH_VERSION"');
    expect(action).toContain('npm install --global "@colbymchenry/codegraph@$codegraph_spec"');
    expect(action).toContain('write_env_line "PR_IMPACT_CODEGRAPH_BIN" "$codegraph_bin"');
    expect(action).toContain('write_env_line "PR_IMPACT_CODEGRAPH_RESOLVED_VERSION" "$codegraph_version"');
    expect(action).toContain('write_output_line "codegraph-version" "$codegraph_version"');
    expect(action).toContain('Refusing to write multi-line value for $name');
    expect(action).toContain('! "$codegraph_version" =~ ^[A-Za-z0-9][A-Za-z0-9._~:+/-]*$');
    expect(action).toContain('$GITHUB_ENV');
    expect(action).toContain('node "${{ github.action_path }}/dist/run.mjs"');
    expect(action).toContain('PR_IMPACT_CACHE_RESTORE_HIT:');
    expect(action).toContain('PR_IMPACT_TRUSTED_CONTEXT:');
    expect(action).toContain('PR_IMPACT_TOKEN_WRITE:');
    expect(action).toContain('description: "Set true only when the caller grants GITHUB_TOKEN pull-requests: write."');
    expect(action).toContain("inputs.comment-write == 'true'");
    expect(action).toContain("github.actor != 'dependabot[bot]'");
    expect(action).toContain('PR_IMPACT_PREPARE_BASE_INDEX: "true"');
    expect(action).toContain('PR_IMPACT_VALIDATE_HEAD: "true"');
    expect(action).toContain('steps.install-codegraph.outputs.codegraph-version');
    expect(action).toContain('steps.install-codegraph.outputs.codegraph-version }}-');
    expect(action).toContain('${{ github.run_id }}-${{ github.run_attempt }}');
    expect(action).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(action).toContain("steps.pr-impact.outputs.cache-status == 'rebuilt'");
    expect(action).toContain('id: upload-report');
    expect(action).toContain('continue-on-error: true');
    expect(action).toContain('id: finalize-pr-impact');
    expect(action).toContain('PR_IMPACT_SUMMARY_WRITE_STATUS: ${{ steps.pr-impact.outputs.summary-write-status }}');
    expect(action).toContain('PR_IMPACT_UPLOAD_OUTCOME: ${{ steps.upload-report.outcome }}');
    expect(action).toContain('summary_status="${PR_IMPACT_SUMMARY_STATUS:-unavailable}"');
    expect(action).toContain('detector_exit_code="${PR_IMPACT_DETECTOR_EXIT_CODE:-3}"');
    expect(action).toContain('conclusion="${PR_IMPACT_INITIAL_CONCLUSION:-fail-analysis-unavailable}"');
    expect(action).toContain('cache_status="${PR_IMPACT_CACHE_STATUS:-unavailable}"');
    expect(action).toContain('write_output_line "summary-status" "$summary_status"');
    expect(action).toContain('write_output_line "helper-version" "$helper_version"');
    expect(action).toContain("steps.finalize-pr-impact.outputs.conclusion != 'pass'");
    expect(readme).toContain('codegraph-version: "1.5.0"');
    expect(readme).toContain('uses: racecraft-lab/codegraph/actions/pr-impact@<immutable-ref>');
    expect(readme).toContain('pull-requests: write');
    expect(readme).toContain('comment-write: "true"');
    expect(readme).toContain('| `comment-write` | `false` |');
    expect(readme).not.toContain('issues: write');
    expect(readme).toContain('| `codegraph-version` | `1.5.0` |');
    expect(readme).not.toContain('1.4.1');
    expect(pkg.files).toContain('actions');
    const packNpm = fs.readFileSync(PACK_NPM, 'utf8');
    expect(packNpm).toContain('cp -R "$ROOT/actions" "$NPM/main/actions"');
    expect(packNpm.indexOf('npm run build:pr-impact-action')).toBeLessThan(
      packNpm.indexOf('cp -R "$ROOT/actions" "$NPM/main/actions"'),
    );
    expect(packNpm).toContain('"actions"');
  });

  it('parses action inputs into the helper contract shape', () => {
    const inputs = parseActionInputs({
      INPUT_CODEGRAPH_VERSION: '1.4.1',
      INPUT_BASE_REF: 'main',
      INPUT_FAIL_ON_CALLERS: '12',
      INPUT_FAIL_ON_HUBS: 'true',
      INPUT_CALLER_DEPTH: '2',
      INPUT_MAX_CALLERS: '40',
      INPUT_NARRATIVE: 'trusted',
    });

    expect(inputs).toEqual({
      codegraphVersion: '1.4.1',
      baseRef: 'main',
      failOnCallers: 12,
      failOnHubs: true,
      callerDepth: 2,
      maxCallers: 40,
      narrative: 'trusted',
    });

    const resolved = parseActionInputs({
      INPUT_CODEGRAPH_VERSION: 'file:.',
      PR_IMPACT_CODEGRAPH_RESOLVED_VERSION: '1.4.1',
    });
    expect(resolved.codegraphVersion).toBe('1.4.1');

    const bounded = parseActionInputs({
      INPUT_CALLER_DEPTH: '99',
      INPUT_MAX_CALLERS: '0',
    });
    expect(bounded.callerDepth).toBe(3);
    expect(bounded.maxCallers).toBe(1);

    for (const invalid of ['abc', '10junk', '-1', '9007199254740992']) {
      expect(() => parseActionInputs({ INPUT_FAIL_ON_CALLERS: invalid })).toThrow('Invalid fail-on-callers');
      expect(() => parseActionInputs({ INPUT_CALLER_DEPTH: invalid })).toThrow('Invalid caller-depth');
      expect(() => parseActionInputs({ INPUT_MAX_CALLERS: invalid })).toThrow('Invalid max-callers');
    }
    for (const invalid of ['treu', '2', 'false-ish']) {
      expect(() => parseActionInputs({ INPUT_FAIL_ON_HUBS: invalid })).toThrow('Invalid fail-on-hubs');
    }
    for (const invalid of ['append', 'trusted-ish']) {
      expect(() => parseActionInputs({ INPUT_NARRATIVE: invalid })).toThrow('Invalid narrative');
    }
  });

  it('emits required metadata outputs from the helper seam', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-contract-'));
    try {
      let output = '';
      const writes: Record<string, string> = {};
      const result = await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'main',
          INPUT_NARRATIVE: 'off',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: (chunk: string | Uint8Array) => { output += String(chunk); return true; } },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: (target: fs.PathOrFileDescriptor, contents: string | Uint8Array) => {
          writes[String(target)] = `${writes[String(target)] ?? ''}${String(contents)}`;
        },
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
      });

      const emitted = outputMap(writes[path.join(tmp, 'outputs.txt')] ?? output);
      expect(emitted['codegraph-version']).toBe('1.4.1');
      expect(emitted['helper-version']).toBe(HELPER_VERSION);
      expect(emitted['summary-status']).toBe(result.detector.summary.status);
      expect(emitted['detector-exit-code']).toBe(String(result.detector.exitCode));
      expect(emitted.conclusion).toBe(result.conclusion);
      expect(result.report).toContain(`- Helper version: ${HELPER_VERSION}`);
      expect(result.report).toContain('- CodeGraph version: 1.4.1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not mutate .gitignore when a cache init cannot safely snapshot it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-gitignore-read-fail-'));
    try {
      const calls: Array<{ command: string; args: string[] }> = [];
      const removes: string[] = [];
      const result = await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.5.0',
          INPUT_NARRATIVE: 'off',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        existsSync: (target: fs.PathLike) => String(target) === '.gitignore' || fs.existsSync(target),
        mkdirSync: fs.mkdirSync,
        rmSync: (target: fs.PathLike, options?: fs.RmOptions) => {
          removes.push(String(target));
          fs.rmSync(target, options);
        },
        writeFileSync: fs.writeFileSync,
        readFileSync: (target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
          if (String(target) === '.gitignore') throw new Error('permission denied');
          return fs.readFileSync(target, options as any);
        },
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          throw new Error('cache init and detector should not run');
        },
      } as any);

      expect(result.detector.summary.status).toBe('unavailable');
      expect(result.conclusion).toBe('fail-analysis-unavailable');
      expect(calls).toEqual([]);
      expect(removes).not.toContain('.gitignore');
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('CodeGraph cache/index is unavailable.');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('emits unavailable analysis instead of silently disabling malformed threshold enforcement', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-invalid-threshold-'));
    try {
      const calls: Array<{ command: string; args: string[] }> = [];
      const result = await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.5.0',
          INPUT_FAIL_ON_CALLERS: '10junk',
          INPUT_FAIL_ON_HUBS: 'treu',
          INPUT_CALLER_DEPTH: '2junk',
          INPUT_MAX_CALLERS: 'many',
          INPUT_NARRATIVE: 'append',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          throw new Error('detector should not run');
        },
      } as any);

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(result.detector.summary.status).toBe('unavailable');
      expect(result.conclusion).toBe('fail-analysis-unavailable');
      expect(outputs.conclusion).toBe('fail-analysis-unavailable');
      expect(calls).toEqual([]);
      const report = fs.readFileSync(path.join(tmp, 'report.md'), 'utf8');
      expect(report).toContain('Invalid fail-on-callers');
      expect(report).toContain('Invalid fail-on-hubs');
      expect(report).toContain('Invalid caller-depth');
      expect(report).toContain('Invalid max-callers');
      expect(report).toContain('Invalid narrative');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('invokes detect-changes with base-ref, bounds, threshold policy, and authoritative JSON capture', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-detector-'));
    try {
      const calls: Array<{ command: string; args: string[] }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'origin/main',
          INPUT_FAIL_ON_CALLERS: '10',
          INPUT_FAIL_ON_HUBS: 'true',
          INPUT_CALLER_DEPTH: '3',
          INPUT_MAX_CALLERS: '50',
          PR_IMPACT_CODEGRAPH_BIN: '/tmp/codegraph-bin',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          return args.includes('json')
            ? JSON.stringify({
              schemaVersion: 1,
              summary: {
                status: 'impact',
                baseRef: 'origin/main',
                changedSymbolCount: 0,
                unmappedHunkCount: 0,
                callerCount: 0,
                affectedFlowCount: 0,
                riskCount: 0,
                warningCount: 0,
              },
              exitCode: 1,
              changedSymbols: [],
              unmappedHunks: [],
              callers: [],
              affectedFlows: { state: 'empty', items: [], truncated: false },
              risks: [],
              warnings: [],
              limits: { callerDepth: 3, maxCallers: 50 },
            })
            : '## Markdown detector report';
        },
      } as any);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.command).toBe('/tmp/codegraph-bin');
      expect(calls[0]?.args).toEqual(expect.arrayContaining([
        'detect-changes',
        '--mode', 'base-ref',
        '--base-ref', 'origin/main',
        '--head-ref', 'HEAD',
        '--caller-depth', '3',
        '--max-callers', '50',
        '--fail-on', 'callers>10,hub',
      ]));
      expect(calls[0]?.args).toEqual(expect.arrayContaining(['--format', 'json']));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prepares and passes a base index when the PR diff deletes files', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-base-index-'));
    try {
      const calls: Array<{ command: string; args: string[]; codegraphDir?: string }> = [];
      const copies: Array<{ source: string; target: string }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'origin/main',
          PR_IMPACT_CODEGRAPH_BIN: '/tmp/codegraph-bin',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          PR_IMPACT_MERGE_BASE: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          PR_IMPACT_PREPARE_BASE_INDEX: 'true',
          GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          GITHUB_RUN_ID: '200',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        cpSync: (source: string, target: string) => {
          copies.push({ source, target });
        },
        mkdirSync: fs.mkdirSync,
        rmSync: fs.rmSync,
        writeFileSync: fs.writeFileSync,
        execFileSync: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
          calls.push({ command, args, codegraphDir: options?.env?.CODEGRAPH_DIR });
          if (command === 'git' && args[0] === 'diff') return 'D\0src/delete-me.ts\0';
          if (command === 'git' && args[0] === 'worktree') return '';
          if (command === '/tmp/codegraph-bin' && args[0] === 'init') return '';
          return JSON.stringify({
            schemaVersion: 1,
            summary: {
              status: 'impact',
              baseRef: 'origin/main',
              changedSymbolCount: 1,
              unmappedHunkCount: 0,
              callerCount: 0,
              affectedFlowCount: 0,
              riskCount: 0,
              warningCount: 0,
            },
            exitCode: 1,
            changedSymbols: [],
            unmappedHunks: [],
            callers: [],
            affectedFlows: { state: 'empty', items: [], truncated: false },
            risks: [],
            warnings: [],
            limits: { callerDepth: 1, maxCallers: 20 },
          });
        },
      } as any);

      expect(calls).toContainEqual(expect.objectContaining({
        command: 'git',
        args: ['diff', '--name-status', '-z', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '--'],
      }));
      expect(calls).toContainEqual(expect.objectContaining({
        command: 'git',
        args: ['worktree', 'add', '--detach', '.codegraph/pr-impact-base-worktree-200', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      }));
      expect(calls).toContainEqual(expect.objectContaining({
        command: '/tmp/codegraph-bin',
        args: ['init', '.codegraph/pr-impact-base-worktree-200'],
        codegraphDir: '.codegraph-pr-impact-base',
      }));
      expect(copies).toEqual([{
        source: '.codegraph/pr-impact-base-worktree-200/.codegraph-pr-impact-base',
        target: '.codegraph-pr-impact-base',
      }]);
      const detectorCall = calls.find((call) => call.command === '/tmp/codegraph-bin' && call.args[0] === 'detect-changes');
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--base-index-dir', '.codegraph-pr-impact-base']));
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--head-ref', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prepares a base index when a retained or renamed file diff deletes lines', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-base-index-lines-'));
    try {
      const calls: Array<{ command: string; args: string[]; codegraphDir?: string }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.5.0',
          INPUT_BASE_REF: 'origin/main',
          PR_IMPACT_CODEGRAPH_BIN: '/tmp/codegraph-bin',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          PR_IMPACT_MERGE_BASE: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          PR_IMPACT_PREPARE_BASE_INDEX: 'true',
          GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          GITHUB_RUN_ID: '201',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        cpSync: () => undefined,
        mkdirSync: fs.mkdirSync,
        rmSync: fs.rmSync,
        writeFileSync: fs.writeFileSync,
        execFileSync: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
          calls.push({ command, args, codegraphDir: options?.env?.CODEGRAPH_DIR });
          if (command === 'git' && args[0] === 'diff' && args.includes('--name-status')) return 'M\0src/calculator.ts\0';
          if (command === 'git' && args[0] === 'diff' && args.includes('--numstat')) return '1\t1\tsrc/calculator.ts\0';
          if (command === 'git' && args[0] === 'worktree') return '';
          if (command === '/tmp/codegraph-bin' && args[0] === 'init') return '';
          return JSON.stringify({
            schemaVersion: 1,
            summary: {
              status: 'impact',
              baseRef: 'origin/main',
              changedSymbolCount: 1,
              unmappedHunkCount: 0,
              callerCount: 0,
              affectedFlowCount: 0,
              riskCount: 0,
              warningCount: 0,
            },
            exitCode: 1,
            changedSymbols: [],
            unmappedHunks: [],
            callers: [],
            affectedFlows: { state: 'empty', items: [], truncated: false },
            risks: [],
            warnings: [],
            limits: { callerDepth: 1, maxCallers: 20 },
          });
        },
      } as any);

      expect(calls).toContainEqual(expect.objectContaining({
        command: 'git',
        args: ['diff', '--numstat', '-z', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '--'],
      }));
      expect(calls.some((call) => call.command === 'git' && call.args.includes('--unified=0'))).toBe(false);
      expect(calls).toContainEqual(expect.objectContaining({
        command: 'git',
        args: ['worktree', 'add', '--detach', '.codegraph/pr-impact-base-worktree-201', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      }));
      const detectorCall = calls.find((call) => call.command === '/tmp/codegraph-bin' && call.args[0] === 'detect-changes');
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--base-index-dir', '.codegraph-pr-impact-base']));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not mistake paths beginning with D for deleted-file statuses', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-base-index-d-path-'));
    try {
      const calls: Array<{ command: string; args: string[]; codegraphDir?: string }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.5.0',
          INPUT_BASE_REF: 'origin/main',
          PR_IMPACT_CODEGRAPH_BIN: '/tmp/codegraph-bin',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          PR_IMPACT_MERGE_BASE: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          PR_IMPACT_PREPARE_BASE_INDEX: 'true',
          GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          GITHUB_RUN_ID: '202',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        cpSync: () => undefined,
        mkdirSync: fs.mkdirSync,
        rmSync: fs.rmSync,
        writeFileSync: fs.writeFileSync,
        execFileSync: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
          calls.push({ command, args, codegraphDir: options?.env?.CODEGRAPH_DIR });
          if (command === 'git' && args[0] === 'diff' && args.includes('--name-status')) return 'A\0Docs/new.ts\0';
          if (command === 'git' && args[0] === 'diff' && args.includes('--numstat')) return '1\t0\tDocs/new.ts\0';
          if (command === 'git' && args[0] === 'worktree') throw new Error('base worktree should not be prepared');
          return JSON.stringify({
            schemaVersion: 1,
            summary: {
              status: 'impact',
              baseRef: 'origin/main',
              changedSymbolCount: 1,
              unmappedHunkCount: 0,
              callerCount: 0,
              affectedFlowCount: 0,
              riskCount: 0,
              warningCount: 0,
            },
            exitCode: 1,
            changedSymbols: [],
            unmappedHunks: [],
            callers: [],
            affectedFlows: { state: 'empty', items: [], truncated: false },
            risks: [],
            warnings: [],
            limits: { callerDepth: 1, maxCallers: 20 },
          });
        },
      } as any);

      expect(calls.some((call) => call.command === 'git' && call.args[0] === 'worktree')).toBe(false);
      const detectorCall = calls.find((call) => call.command === '/tmp/codegraph-bin' && call.args[0] === 'detect-changes');
      expect(detectorCall?.args).not.toContain('--base-index-dir');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('emits unavailable analysis when deleted-file base index preparation fails', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-base-index-fail-'));
    try {
      const calls: Array<{ command: string; args: string[] }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'origin/main',
          PR_IMPACT_CODEGRAPH_BIN: '/tmp/codegraph-bin',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          PR_IMPACT_MERGE_BASE: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          PR_IMPACT_PREPARE_BASE_INDEX: 'true',
          GITHUB_RUN_ID: '200',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        cpSync: () => {
          throw new Error('copy failed');
        },
        mkdirSync: fs.mkdirSync,
        rmSync: fs.rmSync,
        writeFileSync: fs.writeFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          if (command === 'git' && args[0] === 'diff') return 'D\0src/delete-me.ts\0';
          if (command === 'git' && args[0] === 'worktree') return '';
          if (command === '/tmp/codegraph-bin' && args[0] === 'init') return '';
          throw new Error('detector should not run');
        },
      } as any);

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['summary-status']).toBe('unavailable');
      expect(outputs.conclusion).toBe('fail-analysis-unavailable');
      expect(calls.some((call) => call.command === '/tmp/codegraph-bin' && call.args[0] === 'detect-changes')).toBe(false);
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('Unable to prepare base CodeGraph index');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails closed when the checked-out workspace is not the pull-request head', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-head-mismatch-'));
    try {
      const eventPath = path.join(tmp, 'event.json');
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      const calls: Array<{ command: string; args: string[] }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.5.0',
          INPUT_BASE_REF: '',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000000',
          PR_IMPACT_VALIDATE_HEAD: 'true',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: fs.readFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          if (command === 'git' && args.join(' ') === 'rev-parse HEAD') {
            return '9999999999999999999999999999999999999999\n';
          }
          throw new Error('detector should not run');
        },
      } as any);

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['summary-status']).toBe('unavailable');
      expect(outputs.conclusion).toBe('fail-analysis-unavailable');
      expect(calls).toContainEqual({ command: 'git', args: ['rev-parse', 'HEAD'] });
      expect(calls.some((call) => call.command === 'codegraph')).toBe(false);
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('does not match pull request head SHA');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('defaults omitted base-ref input to the computed merge base for detector execution', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-event-base-'));
    try {
      const eventPath = path.join(tmp, 'event.json');
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      const calls: Array<{ command: string; args: string[] }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: '',
          INPUT_CALLER_DEPTH: '1',
          INPUT_MAX_CALLERS: '20',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000000',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: fs.readFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          return args.includes('json')
            ? JSON.stringify({
              schemaVersion: 1,
              summary: {
                status: 'impact',
                baseRef: 'main',
                changedSymbolCount: 0,
                unmappedHunkCount: 0,
                callerCount: 0,
                affectedFlowCount: 0,
                riskCount: 0,
                warningCount: 0,
              },
              exitCode: 1,
              changedSymbols: [],
              unmappedHunks: [],
              callers: [],
              affectedFlows: { state: 'empty', items: [], truncated: false },
              risks: [],
              warnings: [],
              limits: { callerDepth: 1, maxCallers: 20 },
            })
            : '## Markdown detector report';
        },
      } as any);

      const codegraphCalls = calls.filter((call) => call.command === 'codegraph');
      expect(codegraphCalls).toHaveLength(1);
      for (const call of codegraphCalls) {
        expect(call.args).toEqual(expect.arrayContaining(['--base-ref', '0000000000000000000000000000000000000000']));
        expect(call.args).toEqual(expect.arrayContaining(['--head-ref', '0000000000000000000000000000000000000002']));
      }
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Base ref: main');
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Merge base: 0000000000000000000000000000000000000000');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('computes merge base from event base SHA when detached checkout lacks the base branch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-detached-base-'));
    try {
      const eventPath = path.join(tmp, 'event.json');
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      const calls: Array<{ command: string; args: string[] }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: '',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: fs.readFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          if (command === 'git') {
            if (args[1] === '0000000000000000000000000000000000000001') {
              return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
            }
            throw new Error('base ref unavailable');
          }
          return JSON.stringify({
            schemaVersion: 1,
            summary: {
              status: 'impact',
              baseRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              changedSymbolCount: 0,
              unmappedHunkCount: 0,
              callerCount: 0,
              affectedFlowCount: 0,
              riskCount: 0,
              warningCount: 0,
            },
            exitCode: 1,
            changedSymbols: [],
            unmappedHunks: [],
            callers: [],
            affectedFlows: { state: 'empty', items: [], truncated: false },
            risks: [],
            warnings: [],
            limits: { callerDepth: 1, maxCallers: 20 },
          });
        },
      } as any);

      expect(calls.find((call) => call.command === 'git')?.args).toEqual([
        'merge-base',
        '0000000000000000000000000000000000000001',
        '0000000000000000000000000000000000000002',
      ]);
      const detectorCall = calls.find((call) => call.command === 'codegraph');
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--base-ref', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']));
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--head-ref', '0000000000000000000000000000000000000002']));
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Merge base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves an explicit base-ref without falling back to the pull request event base SHA', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-explicit-base-'));
    try {
      const eventPath = path.join(tmp, 'event.json');
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      const calls: Array<{ command: string; args: string[] }> = [];
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'release/next',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: fs.readFileSync,
        execFileSync: (command: string, args: string[]) => {
          calls.push({ command, args });
          if (command === 'git') {
            if (args[1] === '0000000000000000000000000000000000000001') {
              throw new Error('event base SHA must not be used for explicit base-ref');
            }
            if (args[1] === 'release/next') {
              throw new Error('local branch unavailable');
            }
            if (args[1] === 'origin/release/next') {
              return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';
            }
            throw new Error(`unexpected merge-base candidate ${args[1]}`);
          }
          return JSON.stringify({
            schemaVersion: 1,
            summary: {
              status: 'impact',
              baseRef: 'release/next',
              changedSymbolCount: 0,
              unmappedHunkCount: 0,
              callerCount: 0,
              affectedFlowCount: 0,
              riskCount: 0,
              warningCount: 0,
            },
            exitCode: 1,
            changedSymbols: [],
            unmappedHunks: [],
            callers: [],
            affectedFlows: { state: 'empty', items: [], truncated: false },
            risks: [],
            warnings: [],
            limits: { callerDepth: 1, maxCallers: 20 },
          });
        },
      } as any);

      expect(calls.filter((call) => call.command === 'git').map((call) => call.args)).toEqual([
        ['merge-base', 'release/next', '0000000000000000000000000000000000000002'],
        ['merge-base', 'origin/release/next', '0000000000000000000000000000000000000002'],
      ]);
      const detectorCall = calls.find((call) => call.command === 'codegraph');
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--base-ref', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']));
      expect(detectorCall?.args).toEqual(expect.arrayContaining(['--head-ref', '0000000000000000000000000000000000000002']));
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Merge base: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('declares the advisory pull-request dogfood workflow without threshold or narrative escalation', () => {
    const workflow = fs.readFileSync(DOGFOOD_WORKFLOW, 'utf8');

    expect(workflow).toContain('pull_request:');
    expect(workflow).not.toContain('issues: write');
    expect(workflow).not.toContain('pull-requests: write');
    expect(workflow).toContain('concurrency:');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.head.sha }}');
    expect(workflow.indexOf('run: npm ci')).toBeLessThan(workflow.indexOf('uses: ./actions/pr-impact'));
    expect(workflow.indexOf('run: npm run build')).toBeLessThan(workflow.indexOf('uses: ./actions/pr-impact'));
    expect(workflow).toContain('uses: ./actions/pr-impact');
    expect(workflow).toContain('codegraph-version: "file:."');
    expect(workflow).toContain('narrative: "off"');
    expect(workflow).toContain('fail-on-callers: ""');
    expect(workflow).toContain('fail-on-hubs: "false"');
    expect(workflow).not.toContain('pull_request_target');
  });

  it('pins external GitHub Actions to full commit SHAs', () => {
    const action = readAction();
    const readme = fs.readFileSync(ACTION_README, 'utf8');
    const workflow = fs.readFileSync(DOGFOOD_WORKFLOW, 'utf8');
    const combined = `${action}\n${workflow}`;
    const externalUses = [...combined.matchAll(/uses:\s+(actions\/[^\s@]+)@([^\s]+)/g)]
      .map((match) => ({ action: match[1], ref: match[2] }));

    expect(externalUses).toEqual([
      { action: 'actions/cache/restore', ref: '0057852bfaa89a56745cba8c7296529d2fc39830' },
      { action: 'actions/upload-artifact', ref: 'ea165f8d65b6e75b540449e92b4886f43607fa02' },
      { action: 'actions/cache/save', ref: '0057852bfaa89a56745cba8c7296529d2fc39830' },
      { action: 'actions/checkout', ref: '34e114876b0b11c390a56381ad16ebd13914f8d5' },
    ]);
    for (const { ref } of externalUses) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(readme).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
    expect(readme).not.toContain('actions/checkout@v4');
  });
});

const typeSurface: {
  inputs: ActionInputs;
  context: PullRequestContext;
  detector: DetectorResult;
  delivery: DeliveryResult;
  narrative: NarrativeResult;
  conclusion: FinalConclusion;
} = {
  inputs: {
    codegraphVersion: '1.4.1',
    baseRef: 'main',
    failOnCallers: null,
    failOnHubs: false,
    callerDepth: 1,
    maxCallers: 20,
    narrative: 'off',
  },
  context: {
    repository: 'racecraft-lab/codegraph',
    pullNumber: 20,
    baseRef: 'main',
    headSha: 'head',
    mergeBase: null,
    runId: '200',
    runAttempt: '1',
    isForkLike: false,
    tokenPermissions: {
      contentsRead: true,
      issuesWrite: false,
      pullRequestsWrite: false,
    },
  },
  detector: {
    schemaVersion: 1,
    summary: {
      status: 'clean',
      baseRef: 'main',
      changedSymbolCount: 0,
      unmappedHunkCount: 0,
      callerCount: 0,
      affectedFlowCount: 0,
      riskCount: 0,
      warningCount: 0,
    },
    exitCode: 0,
    changedSymbols: [],
    unmappedHunks: [],
    callers: [],
    affectedFlows: {
      state: 'empty',
      items: [],
      truncated: false,
    },
    risks: [],
    warnings: [],
    limits: {},
  },
  delivery: {
    status: 'fallback',
    comment: 'skipped',
    summary: 'written',
    artifact: 'pending',
    currentCommentId: null,
    duplicateCommentIds: [],
    failedDuplicateCommentIds: [],
    reportPath: 'pr-impact-report.md',
    commentUrl: '',
  },
  narrative: {
    status: 'disabled',
    text: null,
    handle: null,
  },
  conclusion: 'pass',
};

void typeSurface;
