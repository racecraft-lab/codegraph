import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { runAction } from '../actions/pr-impact/run';
import { prImpactDetectorResults, prImpactForkEvent, prImpactGitHubEvent } from './fixtures/pr-impact';

function outputMap(raw: string): Record<string, string> {
  return Object.fromEntries(raw.trim().split('\n').filter(Boolean).map((line) => {
    const eq = line.indexOf('=');
    return [line.slice(0, eq), line.slice(eq + 1)];
  }));
}

async function runNarrative(status: string, event: unknown = prImpactGitHubEvent, commentWritable = true) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-narrative-'));
  try {
    const eventPath = path.join(tmp, 'event.json');
    fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
    const comments: Array<{ id: number; body: string; created_at: string; html_url: string; user: { login: string } }> = [];
    await runAction({
      env: {
        INPUT_CODEGRAPH_VERSION: '1.4.1',
        INPUT_BASE_REF: 'main',
        INPUT_NARRATIVE: status === 'disabled' ? 'off' : 'trusted',
        PR_IMPACT_CACHE_STATUS: 'warm-valid',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_TOKEN: 'token',
        PR_IMPACT_TOKEN_WRITE: 'true',
        GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
        GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
        PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        PR_IMPACT_NARRATIVE_SOURCE: status,
        PR_IMPACT_NARRATIVE_TEXT: 'Narrative prose only.',
      },
      stdout: { write: () => true },
      stderr: { write: () => true },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      appendFileSync: fs.appendFileSync,
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      readFileSync: fs.readFileSync,
      execFileSync: () => JSON.stringify(prImpactDetectorResults.impact),
      fetch: async (_url: string, init?: { method?: string; body?: string }) => {
        if (!commentWritable) return { ok: false, status: 403, json: async () => ({}) };
        const method = init?.method ?? 'GET';
        if (method === 'GET') return { ok: true, status: 200, json: async () => comments };
        if (method === 'POST') {
          comments.push({
            id: 1,
            body: String(init?.body ?? ''),
            created_at: '2026-07-15T00:00:00Z',
            html_url: 'https://example.test/comment/1',
            user: { login: 'github-actions[bot]' },
          });
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              body: String(init?.body ?? ''),
              html_url: 'https://example.test/comment/1',
              user: { login: 'github-actions[bot]' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 1,
            body: String(init?.body ?? ''),
            html_url: 'https://example.test/comment/1',
            user: { login: 'github-actions[bot]' },
          }),
        };
      },
    } as any);
    return {
      outputs: outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8')),
      report: fs.readFileSync(path.join(tmp, 'report.md'), 'utf8'),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('PR impact narrative behavior', () => {
  it('keeps disabled, suppressed, unavailable, fallback, pending, and appended narrative from changing deterministic facts', async () => {
    const cases: Array<{ requested: string; expected: string; event: unknown; commentWritable?: boolean }> = [
      { requested: 'disabled', expected: 'disabled', event: prImpactGitHubEvent },
      { requested: 'fallback', expected: 'fallback', event: prImpactGitHubEvent },
      { requested: 'pending', expected: 'pending', event: prImpactGitHubEvent },
      { requested: 'appended', expected: 'appended', event: prImpactGitHubEvent },
      { requested: 'unavailable', expected: 'unavailable', event: prImpactGitHubEvent },
      { requested: 'appended', expected: 'suppressed', event: prImpactForkEvent },
      { requested: 'appended', expected: 'suppressed', event: prImpactGitHubEvent, commentWritable: false },
    ];

    for (const testCase of cases) {
      const { outputs, report } = await runNarrative(testCase.requested, testCase.event, testCase.commentWritable ?? true);
      expect(outputs['summary-status']).toBe('impact');
      expect(outputs.conclusion).toBe('pass');
      expect(outputs['narrative-status']).toBe(testCase.expected);
      if (['fallback', 'pending', 'appended'].includes(testCase.expected)) {
        expect(report).toContain('## Narrative appendix');
        expect(report).toContain('prose-only');
      }
    }
  });
});
