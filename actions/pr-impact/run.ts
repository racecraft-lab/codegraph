import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_VERSION = '0.1.0-spec-020';
export const DEFAULT_CODEGRAPH_VERSION = '1.4.1';
export const ACTION_MARKER = '<!-- codegraph-pr-impact-action -->';

export type SummaryStatus = 'clean' | 'impact' | 'threshold_breach' | 'unavailable';
export type DetectorExitCode = 0 | 1 | 2 | 3;
export type CacheStatus =
  | 'warm-valid'
  | 'miss'
  | 'stale'
  | 'corrupt'
  | 'incompatible'
  | 'rebuilt'
  | 'unavailable';
export type DeliveryStatus = 'comment' | 'fallback' | 'failed';
export type NarrativeStatus =
  | 'disabled'
  | 'suppressed'
  | 'unavailable'
  | 'fallback'
  | 'pending'
  | 'appended';
export type FinalConclusion =
  | 'pass'
  | 'fail-threshold'
  | 'fail-analysis-unavailable'
  | 'fail-report-unavailable';

export interface PullRequestContext {
  repository: string;
  pullNumber: number | null;
  baseRef: string;
  headSha: string;
  mergeBase: string | null;
  isForkLike: boolean;
  tokenPermissions: {
    contentsRead: boolean;
    issuesWrite: boolean;
    pullRequestsWrite: boolean;
  };
}

export interface ActionInputs {
  codegraphVersion: string;
  baseRef: string;
  failOnCallers: number | null;
  failOnHubs: boolean;
  callerDepth: number;
  maxCallers: number;
  narrative: 'off' | 'trusted';
}

export interface DetectorResult {
  summary: {
    status: SummaryStatus;
    baseRef: string | null;
    changedSymbolCount: number;
    unmappedHunkCount: number;
    callerCount: number;
    affectedFlowCount: number;
    riskCount: number;
    warningCount: number;
  };
  exitCode: DetectorExitCode;
  changedSymbols: unknown[];
  unmappedHunks: unknown[];
  callers: unknown[];
  affectedFlows: {
    state: string;
    items: unknown[];
    truncated: boolean;
  };
  risks: unknown[];
  warnings: unknown[];
  limits: Record<string, unknown>;
}

export interface DeliveryResult {
  status: DeliveryStatus;
  comment: 'updated' | 'created' | 'skipped' | 'permission-denied' | 'failed';
  summary: 'written' | 'failed';
  artifact: 'uploaded' | 'failed';
  currentCommentId: string | null;
  duplicateCommentIds: string[];
  reportPath: string;
}

export interface NarrativeResult {
  status: NarrativeStatus;
  text: string | null;
  handle: string | null;
}

export interface RunResult {
  inputs: ActionInputs;
  detector: DetectorResult;
  delivery: DeliveryResult;
  narrative: NarrativeResult;
  conclusion: FinalConclusion;
  report: string;
}

export interface RunDependencies {
  env: NodeJS.ProcessEnv;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  now: () => Date;
  appendFileSync: typeof appendFileSync;
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
}

export function createRunDependencies(): RunDependencies {
  return {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => new Date(),
    appendFileSync,
    mkdirSync,
    writeFileSync,
  };
}

export function parseActionInputs(env: NodeJS.ProcessEnv): ActionInputs {
  const narrative = readInput(env, 'NARRATIVE', 'off');
  return {
    codegraphVersion: readInput(env, 'CODEGRAPH_VERSION', DEFAULT_CODEGRAPH_VERSION),
    baseRef: readInput(env, 'BASE_REF', ''),
    failOnCallers: parseOptionalInteger(readInput(env, 'FAIL_ON_CALLERS', '')),
    failOnHubs: parseBoolean(readInput(env, 'FAIL_ON_HUBS', 'false')),
    callerDepth: parseInteger(readInput(env, 'CALLER_DEPTH', '1'), 1),
    maxCallers: parseInteger(readInput(env, 'MAX_CALLERS', '20'), 20),
    narrative: narrative === 'trusted' ? 'trusted' : 'off',
  };
}

export function determineConclusion(
  detector: Pick<DetectorResult, 'summary' | 'exitCode'>,
  durableReportAvailable: boolean,
): FinalConclusion {
  if (detector.summary.status === 'threshold_breach' || detector.exitCode === 2) {
    return 'fail-threshold';
  }
  if (detector.summary.status === 'unavailable' || detector.exitCode === 3) {
    return 'fail-analysis-unavailable';
  }
  if (!durableReportAvailable) {
    return 'fail-report-unavailable';
  }
  return 'pass';
}

