import { describe, expect, it } from 'vitest';
import { createInitialLspStatus, defaultLspPerformanceCaps, isLspReasonCode, resolveLspConfig } from '../src/lsp';

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
});
