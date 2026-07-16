import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ACTION_MARKER, runAction } from '../actions/pr-impact/run';
import { prImpactDetectorResults, prImpactForkEvent, prImpactGitHubEvent } from './fixtures/pr-impact';

const CURRENT_RUN_MARKER = '<!-- codegraph-pr-impact-run:200:1:0000000000000000000000000000000000000002 -->';

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
      PR_IMPACT_CACHE_STATUS: 'warm-valid',
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

function depsForEvent(tmp: string, event: unknown, overrides: Record<string, unknown> = {}) {
  const base = deps(tmp);
  const eventPath = path.join(tmp, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const overrideEnv = (overrides.env ?? {}) as Record<string, string>;
  return {
    ...base,
    ...overrides,
    env: {
      ...base.env,
      GITHUB_EVENT_PATH: eventPath,
      ...overrideEnv,
    },
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
      expect(report).toContain('- Action run: 200');
      expect(report).toContain('- Run attempt: 1');
      expect(report).toContain('- Repository: racecraft-lab/codegraph');
      expect(report).toContain('- Pull request: #20');
      expect(report).toContain('- Base ref: main');
      expect(report).toContain('- Head SHA: 0000000000000000000000000000000000000002');
      expect(report).toContain('- Merge base:');
      expect(report).toContain('## Summary');
      expect(report).toContain('- Detector status: impact');
      expect(report).toContain('- Final conclusion: pass');
      expect(report).toContain('- Threshold breached: false');
      expect(report).toContain('## Changed symbols');
      expect(report).toContain('runAction');
      expect(report).toContain('## Impacted callers');
      expect(report).toContain('## Affected flows');
      expect(report).toContain('## Risks');
      expect(report).toContain('## Warnings');
      expect(report).toContain('## Limits');
      expect(report).toContain('## Fallback delivery note');
      expect(fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8')).toContain('- Delivery status: fallback');

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['summary-status']).toBe('impact');
      expect(outputs.conclusion).toBe('pass');
      expect(outputs['delivery-status']).toBe('fallback');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('renders normalized limits returned by the detector', async () => {
    const tmp = tmpDir();
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          INPUT_CALLER_DEPTH: '99',
          INPUT_MAX_CALLERS: '0',
        },
        execFileSync: () => JSON.stringify({
          ...prImpactDetectorResults.impact,
          limits: {
            ...prImpactDetectorResults.impact.limits,
            callerDepth: 3,
            maxCallers: 1,
          },
        }),
      }));

      expect(result.report).toContain('- Caller depth: 3');
      expect(result.report).toContain('- Max callers: 1');
      expect(result.report).not.toContain('- Caller depth: 99');
      expect(result.report).not.toContain('- Max callers: 0');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('escapes PR-controlled Markdown fields in bot-authored reports', async () => {
    const tmp = tmpDir();
    try {
      const result = await runAction(deps(tmp, {
        execFileSync: () => JSON.stringify({
          ...prImpactDetectorResults.impact,
          summary: {
            ...prImpactDetectorResults.impact.summary,
            riskCount: 1,
          },
          changedSymbols: [{
            qualifiedName: 'bad\n## Injected | \\ <b>',
            kind: 'function',
            filePath: 'src/a|b\\c\nmalicious.ts',
            changeType: 'modified',
          }],
          callers: [{
            qualifiedName: 'caller*name*',
            filePath: 'src/caller[link].ts',
            depth: 1,
          }],
          affectedFlows: {
            state: 'available',
            items: [{
              flowId: 'flow:bad',
              name: 'flow<script>\n# fake',
              entryKind: 'action',
              stepCount: 1,
              truncated: false,
            }],
            truncated: false,
          },
          risks: [{
            code: 'risk|pipe',
            message: 'contains <html>\n## heading',
          }],
        }),
      }));

      expect(result.report).not.toContain('\n## Injected');
      expect(result.report).not.toContain('<b>');
      expect(result.report).not.toContain('<script>');
      expect(result.report).not.toContain('\n# fake');
      expect(result.report).toContain('bad ↵ \\#\\# Injected \\| \\\\ &lt;b&gt;');
      expect(result.report).toContain('src/a\\|b\\\\c ↵ malicious.ts');
      expect(result.report).toContain('caller\\*name\\*');
      expect(result.report).toContain('src/caller\\[link\\].ts');
      expect(result.report).toContain('flow&lt;script&gt; ↵ \\# fake');
      expect(result.report).toContain('contains &lt;html&gt;\\\\n\\#\\# heading');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('renders unmapped hunks so path-only or no-symbol impacts are visible', async () => {
    const tmp = tmpDir();
    try {
      const result = await runAction(deps(tmp, {
        execFileSync: () => JSON.stringify({
          ...prImpactDetectorResults.impact,
          summary: {
            ...prImpactDetectorResults.impact.summary,
            changedSymbolCount: 0,
            unmappedHunkCount: 2,
            callerCount: 0,
            affectedFlowCount: 0,
          },
          changedSymbols: [],
          unmappedHunks: [{
            hunkId: 'h1',
            oldPath: 'docs/old.md',
            newPath: 'docs/new.md',
            newStart: 12,
            newLines: 3,
            reason: 'no-symbol-span',
            message: 'Path-only rename or move is reported without mapped symbol impact.',
          }, {
            hunkId: 'h2',
            oldPath: 'src/deleted.ts',
            newPath: null,
            oldStart: 44,
            oldLines: 2,
            newStart: 0,
            newLines: 0,
            reason: 'deleted-without-span',
            message: 'Deleted hunk has no mapped symbol span.',
          }],
          callers: [],
          affectedFlows: {
            state: 'empty',
            items: [],
            truncated: false,
          },
        }),
      }));

      expect(result.report).toContain('## Unmapped hunks');
      expect(result.report).toContain('docs/new.md:12+3');
      expect(result.report).toContain('src/deleted.ts:44+2');
      expect(result.report).toContain('no-symbol-span');
      expect(result.report).toContain('Path-only rename or move');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not abort report delivery when detector arrays contain malformed entries', async () => {
    const tmp = tmpDir();
    try {
      const result = await runAction(deps(tmp, {
        execFileSync: () => JSON.stringify({
          ...prImpactDetectorResults.impact,
          summary: {
            ...prImpactDetectorResults.impact.summary,
            unmappedHunkCount: 1,
            riskCount: 1,
            warningCount: 1,
          },
          changedSymbols: [null],
          unmappedHunks: [null],
          callers: [null],
          affectedFlows: {
            state: 'available',
            items: [null],
            truncated: false,
          },
          risks: [null],
          warnings: [null],
        }),
      }));

      expect(result.conclusion).toBe('pass');
      expect(result.report).toContain('## Changed symbols');
      expect(result.report).toContain('unknown path');
      expect(result.report).toContain('## Unmapped hunks');
      expect(result.report).toContain('unknown path');
      expect(result.report).toContain('## Impacted callers');
      expect(result.report).toContain('## Risks');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('creates one action-owned sticky comment when none exists', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    let createdComment: { id: number; body: string; created_at: string; html_url: string; user: { login: string } } | null = null;
    try {
      await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
          if ((init?.method ?? 'GET') === 'GET') {
            return { ok: true, status: 200, json: async () => createdComment ? [createdComment] : [] };
          }
          if ((init?.method ?? 'GET') === 'PATCH') {
            if (createdComment) createdComment = { ...createdComment, body: String(init?.body ?? '') };
            return { ok: true, status: 200, json: async () => createdComment ?? {} };
          }
          createdComment = {
            id: 100,
            body: JSON.parse(String(init?.body ?? '{}')).body,
            created_at: '2026-07-15T00:00:00Z',
            html_url: 'https://example.test/comment/100',
            user: { login: 'github-actions[bot]' },
          };
          return {
            ok: true,
            status: 201,
            json: async () => createdComment,
          };
        },
      }));

      const post = calls.find((call) => call.method === 'POST');
      const finalPatch = calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/100'));
      expect(post?.url).toContain('/repos/racecraft-lab/codegraph/issues/20/comments');
      expect(post?.body).toContain(ACTION_MARKER);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
      expect(finalPatch?.url).toBe('https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/100');
      expect(finalPatch?.body).toContain('- Delivery status: comment');
      expect(fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8')).toContain('- Delivery status: comment');
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Delivery status: comment');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not let an older run overwrite a newer action-owned sticky comment', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
          GITHUB_RUN_ID: '200',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_SHA: 'older-head',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
          if ((init?.method ?? 'GET') === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: 300,
                  body: [
                    ACTION_MARKER,
                    '<!-- codegraph-pr-impact-run:201:1:newer-head -->',
                    '',
                    '# CodeGraph PR Impact',
                  ].join('\n'),
                  created_at: '2026-07-15T00:00:01Z',
                  html_url: 'newer',
                  user: { login: 'github-actions[bot]' },
                },
              ],
            };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        },
      }));

      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.comment).toBe('skipped');
      expect(calls.some((call) => call.method === 'PATCH' && call.url.endsWith('/300'))).toBe(false);
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('retires an updated sticky comment when a newer run appears before post-update refresh', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    let getCount = 0;
    const stickyComment = {
      id: 300,
      body: [
        ACTION_MARKER,
        '<!-- codegraph-pr-impact-run:200:1:0000000000000000000000000000000000000002 -->',
        '',
        '# CodeGraph PR Impact',
      ].join('\n'),
      created_at: '2026-07-15T00:00:01Z',
      html_url: 'sticky',
      user: { login: 'github-actions[bot]' },
    };
    const newerComment = {
      id: 301,
      body: [
        ACTION_MARKER,
        '<!-- codegraph-pr-impact-run:201:1:newer-head -->',
        '',
        '# CodeGraph PR Impact',
      ].join('\n'),
      created_at: '2026-07-15T00:00:02Z',
      html_url: 'newer',
      user: { login: 'github-actions[bot]' },
    };
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
          GITHUB_RUN_ID: '200',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_SHA: 'older-head',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          const method = init?.method ?? 'GET';
          calls.push({ method, url, body: init?.body });
          if (method === 'GET') {
            getCount += 1;
            return {
              ok: true,
              status: 200,
              json: async () => getCount === 1 ? [stickyComment] : [newerComment, stickyComment],
            };
          }
          stickyComment.body = JSON.parse(String(init?.body ?? '{}')).body;
          return { ok: true, status: 200, json: async () => stickyComment };
        },
      }));

      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.comment).toBe('skipped');
      expect(result.delivery.duplicateCommentIds).toEqual(['300']);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
      const patches = calls.filter((call) => call.method === 'PATCH');
      expect(patches.map((call) => call.url)).toEqual([
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/300',
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/300',
      ]);
      expect(patches[0]?.body).toContain('# CodeGraph PR Impact');
      expect(patches[1]?.body).toContain('Retired duplicate');
      expect(patches[1]?.body).not.toContain('- Delivery status: comment');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('retires the current run comment instead of finalizing when a newer run appears before final patch', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    let createdComment: { id: number; body: string; created_at: string; html_url: string; user: { login: string } } | null = null;
    let getCount = 0;
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
          GITHUB_RUN_ID: '200',
          GITHUB_RUN_ATTEMPT: '1',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          const method = init?.method ?? 'GET';
          calls.push({ method, url, body: init?.body });
          if (method === 'GET') {
            getCount += 1;
            const newerComment = {
              id: 401,
              body: [
                ACTION_MARKER,
                '<!-- codegraph-pr-impact-run:201:1:0000000000000000000000000000000000000002 -->',
                '',
                '# CodeGraph PR Impact',
              ].join('\n'),
              created_at: '2026-07-15T00:00:03Z',
              html_url: 'newer',
              user: { login: 'github-actions[bot]' },
            };
            return {
              ok: true,
              status: 200,
              json: async () => getCount < 3
                ? (createdComment ? [createdComment] : [])
                : [newerComment, ...(createdComment ? [createdComment] : [])],
            };
          }
          if (method === 'POST') {
            createdComment = {
              id: 400,
              body: JSON.parse(String(init?.body ?? '{}')).body,
              created_at: '2026-07-15T00:00:02Z',
              html_url: 'created',
              user: { login: 'github-actions[bot]' },
            };
            return { ok: true, status: 201, json: async () => createdComment };
          }
          return { ok: true, status: 200, json: async () => ({ id: Number(url.split('/').pop()), html_url: 'patched' }) };
        },
      }));

      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.comment).toBe('failed');
      expect(result.delivery.currentCommentId).toBeNull();
      expect(result.delivery.commentUrl).toBe('');
      expect(result.delivery.duplicateCommentIds).toEqual(['400']);
      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['comment-url']).toBe('');
      const patches = calls.filter((call) => call.method === 'PATCH');
      expect(patches.map((call) => call.url)).toEqual([
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/400',
      ]);
      expect(patches[0]?.body).toContain('Retired duplicate');
      expect(patches[0]?.body).not.toContain('- Delivery status: comment');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('records final-patch race cleanup failures in the fallback report', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    let createdComment: { id: number; body: string; created_at: string; html_url: string; user: { login: string } } | null = null;
    let getCount = 0;
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
          GITHUB_RUN_ID: '200',
          GITHUB_RUN_ATTEMPT: '1',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          const method = init?.method ?? 'GET';
          calls.push({ method, url, body: init?.body });
          if (method === 'GET') {
            getCount += 1;
            const newerComment = {
              id: 401,
              body: [
                ACTION_MARKER,
                '<!-- codegraph-pr-impact-run:201:1:0000000000000000000000000000000000000002 -->',
                '',
                '# CodeGraph PR Impact',
              ].join('\n'),
              created_at: '2026-07-15T00:00:03Z',
              html_url: 'newer',
              user: { login: 'github-actions[bot]' },
            };
            return {
              ok: true,
              status: 200,
              json: async () => getCount < 3
                ? (createdComment ? [createdComment] : [])
                : [newerComment, ...(createdComment ? [createdComment] : [])],
            };
          }
          if (method === 'POST') {
            createdComment = {
              id: 400,
              body: JSON.parse(String(init?.body ?? '{}')).body,
              created_at: '2026-07-15T00:00:02Z',
              html_url: 'created',
              user: { login: 'github-actions[bot]' },
            };
            return { ok: true, status: 201, json: async () => createdComment };
          }
          return { ok: false, status: 500, json: async () => ({}) };
        },
      }));

      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.failedDuplicateCommentIds).toEqual(['400']);
      expect(result.delivery.duplicateCommentIds).toEqual([]);
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Duplicate cleanup failures: 1');
      const patches = calls.filter((call) => call.method === 'PATCH');
      expect(patches.map((call) => call.url)).toEqual([
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/400',
      ]);
      expect(patches[0]?.body).toContain('Retired duplicate');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('creates a current-run sticky comment without overwriting older active comments', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const comments = [
      { id: 10, body: `${ACTION_MARKER}\nold`, created_at: '2026-07-14T00:00:00Z', html_url: 'old', user: { login: 'github-actions[bot]' } },
      { id: 11, body: `${ACTION_MARKER}\nnew`, created_at: '2026-07-15T00:00:00Z', html_url: 'new', user: { login: 'github-actions[bot]' } },
      { id: 12, body: 'unrelated', created_at: '2026-07-15T00:00:01Z', html_url: 'unrelated', user: { login: 'github-actions[bot]' } },
      { id: 13, body: `${ACTION_MARKER}\nspoofed`, created_at: '2026-07-15T00:00:02Z', html_url: 'spoofed', user: { login: 'random-user' } },
    ];
    try {
      await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
          if ((init?.method ?? 'GET') === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => comments,
            };
          }
          if ((init?.method ?? 'GET') === 'POST') {
            const created = {
              id: 14,
              body: JSON.parse(String(init?.body ?? '{}')).body,
              created_at: '2026-07-15T00:00:03Z',
              html_url: 'created',
              user: { login: 'github-actions[bot]' },
            };
            comments.push(created);
            return { ok: true, status: 201, json: async () => created };
          }
          const id = Number(url.split('/').pop());
          const comment = comments.find((item) => item.id === id);
          if (comment) comment.body = JSON.parse(String(init?.body ?? '{}')).body;
          return { ok: true, status: 200, json: async () => comment ?? { id, html_url: 'patched' } };
        },
      }));

      const patches = calls.filter((call) => call.method === 'PATCH');
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
      expect(patches.map((call) => call.url)).toEqual([
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/11',
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/10',
        'https://api.github.com/repos/racecraft-lab/codegraph/issues/comments/14',
      ]);
      expect(patches[0]?.body).toContain('Retired duplicate');
      expect(patches[1]?.body).toContain('Retired duplicate');
      expect(patches[2]?.body).toContain('- Delivery status: comment');
      expect(calls.some((call) => call.url.includes('/comments/12'))).toBe(false);
      expect(calls.some((call) => call.url.includes('/comments/13'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('records duplicate cleanup failures without hiding successful current comment delivery', async () => {
    const tmp = tmpDir();
    const comments = [
      { id: 10, body: `${ACTION_MARKER}\nold`, created_at: '2026-07-14T00:00:00Z', html_url: 'old', user: { login: 'github-actions[bot]' } },
      { id: 11, body: `${ACTION_MARKER}\n${CURRENT_RUN_MARKER}\nnew`, created_at: '2026-07-15T00:00:00Z', html_url: 'new', user: { login: 'github-actions[bot]' } },
    ];
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          if ((init?.method ?? 'GET') === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => comments,
            };
          }
          const id = Number(url.split('/').pop());
          const comment = comments.find((item) => item.id === id);
          if (comment) comment.body = JSON.parse(String(init?.body ?? '{}')).body;
          return {
            ok: !url.endsWith('/10'),
            status: url.endsWith('/10') ? 500 : 200,
            json: async () => comment ?? { id, html_url: 'patched' },
          };
        },
      }));

      expect(result.delivery.status).toBe('comment');
      expect(result.delivery.currentCommentId).toBe('11');
      expect(result.delivery.duplicateCommentIds).toEqual([]);
      expect(result.delivery.failedDuplicateCommentIds).toEqual(['10']);
      expect(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')).toContain('- Duplicate cleanup failures: 1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not reuse retired duplicate comments as the current sticky comment', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const comments = [
      {
        id: 20,
        body: `${ACTION_MARKER}\n<!-- codegraph-pr-impact-retired -->\n\n_Retired duplicate CodeGraph PR impact report._`,
        created_at: '2026-07-15T00:00:05Z',
        html_url: 'retired',
        user: { login: 'github-actions[bot]' },
      },
      { id: 21, body: `${ACTION_MARKER}\nold active`, created_at: '2026-07-15T00:00:00Z', html_url: 'active', user: { login: 'github-actions[bot]' } },
    ];
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          const method = init?.method ?? 'GET';
          calls.push({ method, url, body: init?.body });
          if (method === 'GET') {
            return { ok: true, status: 200, json: async () => comments };
          }
          if (method === 'POST') {
            const created = {
              id: 22,
              body: JSON.parse(String(init?.body ?? '{}')).body,
              created_at: '2026-07-15T00:00:06Z',
              html_url: 'created',
              user: { login: 'github-actions[bot]' },
            };
            comments.push(created);
            return { ok: true, status: 201, json: async () => created };
          }
          const id = Number(url.split('/').pop());
          const comment = comments.find((item) => item.id === id);
          if (comment) comment.body = JSON.parse(String(init?.body ?? '{}')).body;
          return { ok: true, status: 200, json: async () => comment ?? { id, html_url: 'patched' } };
        },
      }));

      expect(result.delivery.status).toBe('comment');
      expect(result.delivery.currentCommentId).toBe('22');
      expect(calls.some((call) => call.method === 'PATCH' && call.url.endsWith('/20'))).toBe(false);
      expect(calls.some((call) => call.method === 'PATCH' && call.url.endsWith('/21'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('paginates issue comments before updating the sticky comment', async () => {
    const tmp = tmpDir();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const stickyComment = { id: 101, body: `${ACTION_MARKER}\n${CURRENT_RUN_MARKER}\ncurrent`, created_at: '2026-07-15T00:00:01Z', html_url: 'current', user: { login: 'github-actions[bot]' } };
    try {
      await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'token',
          PR_IMPACT_TOKEN_WRITE: 'true',
        },
        fetch: async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
          if ((init?.method ?? 'GET') === 'GET' && url.includes('&page=1')) {
            return {
              ok: true,
              status: 200,
              json: async () => Array.from({ length: 100 }, (_, id) => ({
                id,
                body: 'unrelated',
                created_at: '2026-07-15T00:00:00Z',
                html_url: `unrelated-${id}`,
                user: { login: 'github-actions[bot]' },
              })),
            };
          }
          if ((init?.method ?? 'GET') === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => [stickyComment],
            };
          }
          stickyComment.body = JSON.parse(String(init?.body ?? '{}')).body;
          return { ok: true, status: 200, json: async () => stickyComment };
        },
      }));

      expect(calls.some((call) => call.method === 'GET' && call.url.includes('&page=1'))).toBe(true);
      expect(calls.some((call) => call.method === 'GET' && call.url.includes('&page=2'))).toBe(true);
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
      expect(calls.some((call) => call.method === 'PATCH' && call.url.endsWith('/101'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls back when GitHub comment fetch or JSON parsing fails', async () => {
    for (const fetch of [
      async () => { throw new Error('network down'); },
      async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    ]) {
      const tmp = tmpDir();
      try {
        const result = await runAction(deps(tmp, {
          env: {
            ...deps(tmp).env,
            GITHUB_TOKEN: 'token',
            PR_IMPACT_TOKEN_WRITE: 'true',
          },
          fetch,
        }));

        expect(result.delivery.status).toBe('fallback');
        expect(result.delivery.comment).toBe('permission-denied');
        expect(result.delivery.summary).toBe('written');
        expect(fs.existsSync(path.join(tmp, 'report.md'))).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  });

  it('falls back for fork-like pull requests without using comment or narrative privileges', async () => {
    const tmp = tmpDir();
    const calls: string[] = [];
    try {
      const result = await runAction(depsForEvent(tmp, prImpactForkEvent, {
        env: {
          GITHUB_TOKEN: 'token-that-must-not-be-used',
          INPUT_NARRATIVE: 'trusted',
        },
        fetch: async (url: string) => {
          calls.push(url);
          return { ok: true, status: 200, json: async () => [] };
        },
      }));

      expect(calls).toEqual([]);
      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.comment).toBe('skipped');
      expect(result.narrative.status).toBe('suppressed');
      expect(fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8')).toContain(ACTION_MARKER);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('suppresses privileged paths for same-repository read-only and Dependabot-like runs', async () => {
    for (const env of [
      { GITHUB_TOKEN: 'read-only-token', INPUT_NARRATIVE: 'trusted', PR_IMPACT_NARRATIVE_SOURCE: 'appended' },
      {
        GITHUB_TOKEN: 'token',
        INPUT_NARRATIVE: 'trusted',
        PR_IMPACT_NARRATIVE_SOURCE: 'appended',
        PR_IMPACT_TOKEN_WRITE: 'true',
        GITHUB_ACTOR: 'dependabot[bot]',
      },
    ]) {
      const tmp = tmpDir();
      const calls: string[] = [];
      try {
        const base = deps(tmp);
        const result = await runAction(deps(tmp, {
          env: {
            ...base.env,
            ...env,
          },
          fetch: async (url: string) => {
            calls.push(url);
            return { ok: true, status: 200, json: async () => [] };
          },
        }));

        expect(calls).toEqual([]);
        expect(result.delivery.status).toBe('fallback');
        expect(result.delivery.comment).toBe('skipped');
        expect(result.narrative.status).toBe('suppressed');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  });

  it('keeps summary and artifact fallback available when comment listing is denied', async () => {
    const tmp = tmpDir();
    try {
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_TOKEN: 'read-only-token',
          PR_IMPACT_TOKEN_WRITE: 'true',
        },
        fetch: async () => ({ ok: false, status: 403, json: async () => ({ message: 'Resource not accessible by integration' }) }),
      }));

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.comment).toBe('permission-denied');
      expect(result.delivery.summary).toBe('written');
      expect(result.delivery.artifact).toBe('pending');
      expect(outputs['delivery-status']).toBe('fallback');
      expect(outputs['artifact-name']).toBe('codegraph-pr-impact');
      expect(fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8')).toContain('## Summary');
      expect(fs.existsSync(path.join(tmp, 'report.md'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('emits an empty report path when report file delivery fails', async () => {
    const tmp = tmpDir();
    try {
      const reportPath = path.join(tmp, 'report.md');
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          PR_IMPACT_REPORT_PATH: reportPath,
        },
        writeFileSync: (target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
          if (String(target) === reportPath) throw new Error('disk full');
          fs.writeFileSync(target, data);
        },
      }));

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.artifact).toBe('failed');
      expect(result.delivery.summary).toBe('written');
      expect(outputs['delivery-status']).toBe('fallback');
      expect(outputs['report-path']).toBe('');
      expect(fs.existsSync(reportPath)).toBe(false);
      const summary = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
      expect(summary).toContain('## Summary');
      expect(summary).toContain('- Delivery status: fallback');
      expect(summary).toContain('- Final conclusion: pass');
      expect(summary).not.toContain('- Final conclusion: fail-report-unavailable');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('treats the authoritative final report rewrite as the report-path gate', async () => {
    const tmp = tmpDir();
    try {
      const reportPath = path.join(tmp, 'report.md');
      let reportWrites = 0;
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          PR_IMPACT_REPORT_PATH: reportPath,
        },
        writeFileSync: (target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
          if (String(target) === reportPath) {
            reportWrites += 1;
            if (reportWrites === 3) throw new Error('final canonical report unavailable');
          }
          fs.writeFileSync(target, data);
        },
      }));

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(result.delivery.status).toBe('fallback');
      expect(result.delivery.artifact).toBe('failed');
      expect(result.delivery.summary).toBe('written');
      expect(result.conclusion).toBe('pass');
      expect(outputs.conclusion).toBe('pass');
      expect(outputs['report-path']).toBe('');
      const summary = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
      expect(summary).toContain('- Delivery status: fallback');
      expect(summary).toContain('- Final conclusion: pass');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails report availability when preliminary write succeeds but final report and summary writes fail', async () => {
    const tmp = tmpDir();
    try {
      const reportPath = path.join(tmp, 'report.md');
      const summaryPath = path.join(tmp, 'summary.md');
      let reportWrites = 0;
      const result = await runAction(deps(tmp, {
        env: {
          ...deps(tmp).env,
          GITHUB_STEP_SUMMARY: summaryPath,
          PR_IMPACT_REPORT_PATH: reportPath,
        },
        appendFileSync: (target: fs.PathOrFileDescriptor, data: string | Uint8Array) => {
          if (String(target) === summaryPath) throw new Error('summary unavailable');
          fs.appendFileSync(target, data);
        },
        writeFileSync: (target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
          if (String(target) === reportPath) {
            reportWrites += 1;
            if (reportWrites > 1) throw new Error('final report unavailable');
          }
          fs.writeFileSync(target, data);
        },
      }));

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(result.delivery.status).toBe('failed');
      expect(result.delivery.summary).toBe('failed');
      expect(result.delivery.artifact).toBe('failed');
      expect(result.conclusion).toBe('fail-report-unavailable');
      expect(outputs.conclusion).toBe('fail-report-unavailable');
      expect(outputs['report-path']).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
