import { describe, expect, it } from 'vitest';

import {
  isCfgReadResult,
  type CfgBlock,
  type CfgEdge,
  type CfgGraph,
  type CfgPage,
  type CfgReadResult,
  type CfgReason,
  type CfgState,
} from '../../../src/index';
import {
  buildCfgPage,
  deriveCfgSourceVersion,
  makeCfgReadResult,
  normalizeCfgPageRequest,
  pageCfgGraph,
  resolveCfgStatus,
  safeCfgMessage,
} from '../../../src/analysis/cfg';

const TOP_LEVEL_KEYS = [
  'analysis',
  'cfg',
  'functionId',
  'message',
  'page',
  'reason',
  'sourceVersion',
  'stale',
  'state',
];

const page: CfgPage = {
  limit: 100,
  offset: 0,
  blocks: { total: 2, returned: 2, hasMore: false, nextOffset: null },
  edges: { total: 1, returned: 1, hasMore: false, nextOffset: null },
};

const entry: CfgBlock = {
  id: 'fn:demo:entry',
  role: 'entry',
  ordinal: 0,
  spans: [],
};

const exit: CfgBlock = {
  id: 'fn:demo:exit',
  role: 'exit',
  ordinal: 1,
  spans: [{ startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 }],
};

const edge: CfgEdge = {
  source: entry.id,
  target: exit.id,
  kind: 'fallthrough',
};

const graph: CfgGraph = {
  analysis: 'cfg',
  graphId: 'cfg:fn:demo:source:v1',
  language: 'typescript',
  functionId: 'fn:demo',
  sourceVersion: 'source:v1',
  blocks: [entry, exit],
  edges: [edge],
};

function resultFor(
  state: CfgState,
  reason: CfgReason | null,
  payload: boolean,
): CfgReadResult {
  return {
    analysis: 'cfg',
    functionId: 'fn:demo',
    state,
    reason,
    message: '',
    sourceVersion: payload ? 'source:v1' : null,
    stale: state === 'stale',
    cfg: payload ? graph : null,
    page: payload ? page : null,
  };
}

