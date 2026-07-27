import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';

import { CodeGraph } from '../../../src/index';
import { setCfgParserOverrideForTests } from '../../../src/analysis/cfg';
import type { SqliteDatabase } from '../../../src/db/sqlite-adapter';
import { getParser } from '../../../src/extraction/grammars';
import { clearProjectConfigCache } from '../../../src/project-config';
import { materializeBenchmarkMonorepo } from '../fixtures/benchmark-monorepo/generate';

const OVERHEAD_LIMIT = 1.20;
const FULL_WARMUP_PAIRS = 2;
const FULL_MEASURED_PAIRS = 10;
const SMOKE_MEASURED_PAIRS = 5;
const CFG_PERFORMANCE_TIMEOUT_MS = 300_000;
const CFG_EVIDENCE_COMMAND =
  'CODEGRAPH_CFG_PERF_EVIDENCE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts';
const CFG_SMOKE_COMMAND =
  'CODEGRAPH_CFG_PERF_SMOKE=1 npx vitest run __tests__/analysis/cfg/cfg-performance.test.ts';
const cfgEvidenceMode = process.env.CODEGRAPH_CFG_PERF_EVIDENCE === '1';
const cfgSmokeMode = process.env.CODEGRAPH_CFG_PERF_SMOKE === '1';
const cfgTimedBenchmarkEnabled = cfgEvidenceMode || cfgSmokeMode;
const tempDirs: string[] = [];

type Arm = 'disabled' | 'enabled';

interface BenchmarkPlan {
  readonly label: 'smoke' | 'authoritative';
  readonly warmupPairs: number;
  readonly measuredPairs: number;
}

interface RunMetrics {
  readonly files: number;
  readonly nodes: number;
  readonly baseEdges: number;
  readonly lspEdges: number;
  readonly vectors: number;
  readonly flows: number;
  readonly flowSteps: number;
  readonly clusters: number;
  readonly clusterMembers: number;
  readonly catalogMetaRows: number;
  readonly cfgStatus: number;
  readonly cfgBlocks: number;
  readonly cfgEdges: number;
  readonly cfgAvailableByLanguage: Record<string, number>;
  readonly cfgBlocksByLanguage: Record<string, number>;
  readonly cfgEdgesByLanguage: Record<string, number>;
}

interface TimedArmResult {
  readonly arm: Arm;
  readonly elapsedMs: number;
  readonly metrics: RunMetrics;
  readonly networkFetches: number;
  readonly projectRoot: string;
}

interface PairResult {
  readonly pair: number;
  readonly order: readonly Arm[];
  readonly disabledMs: number;
  readonly enabledMs: number;
  readonly disabledProjectRoot: string;
  readonly enabledProjectRoot: string;
}

interface BenchmarkResult {
  readonly label: BenchmarkPlan['label'];
  readonly warmupPairs: readonly PairResult[];
  readonly measuredPairs: readonly PairResult[];
  readonly samples: {
    readonly disabledMs: readonly number[];
    readonly enabledMs: readonly number[];
  };
  readonly medians: {
    readonly disabledMs: number;
    readonly enabledMs: number;
  };
  readonly minMax: {
    readonly disabledMs: { readonly min: number; readonly max: number };
    readonly enabledMs: { readonly min: number; readonly max: number };
  };
  readonly ratio: number;
  readonly referenceMetrics: {
    readonly disabled: RunMetrics;
    readonly enabled: RunMetrics;
  };
  readonly networkFetches: number;
}

interface FixtureIdentity {
  readonly generatorPath: string;
  readonly generatorHash: string;
  readonly files: readonly string[];
  readonly contentHash: string;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
  clearProjectConfigCache();
});

