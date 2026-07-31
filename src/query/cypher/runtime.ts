import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { getCodeGraphDir } from '../../directory';
import { SqliteDatabase, createDatabase } from '../../db/sqlite-adapter';
import { CYPHER_RUNTIME_DEADLINE_MS } from './limits';

export type CypherRuntimeSuccessResult = {
  readonly status: 'success';
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly effectiveCap: number;
  readonly truncated: boolean;
};

export type CypherRuntimeDiagnosticResult = {
  readonly status: 'diagnostic';
  readonly code: string;
  readonly message: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly expected: string;
  readonly anchor: string;
  readonly excerpt: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
};

export type CypherRuntimeTimeoutResult = {
  readonly status: 'timeout';
  readonly code: 'CYPHER_TIMEOUT';
  readonly deadlineMs: 5000;
  readonly guidance: string;
};

export type CypherRuntimeResult =
  | CypherRuntimeSuccessResult
  | CypherRuntimeDiagnosticResult
  | CypherRuntimeTimeoutResult;

export type CypherRuntimeSqlRequest = {
  readonly sql: string;
  readonly boundParameters?: readonly unknown[];
  readonly effectiveCap?: number;
  readonly queryPlanProbe?: CypherRuntimeQueryPlanProbe;
};

export type CypherRuntimeTestOptions = {
  readonly onSqlPrepare?: (sql: string) => void;
  readonly onQueryPlan?: (evidence: CypherPerformancePlanEvidence) => void;
};

export type CypherPerformancePlanEvidence = {
  readonly probeId: string;
  readonly query: string;
  readonly details: readonly string[];
  readonly edgeIndexes: readonly string[];
  readonly tempWork: readonly string[];
  readonly boundedBy: string;
};

export type CypherRuntimeQueryPlanProbe = {
  readonly probeId: string;
  readonly query: string;
  readonly boundedBy: string;
};

type RuntimeWorkerSuccessMessage = {
  readonly type: 'success';
  readonly requestId: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly columns: readonly string[];
};

type RuntimeWorkerErrorMessage = {
  readonly type: 'error';
  readonly requestId: number;
  readonly message: string;
};

type RuntimeWorkerMessage = RuntimeWorkerSuccessMessage | RuntimeWorkerErrorMessage;

/**
 * Ceiling on live runtime workers per database. A Cypher read costs several
 * statements (plan, edge hydration, node hydration), and spawning a V8 isolate
 * plus a fresh SQLite connection for each one made a single query pay three
 * isolate boots — with nothing bounding how many concurrent callers could do
 * that at once. Workers are pooled and reused instead, so repeat statements
 * ride an already-open read-only connection and total isolates stay bounded.
 */
const CYPHER_RUNTIME_MAX_WORKERS = 4;

/**
 * Internal seam for exercising the deadline without a content-sniffing branch
 * in shipped code. Reading it from the environment keeps the trigger under the
 * control of whoever launched the process rather than of whoever wrote the
 * query text.
 */
const CYPHER_RUNTIME_DEADLINE_ENV_VAR = 'CODEGRAPH_CYPHER_DEADLINE_MS';

const runtimeState = {
  /**
   * Statements currently executing in a worker — not workers alive. Pooled
   * workers outlive the statement that created them, so liveness is no longer
   * a leak signal; an in-flight count still is.
   */
  activeWorkers: 0,
  terminatedWorkers: 0,
};

const RUNTIME_WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');

// node:sqlite is resolved inside the guard, not at module scope: package
// engines admit Node 20, where requiring it throws. At module scope that kills
// the worker before it can report why, and the parent can only say "the worker
// died". Captured here, the real cause survives to the classifier.
let db;
let openError;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(workerData.dbPath, { readOnly: true });
} catch (error) {
  openError = error instanceof Error ? error.message : String(error);
}

