import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { runAction } from '../actions/pr-impact/run';
import { prImpactDetectorResults, prImpactGitHubEvent } from './fixtures/pr-impact';

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

describe('PR impact result matrix', () => {
  function baseDeps(tmp: string, detector: unknown, extraEnv: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
    const eventPath = path.join(tmp, 'event.json');
    fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
    return {
      env: {
        INPUT_CODEGRAPH_VERSION: '1.4.1',
        INPUT_BASE_REF: 'main',
        PR_IMPACT_CACHE_STATUS: 'warm-valid',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'racecraft-lab/codegraph',
        GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
        GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
        PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000001',
        ...extraEnv,
      },
      stdout: { write: () => true },
      stderr: { write: () => true },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      appendFileSync: fs.appendFileSync,
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      readFileSync: fs.readFileSync,
      execFileSync: () => JSON.stringify(detector),
      fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
      ...overrides,
    } as any;
  }

  async function runMatrixCase(detector: unknown, extraEnv: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-matrix-'));
    const result = await runAction(baseDeps(tmp, detector, extraEnv, overrides));
    const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
    const reportPath = path.join(tmp, 'report.md');
    const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
    fs.rmSync(tmp, { recursive: true, force: true });
    return { outputs, report, result };
  }

  it('maps clean, ordinary impact, threshold breach, unavailable analysis, and report-unavailable states', async () => {
    await expect(runMatrixCase(prImpactDetectorResults.clean)).resolves.toMatchObject({
      outputs: {
        'summary-status': 'clean',
        conclusion: 'pass',
        'threshold-breached': 'false',
      },
    });

    await expect(runMatrixCase(prImpactDetectorResults.impact)).resolves.toMatchObject({
      outputs: {
        'summary-status': 'impact',
        conclusion: 'pass',
        'threshold-breached': 'false',
      },
    });

    await expect(runMatrixCase(prImpactDetectorResults.thresholdBreach)).resolves.toMatchObject({
      outputs: {
        'summary-status': 'threshold_breach',
        conclusion: 'fail-threshold',
        'threshold-breached': 'true',
      },
    });

    await expect(runMatrixCase(prImpactDetectorResults.unavailable)).resolves.toMatchObject({
      outputs: {
        'summary-status': 'unavailable',
        conclusion: 'fail-analysis-unavailable',
      },
    });

    await expect(runMatrixCase(prImpactDetectorResults.clean, {}, {
      appendFileSync: (target: fs.PathOrFileDescriptor, contents: string | Uint8Array) => {
        if (String(target).endsWith('summary.md')) throw new Error('summary unavailable');
        fs.appendFileSync(target, contents);
      },
      writeFileSync: (target: fs.PathOrFileDescriptor, contents: string | Uint8Array) => {
        if (String(target).endsWith('report.md')) throw new Error('report unavailable');
        fs.writeFileSync(target, contents);
      },
    })).resolves.toMatchObject({
      outputs: {
        'summary-status': 'clean',
        conclusion: 'fail-report-unavailable',
        'delivery-status': 'failed',
      },
    });
  });

  it('maps threshold inputs to fail-on detector arguments', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-threshold-'));
    const calls: string[][] = [];
    try {
      await runAction(baseDeps(tmp, prImpactDetectorResults.impact, {
        INPUT_FAIL_ON_CALLERS: '5',
        INPUT_FAIL_ON_HUBS: 'true',
      }, {
        execFileSync: (_command: string, args: string[]) => {
          calls.push(args);
          return JSON.stringify(prImpactDetectorResults.impact);
        },
      }));

      expect(calls[0]).toEqual(expect.arrayContaining(['--fail-on', 'callers>5,hub']));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('publishes an unavailable report and failing conclusion for detector exit 3', async () => {
    const { outputs, report } = await runMatrixCase(prImpactDetectorResults.unavailable);

    expect(outputs['detector-exit-code']).toBe('3');
    expect(outputs.conclusion).toBe('fail-analysis-unavailable');
    expect(report).toContain('- Detector status: unavailable');
    expect(report).toContain('- Final conclusion: fail-analysis-unavailable');
    expect(report).toContain('Index unavailable');
  });

  it('fails closed when detector JSON is schema-drifted or internally inconsistent', async () => {
    for (const detector of [
      { summary: { status: 'clean' }, exitCode: 0 },
      { ...prImpactDetectorResults.clean, exitCode: 1 },
      { ...prImpactDetectorResults.clean, changedSymbols: undefined },
      {
        ...prImpactDetectorResults.clean,
        changedSymbols: [
          {
            id: 'symbol:unexpected',
            qualifiedName: 'unexpected',
            kind: 'function',
            filePath: 'src/unexpected.ts',
            changeType: 'modified',
          },
        ],
      },
      {
        ...prImpactDetectorResults.clean,
        summary: {
          ...prImpactDetectorResults.clean.summary,
          riskCount: 1,
        },
        risks: [
          {
            code: 'threshold-breach',
            severity: 'error',
            targetId: 'symbol:unexpected',
            policy: 'callers>0',
          },
        ],
      },
      {
        ...prImpactDetectorResults.impact,
        summary: {
          ...prImpactDetectorResults.impact.summary,
          status: 'clean',
        },
        exitCode: 0,
      },
    ]) {
      const { outputs, report } = await runMatrixCase(detector);

      expect(outputs['summary-status']).toBe('unavailable');
      expect(outputs['detector-exit-code']).toBe('3');
      expect(outputs.conclusion).toBe('fail-analysis-unavailable');
      expect(report).toContain('Detector returned malformed detect-changes JSON.');
    }
  });

  it('does not let comment failure rewrite deterministic impact status or conclusion', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-matrix-'));
    try {
      const eventPath = path.join(tmp, 'event.json');
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'main',
          INPUT_FAIL_ON_CALLERS: '1',
          PR_IMPACT_CACHE_STATUS: 'warm-valid',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: 'racecraft-lab/codegraph',
          GITHUB_TOKEN: 'read-only-token',
          PR_IMPACT_TOKEN_WRITE: 'true',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
          PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000001',
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        mkdirSync: fs.mkdirSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: fs.readFileSync,
        execFileSync: () => JSON.stringify(prImpactDetectorResults.thresholdBreach),
        fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
      } as any);

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['summary-status']).toBe('threshold_breach');
      expect(outputs['detector-exit-code']).toBe('2');
      expect(outputs.conclusion).toBe('fail-threshold');
      expect(outputs['threshold-breached']).toBe('true');
      expect(outputs['delivery-status']).toBe('fallback');
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Final conclusion: fail-threshold');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
