import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ACTION_MARKER, runAction } from '../actions/pr-impact/run';
import { prImpactDetectorResults, prImpactGitHubEvent } from './fixtures/pr-impact';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-delivery-'));
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

function deps(tmp: string, overrides: Record<string, unknown> = {}) {
  const eventPath = path.join(tmp, 'event.json');
  const outputPath = path.join(tmp, 'outputs.txt');
  const summaryPath = path.join(tmp, 'summary.md');
  const reportPath = path.join(tmp, 'report.md');
  fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');

  return {
    env: {
      INPUT_CODEGRAPH_VERSION: '1.4.1',
      INPUT_BASE_REF: 'main',
      INPUT_CALLER_DEPTH: '2',
      INPUT_MAX_CALLERS: '40',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'racecraft-lab/codegraph',
      GITHUB_RUN_ID: '200',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_SHA: 'head-sha',
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      PR_IMPACT_REPORT_PATH: reportPath,
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
    ...overrides,
  } as any;
}

describe('PR impact report delivery', () => {
  it('renders the deterministic report contract sections and run metadata', async () => {
    const tmp = tmpDir();
    try {
      const result = await runAction(deps(tmp, {
        execFileSync: (_cmd: string, args: string[]) => {
          return args.includes('json')
            ? JSON.stringify(prImpactDetectorResults.impact)
            : '## Detect Changes\n\nMarkdown detector payload';
        },
      }));

      const report = fs.readFileSync(path.join(tmp, 'report.md'), 'utf8');
      expect(report).toBe(result.report);
      expect(report).toContain(ACTION_MARKER);
      expect(report).toContain('## Run metadata');
      expect(report).toContain('- Repository: racecraft-lab/codegraph');
      expect(report).toContain('- Pull request: #20');
      expect(report).toContain('- Base ref: main');
      expect(report).toContain('- Head SHA: 0000000000000000000000000000000000000002');
      expect(report).toContain('- Merge base:');
      expect(report).toContain('## Summary');
      expect(report).toContain('- Detector status: impact');
      expect(report).toContain('- Final conclusion: pass');
      expect(report).toContain('## Changed symbols');
      expect(report).toContain('runAction');
      expect(report).toContain('## Impacted callers');
      expect(report).toContain('## Affected flows');
      expect(report).toContain('## Risks');
      expect(report).toContain('## Warnings');
      expect(report).toContain('## Limits');
      expect(report).toContain('## Fallback delivery note');

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['summary-status']).toBe('impact');
      expect(outputs.conclusion).toBe('pass');
      expect(outputs['delivery-status']).toBe('fallback');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('creates one action-owned sticky comment when none exists', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    try {
      await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
          if ((init?.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
          return { ok: true, status: 201, json: async () => ({ id: 100, html_url: 'https://example.test/comment/100' }) };
        },
      }));

      const post = calls.find((call) => call.method === 'POST');
      expect(post?.url).toContain('/repos/racecraft-lab/codegraph/issues/20/comments');
      expect(post?.body).toContain(ACTION_MARKER);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('updates the newest action-owned sticky comment and retires older duplicates', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    try {
      await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
          if ((init?.method ?? 'GET') === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => [
                { id: 10, body: `${ACTION_MARKER}\nold`, created_at: '2026-07-14T00:00:00Z', html_url: 'old' },
                { id: 11, body: `${ACTION_MARKER}\nnew`, created_at: '2026-07-15T00:00:00Z', html_url: 'new' },
                { id: 12, body: 'unrelated', created_at: '2026-07-15T00:00:01Z', html_url: 'unrelated' },
              ],
            };
          }
          return { ok: true, status: 200, json: async () => ({ id: 11, html_url: 'new' }) };
        },
      }));

      const patches = calls.filter((call) => call.method === 'PATCH');
      expect(patches.map((call) => call.url)).toEqual([
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/11',
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/10',
      ]);
      expect(patches[0]?.body).toContain('runAction');
      expect(patches[1]?.body).toContain('Retired duplicate');
      expect(calls.some((call) => call.url.includes('/comments/12'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
