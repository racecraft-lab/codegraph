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
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: 'racecraft-lab/codegraph',
          GITHUB_TOKEN: 'read-only-token',
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
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