export async function runAction(deps: RunDependencies = createRunDependencies()): Promise<RunResult> {
  const inputs = parseActionInputs(deps.env);
  const reportPath = deps.env.PR_IMPACT_REPORT_PATH ?? 'pr-impact-report.md';
  const artifactName = deps.env.PR_IMPACT_ARTIFACT_NAME ?? 'codegraph-pr-impact';
  const detector = createUnavailableDetector(inputs);
  const delivery = createInitialDelivery(reportPath);
  const narrative = createInitialNarrative(inputs);
  const conclusion = determineConclusion(detector, delivery.status !== 'failed');
  const report = renderReport({
    inputs,
    detector,
    delivery,
    narrative,
    conclusion,
    artifactName,
    recordedAt: deps.now().toISOString(),
  });

  deps.mkdirSync(dirname(reportPath), { recursive: true });
  deps.writeFileSync(reportPath, report, 'utf8');

  emitOutput(deps, 'summary-status', detector.summary.status);
  emitOutput(deps, 'detector-exit-code', String(detector.exitCode));
  emitOutput(deps, 'conclusion', conclusion);
  emitOutput(deps, 'threshold-breached', String(detector.summary.status === 'threshold_breach'));
  emitOutput(deps, 'cache-status', 'unavailable');
  emitOutput(deps, 'delivery-status', delivery.status);
  emitOutput(deps, 'comment-url', '');
  emitOutput(deps, 'report-path', reportPath);
  emitOutput(deps, 'artifact-name', artifactName);
  emitOutput(deps, 'narrative-status', narrative.status);
  emitOutput(deps, 'codegraph-version', inputs.codegraphVersion);
  emitOutput(deps, 'helper-version', HELPER_VERSION);

  return { inputs, detector, delivery, narrative, conclusion, report };
}

function createUnavailableDetector(inputs: ActionInputs): DetectorResult {
  return {
    summary: {
      status: 'unavailable',
      baseRef: inputs.baseRef || null,
      changedSymbolCount: 0,
      unmappedHunkCount: 0,
      callerCount: 0,
      affectedFlowCount: 0,
      riskCount: 1,
      warningCount: 1,
    },
    exitCode: 3,
    changedSymbols: [],
    unmappedHunks: [],
    callers: [],
    affectedFlows: {
      state: 'unavailable',
      items: [],
      truncated: false,
    },
    risks: [
      {
        code: 'analysis-unavailable',
        severity: 'error',
        targetId: 'pr-impact-helper',
        message: 'SPEC-020 action helper scaffold is not fully implemented yet.',
      },
    ],
    warnings: [
      {
        code: 'scaffold',
        message: 'Generated runtime placeholder is present; detector execution is implemented in later tasks.',
      },
    ],
    limits: {
      callerDepth: inputs.callerDepth,
      maxCallers: inputs.maxCallers,
    },
  };
}

function createInitialDelivery(reportPath: string): DeliveryResult {
  return {
    status: 'fallback',
    comment: 'skipped',
    summary: 'written',
    artifact: 'uploaded',
    currentCommentId: null,
    duplicateCommentIds: [],
    reportPath,
  };
}

function createInitialNarrative(inputs: ActionInputs): NarrativeResult {
  return {
    status: inputs.narrative === 'trusted' ? 'unavailable' : 'disabled',
    text: null,
    handle: null,
  };
}

function renderReport(args: {
  inputs: ActionInputs;
  detector: DetectorResult;
  delivery: DeliveryResult;
  narrative: NarrativeResult;
  conclusion: FinalConclusion;
  artifactName: string;
  recordedAt: string;
}): string {
  const { inputs, detector, delivery, narrative, conclusion, artifactName, recordedAt } = args;
  return [
    ACTION_MARKER,
    '',
    '# CodeGraph PR Impact',
    '',
    '## Run metadata',
    '',
    `- Recorded at: ${recordedAt}`,
    `- Base ref: ${inputs.baseRef || 'unresolved'}`,
    `- CodeGraph version: ${inputs.codegraphVersion}`,
    `- Helper version: ${HELPER_VERSION}`,
    '',
    '## Summary',
    '',
    `- Detector status: ${detector.summary.status}`,
    `- Detector exit code: ${detector.exitCode}`,
    `- Final conclusion: ${conclusion}`,
    `- Cache status: unavailable`,
    `- Delivery status: ${delivery.status}`,
    `- Narrative status: ${narrative.status}`,
    `- Artifact: ${artifactName}`,
    '',
    '## Changed symbols',
    '',
    '- None recorded.',
    '',
    '## Impacted callers',
    '',
    '- None recorded.',
    '',
    '## Affected flows',
    '',
    `- State: ${detector.affectedFlows.state}`,
    '',
    '## Risks',
    '',
    ...formatItems(detector.risks),
    '',
    '## Warnings',
    '',
    ...formatItems(detector.warnings),
    '',
    '## Limits',
    '',
    `- Caller depth: ${inputs.callerDepth}`,
    `- Max callers: ${inputs.maxCallers}`,
    '',
    '## Fallback delivery note',
    '',
    `- Report path: ${delivery.reportPath}`,
    '- Comment delivery is not attempted by the setup scaffold.',
    '',
  ].join('\n');
}

function formatItems(items: unknown[]): string[] {
  if (items.length === 0) return ['- None.'];
  return items.map((item) => `- ${JSON.stringify(item)}`);
}

function emitOutput(deps: RunDependencies, name: string, value: string): void {
  const outputFile = deps.env.GITHUB_OUTPUT;
  if (outputFile) {
    deps.appendFileSync(outputFile, `${name}=${escapeOutputFileValue(value)}\n`, 'utf8');
    return;
  }
  deps.stdout.write(`::set-output name=${name}::${escapeCommandValue(value)}\n`);
}

function readInput(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return env[`INPUT_${name}`] ?? fallback;
}

function parseOptionalInteger(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(raw: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function escapeOutputFileValue(value: string): string {
  return value.replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeCommandValue(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function isDirectRun(metaUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && fileURLToPath(metaUrl) === argvPath;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  runAction().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CodeGraph PR impact helper failed: ${message}\n`);
    process.exitCode = 1;
  });
}