describe('SPEC-014 T039 CFG paired performance benchmark', () => {
  it.skipIf(cfgTimedBenchmarkEnabled)('parses each enabled CFG source file once per index run', async () => {
    let parseCalls = 0;
    setCfgParserOverrideForTests('typescript', {
      parse(source) {
        parseCalls += 1;
        const parser = getParser('typescript', 'src/app.ts');
        expect(parser).not.toBeNull();
        return parser!.parse(source);
      },
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-parse-cache-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ analysis: { cfg: true } }, null, 2));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'app.ts'),
      [
        'export function first(value: number): number {',
        '  return value + 1;',
        '}',
        '',
        'export function second(value: number): number {',
        '  return value + 2;',
        '}',
        '',
        'export function third(value: number): number {',
        '  return value + 3;',
        '}',
        '',
      ].join('\n'),
    );

    const graph = CodeGraph.initSync(dir);
    try {
      const indexResult = await graph.indexAll({ embeddingsProvider: 'off', lsp: 'disable' });
      expect(indexResult.success).toBe(true);
      const db = (graph as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
      expect(countWhere(db, 'cfg_status', "state = 'available'")).toBe(3);
    } finally {
      graph.close();
      setCfgParserOverrideForTests('typescript', undefined);
    }

    expect(parseCalls).toBe(1);
  }, 120_000);

  it.skipIf(!cfgTimedBenchmarkEnabled)(
    'records CFG paired performance and gates timing only in explicit isolated evidence mode',
    async () => {
      const fixture = fixtureIdentity();
      const smokePlan: BenchmarkPlan = {
        label: 'smoke',
        warmupPairs: FULL_WARMUP_PAIRS,
        measuredPairs: SMOKE_MEASURED_PAIRS,
      };
      const fullPlan: BenchmarkPlan = {
        label: 'authoritative',
        warmupPairs: FULL_WARMUP_PAIRS,
        measuredPairs: FULL_MEASURED_PAIRS,
      };

      const result = await runBenchmark(cfgEvidenceMode ? fullPlan : smokePlan);
      const timingGateApplied = cfgEvidenceMode && result.label === 'authoritative';
      const timingGateStatus = timingGateApplied
        ? result.ratio <= OVERHEAD_LIMIT ? 'pass' : 'fail'
        : 'not_applied_load_contaminated_non_authoritative';

      const evidence = {
        benchmark: 'spec-014-cfg-paired-index-overhead',
        threshold: OVERHEAD_LIMIT,
        mode: cfgEvidenceMode ? 'isolated-authoritative' : 'load-contaminated-smoke',
        authoritative: cfgEvidenceMode,
        timingGateApplied,
        timingGateStatus,
        timingGateReason: timingGateApplied
          ? 'CODEGRAPH_CFG_PERF_EVIDENCE=1 explicitly requested isolated product timing evidence.'
          : 'Explicit smoke timing is load-contaminated and non-authoritative; ratio is recorded for visibility only.',
        isolatedEvidenceCommand: CFG_EVIDENCE_COMMAND,
        smokeCommand: CFG_SMOKE_COMMAND,
        repository: {
          commit: git(['rev-parse', 'HEAD']),
          statusShort: git(['status', '--short']),
        },
        fixture,
        environment: environmentMetadata(),
        command: {
          argv: process.argv,
          cwd: process.cwd(),
          execPath: process.execPath,
          envOverrides: {
            CI: process.env.CI ?? null,
            CODEGRAPH_CFG_PERF_EVIDENCE: process.env.CODEGRAPH_CFG_PERF_EVIDENCE ?? null,
            CODEGRAPH_CFG_PERF_SMOKE: process.env.CODEGRAPH_CFG_PERF_SMOKE ?? null,
            CODEGRAPH_NO_FAST_INIT: process.env.CODEGRAPH_NO_FAST_INIT ?? null,
            CODEGRAPH_NO_WAL_DEFER: process.env.CODEGRAPH_NO_WAL_DEFER ?? null,
            CODEGRAPH_EMBEDDING_PROVIDER: process.env.CODEGRAPH_EMBEDDING_PROVIDER ?? null,
            CODEGRAPH_LLM_ENDPOINT: process.env.CODEGRAPH_LLM_ENDPOINT ? '<set>' : null,
          },
          indexOptions: { embeddingsProvider: 'off', lsp: 'disable' },
          analysisConfig: {
            disabledArm: { cfg: false, flows: false, clusters: false },
            enabledArm: { cfg: true, flows: false, clusters: false },
          },
        },
        result,
        observedTiming: {
          label: result.label,
          warmups: result.warmupPairs.length,
          samples: result.measuredPairs.length,
          medianDisabledMs: result.medians.disabledMs,
          medianEnabledMs: result.medians.enabledMs,
          ratio: result.ratio,
        },
      };

      console.log(`CFG_PERFORMANCE_RESULT ${JSON.stringify(evidence)}`);

      expect(result.warmupPairs).toHaveLength(FULL_WARMUP_PAIRS);
      expect(result.samples.disabledMs).toHaveLength(result.measuredPairs.length);
      expect(result.samples.enabledMs).toHaveLength(result.measuredPairs.length);
      expect(result.ratio).toBeGreaterThan(0);
      expect(result.networkFetches).toBe(0);

      if (cfgEvidenceMode) {
        expect(result.label).toBe('authoritative');
        expect(result.measuredPairs).toHaveLength(FULL_MEASURED_PAIRS);
        expect(timingGateApplied).toBe(true);
        expect(result.ratio).toBeLessThanOrEqual(OVERHEAD_LIMIT);
      } else {
        expect(result.label).toBe('smoke');
        expect(result.measuredPairs.length).toBeGreaterThanOrEqual(SMOKE_MEASURED_PAIRS);
        expect(timingGateApplied).toBe(false);
        expect(timingGateStatus).toBe('not_applied_load_contaminated_non_authoritative');
      }
    },
    CFG_PERFORMANCE_TIMEOUT_MS,
  );
});

