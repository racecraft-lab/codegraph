import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { runAction } from '../actions/pr-impact/run';
import { prImpactDetectorResults, prImpactGitHubEvent, prImpactWarmCacheSamples } from './fixtures/pr-impact';

function outputMap(raw: string): Record<string, string> {
  return Object.fromEntries(raw.trim().split('\n').filter(Boolean).map((line) => {
    const eq = line.indexOf('=');
    return [line.slice(0, eq), line.slice(eq + 1)];
  }));
}

async function runWithCacheStatus(cacheStatus: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-cache-'));
  try {
    const eventPath = path.join(tmp, 'event.json');
    fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
    const result = await runAction({
      env: {
        INPUT_CODEGRAPH_VERSION: '1.4.1',
        INPUT_BASE_REF: 'main',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
        GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
        PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        PR_IMPACT_CACHE_STATUS: cacheStatus,
      },
      stdout: { write: () => true },
      stderr: { write: () => true },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      appendFileSync: fs.appendFileSync,
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      readFileSync: fs.readFileSync,
      execFileSync: () => JSON.stringify(prImpactDetectorResults.impact),
      fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    } as any);
    const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
    const report = fs.readFileSync(path.join(tmp, 'report.md'), 'utf8');
    return { result, outputs, report };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('PR impact cache handling', () => {
  it('records warm-valid, miss, stale, corrupt, incompatible, rebuilt, and unavailable cache states', async () => {
    for (const state of ['warm-valid', 'miss', 'stale', 'corrupt', 'incompatible', 'rebuilt'] as const) {
      const { outputs, report } = await runWithCacheStatus(state);
      expect(outputs['cache-status']).toBe(state);
      expect(outputs.conclusion).toBe('pass');
      expect(report).toContain(`- Cache status: ${state}`);
    }

    const unavailable = await runWithCacheStatus('unavailable');
    expect(unavailable.outputs['cache-status']).toBe('unavailable');
    expect(unavailable.outputs['summary-status']).toBe('unavailable');
    expect(unavailable.outputs.conclusion).toBe('fail-analysis-unavailable');
  });

  it('validates at least five eligible warm-cache samples with median completion at or below three minutes', () => {
    const eligible = prImpactWarmCacheSamples.filter((sample) => sample.eligible && sample.cacheStatus === 'warm-valid');
    const durations = eligible.map((sample) => sample.durationSeconds).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];

    expect(eligible).toHaveLength(5);
    expect(median).toBeLessThanOrEqual(180);
  });
});
