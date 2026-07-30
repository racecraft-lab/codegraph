import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { getCodeGraphDir } from '../../directory';
import { SqliteDatabase, createDatabase } from '../../db/sqlite-adapter';

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
};

export type CypherRuntimeTestOptions = {
  readonly forceTimeout?: boolean;
  readonly onSqlPrepare?: (sql: string) => void;
};

type RuntimeWorkerSuccessMessage = {
  readonly type: 'success';
  readonly rows: readonly Record<string, unknown>[];
  readonly columns: readonly string[];
};

type RuntimeWorkerErrorMessage = {
  readonly type: 'error';
  readonly message: string;
};

type RuntimeWorkerMessage = RuntimeWorkerSuccessMessage | RuntimeWorkerErrorMessage;

const CYPHER_RUNTIME_DEADLINE_MS = 5000 as const;
const CYPHER_FORCE_TIMEOUT_TEST_DEADLINE_MS = 25 as const;

const runtimeState = {
  activeWorkers: 0,
  terminatedWorkers: 0,
};

const RUNTIME_WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('node:sqlite');

if (workerData.forceTimeout) {
  setInterval(() => {}, 1000);
} else {
  let db;
  try {
    db = new DatabaseSync(workerData.dbPath, { readOnly: true });
    const statement = db.prepare(workerData.sql);
    const rows = statement.all(...workerData.boundParameters);
    const firstRow = rows[0];
    const columns = firstRow && typeof firstRow === 'object' ? Object.keys(firstRow) : [];
    parentPort.postMessage({ type: 'success', rows, columns });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      if (db && db.isOpen) db.close();
    } catch {}
  }
}
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

  return executeSqlInWorker(dbPath, request, options);
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

function executeSqlInWorker(
  dbPath: string,
  request: CypherRuntimeSqlRequest,
  options: CypherRuntimeTestOptions,
): Promise<CypherRuntimeResult> {
  const worker = new Worker(RUNTIME_WORKER_SOURCE, {
    eval: true,
    workerData: {
      dbPath,
      sql: request.sql,
      boundParameters: [...(request.boundParameters ?? [])],
      forceTimeout: options.forceTimeout === true,
    },
  });
  runtimeState.activeWorkers += 1;

  return new Promise<CypherRuntimeResult>((resolve) => {
    let settled = false;

    const finish = (result: CypherRuntimeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      runtimeState.activeWorkers = Math.max(0, runtimeState.activeWorkers - 1);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void terminateTimedOutWorker(worker).then(() => {
        clearTimeout(timer);
        runtimeState.activeWorkers = Math.max(0, runtimeState.activeWorkers - 1);
        runtimeState.terminatedWorkers += 1;
        resolve(timeoutResult());
      });
    }, options.forceTimeout === true ? CYPHER_FORCE_TIMEOUT_TEST_DEADLINE_MS : CYPHER_RUNTIME_DEADLINE_MS);
    timer.unref?.();

    worker.once('message', (message: RuntimeWorkerMessage) => {
      if (message.type === 'success') {
        void worker.terminate();
        finish(successResult(message, request.effectiveCap));
        return;
      }

      void worker.terminate();
      finish(diagnosticResult(
        'CYPHER_RUNTIME_ERROR',
        'Cypher runtime failed while executing a read-only statement.',
        'read-only SQLite statement',
        'runtime',
      ));
    });

    worker.once('error', () => {
      finish(diagnosticResult(
        'CYPHER_RUNTIME_ERROR',
        'Cypher runtime worker failed before completing the read-only statement.',
        'healthy runtime worker',
        'runtime',
      ));
    });

    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        finish(diagnosticResult(
          'CYPHER_RUNTIME_ERROR',
          'Cypher runtime worker exited before completing the read-only statement.',
          'healthy runtime worker',
          'runtime',
        ));
      }
    });
  });
}

async function terminateTimedOutWorker(worker: Worker): Promise<void> {
  try {
    await worker.terminate();
  } catch {
    worker.unref();
  }
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
    guidance: 'Query exceeded the fixed Cypher deadline; narrow MATCH, WHERE, RETURN, or LIMIT.',
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
  if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmedSql)) {
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