parentPort.on('message', (request) => {
  if (openError !== undefined) {
    parentPort.postMessage({ type: 'error', requestId: request.requestId, message: openError });
    return;
  }
  try {
    const statement = db.prepare(request.sql);
    const rows = statement.all(...request.boundParameters);
    const firstRow = rows[0];
    const columns = firstRow && typeof firstRow === 'object' ? Object.keys(firstRow) : [];
    parentPort.postMessage({ type: 'success', requestId: request.requestId, rows, columns });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
`;

export async function executeCypherSqlForTests(
  projectRoot: string,
  request: CypherRuntimeSqlRequest,
  options: CypherRuntimeTestOptions = {},
): Promise<CypherRuntimeResult> {
  const dbPath = path.join(getCodeGraphDir(projectRoot), 'codegraph.db');
  if (!fs.existsSync(dbPath)) {
    return diagnosticResult(
      'CYPHER_NOT_INDEXED',
      'CodeGraph index database was not found.',
      'existing CodeGraph index',
      'runtime',
    );
  }

  const readOnlyDiagnostic = validateReadOnlySql(request.sql);
  if (readOnlyDiagnostic !== undefined) {
    return readOnlyDiagnostic;
  }

  options.onSqlPrepare?.(request.sql);
  if (request.queryPlanProbe !== undefined && options.onQueryPlan !== undefined) {
    options.onQueryPlan(collectQueryPlanEvidence(dbPath, request));
  }

  return executeSqlInWorker(dbPath, request);
}

export function openCypherReadOnlyDatabaseForTests(dbPath: string): SqliteDatabase {
  return openCypherReadOnlyDatabase(dbPath);
}

export function getCypherRuntimeStateForTests(): {
  readonly activeWorkers: number;
  readonly terminatedWorkers: number;
} {
  return {
    activeWorkers: runtimeState.activeWorkers,
    terminatedWorkers: runtimeState.terminatedWorkers,
  };
}

function openCypherReadOnlyDatabase(dbPath: string): SqliteDatabase {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`CodeGraph database not found: ${dbPath}`);
  }
  return createDatabase(dbPath, { readOnly: true }).db;
}

type QueryPlanRow = {
  readonly id?: unknown;
  readonly parent?: unknown;
  readonly detail?: unknown;
};

function collectQueryPlanEvidence(
  dbPath: string,
  request: CypherRuntimeSqlRequest,
): CypherPerformancePlanEvidence {
  const probe = request.queryPlanProbe;
  if (probe === undefined) {
    throw new Error('Cypher query plan probe is required.');
  }

  const db = openCypherReadOnlyDatabase(dbPath);
  try {
    const rows = db.prepare(`EXPLAIN QUERY PLAN ${request.sql}`).all(...(request.boundParameters ?? [])) as QueryPlanRow[];
    const details = rows.map(formatQueryPlanRow).slice(0, 64);
    const evidenceText = `${details.join('\n')}\n${request.sql}`;
    const sqlLines = request.sql.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    const tempWork = [
      ...details.filter((detail) => /\bTEMP\b|ORDER BY|GROUP BY/i.test(detail)),
      ...sqlLines.filter((line) => /\b(ORDER BY|GROUP BY)\b/i.test(line)).map((line) => `SQL ${line}`),
    ].slice(0, 32);

    return {
      probeId: probe.probeId,
      query: probe.query,
      details,
      edgeIndexes: uniqueStrings([...evidenceText.matchAll(/\bidx_edges_(?:source|target)_kind\b/g)].map((match) => match[0])),
      tempWork: uniqueStrings(tempWork),
      boundedBy: probe.boundedBy,
    };
  } finally {
    db.close();
  }
}

function formatQueryPlanRow(row: QueryPlanRow): string {
  const id = typeof row.id === 'number' || typeof row.id === 'bigint' ? String(row.id) : '?';
  const parent = typeof row.parent === 'number' || typeof row.parent === 'bigint' ? String(row.parent) : '?';
  const detail = typeof row.detail === 'string' ? row.detail : JSON.stringify(row);
  return `QUERY PLAN ${id}:${parent} ${detail}`;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * How long a pooled worker may sit idle before it is closed.
 *
 * A worker holds an open read-only connection. Under WAL that never blocks the
 * indexer, but `journal_mode = WAL` can silently fail to apply on some
 * filesystems (see src/db/index.ts), and there a reader held for the lifetime
 * of a long-running MCP server would block writes indefinitely — something the
 * previous statement-scoped connection could not do. Eviction also keeps an
 * idle server from pinning threads for a project nobody is querying.
 */
const CYPHER_RUNTIME_WORKER_IDLE_MS = 30_000;

type PooledWorker = {
  readonly worker: Worker;
  readonly dbPath: string;
  idleTimer?: NodeJS.Timeout;
};

type WorkerPool = {
  readonly idle: PooledWorker[];
  readonly waiters: ((worker: PooledWorker) => void)[];
  live: number;
};

const workerPools = new Map<string, WorkerPool>();
let nextRequestId = 0;

function poolForDatabase(dbPath: string): WorkerPool {
  const existing = workerPools.get(dbPath);
  if (existing !== undefined) {
    return existing;
  }
  const pool: WorkerPool = { idle: [], waiters: [], live: 0 };
  workerPools.set(dbPath, pool);
  return pool;
}

function spawnWorker(dbPath: string): PooledWorker {
  const worker = new Worker(RUNTIME_WORKER_SOURCE, { eval: true, workerData: { dbPath } });
  // An idle worker must never hold the process open — a CLI run that finishes
  // its query would otherwise hang forever on a pooled thread.
  worker.unref();
  return { worker, dbPath };
}

function acquireWorker(dbPath: string): Promise<PooledWorker> {
  const pool = poolForDatabase(dbPath);
  const idle = pool.idle.pop();
  if (idle !== undefined) {
    clearTimeout(idle.idleTimer);
    idle.idleTimer = undefined;
    return Promise.resolve(idle);
  }
  if (pool.live < CYPHER_RUNTIME_MAX_WORKERS) {
    pool.live += 1;
    return Promise.resolve(spawnWorker(dbPath));
  }
  return new Promise<PooledWorker>((resolve) => {
    pool.waiters.push(resolve);
  });
}

function releaseWorker(pooled: PooledWorker): void {
  const pool = poolForDatabase(pooled.dbPath);
  const waiter = pool.waiters.shift();
  if (waiter !== undefined) {
    waiter(pooled);
    return;
  }
  pooled.worker.unref();
  pool.idle.push(pooled);

  pooled.idleTimer = setTimeout(() => {
    const index = pool.idle.indexOf(pooled);
    if (index === -1) {
      return;
    }
    pool.idle.splice(index, 1);
    pool.live -= 1;
    void pooled.worker.terminate();
  }, CYPHER_RUNTIME_WORKER_IDLE_MS);
  pooled.idleTimer.unref?.();
}

/**
 * Drop a worker whose isolate can no longer be trusted — it timed out mid
 * statement (SQLite runs synchronously, so the only way to reclaim it is to
 * kill the thread) or it died outright.
 */
function discardWorker(pooled: PooledWorker): void {
  const pool = poolForDatabase(pooled.dbPath);
  pool.live -= 1;
  void pooled.worker.terminate();

  const waiter = pool.waiters.shift();
  if (waiter !== undefined) {
    pool.live += 1;
    waiter(spawnWorker(pooled.dbPath));
  }
}

function resolveDeadlineMs(): number {
  const configured = Number.parseInt(process.env[CYPHER_RUNTIME_DEADLINE_ENV_VAR] ?? '', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : CYPHER_RUNTIME_DEADLINE_MS;
}

async function executeSqlInWorker(
  dbPath: string,
  request: CypherRuntimeSqlRequest,
): Promise<CypherRuntimeResult> {
  const pooled = await acquireWorker(dbPath);
  const requestId = (nextRequestId += 1);
  pooled.worker.ref();
  runtimeState.activeWorkers += 1;

  return new Promise<CypherRuntimeResult>((resolve) => {
    let settled = false;

    const settle = (result: CypherRuntimeResult, reusable: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pooled.worker.off('message', onMessage);
      pooled.worker.off('error', onError);
      pooled.worker.off('exit', onExit);
      runtimeState.activeWorkers = Math.max(0, runtimeState.activeWorkers - 1);
      if (reusable) {
        releaseWorker(pooled);
      } else {
        discardWorker(pooled);
      }
      resolve(result);
    };

    const onMessage = (message: RuntimeWorkerMessage): void => {
      if (message.requestId !== requestId) {
        return;
      }
      if (message.type === 'success') {
        settle(successResult(message, request.effectiveCap), true);
        return;
      }
      // A rejected statement leaves the connection healthy, so the worker goes
      // back in the pool; only the reported diagnostic changes.
      settle(classifyRuntimeFailure(message.message, EXECUTION_FAILURE_DIAGNOSTIC), true);
    };

    const onError = (error: Error): void => {
      settle(classifyRuntimeFailure(error.message, WORKER_FAILURE_DIAGNOSTIC), false);
    };

    const onExit = (): void => {
      settle(diagnosticResult(...WORKER_EXIT_DIAGNOSTIC), false);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      runtimeState.terminatedWorkers += 1;
      settle(timeoutResult(), false);
    }, resolveDeadlineMs());
    timer.unref?.();

    pooled.worker.on('message', onMessage);
    pooled.worker.on('error', onError);
    pooled.worker.on('exit', onExit);
    pooled.worker.postMessage({
      requestId,
      sql: request.sql,
      boundParameters: [...(request.boundParameters ?? [])],
    });
  });
}

type DiagnosticSpec = readonly [code: string, message: string, expected: string, anchor: string];

const EXECUTION_FAILURE_DIAGNOSTIC: DiagnosticSpec = [
  'CYPHER_RUNTIME_ERROR',
  'Cypher runtime failed while executing a read-only statement.',
  'read-only SQLite statement',
  'runtime',
];

const WORKER_FAILURE_DIAGNOSTIC: DiagnosticSpec = [
  'CYPHER_RUNTIME_ERROR',
  'Cypher runtime worker failed before completing the read-only statement.',
  'healthy runtime worker',
  'runtime',
];

const WORKER_EXIT_DIAGNOSTIC: DiagnosticSpec = [
  'CYPHER_RUNTIME_ERROR',
  'Cypher runtime worker exited before completing the read-only statement.',
  'healthy runtime worker',
  'runtime',
];

/**
 * Turn a raw worker failure into a diagnostic without echoing it.
 *
 * The generated SQL must never reach the caller, so an arbitrary SQLite message
 * cannot be forwarded verbatim — it can quote column names and query fragments.
 * Two causes are worth naming anyway because the generic text sends the reader
 * hunting in the wrong place: a runtime that has no usable `node:sqlite` (the
 * package's engine range still admits Node 20, where it is absent) and a
 * contended database. Everything else keeps the unrevealing wording.
 */
function classifyRuntimeFailure(rawMessage: string, fallback: DiagnosticSpec): CypherRuntimeDiagnosticResult {
  if (/node:sqlite|DatabaseSync|ERR_UNKNOWN_BUILTIN_MODULE/i.test(rawMessage)) {
    return diagnosticResult(
      'CYPHER_RUNTIME_UNAVAILABLE',
      'Cypher requires the built-in node:sqlite module with FTS5. Use Node 22.16+ (22.x) or Node 24.x; the self-contained CodeGraph CLI bundles a compatible runtime.',
      'node:sqlite-capable runtime',
      'runtime',
    );
  }
  if (/SQLITE_BUSY|database is locked/i.test(rawMessage)) {
    return diagnosticResult(
      'CYPHER_RUNTIME_BUSY',
      'The CodeGraph index is locked by another writer; retry once indexing or sync finishes.',
      'uncontended CodeGraph index',
      'runtime',
    );
  }
  return diagnosticResult(...fallback);
}

function successResult(
  message: RuntimeWorkerSuccessMessage,
  effectiveCap = message.rows.length,
): CypherRuntimeSuccessResult {
  return {
    status: 'success',
    columns: message.columns,
    rows: message.rows.slice(0, effectiveCap),
    effectiveCap,
    truncated: message.rows.length > effectiveCap,
  };
}

function timeoutResult(): CypherRuntimeTimeoutResult {
  return {
    status: 'timeout',
    code: 'CYPHER_TIMEOUT',
    deadlineMs: CYPHER_RUNTIME_DEADLINE_MS,
    guidance: 'Query exceeded the fixed Cypher deadline; narrow MATCH relationship depth, WHERE, RETURN, or LIMIT.',
  };
}

function validateReadOnlySql(sql: string): CypherRuntimeDiagnosticResult | undefined {
  const trimmedSql = sql.trim();
  if (!/^(SELECT|WITH RECURSIVE)\b/i.test(trimmedSql)) {
    return diagnosticResult(
      'CYPHER_UNSUPPORTED_CLAUSE',
      'Cypher runtime only prepares generated read-only SELECT statements.',
      'SELECT or WITH RECURSIVE',
      'runtime',
    );
  }
  if (trimmedSql.includes(';')) {
    return diagnosticResult(
      'CYPHER_UNSUPPORTED_CLAUSE',
      'Cypher runtime rejects SQL statement lists before prepare.',
      'single read-only statement',
      'runtime',
    );
  }
  if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(trimmedSql)) {
    return diagnosticResult(
      'CYPHER_UNSUPPORTED_CLAUSE',
      'Cypher runtime rejects mutating SQL before prepare.',
      'read-only SELECT statement',
      'runtime',
    );
  }
  return undefined;
}

function diagnosticResult(
  code: string,
  message: string,
  expected: string,
  anchor: string,
): CypherRuntimeDiagnosticResult {
  return {
    status: 'diagnostic',
    code,
    message,
    offset: 0,
    line: 1,
    column: 0,
    expected,
    anchor,
    excerpt: '',
    truncatedBefore: false,
    truncatedAfter: false,
  };
}