describe('SPEC-014 public CFG contract', () => {
  it('exports the frozen CfgReadResult top-level shape and accepts valid state/reason payloads', () => {
    const available = resultFor('available', null, true);

    expect(Object.keys(available).sort()).toEqual(TOP_LEVEL_KEYS);
    expect(isCfgReadResult(available)).toBe(true);

    const validCases: Array<[CfgState, CfgReason | null, boolean]> = [
      ['available', null, true],
      ['disabled', 'analysis_disabled', false],
      ['not_indexed', 'project_not_indexed', false],
      ['not_computed', 'cfg_not_computed', false],
      ['stale', 'source_version_mismatch', true],
      ['stale', 'refresh_failed_retained_stale', true],
      ['unavailable', 'first_refresh_failed', false],
      ['unsupported', 'unsupported_language', false],
      ['unsupported', 'unsupported_construct', false],
      ['unsupported', 'parse_error', false],
      ['unsupported', 'parse_unsafe_region', false],
      ['unsupported', 'parser_unavailable', false],
      ['resource_limited', 'block_limit_exceeded', false],
      ['unknown_function', 'function_unknown', false],
      ['deleted', 'function_deleted', false],
    ];

    for (const [state, reason, payload] of validCases) {
      expect(isCfgReadResult(resultFor(state, reason, payload))).toBe(true);
    }
  });

  it('rejects non-contract states, reasons, payload nullability, and top-level key drift', () => {
    expect(isCfgReadResult({ ...resultFor('available', null, true), extra: true })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), state: 'empty' })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), reason: 'analysis_disabled' })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), reason: null })).toBe(false);
    expect(
      isCfgReadResult({ ...resultFor('not_computed', 'cfg_not_computed', false), reason: 'no_current_cfg_functions' })
    ).toBe(false);
    expect(isCfgReadResult({ ...resultFor('stale', 'source_version_mismatch', true), stale: false })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), stale: true })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: null })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), page: null })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), cfg: graph })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('disabled', 'analysis_disabled', false), message: 'x'.repeat(241) })).toBe(false);
  });

  it('validates block roles, edge kinds, graph identity, and page metadata', () => {
    expect(
      isCfgReadResult({
        ...resultFor('available', null, true),
        cfg: { ...graph, blocks: [{ ...entry, role: 'landing' }] },
      })
    ).toBe(false);
    expect(
      isCfgReadResult({
        ...resultFor('available', null, true),
        cfg: { ...graph, edges: [{ ...edge, kind: 'exception' }] },
      })
    ).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: { ...graph, analysis: 'flow' } })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: { ...graph, functionId: 'fn:other' } })).toBe(false);
    expect(isCfgReadResult({ ...resultFor('available', null, true), cfg: { ...graph, sourceVersion: 'source:v2' } })).toBe(false);
    expect(
      isCfgReadResult({
        ...resultFor('available', null, true),
        page: { ...page, blocks: { total: 2, returned: 3, hasMore: false, nextOffset: null } },
      })
    ).toBe(false);
  });

  it('derives source versions only from function snapshot and CFG contract inputs', () => {
    const baseInput = {
      fileContentHash: 'file:abc123',
      functionId: 'fn:demo',
      language: 'typescript',
      startLine: 1,
      startColumn: 0,
      endLine: 10,
      endColumn: 1,
      statusVersion: 1,
      blockVersion: 1,
      edgeVersion: 1,
    };

    const base = deriveCfgSourceVersion(baseInput);

    expect(base).toMatch(/^cfgsrc:v1:[a-f0-9]{64}$/);
    expect(deriveCfgSourceVersion({ ...baseInput })).toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, graphWriteVersion: 999 })).toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, endLine: 11 })).not.toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, fileContentHash: 'file:def456' })).not.toBe(base);
    expect(deriveCfgSourceVersion({ ...baseInput, blockVersion: 2 })).not.toBe(base);
  });

  it('resolves read status precedence, source-version stale state, and no-payload skip states', () => {
    const sourceVersion = deriveCfgSourceVersion({
      fileContentHash: 'file:abc123',
      functionId: 'fn:demo',
      language: 'typescript',
      startLine: 1,
      startColumn: 0,
      endLine: 10,
      endColumn: 1,
      statusVersion: 1,
      blockVersion: 1,
      edgeVersion: 1,
    });

    const stored = {
      state: 'available' as const,
      reason: null,
      message: '',
      sourceVersion,
      statusVersion: 1,
      blockVersion: 1,
      edgeVersion: 1,
    };

    expect(resolveCfgStatus({ enabled: false, projectIndexed: true, currentSourceVersion: sourceVersion, stored })).toEqual({
      state: 'disabled',
      reason: 'analysis_disabled',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(resolveCfgStatus({ enabled: true, projectIndexed: false, currentSourceVersion: sourceVersion, stored })).toEqual({
      state: 'not_indexed',
      reason: 'project_not_indexed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(resolveCfgStatus({ enabled: true, projectIndexed: true, currentSourceVersion: sourceVersion, stored: null })).toEqual({
      state: 'not_computed',
      reason: 'cfg_not_computed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(resolveCfgStatus({ enabled: true, projectIndexed: true, currentSourceVersion: null, stored: null })).toEqual({
      state: 'unknown_function',
      reason: 'function_unknown',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
    expect(
      resolveCfgStatus({
        enabled: true,
        projectIndexed: true,
        currentSourceVersion: 'source:v2',
        stored,
      })
    ).toEqual({
      state: 'stale',
      reason: 'source_version_mismatch',
      stale: true,
      sourceVersion,
      carriesPayload: true,
    });
    expect(
      resolveCfgStatus({
        enabled: true,
        projectIndexed: true,
        currentSourceVersion: sourceVersion,
        stored: {
          ...stored,
          state: 'unsupported',
          reason: 'unsupported_construct',
        },
      })
    ).toEqual({
      state: 'unsupported',
      reason: 'unsupported_construct',
      stale: false,
      sourceVersion,
      carriesPayload: false,
    });
  });

  it('clamps paging and applies one request independently to ordered blocks and edges', () => {
    expect(normalizeCfgPageRequest({})).toEqual({ limit: 100, offset: 0 });
    expect(normalizeCfgPageRequest({ limit: -10, offset: -4 })).toEqual({ limit: 1, offset: 0 });
    expect(normalizeCfgPageRequest({ limit: 999, offset: 3.8 })).toEqual({ limit: 500, offset: 3 });

    expect(buildCfgPage({ limit: 2, offset: 1, totalBlocks: 5, totalEdges: 2 })).toEqual({
      limit: 2,
      offset: 1,
      blocks: { total: 5, returned: 2, hasMore: true, nextOffset: 3 },
      edges: { total: 2, returned: 1, hasMore: false, nextOffset: null },
    });

    const paged = pageCfgGraph({
      graph: {
        ...graph,
        blocks: [
          entry,
          { ...entry, id: 'body-1', role: 'body', ordinal: 1 },
          { ...entry, id: 'body-2', role: 'body', ordinal: 2 },
          { ...exit, ordinal: 3 },
        ],
        edges: [
          edge,
          { ...edge, source: 'body-1', target: 'body-2' },
          { ...edge, source: 'body-2', target: exit.id },
        ],
      },
      request: { limit: 2, offset: 1 },
    });

    expect(paged.cfg.blocks.map((block) => block.id)).toEqual(['body-1', 'body-2']);
    expect(paged.cfg.edges.map((item) => item.source)).toEqual(['body-1', 'body-2']);
    expect(paged.page).toEqual({
      limit: 2,
      offset: 1,
      blocks: { total: 4, returned: 2, hasMore: true, nextOffset: 3 },
      edges: { total: 3, returned: 2, hasMore: false, nextOffset: null },
    });
  });

  it('bounds and sanitizes CFG messages without leaking raw exception strings', () => {
    expect(safeCfgMessage(undefined)).toBe('');
    expect(safeCfgMessage('line one\nline two')).toBe('line one line two');
    expect([...safeCfgMessage('😀'.repeat(300))]).toHaveLength(240);
    expect(safeCfgMessage(new Error('SyntaxError: raw source token should not leak'))).toBe(
      'CFG analysis result unavailable.'
    );
  });

  it('builds read results with no partial payload for unsupported and resource-limited states', () => {
    const unsupported = makeCfgReadResult({
      functionId: 'fn:demo',
      state: 'unsupported',
      reason: 'unsupported_construct',
      message: 'unsupported syntax',
      sourceVersion: 'source:v1',
      cfg: graph,
      page,
    });
    const limited = makeCfgReadResult({
      functionId: 'fn:demo',
      state: 'resource_limited',
      reason: 'block_limit_exceeded',
      message: 'too many blocks',
      sourceVersion: 'source:v1',
      cfg: graph,
      page,
    });

    expect(unsupported).toMatchObject({ cfg: null, page: null, stale: false });
    expect(limited).toMatchObject({ cfg: null, page: null, stale: false });
    expect(isCfgReadResult(unsupported)).toBe(true);
    expect(isCfgReadResult(limited)).toBe(true);
    expect(isCfgReadResult(makeCfgReadResult({ functionId: 'fn:demo', state: 'available', reason: null, cfg: graph, page }))).toBe(true);
  });

  it('fails closed instead of constructing invalid payload-bearing read results', () => {
    expect(() => makeCfgReadResult({ functionId: 'fn:demo', state: 'available', reason: null, cfg: graph })).toThrow(
      /Invalid CfgReadResult: available requires complete cfg and page/
    );
    expect(() =>
      makeCfgReadResult({ functionId: 'fn:demo', state: 'stale', reason: 'source_version_mismatch', page })
    ).toThrow(/Invalid CfgReadResult: stale requires complete cfg and page/);
    expect(() =>
      makeCfgReadResult({
        functionId: 'fn:demo',
        state: 'available',
        reason: null,
        sourceVersion: 'source:v1',
        cfg: { ...graph, functionId: 'fn:other' },
        page,
      })
    ).toThrow(/Invalid CfgReadResult: constructed result violates CFG contract/);
    expect(() =>
      makeCfgReadResult({
        functionId: 'fn:demo',
        state: 'available',
        reason: null,
        sourceVersion: 'source:v1',
        cfg: { ...graph, sourceVersion: 'source:v2' },
        page,
      })
    ).toThrow(/Invalid CfgReadResult: constructed result violates CFG contract/);
    expect(() =>
      makeCfgReadResult({ functionId: 'fn:demo', state: 'available', reason: 'analysis_disabled', cfg: graph, page })
    ).toThrow(/Invalid CfgReadResult: constructed result violates CFG contract/);

    const unsupported = makeCfgReadResult({
      functionId: 'fn:demo',
      state: 'unsupported',
      reason: 'unsupported_construct',
      sourceVersion: 'source:v1',
      cfg: graph,
      page,
    });
    expect(unsupported.cfg).toBeNull();
    expect(unsupported.page).toBeNull();
    expect(isCfgReadResult(unsupported)).toBe(true);
  });

  it('does not report stale for non-payload stored statuses whose source token is not current', () => {
    const resolved = resolveCfgStatus({
      enabled: true,
      projectIndexed: true,
      currentSourceVersion: 'source:v2',
      stored: {
        state: 'unsupported',
        reason: 'unsupported_construct',
        sourceVersion: 'source:v1',
        statusVersion: 1,
        blockVersion: 1,
        edgeVersion: 1,
      },
    });

    expect(resolved).toEqual({
      state: 'not_computed',
      reason: 'cfg_not_computed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    });
  });
});