async function runBenchmark(plan: BenchmarkPlan): Promise<BenchmarkResult> {
  const warmupPairs: PairResult[] = [];
  const measuredPairs: PairResult[] = [];
  let referenceDisabled: RunMetrics | null = null;
  let referenceEnabled: RunMetrics | null = null;
  let networkFetches = 0;

  for (let pair = 0; pair < plan.warmupPairs + plan.measuredPairs; pair++) {
    const order = pair % 2 === 0 ? ['disabled', 'enabled'] as const : ['enabled', 'disabled'] as const;
    const results = new Map<Arm, TimedArmResult>();

    for (const arm of order) {
      const result = await timeArm(arm, plan.label, pair);
      results.set(arm, result);
      networkFetches += result.networkFetches;
      assertArmInvariants(result);

      if (arm === 'disabled' && referenceDisabled === null) referenceDisabled = result.metrics;
      if (arm === 'enabled' && referenceEnabled === null) referenceEnabled = result.metrics;
      assertComparableMetrics(result.metrics, arm === 'disabled' ? referenceDisabled! : referenceEnabled!);
    }

    const disabled = results.get('disabled')!;
    const enabled = results.get('enabled')!;
    assertComparableNonCfgMetrics(disabled.metrics, enabled.metrics);

    const pairResult: PairResult = {
      pair,
      order,
      disabledMs: round(disabled.elapsedMs),
      enabledMs: round(enabled.elapsedMs),
      disabledProjectRoot: disabled.projectRoot,
      enabledProjectRoot: enabled.projectRoot,
    };

    if (pair < plan.warmupPairs) {
      warmupPairs.push(pairResult);
    } else {
      measuredPairs.push({ ...pairResult, pair: pair - plan.warmupPairs });
    }
  }

  const disabledMs = measuredPairs.map((pair) => pair.disabledMs);
  const enabledMs = measuredPairs.map((pair) => pair.enabledMs);
  const medianDisabled = median(disabledMs);
  const medianEnabled = median(enabledMs);

  return {
    label: plan.label,
    warmupPairs,
    measuredPairs,
    samples: { disabledMs, enabledMs },
    medians: {
      disabledMs: round(medianDisabled),
      enabledMs: round(medianEnabled),
    },
    minMax: {
      disabledMs: { min: Math.min(...disabledMs), max: Math.max(...disabledMs) },
      enabledMs: { min: Math.min(...enabledMs), max: Math.max(...enabledMs) },
    },
    ratio: round(medianEnabled / medianDisabled, 4),
    referenceMetrics: {
      disabled: referenceDisabled!,
      enabled: referenceEnabled!,
    },
    networkFetches,
  };
}

