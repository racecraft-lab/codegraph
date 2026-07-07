import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createInitialLspStatus,
  createLspCoverageRecord,
  defaultLspPerformanceCaps,
  evaluateLspWatchBatchScope,
  isLspReasonCode,
  lspReasonCategory,
  parsePersistedLspStatus,
  recordLspChecked,
  recordLspDegradation,
  recordLspEdgeDecision,
  recordLspSkip,
  resolveLspConfig,
  serializeLspStatus,
} from '../src/lsp';

describe('LSP status contract foundation', () => {
  it('creates stable disabled-path zero-work status evidence', () => {
    const config = resolveLspConfig({ projectRoot: process.cwd(), env: {} });
    const status = createInitialLspStatus(config);
    status.servers.push({
      language: 'typescript',
      command: ['typescript-language-server', '--stdio'],
      state: 'available',
      minimumRuntimeEvidence: 'TypeScript SDK path observed when server requires it',
    });

    expect(status.enabled).toBe(false);
    expect(status.activationSource).toBe('default-off');
    expect(status.lastRunAt).toBeNull();
    expect(status.servers[0]?.minimumRuntimeEvidence).toContain('TypeScript SDK');
    expect(status.coverage).toEqual([]);
    expect(status.edgeCounts).toEqual({
      checked: 0,
      verified: 0,
      corrected: 0,
      suppressed: 0,
      skippedByReason: {},
      degraded: 0,
    });
    expect(status.performance.zeroWorkWhenDisabled).toEqual({
      commandProbes: 0,
      subprocessStarts: 0,
      jsonRpcRequests: 0,
      statusWrites: 0,
      graphMutations: 0,
    });
  });

  it('pins default performance caps and required reason codes', () => {
    expect(defaultLspPerformanceCaps()).toEqual({
      activeSessionsPerProject: 2,
      inFlightRequestsPerSession: 8,
      fullIndexSourceFilesPerLanguage: 2000,
      fullIndexWorkItemsPerLanguage: 10000,
      fullIndexBatchSize: 250,
      watchChangedSourceFilesPerBatch: 100,
      watchWorkItemsPerLanguagePerBatch: 1000,
    });

    for (const code of [
      'missing-default-command',
      'configured-command-unavailable',
      'server-crash',
      'initialize-timeout',
      'request-timeout',
      'malformed-protocol-response',
      'shutdown-failure',
      'watch-changed-files-absent',
      'watch-changed-files-unbounded',
      'watch-changed-files-cap-exceeded',
      'watch-work-cap-exceeded',
      'full-index-file-cap-exceeded',
      'full-index-work-cap-exceeded',
      'language-not-present',
      'language-not-applicable',
      'validation-only-prereq-missing',
      'future-owned',
    ]) {
      expect(isLspReasonCode(code)).toBe(true);
    }
  });

  it('categorizes unavailable, skipped, degraded, not-present, not-applicable, and validation-only reasons', () => {
    expect(lspReasonCategory('missing-default-command')).toBe('unavailable');
    expect(lspReasonCategory('configured-command-unavailable')).toBe('unavailable');
    expect(lspReasonCategory('server-crash')).toBe('degraded');
    expect(lspReasonCategory('initialize-timeout')).toBe('degraded');
    expect(lspReasonCategory('request-timeout')).toBe('degraded');
    expect(lspReasonCategory('malformed-protocol-response')).toBe('degraded');
    expect(lspReasonCategory('shutdown-failure')).toBe('degraded');
    expect(lspReasonCategory('full-index-file-cap-exceeded')).toBe('skipped');
    expect(lspReasonCategory('full-index-work-cap-exceeded')).toBe('skipped');
    expect(lspReasonCategory('watch-changed-files-absent')).toBe('skipped');
    expect(lspReasonCategory('language-not-present')).toBe('not-present');
    expect(lspReasonCategory('language-not-applicable')).toBe('not-applicable');
    expect(lspReasonCategory('validation-only-prereq-missing')).toBe('validation-only');
  });

  it('updates checked, verified, corrected, suppressed, skipped, and degraded counters without double counting', () => {
    const config = resolveLspConfig({ projectRoot: process.cwd(), cliActivation: 'enable', env: {} });
    const status = createInitialLspStatus(config);
    const coverage = createLspCoverageRecord('python', {
      sourceFilesSeen: 2,
      candidateWorkItems: 7,
    });

    recordLspChecked(status, coverage, 4);
    recordLspEdgeDecision(status, 'verified');
    recordLspEdgeDecision(status, 'corrected');
    recordLspEdgeDecision(status, 'suppressed');
    recordLspSkip(status, coverage, 'language-not-applicable', 1);
    recordLspDegradation(status, coverage, 'server-crash', 2);

    expect(status.edgeCounts).toEqual({
      checked: 4,
      verified: 1,
      corrected: 1,
      suppressed: 1,
      skippedByReason: { 'language-not-applicable': 1, 'server-crash': 2 },
      degraded: 2,
    });
    expect(coverage.checkedWorkItems).toBe(4);
    expect(coverage.skippedByReason).toEqual({
      'language-not-applicable': 1,
      'server-crash': 2,
    });
  });

  it('rejects absent, unbounded, and oversized watch scopes without a repository-wide fallback', () => {
    expect(evaluateLspWatchBatchScope({
      changedSourceFiles: undefined,
      candidateWorkItemsByLanguage: {},
    })).toEqual({
      canRun: false,
      skippedByReason: { 'watch-changed-files-absent': 1 },
      skippedByLanguage: {},
    });

    expect(evaluateLspWatchBatchScope({
      changedSourceFiles: 'unbounded',
      candidateWorkItemsByLanguage: {},
    })).toEqual({
      canRun: false,
      skippedByReason: { 'watch-changed-files-unbounded': 1 },
      skippedByLanguage: {},
    });

    const oversized = evaluateLspWatchBatchScope({
      changedSourceFiles: Array.from({ length: 101 }, (_, index) => `f${index}.ts`),
      candidateWorkItemsByLanguage: { typescript: 1001, python: 2 },
    });
    expect(oversized.canRun).toBe(false);
    expect(oversized.skippedByReason).toEqual({
      'watch-changed-files-cap-exceeded': 101,
      'watch-work-cap-exceeded': 1001,
    });
    expect(oversized.skippedByLanguage).toEqual({
      typescript: 'watch-work-cap-exceeded',
    });
  });

  it('round-trips activation source, server evidence, coverage, and edge counts', () => {
    const config = resolveLspConfig({ projectRoot: process.cwd(), cliActivation: 'enable', env: {} });
    const status = createInitialLspStatus(config);
    status.lastRunAt = '2026-07-06T00:00:00.000Z';
    status.servers.push({
      language: 'typescript',
      command: ['typescript-language-server', '--stdio'],
      state: 'initialized',
      observedVersion: 'fixture-server 1.0.0',
      resolvedPath: '/tmp/typescript-language-server',
      expectedAlternatives: [['typescript-language-server', '--stdio']],
    });
    status.coverage.push({
      language: 'typescript',
      sourceFilesSeen: 2,
      candidateWorkItems: 3,
      checkedWorkItems: 3,
      skippedByReason: {},
      capExceededReasons: [],
      elapsedMs: 12,
    });
    status.edgeCounts.checked = 3;
    status.edgeCounts.verified = 2;
    status.performance.lspElapsedMs = 12;

    const parsed = parsePersistedLspStatus(serializeLspStatus(status));
    expect(parsed).toEqual(status);
  });

  it('keeps the graceful-degradation fixture README scoped to local scenarios', () => {
    const readme = fs.readFileSync(
      path.join(process.cwd(), '__tests__/fixtures/lsp/degradation/README.md'),
      'utf8',
    );

    expect(readme).toContain('missing server');
    expect(readme).toContain('server crash');
    expect(readme).toContain('initialize timeout');
    expect(readme).toContain('request timeout');
    expect(readme).toContain('malformed response');
    expect(readme).toContain('shutdown failure');
    expect(readme).not.toContain('http://');
    expect(readme).not.toContain('https://');
  });
});
