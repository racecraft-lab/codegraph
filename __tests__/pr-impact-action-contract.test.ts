import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
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

const ROOT = path.resolve(__dirname, '..');
const ACTION_YML = path.join(ROOT, 'actions/pr-impact/action.yml');
const DOGFOOD_WORKFLOW = path.join(ROOT, '.github/workflows/pr-impact.yml');
const PACKAGE_JSON = path.join(ROOT, 'package.json');

const INPUTS = [
  'codegraph-version',
  'base-ref',
  'fail-on-callers',
  'fail-on-hubs',
  'caller-depth',
  'max-callers',
  'narrative',
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
    const pkg = readPackage();

    for (const input of INPUTS) {
      expect(action).toMatch(new RegExp(`^  ${input}:`, 'm'));
      expect(action).toContain(`INPUT_${input.toUpperCase().replaceAll('-', '_')}:`);
    }

    for (const output of OUTPUTS) {
      expect(action).toMatch(new RegExp(`^  ${output}:`, 'm'));
      expect(action).toContain(`steps.pr-impact.outputs.${output}`);
    }

    expect(action).toContain(`default: "${pkg.version}"`);
    expect(action).toContain('npm install --global "@colbymchenry/codegraph@${{ inputs.codegraph-version }}"');
    expect(action).toContain('node "${{ github.action_path }}/dist/run.mjs"');
    expect(action).toContain('PR_IMPACT_CACHE_RESTORE_HIT:');
    expect(action).toContain("steps.pr-impact.outputs.cache-status == 'rebuilt'");
    expect(pkg.files).toContain('actions');
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

  it('invokes detect-changes with base-ref, bounds, threshold policy, JSON capture, and markdown capture', async () => {
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

      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.command).toBe('codegraph');
        expect(call.args).toEqual(expect.arrayContaining([
          'detect-changes',
          '--mode', 'base-ref',
          '--base-ref', 'origin/main',
          '--caller-depth', '3',
          '--max-callers', '50',
          '--fail-on', 'callers>10,hub',
        ]));
      }
      expect(calls[0]?.args).toEqual(expect.arrayContaining(['--format', 'json']));
      expect(calls[1]?.args).toEqual(expect.arrayContaining(['--format', 'markdown']));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('declares the advisory pull-request dogfood workflow without threshold or narrative escalation', () => {
    const workflow = fs.readFileSync(DOGFOOD_WORKFLOW, 'utf8');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('uses: ./actions/pr-impact');
    expect(workflow).toContain('narrative: "off"');
    expect(workflow).toContain('fail-on-callers: ""');
    expect(workflow).toContain('fail-on-hubs: "false"');
    expect(workflow).not.toContain('pull_request_target');
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
    isForkLike: false,
    tokenPermissions: {
      contentsRead: true,
      issuesWrite: false,
      pullRequestsWrite: false,
    },
  },
  detector: {
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
    artifact: 'uploaded',
    currentCommentId: null,
    duplicateCommentIds: [],
    reportPath: 'pr-impact-report.md',
  },
  narrative: {
    status: 'disabled',
    text: null,
    handle: null,
  },
  conclusion: 'pass',
};

void typeSurface;