async function timeArm(arm: Arm, label: BenchmarkPlan['label'], pair: number): Promise<TimedArmResult> {
  const projectRoot = makeFixtureProject(arm, label, pair);
  clearProjectConfigCache();
  expect(fs.existsSync(path.join(projectRoot, '.codegraph')), `${arm} run must start before .codegraph exists`).toBe(false);

  let graph: CodeGraph | null = null;
  let fetchGuard: ReturnType<typeof installFetchGuard> | null = null;
  try {
    graph = CodeGraph.initSync(projectRoot);
    fetchGuard = installFetchGuard();
    const started = performance.now();
    const indexResult = await graph.indexAll({ embeddingsProvider: 'off', lsp: 'disable' });
    const elapsedMs = performance.now() - started;
    expect(indexResult.success).toBe(true);

    const db = (graph as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
    return {
      arm,
      elapsedMs,
      metrics: readMetrics(db),
      networkFetches: fetchGuard.count(),
      projectRoot,
    };
  } finally {
    fetchGuard?.restore();
    graph?.close();
  }
}

function makeFixtureProject(arm: Arm, label: string, pair: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cg-cfg-perf-${label}-${pair}-${arm}-`));
  tempDirs.push(dir);
  materializeBenchmarkMonorepo(dir);
  fs.writeFileSync(
    path.join(dir, 'codegraph.json'),
    JSON.stringify(
      {
        analysis: {
          cfg: arm === 'enabled',
          flows: false,
          clusters: false,
        },
      },
      null,
      2,
    ),
  );
  return dir;
}

function readMetrics(db: SqliteDatabase): RunMetrics {
  return {
    files: count(db, 'files'),
    nodes: count(db, 'nodes'),
    baseEdges: countWhere(db, 'edges', "provenance IS NULL OR provenance <> 'lsp'"),
    lspEdges: countWhere(db, 'edges', "provenance = 'lsp'"),
    vectors: count(db, 'node_vectors'),
    flows: count(db, 'flows'),
    flowSteps: count(db, 'flow_steps'),
    clusters: count(db, 'clusters'),
    clusterMembers: count(db, 'cluster_members'),
    catalogMetaRows: count(db, 'catalog_meta'),
    cfgStatus: count(db, 'cfg_status'),
    cfgBlocks: count(db, 'cfg_blocks'),
    cfgEdges: count(db, 'cfg_edges'),
    cfgAvailableByLanguage: countAvailableStatusByLanguage(db),
    cfgBlocksByLanguage: countCfgPayloadByLanguage(db, 'cfg_blocks'),
    cfgEdgesByLanguage: countCfgPayloadByLanguage(db, 'cfg_edges'),
  };
}

function count(db: SqliteDatabase, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function countWhere(db: SqliteDatabase, table: string, where: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count);
}

function countAvailableStatusByLanguage(db: SqliteDatabase): Record<string, number> {
  const rows = db.prepare(
    "SELECT language, COUNT(*) AS count FROM cfg_status WHERE state = 'available' GROUP BY language ORDER BY language",
  ).all() as Array<{ language: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.language, Number(row.count)]));
}

function countCfgPayloadByLanguage(db: SqliteDatabase, table: 'cfg_blocks' | 'cfg_edges'): Record<string, number> {
  const rows = db.prepare(
    `SELECT cfg_status.language, COUNT(*) AS count
     FROM ${table}
     INNER JOIN cfg_status ON cfg_status.function_id = ${table}.function_id
     GROUP BY cfg_status.language
     ORDER BY cfg_status.language`,
  ).all() as Array<{ language: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.language, Number(row.count)]));
}

function assertArmInvariants(result: TimedArmResult): void {
  expect(result.networkFetches, `${result.arm} arm must not call fetch() during indexAll()`).toBe(0);
  expect(result.metrics.vectors, `${result.arm} arm must keep embeddings off`).toBe(0);
  expect(result.metrics.lspEdges, `${result.arm} arm must keep LSP off`).toBe(0);
  expect(result.metrics.flows, `${result.arm} arm must keep flows off`).toBe(0);
  expect(result.metrics.flowSteps, `${result.arm} arm must keep flows off`).toBe(0);
  expect(result.metrics.clusters, `${result.arm} arm must keep clusters off`).toBe(0);
  expect(result.metrics.clusterMembers, `${result.arm} arm must keep clusters off`).toBe(0);
  expect(result.metrics.catalogMetaRows, `${result.arm} arm must not write catalog metadata`).toBe(0);

  if (result.arm === 'disabled') {
    expect(result.metrics.cfgStatus).toBe(0);
    expect(result.metrics.cfgBlocks).toBe(0);
    expect(result.metrics.cfgEdges).toBe(0);
    expect(result.metrics.cfgAvailableByLanguage).toEqual({});
    return;
  }

  expect(result.metrics.cfgStatus).toBeGreaterThan(0);
  expect(result.metrics.cfgBlocks).toBeGreaterThan(0);
  expect(result.metrics.cfgEdges).toBeGreaterThan(0);
  expect(result.metrics.cfgAvailableByLanguage.typescript).toBeGreaterThan(0);
  expect(result.metrics.cfgAvailableByLanguage.python).toBeGreaterThan(0);
  expect(result.metrics.cfgBlocksByLanguage.typescript).toBeGreaterThan(0);
  expect(result.metrics.cfgBlocksByLanguage.python).toBeGreaterThan(0);
  expect(result.metrics.cfgEdgesByLanguage.typescript).toBeGreaterThan(0);
  expect(result.metrics.cfgEdgesByLanguage.python).toBeGreaterThan(0);
}

function assertComparableMetrics(actual: RunMetrics, expected: RunMetrics): void {
  expect(comparableNonCfgMetrics(actual)).toEqual(comparableNonCfgMetrics(expected));
  expect(actual.cfgStatus).toBe(expected.cfgStatus);
  expect(actual.cfgBlocks).toBe(expected.cfgBlocks);
  expect(actual.cfgEdges).toBe(expected.cfgEdges);
  expect(actual.cfgAvailableByLanguage).toEqual(expected.cfgAvailableByLanguage);
}

function assertComparableNonCfgMetrics(disabled: RunMetrics, enabled: RunMetrics): void {
  expect(comparableNonCfgMetrics(enabled)).toEqual(comparableNonCfgMetrics(disabled));
}

function comparableNonCfgMetrics(metrics: RunMetrics): Omit<
  RunMetrics,
  'cfgStatus' | 'cfgBlocks' | 'cfgEdges' | 'cfgAvailableByLanguage' | 'cfgBlocksByLanguage' | 'cfgEdgesByLanguage'
> {
  return {
    files: metrics.files,
    nodes: metrics.nodes,
    baseEdges: metrics.baseEdges,
    lspEdges: metrics.lspEdges,
    vectors: metrics.vectors,
    flows: metrics.flows,
    flowSteps: metrics.flowSteps,
    clusters: metrics.clusters,
    clusterMembers: metrics.clusterMembers,
    catalogMetaRows: metrics.catalogMetaRows,
  };
}

function installFetchGuard(): { count: () => number; restore: () => void } {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('Network fetch is forbidden during SPEC-014 CFG performance runs');
  }) as typeof fetch;
  return {
    count: () => fetches,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function fixtureIdentity(): FixtureIdentity {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cfg-perf-fixture-identity-'));
  tempDirs.push(dir);
  const files = materializeBenchmarkMonorepo(dir);
  const contentHash = createHash('sha256');
  for (const relPath of files) {
    contentHash.update(relPath);
    contentHash.update('\0');
    contentHash.update(fs.readFileSync(path.join(dir, relPath)));
    contentHash.update('\0');
  }

  const generatorPath = path.relative(process.cwd(), path.resolve(__dirname, '../fixtures/benchmark-monorepo/generate.ts'));
  return {
    generatorPath,
    generatorHash: sha256File(path.resolve(process.cwd(), generatorPath)),
    files,
    contentHash: contentHash.digest('hex'),
  };
}

function environmentMetadata(): Record<string, unknown> {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    logicalCores: cpus.length,
    totalMemoryBytes: os.totalmem(),
    tmpRoot: os.tmpdir(),
    storageRoot: path.parse(os.tmpdir()).root,
  };
}

function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: process.cwd(), encoding: 'utf8' });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function median(values: readonly number[]): number {
  expect(values.length).toBeGreaterThan(0);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
