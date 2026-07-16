import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
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
  commentUrl: string;
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
  readFileSync: typeof readFileSync;
  execFileSync: typeof execFileSync;
  fetch: FetchLike;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export function createRunDependencies(): RunDependencies {
  return {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => new Date(),
    appendFileSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    execFileSync,
    fetch: globalThis.fetch as FetchLike,
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
  const context = readPullRequestContext(deps, inputs);
  const reportPath = deps.env.PR_IMPACT_REPORT_PATH ?? 'pr-impact-report.md';
  const artifactName = deps.env.PR_IMPACT_ARTIFACT_NAME ?? 'codegraph-pr-impact';
  const detector = runDetector(deps, inputs);
  const narrative = createInitialNarrative(inputs);
  let delivery = createInitialDelivery(reportPath);
  const conclusion = determineConclusion(detector, delivery.status !== 'failed');
  const report = renderReport({
    inputs,
    context,
    detector,
    delivery,
    narrative,
    conclusion,
    artifactName,
    recordedAt: deps.now().toISOString(),
  });

  deps.mkdirSync(dirname(reportPath), { recursive: true });
  deps.writeFileSync(reportPath, report, 'utf8');
  delivery = await deliverReport(deps, context, report, reportPath);

  emitOutput(deps, 'summary-status', detector.summary.status);
  emitOutput(deps, 'detector-exit-code', String(detector.exitCode));
  emitOutput(deps, 'conclusion', conclusion);
  emitOutput(deps, 'threshold-breached', String(detector.summary.status === 'threshold_breach'));
  emitOutput(deps, 'cache-status', 'unavailable');
  emitOutput(deps, 'delivery-status', delivery.status);
  emitOutput(deps, 'comment-url', delivery.commentUrl);
  emitOutput(deps, 'report-path', reportPath);
  emitOutput(deps, 'artifact-name', artifactName);
  emitOutput(deps, 'narrative-status', narrative.status);
  emitOutput(deps, 'codegraph-version', inputs.codegraphVersion);
  emitOutput(deps, 'helper-version', HELPER_VERSION);

  return { inputs, detector, delivery, narrative, conclusion, report };
}

function readPullRequestContext(deps: RunDependencies, inputs: ActionInputs): PullRequestContext {
  const event = readGitHubEvent(deps);
  const repository = stringAt(event, ['repository', 'full_name']) || deps.env.GITHUB_REPOSITORY || '';
  const pullNumber = numberAt(event, ['pull_request', 'number']);
  const baseRef = inputs.baseRef || stringAt(event, ['pull_request', 'base', 'ref']) || '';
  const headSha = stringAt(event, ['pull_request', 'head', 'sha']) || deps.env.GITHUB_SHA || '';
  const baseSha = stringAt(event, ['pull_request', 'base', 'sha']);
  const headRepo = stringAt(event, ['pull_request', 'head', 'repo', 'full_name']);
  const baseRepo = stringAt(event, ['pull_request', 'base', 'repo', 'full_name']) || repository;

  return {
    repository,
    pullNumber,
    baseRef,
    headSha,
    mergeBase: deps.env.PR_IMPACT_MERGE_BASE ?? baseSha ?? null,
    isForkLike: headRepo !== '' && baseRepo !== '' && headRepo !== baseRepo,
    tokenPermissions: {
      contentsRead: true,
      issuesWrite: Boolean(deps.env.GITHUB_TOKEN),
      pullRequestsWrite: Boolean(deps.env.GITHUB_TOKEN),
    },
  };
}

function readGitHubEvent(deps: RunDependencies): unknown {
  const eventPath = deps.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  try {
    return JSON.parse(String(deps.readFileSync(eventPath, 'utf8')));
  } catch {
    return {};
  }
}

function runDetector(deps: RunDependencies, inputs: ActionInputs): DetectorResult {
  const baseRef = inputs.baseRef || 'HEAD^';
  const jsonArgs = detectorArgs(inputs, baseRef, 'json');
  const markdownArgs = detectorArgs(inputs, baseRef, 'markdown');
  try {
    const json = runDetectorCommand(deps, jsonArgs);
    runDetectorCommand(deps, markdownArgs);
    return normalizeDetectorResult(JSON.parse(json), inputs);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return createUnavailableDetector(inputs, message);
  }
}

function detectorArgs(inputs: ActionInputs, baseRef: string, format: 'json' | 'markdown'): string[] {
  const args = [
    'detect-changes',
    '--mode', 'base-ref',
    '--base-ref', baseRef,
    '--format', format,
    '--caller-depth', String(inputs.callerDepth),
    '--max-callers', String(inputs.maxCallers),
  ];
  const failOn = failOnPolicy(inputs);
  if (failOn) args.push('--fail-on', failOn);
  return args;
}

function failOnPolicy(inputs: ActionInputs): string {
  const policies: string[] = [];
  if (inputs.failOnCallers !== null) policies.push(`callers>${inputs.failOnCallers}`);
  if (inputs.failOnHubs) policies.push('hub');
  return policies.join(',');
}

function runDetectorCommand(deps: RunDependencies, args: string[]): string {
  try {
    return String(deps.execFileSync('codegraph', args, {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error: unknown) {
    const maybe = error as { stdout?: string | Buffer; status?: number };
    if ((maybe.status === 1 || maybe.status === 2 || maybe.status === 3) && maybe.stdout) {
      return String(maybe.stdout);
    }
    throw error;
  }
}

function normalizeDetectorResult(raw: unknown, inputs: ActionInputs): DetectorResult {
  const candidate = raw as Partial<DetectorResult>;
  const summary = (candidate.summary ?? {}) as Partial<DetectorResult['summary']>;
  return {
    summary: {
      status: isSummaryStatus(summary.status) ? summary.status : 'unavailable',
      baseRef: typeof summary.baseRef === 'string' ? summary.baseRef : inputs.baseRef || null,
      changedSymbolCount: numberOr(summary.changedSymbolCount, 0),
      unmappedHunkCount: numberOr(summary.unmappedHunkCount, 0),
      callerCount: numberOr(summary.callerCount, 0),
      affectedFlowCount: numberOr(summary.affectedFlowCount, 0),
      riskCount: numberOr(summary.riskCount, 0),
      warningCount: numberOr(summary.warningCount, 0),
    },
    exitCode: isDetectorExitCode(candidate.exitCode) ? candidate.exitCode : 3,
    changedSymbols: Array.isArray(candidate.changedSymbols) ? candidate.changedSymbols : [],
    unmappedHunks: Array.isArray(candidate.unmappedHunks) ? candidate.unmappedHunks : [],
    callers: Array.isArray(candidate.callers) ? candidate.callers : [],
    affectedFlows: normalizeAffectedFlows(candidate.affectedFlows),
    risks: Array.isArray(candidate.risks) ? candidate.risks : [],
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
    limits: typeof candidate.limits === 'object' && candidate.limits !== null ? candidate.limits : {
      callerDepth: inputs.callerDepth,
      maxCallers: inputs.maxCallers,
    },
  };
}

function createUnavailableDetector(inputs: ActionInputs, message = 'SPEC-020 action helper could not run detect-changes.'): DetectorResult {
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
        message,
      },
    ],
    warnings: [
      {
        code: 'scaffold',
        message: 'Detector execution failed; unavailable report emitted.',
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
      commentUrl: '',
  };
}

async function deliverReport(
  deps: RunDependencies,
  context: PullRequestContext,
  report: string,
  reportPath: string,
): Promise<DeliveryResult> {
  let summary: DeliveryResult['summary'] = 'failed';
  try {
    if (deps.env.GITHUB_STEP_SUMMARY) {
      deps.appendFileSync(deps.env.GITHUB_STEP_SUMMARY, `${report}\n`, 'utf8');
    }
    summary = 'written';
  } catch {
    summary = 'failed';
  }

  const base: DeliveryResult = {
    status: summary === 'written' ? 'fallback' : 'failed',
    comment: 'skipped',
    summary,
    artifact: 'uploaded',
    currentCommentId: null,
    duplicateCommentIds: [],
    reportPath,
    commentUrl: '',
  };

  if (!deps.env.GITHUB_TOKEN || context.pullNumber === null || context.isForkLike) {
    return base;
  }

  const comments = await listComments(deps, context);
  if (comments === null) {
    return { ...base, comment: 'permission-denied' };
  }

  const marked = comments
    .filter((comment) => comment.body.includes(ACTION_MARKER))
    .sort(compareCommentNewestFirst);
  const current = marked[0];
  const duplicates = marked.slice(1);
  const duplicateIds: string[] = [];

  if (current) {
    const updated = await patchComment(deps, context, current.id, report);
    for (const duplicate of duplicates) {
      const retired = await patchComment(
        deps,
        context,
        duplicate.id,
        `${ACTION_MARKER}\n\n_Retired duplicate CodeGraph PR impact report._`,
      );
      if (retired) duplicateIds.push(String(duplicate.id));
    }
    if (updated) {
      return {
        ...base,
        status: 'comment',
        comment: 'updated',
        currentCommentId: String(current.id),
        duplicateCommentIds: duplicateIds,
        commentUrl: current.html_url,
      };
    }
    return { ...base, comment: 'failed' };
  }

  const created = await createComment(deps, context, report);
  if (!created) return { ...base, comment: 'failed' };
  return {
    ...base,
    status: 'comment',
    comment: 'created',
    currentCommentId: String(created.id),
    commentUrl: created.html_url,
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
  context: PullRequestContext;
  detector: DetectorResult;
  delivery: DeliveryResult;
  narrative: NarrativeResult;
  conclusion: FinalConclusion;
  artifactName: string;
  recordedAt: string;
}): string {
  const { inputs, context, detector, delivery, narrative, conclusion, artifactName, recordedAt } = args;
  return [
    ACTION_MARKER,
    '',
    '# CodeGraph PR Impact',
    '',
    '## Run metadata',
    '',
    `- Recorded at: ${recordedAt}`,
    `- Repository: ${context.repository || 'unknown'}`,
    `- Pull request: ${context.pullNumber === null ? 'unknown' : `#${context.pullNumber}`}`,
    `- Base ref: ${inputs.baseRef || 'unresolved'}`,
    `- Head SHA: ${context.headSha || 'unknown'}`,
    `- Merge base: ${context.mergeBase ?? 'unknown'}`,
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
    ...formatChangedSymbols(detector.changedSymbols),
    '',
    '## Impacted callers',
    '',
    ...formatCallers(detector.callers),
    '',
    '## Affected flows',
    '',
    ...formatAffectedFlows(detector.affectedFlows),
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

interface GitHubComment {
  id: number | string;
  body: string;
  created_at?: string;
  html_url: string;
}

async function listComments(deps: RunDependencies, context: PullRequestContext): Promise<GitHubComment[] | null> {
  const response = await deps.fetch(issueCommentsUrl(deps, context), {
    method: 'GET',
    headers: githubHeaders(deps),
  });
  if (!response.ok) return null;
  const json = await response.json();
  if (!Array.isArray(json)) return [];
  return json.filter(isGitHubComment);
}

async function createComment(
  deps: RunDependencies,
  context: PullRequestContext,
  body: string,
): Promise<GitHubComment | null> {
  const response = await deps.fetch(issueCommentsUrl(deps, context), {
    method: 'POST',
    headers: githubHeaders(deps),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) return null;
  const json = await response.json();
  return isGitHubComment(json) ? json : null;
}

async function patchComment(
  deps: RunDependencies,
  context: PullRequestContext,
  id: number | string,
  body: string,
): Promise<boolean> {
  const response = await deps.fetch(`${apiBase(deps)}/repos/${context.repository}/issues/comments/${id}`, {
    method: 'PATCH',
    headers: githubHeaders(deps),
    body: JSON.stringify({ body }),
  });
  return response.ok;
}

function issueCommentsUrl(deps: RunDependencies, context: PullRequestContext): string {
  return `${apiBase(deps)}/repos/${context.repository}/issues/${context.pullNumber}/comments`;
}

function apiBase(deps: RunDependencies): string {
  return deps.env.GITHUB_API_URL ?? 'https://api.github.com';
}

function githubHeaders(deps: RunDependencies): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (deps.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${deps.env.GITHUB_TOKEN}`;
  return headers;
}

function compareCommentNewestFirst(left: GitHubComment, right: GitHubComment): number {
  const leftTime = Date.parse(left.created_at ?? '');
  const rightTime = Date.parse(right.created_at ?? '');
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return Number(right.id) - Number(left.id);
}

function isGitHubComment(value: unknown): value is GitHubComment {
  const candidate = value as Partial<GitHubComment>;
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    (typeof candidate.id === 'number' || typeof candidate.id === 'string') &&
    typeof candidate.body === 'string' &&
    typeof candidate.html_url === 'string'
  );
}

function formatChangedSymbols(items: unknown[]): string[] {
  if (items.length === 0) return ['- None.'];
  return items.map((item) => {
    const symbol = item as Record<string, unknown>;
    return `- ${stringField(symbol, 'qualifiedName') || stringField(symbol, 'name') || 'unknown'} (${stringField(symbol, 'kind') || 'symbol'}) — ${stringField(symbol, 'filePath') || 'unknown path'}`;
  });
}

function formatCallers(items: unknown[]): string[] {
  if (items.length === 0) return ['- None.'];
  return items.map((item) => {
    const caller = item as Record<string, unknown>;
    return `- ${stringField(caller, 'qualifiedName') || stringField(caller, 'name') || 'unknown'} — ${stringField(caller, 'filePath') || 'unknown path'}`;
  });
}

function formatAffectedFlows(flows: DetectorResult['affectedFlows']): string[] {
  const lines = [`- State: ${flows.state}`];
  if (flows.items.length === 0) return lines;
  for (const item of flows.items) {
    const flow = item as Record<string, unknown>;
    lines.push(`- ${stringField(flow, 'name') || stringField(flow, 'flowId') || 'unknown flow'}`);
  }
  return lines;
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

function stringAt(value: unknown, pathParts: string[]): string {
  let current = value;
  for (const part of pathParts) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : '';
}

function numberAt(value: unknown, pathParts: string[]): number | null {
  let current = value;
  for (const part of pathParts) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'number' ? current : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  return typeof fieldValue === 'string' ? fieldValue : '';
}

function normalizeAffectedFlows(value: unknown): DetectorResult['affectedFlows'] {
  const flows = value as Partial<DetectorResult['affectedFlows']>;
  return {
    state: typeof flows?.state === 'string' ? flows.state : 'unavailable',
    items: Array.isArray(flows?.items) ? flows.items : [],
    truncated: typeof flows?.truncated === 'boolean' ? flows.truncated : false,
  };
}

function isSummaryStatus(value: unknown): value is SummaryStatus {
  return value === 'clean' || value === 'impact' || value === 'threshold_breach' || value === 'unavailable';
}

function isDetectorExitCode(value: unknown): value is DetectorExitCode {
  return value === 0 || value === 1 || value === 2 || value === 3;
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
