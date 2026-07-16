import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
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
        PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000001',
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

function lockfileHash(lockfile: string): string {
  return createHash('sha256').update(lockfile).digest('hex');
}

function healthyStatus() {
  return {
    version: '1.4.1',
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    worktreeMismatch: null,
    index: {
      builtWithExtractionVersion: 24,
      currentExtractionVersion: 24,
      reindexRecommended: false,
      state: null,
    },
  };
}

function cacheMetadata(identity: Record<string, string>) {
  return {
    schemaVersion: 1,
    helperVersion: '0.1.0-spec-020',
    recordedAt: '2026-07-15T00:00:00.000Z',
    identity,
  };
}

async function runWithMetadata(metadata: unknown, options: { lockfile?: string; indexFails?: boolean; status?: unknown } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-cache-meta-'));
  const lockfile = options.lockfile ?? '{"lockfileVersion":3}';
  try {
    const eventPath = path.join(tmp, 'event.json');
    const metadataPath = path.join(tmp, 'pr-impact-cache.json');
    fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
    fs.writeFileSync(metadataPath, typeof metadata === 'string' ? metadata : JSON.stringify(metadata), 'utf8');
    const calls: string[][] = [];
    await runAction({
      env: {
        INPUT_CODEGRAPH_VERSION: '1.4.1',
        INPUT_BASE_REF: 'main',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
        GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
        PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
        PR_IMPACT_CACHE_RESTORE_HIT: 'true',
        PR_IMPACT_CACHE_METADATA_PATH: metadataPath,
        PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000001',
      },
      stdout: { write: () => true },
      stderr: { write: () => true },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      appendFileSync: fs.appendFileSync,
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      readFileSync: (target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
        if (String(target) === 'package-lock.json') return lockfile;
        return fs.readFileSync(target, options as BufferEncoding);
      },
      execFileSync: (_command: string, args: string[]) => {
        calls.push(args);
        if (args[0] === 'status') {
          return JSON.stringify(options.status ?? healthyStatus());
        }
        if (args[0] === 'index') {
          if (options.indexFails) throw new Error('index failed');
          return '';
        }
        return args.includes('json')
          ? JSON.stringify(prImpactDetectorResults.impact)
          : '## Markdown detector report';
      },
      fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    } as any);
    const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
    let updatedMetadata: unknown = null;
    try {
      updatedMetadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
    } catch {
      updatedMetadata = null;
    }
    return { outputs, calls, updatedMetadata };
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

  it('accepts restored cache metadata only when the identity matches the current comparison', async () => {
    const lockfile = '{"lockfileVersion":3}';
    const identity = {
      repository: 'racecraft-lab/codegraph',
      codegraphVersion: '1.4.1',
      baseRef: 'main',
      headSha: '0000000000000000000000000000000000000002',
      mergeBase: '0000000000000000000000000000000000000001',
      lockfileHash: lockfileHash(lockfile),
    };

    const { outputs, calls } = await runWithMetadata(cacheMetadata(identity), { lockfile });

    expect(outputs['cache-status']).toBe('warm-valid');
    expect(calls.map((args) => args[0])).not.toContain('index');
  });

  it('rebuilds stale restored cache metadata before detector analysis and records the new identity', async () => {
    const lockfile = '{"lockfileVersion":3}';
    const staleIdentity = {
      repository: 'racecraft-lab/codegraph',
      codegraphVersion: '1.4.1',
      baseRef: 'main',
      headSha: 'old-head',
      mergeBase: '0000000000000000000000000000000000000001',
      lockfileHash: lockfileHash(lockfile),
    };

    const { outputs, calls, updatedMetadata } = await runWithMetadata(cacheMetadata(staleIdentity), { lockfile });

    expect(outputs['cache-status']).toBe('rebuilt');
    expect(calls[0]).toEqual(['index']);
    expect(updatedMetadata.identity.headSha).toBe('0000000000000000000000000000000000000002');
  });

  it('initializes the CodeGraph index on a cold cache miss without leaving .gitignore noise', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-cold-cache-'));
    const originalGitignore = 'node_modules/\n.codegraph/\n';
    try {
      const eventPath = path.join(tmp, 'event.json');
      const metadataPath = path.join(tmp, 'pr-impact-cache.json');
      const gitignorePath = path.join(tmp, '.gitignore');
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      fs.writeFileSync(gitignorePath, originalGitignore, 'utf8');
      const calls: string[][] = [];

      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: '1.4.1',
          INPUT_BASE_REF: 'main',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
          PR_IMPACT_CACHE_METADATA_PATH: metadataPath,
          PR_IMPACT_GITIGNORE_PATH: gitignorePath,
          PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000001',
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        existsSync: fs.existsSync,
        mkdirSync: fs.mkdirSync,
        rmSync: fs.rmSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: (target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
          if (String(target) === 'package-lock.json') return '{"lockfileVersion":3}';
          return fs.readFileSync(target, options as BufferEncoding);
        },
        execFileSync: (_command: string, args: string[]) => {
          calls.push(args);
          if (args[0] === 'init') {
            fs.appendFileSync(gitignorePath, '.codegraph/\n', 'utf8');
            return '';
          }
          return args.includes('json')
            ? JSON.stringify(prImpactDetectorResults.impact)
            : '## Markdown detector report';
        },
        fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
      } as any);

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['cache-status']).toBe('rebuilt');
      expect(outputs.conclusion).toBe('pass');
      expect(calls.map((args) => args[0])).toEqual(['init', 'detect-changes', 'detect-changes']);
      expect(fs.readFileSync(gitignorePath, 'utf8')).toBe(originalGitignore);
      expect(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).identity.headSha).toBe('0000000000000000000000000000000000000002');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('re-indexes restored fallback cache metadata even when the cache action reports a non-exact hit', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pr-impact-restore-key-'));
    try {
      const eventPath = path.join(tmp, 'event.json');
      const metadataPath = path.join(tmp, 'pr-impact-cache.json');
      const lockfile = '{"lockfileVersion":3}';
      fs.writeFileSync(eventPath, JSON.stringify(prImpactGitHubEvent), 'utf8');
      fs.writeFileSync(metadataPath, JSON.stringify(cacheMetadata({
        repository: 'racecraft-lab/codegraph',
        codegraphVersion: '1.4.1',
        baseRef: 'main',
        headSha: 'old-head',
        mergeBase: '0000000000000000000000000000000000000001',
        lockfileHash: lockfileHash(lockfile),
      })), 'utf8');
      const calls: string[][] = [];

      await runAction({
        env: {
          INPUT_CODEGRAPH_VERSION: 'file:.',
          INPUT_BASE_REF: 'main',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: path.join(tmp, 'outputs.txt'),
          GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'),
          PR_IMPACT_REPORT_PATH: path.join(tmp, 'report.md'),
          PR_IMPACT_CACHE_RESTORE_HIT: 'false',
          PR_IMPACT_CACHE_METADATA_PATH: metadataPath,
          PR_IMPACT_MERGE_BASE: '0000000000000000000000000000000000000001',
        },
        stdout: { write: () => true },
        stderr: { write: () => true },
        now: () => new Date('2026-07-15T00:00:00.000Z'),
        appendFileSync: fs.appendFileSync,
        existsSync: fs.existsSync,
        mkdirSync: fs.mkdirSync,
        rmSync: fs.rmSync,
        writeFileSync: fs.writeFileSync,
        readFileSync: (target: fs.PathOrFileDescriptor, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
          if (String(target) === 'package-lock.json') return lockfile;
          return fs.readFileSync(target, options as BufferEncoding);
        },
        execFileSync: (_command: string, args: string[]) => {
          calls.push(args);
          if (args[0] === 'index') return '';
          return args.includes('json')
            ? JSON.stringify(prImpactDetectorResults.impact)
            : '## Markdown detector report';
        },
        fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }),
      } as any);

      const outputs = outputMap(fs.readFileSync(path.join(tmp, 'outputs.txt'), 'utf8'));
      expect(outputs['cache-status']).toBe('rebuilt');
      expect(outputs.conclusion).toBe('pass');
      expect(calls.map((args) => args[0])).toEqual(['index', 'detect-changes', 'detect-changes']);
      expect(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).identity.codegraphVersion).toBe('file:.');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rebuilds matching restored metadata when index health reports worktree mismatch or pending changes', async () => {
    const lockfile = '{"lockfileVersion":3}';
    const identity = {
      repository: 'racecraft-lab/codegraph',
      codegraphVersion: '1.4.1',
      baseRef: 'main',
      headSha: '0000000000000000000000000000000000000002',
      mergeBase: '0000000000000000000000000000000000000001',
      lockfileHash: lockfileHash(lockfile),
    };
    const unhealthy = {
      ...healthyStatus(),
      pendingChanges: { added: 0, modified: 1, removed: 0 },
      worktreeMismatch: { worktreeRoot: '/worktree', indexRoot: '/main' },
    };

    const { outputs, calls } = await runWithMetadata(cacheMetadata(identity), { lockfile, status: unhealthy });

    expect(outputs['cache-status']).toBe('rebuilt');
    expect(calls.map((args) => args[0])).toEqual(['status', 'index', 'detect-changes', 'detect-changes']);
  });

  it('emits unavailable analysis when invalid cache cannot be rebuilt', async () => {
    const { outputs, calls } = await runWithMetadata('{not json', { indexFails: true });

    expect(outputs['cache-status']).toBe('unavailable');
    expect(outputs['summary-status']).toBe('unavailable');
    expect(outputs.conclusion).toBe('fail-analysis-unavailable');
    expect(calls).toEqual([['index']]);
  });

  it('validates at least five eligible warm-cache samples with median completion at or below three minutes', () => {
    const eligible = prImpactWarmCacheSamples.filter((sample) => sample.eligible && sample.cacheStatus === 'warm-valid');
    const durations = eligible.map((sample) => sample.durationSeconds).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];

    expect(eligible).toHaveLength(5);
    expect(median).toBeLessThanOrEqual(180);
  });
});
