import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_VERSION = '0.1.0-spec-020';
export const DEFAULT_CODEGRAPH_VERSION = '1.5.0';
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
  runId: string;
  runAttempt: string;
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
  artifact: 'pending' | 'failed';
  currentCommentId: string | null;
  duplicateCommentIds: string[];
  failedDuplicateCommentIds: string[];
  reportPath: string;
  commentUrl: string;
}

export interface NarrativeResult {
  status: NarrativeStatus;
  text: string | null;
  handle: string | null;
}

export interface CacheIdentity {
  repository: string;
  codegraphVersion: string;
  baseRef: string;
  headSha: string;
  mergeBase: string;
  lockfileHash: string;
}

interface CacheMetadata {
  schemaVersion: 1;
  helperVersion: string;
  recordedAt: string;
  identity: CacheIdentity;
}

type BaseIndexPreparation =
  | { status: 'not-needed'; dir: null }
  | { status: 'ready'; dir: string }
  | { status: 'failed'; dir: null; message: string };

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
  cpSync?: typeof cpSync;
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  rmSync: typeof rmSync;
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
    cpSync,
    existsSync,
    mkdirSync,
    rmSync,
    writeFileSync,
    readFileSync,
    execFileSync,
    fetch: globalThis.fetch as FetchLike,
  };
}

export function parseActionInputs(env: NodeJS.ProcessEnv): ActionInputs {
  const narrative = readInput(env, 'NARRATIVE', 'off');
  const requestedCodegraphVersion = readInput(env, 'CODEGRAPH_VERSION', DEFAULT_CODEGRAPH_VERSION);
  return {
    codegraphVersion: env.PR_IMPACT_CODEGRAPH_RESOLVED_VERSION || requestedCodegraphVersion,
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
  const workspaceHeadError = validateWorkspaceHead(deps, context);
  const cacheStatus = workspaceHeadError ? 'unavailable' : prepareCache(deps, inputs, context);
  const effectiveBaseRef = resolveBaseRef(inputs, context);
  const baseIndex = cacheStatus === 'unavailable'
    ? { status: 'not-needed', dir: null } as BaseIndexPreparation
    : prepareBaseIndexIfNeeded(deps, context);
  const detector = workspaceHeadError
    ? createUnavailableDetector(inputs, workspaceHeadError, effectiveBaseRef)
    : cacheStatus === 'unavailable'
    ? createUnavailableDetector(inputs, 'CodeGraph cache/index is unavailable.', effectiveBaseRef)
    : baseIndex.status === 'failed'
      ? createUnavailableDetector(inputs, baseIndex.message, effectiveBaseRef)
      : runDetector(deps, inputs, context, baseIndex.dir);
  const narrative = createInitialNarrative(inputs, context, deps);
  let delivery = createInitialDelivery(reportPath);
  let conclusion = determineConclusion(detector, delivery.status !== 'failed');
  const preliminaryReport = renderReport({
    inputs,
    context,
    detector,
    delivery,
    narrative,
    conclusion,
    cacheStatus,
    artifactName,
    recordedAt: deps.now().toISOString(),
  });

  const preliminaryReportFileWritten = writeReportFile(deps, reportPath, preliminaryReport);
  delivery = await deliverReportComment(deps, context, preliminaryReport, reportPath, preliminaryReportFileWritten);
  conclusion = determineConclusion(detector, delivery.status !== 'failed');
  let report = renderReport({
    inputs,
    context,
    detector,
    delivery,
    narrative,
    conclusion,
    cacheStatus,
    artifactName,
    recordedAt: deps.now().toISOString(),
  });
  if (delivery.status === 'comment') {
    const finalizedComment = await patchDeliveredComment(deps, context, delivery, report);
    if (!finalizedComment) {
      delivery = {
        ...delivery,
        status: preliminaryReportFileWritten ? 'fallback' : 'failed',
        comment: 'failed',
      };
      conclusion = determineConclusion(detector, delivery.status !== 'failed');
      report = renderReport({
        inputs,
        context,
        detector,
        delivery,
        narrative,
        conclusion,
        cacheStatus,
        artifactName,
        recordedAt: deps.now().toISOString(),
      });
    }
  }
  const reportFileWritten = writeReportFile(deps, reportPath, report);
  delivery = {
    ...delivery,
    status: delivery.status === 'comment' ? 'comment' : reportFileWritten ? 'fallback' : 'failed',
    artifact: reportFileWritten ? 'pending' : 'failed',
    summary: writeSummary(deps, report),
  };
  conclusion = determineConclusion(detector, delivery.status !== 'failed');
  if (delivery.status === 'failed' && delivery.summary === 'written') {
    delivery = { ...delivery, status: 'fallback' };
    conclusion = determineConclusion(detector, true);
    report = renderReport({
      inputs,
      context,
      detector,
      delivery,
      narrative,
      conclusion,
      cacheStatus,
      artifactName,
      recordedAt: deps.now().toISOString(),
    });
    if (reportFileWritten) writeReportFile(deps, reportPath, report);
  }

  emitOutput(deps, 'summary-status', detector.summary.status);
  emitOutput(deps, 'detector-exit-code', String(detector.exitCode));
  emitOutput(deps, 'conclusion', conclusion);
  emitOutput(deps, 'threshold-breached', String(detector.summary.status === 'threshold_breach'));
  emitOutput(deps, 'cache-status', cacheStatus);
  emitOutput(deps, 'delivery-status', delivery.status);
  emitOutput(deps, 'comment-url', delivery.commentUrl);
  emitOutput(deps, 'report-path', reportFileWritten ? reportPath : '');
  emitOutput(deps, 'artifact-name', artifactName);
  emitOutput(deps, 'narrative-status', narrative.status);
  emitOutput(deps, 'codegraph-version', inputs.codegraphVersion);
  emitOutput(deps, 'helper-version', HELPER_VERSION);

  return { inputs, detector, delivery, narrative, conclusion, report };
}

function prepareCache(deps: RunDependencies, inputs: ActionInputs, context: PullRequestContext): CacheStatus {
  const explicitStatus = deps.env.PR_IMPACT_CACHE_STATUS;
  if (isCacheStatus(explicitStatus)) return explicitStatus;

  const identity = cacheIdentity(deps, inputs, context);
  const metadataPath = deps.env.PR_IMPACT_CACHE_METADATA_PATH ?? '.codegraph/pr-impact-cache.json';
  const restoreHit = deps.env.PR_IMPACT_CACHE_RESTORE_HIT === 'true';
  const restoredStatus = restoreHit || fileExists(deps, metadataPath)
    ? validateCacheMetadata(deps, metadataPath, identity)
    : 'miss';
  if (restoredStatus === 'warm-valid') return restoredStatus;

  const rebuildMode = restoredStatus === 'miss' ? 'init' : 'index';
  if (!rebuildCodeGraphIndex(deps, rebuildMode)) {
    if (rebuildMode !== 'index' || !resetCodeGraphIndex(deps) || !rebuildCodeGraphIndex(deps, 'init')) {
      return 'unavailable';
    }
  }
  writeCacheMetadata(deps, metadataPath, identity);
  return 'rebuilt';
}

function validateWorkspaceHead(deps: RunDependencies, context: PullRequestContext): string | null {
  if (deps.env.PR_IMPACT_VALIDATE_HEAD !== 'true' || !context.headSha) return null;
  try {
    const actual = String(deps.execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })).trim();
    if (actual === context.headSha) return null;
    return `Checked-out workspace HEAD (${actual || 'unknown'}) does not match pull request head SHA (${context.headSha}); checkout github.event.pull_request.head.sha before running CodeGraph PR impact.`;
  } catch {
    return 'Unable to verify checked-out workspace HEAD before CodeGraph PR impact analysis.';
  }
}

function prepareBaseIndexIfNeeded(deps: RunDependencies, context: PullRequestContext): BaseIndexPreparation {
  if (deps.env.PR_IMPACT_PREPARE_BASE_INDEX !== 'true') {
    return deps.env.PR_IMPACT_BASE_INDEX_DIR
      ? { status: 'ready', dir: deps.env.PR_IMPACT_BASE_INDEX_DIR }
      : { status: 'not-needed', dir: null };
  }
  if (!context.mergeBase) return { status: 'not-needed', dir: null };
  const hasDeletedFiles = prDiffHasDeletedFiles(deps, context.mergeBase, context.headSha);
  if (hasDeletedFiles === null) {
    return { status: 'failed', dir: null, message: 'Unable to inspect PR diff for deleted files before analysis.' };
  }
  if (!hasDeletedFiles) return { status: 'not-needed', dir: null };
  if (!deps.cpSync) {
    return { status: 'failed', dir: null, message: 'Unable to copy base CodeGraph index for deleted-file analysis.' };
  }

  const baseIndexDir = deps.env.PR_IMPACT_BASE_INDEX_DIR ?? '.codegraph-pr-impact-base';
  if (!isPlainCodeGraphDirName(baseIndexDir)) {
    return { status: 'failed', dir: null, message: 'Invalid base CodeGraph index directory name for deleted-file analysis.' };
  }
  const safeRunId = (context.runId || 'local').replace(/[^A-Za-z0-9_.-]/g, '-');
  const baseWorktreePath = deps.env.PR_IMPACT_BASE_WORKTREE_PATH ?? `.codegraph/pr-impact-base-worktree-${safeRunId}`;
  try {
    deps.rmSync(baseWorktreePath, { recursive: true, force: true });
    deps.rmSync(baseIndexDir, { recursive: true, force: true });
    deps.execFileSync('git', ['worktree', 'add', '--detach', baseWorktreePath, context.mergeBase], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    deps.execFileSync(codegraphBin(deps), ['init', baseWorktreePath], {
      encoding: 'utf8',
      env: { ...deps.env, CODEGRAPH_DIR: baseIndexDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    deps.cpSync(`${baseWorktreePath}/${baseIndexDir}`, baseIndexDir, { recursive: true });
    return { status: 'ready', dir: baseIndexDir };
  } catch (error: unknown) {
    deps.rmSync(baseIndexDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', dir: null, message: `Unable to prepare base CodeGraph index for deleted-file analysis: ${message}` };
  } finally {
    try {
      deps.execFileSync('git', ['worktree', 'remove', '--force', baseWorktreePath], {
        encoding: 'utf8',
        env: deps.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      deps.rmSync(baseWorktreePath, { recursive: true, force: true });
    }
  }
}

function prDiffHasDeletedFiles(deps: RunDependencies, mergeBase: string, headSha: string): boolean | null {
  try {
    const output = String(deps.execFileSync('git', ['diff', '--name-status', '-z', mergeBase, headSha || 'HEAD', '--'], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    return output.split('\0').some((part) => part.startsWith('D'));
  } catch {
    return null;
  }
}

function isPlainCodeGraphDirName(dir: string): boolean {
  return dir !== ''
    && dir !== '.'
    && !dir.includes('..')
    && !dir.includes('/')
    && !dir.includes('\\');
}

function cacheIdentity(deps: RunDependencies, inputs: ActionInputs, context: PullRequestContext): CacheIdentity {
  return {
    repository: context.repository || deps.env.GITHUB_REPOSITORY || 'unknown',
    codegraphVersion: inputs.codegraphVersion,
    baseRef: inputs.baseRef || context.baseRef || 'HEAD^',
    headSha: context.headSha || deps.env.GITHUB_SHA || 'unknown',
    mergeBase: context.mergeBase ?? 'unknown',
    lockfileHash: hashFirstExistingFile(deps, ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']),
  };
}

function validateCacheMetadata(
  deps: RunDependencies,
  metadataPath: string,
  expected: CacheIdentity,
): CacheStatus {
  let metadata: CacheMetadata;
  try {
    metadata = JSON.parse(String(deps.readFileSync(metadataPath, 'utf8'))) as CacheMetadata;
  } catch {
    return 'corrupt';
  }
  if (metadata.schemaVersion !== 1 || metadata.identity === null || typeof metadata.identity !== 'object') {
    return 'corrupt';
  }
  if (metadata.identity.repository !== expected.repository) {
    return 'stale';
  }
  if (metadata.identity.codegraphVersion !== expected.codegraphVersion) {
    return 'incompatible';
  }
  for (const field of ['baseRef', 'headSha', 'mergeBase', 'lockfileHash'] as const) {
    if (metadata.identity[field] !== expected[field]) return 'stale';
  }
  return validateWarmIndexHealth(deps, expected);
}

function validateWarmIndexHealth(deps: RunDependencies, expected: CacheIdentity): CacheStatus {
  let status: unknown;
  try {
    status = JSON.parse(String(deps.execFileSync(codegraphBin(deps), ['status', '--json'], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })));
  } catch {
    return 'stale';
  }
  const report = objectValue(status);
  if (!report) return 'stale';
  const version = requiredStringField(report, 'version');
  if (version === null || version !== expected.codegraphVersion) {
    return 'incompatible';
  }
  if (!hasOwn(report, 'worktreeMismatch') || report.worktreeMismatch !== null) {
    return 'stale';
  }
  const pending = objectField(report, 'pendingChanges');
  if (
    !pending ||
    requiredNumberField(pending, 'added') === null ||
    requiredNumberField(pending, 'modified') === null ||
    requiredNumberField(pending, 'removed') === null
  ) {
    return 'stale';
  }
  if (requiredNumberField(pending, 'added')! > 0 || requiredNumberField(pending, 'modified')! > 0 || requiredNumberField(pending, 'removed')! > 0) {
    return 'stale';
  }
  const index = objectField(report, 'index');
  if (!index) return 'stale';
  const builtWithExtractionVersion = requiredNumberField(index, 'builtWithExtractionVersion');
  const currentExtractionVersion = requiredNumberField(index, 'currentExtractionVersion');
  if (builtWithExtractionVersion === null || currentExtractionVersion === null) {
    return 'incompatible';
  }
  if (builtWithExtractionVersion !== currentExtractionVersion) {
    return 'incompatible';
  }
  if (index.reindexRecommended !== false) return 'stale';
  if (index.state !== 'complete') return 'stale';
  return 'warm-valid';
}

function rebuildCodeGraphIndex(deps: RunDependencies, mode: 'init' | 'index'): boolean {
  const gitignorePath = deps.env.PR_IMPACT_GITIGNORE_PATH ?? '.gitignore';
  const gitignore = mode === 'init' ? readOptionalFile(deps, gitignorePath) : null;
  try {
    deps.execFileSync(codegraphBin(deps), [mode], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  } finally {
    if (gitignore) restoreOptionalFile(deps, gitignorePath, gitignore);
  }
}

function resetCodeGraphIndex(deps: RunDependencies): boolean {
  try {
    deps.rmSync(deps.env.PR_IMPACT_CODEGRAPH_PATH ?? '.codegraph', { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function readOptionalFile(deps: RunDependencies, path: string): { exists: boolean; content: string } {
  try {
    return fileExists(deps, path)
      ? { exists: true, content: String(deps.readFileSync(path, 'utf8')) }
      : { exists: false, content: '' };
  } catch {
    return { exists: false, content: '' };
  }
}

function fileExists(deps: RunDependencies, path: string): boolean {
  try {
    return deps.existsSync(path);
  } catch {
    return false;
  }
}

function restoreOptionalFile(
  deps: RunDependencies,
  path: string,
  snapshot: { exists: boolean; content: string },
): void {
  try {
    if (snapshot.exists) {
      deps.writeFileSync(path, snapshot.content, 'utf8');
    } else if (deps.existsSync(path)) {
      deps.rmSync(path, { force: true });
    }
  } catch {
    // Restoring the advisory .gitignore mutation is best-effort; the action
    // still reports through the deterministic detector result below.
  }
}

function writeCacheMetadata(deps: RunDependencies, metadataPath: string, identity: CacheIdentity): void {
  try {
    deps.mkdirSync(dirname(metadataPath), { recursive: true });
    const metadata: CacheMetadata = {
      schemaVersion: 1,
      helperVersion: HELPER_VERSION,
      recordedAt: new Date().toISOString(),
      identity,
    };
    deps.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  } catch {
    // A metadata write failure should not make a freshly rebuilt index unusable
    // for the current analysis; the next run will simply rebuild again.
  }
}

function hashFirstExistingFile(deps: RunDependencies, paths: string[]): string {
  for (const path of paths) {
    try {
      return createHash('sha256').update(String(deps.readFileSync(path, 'utf8'))).digest('hex');
    } catch {
      // Try the next lockfile name.
    }
  }
  return 'missing';
}

function writeReportFile(deps: RunDependencies, reportPath: string, report: string): boolean {
  try {
    deps.mkdirSync(dirname(reportPath), { recursive: true });
    deps.writeFileSync(reportPath, report, 'utf8');
    return true;
  } catch {
    return false;
  }
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
  const isForkLike = headRepo !== '' && baseRepo !== '' && headRepo !== baseRepo;
  const hasTrustedContext = trustedContextFor(deps, isForkLike);
  const hasTrustedToken = Boolean(deps.env.GITHUB_TOKEN) && hasTrustedContext && parseBoolean(deps.env.PR_IMPACT_TOKEN_WRITE ?? 'false');

  return {
    repository,
    pullNumber,
    baseRef,
    headSha,
    mergeBase: resolveMergeBase(deps, baseRef, headSha, baseSha),
    runId: deps.env.GITHUB_RUN_ID ?? 'unknown',
    runAttempt: deps.env.GITHUB_RUN_ATTEMPT ?? 'unknown',
    isForkLike,
    tokenPermissions: {
      contentsRead: true,
      issuesWrite: hasTrustedToken,
      pullRequestsWrite: false,
    },
  };
}

function resolveBaseRef(inputs: ActionInputs, context: PullRequestContext): string {
  return inputs.baseRef || context.baseRef || 'HEAD^';
}

function resolveDetectorBaseRef(inputs: ActionInputs, context: PullRequestContext): string {
  if (inputs.baseRef) return inputs.baseRef;
  if (context.mergeBase) return context.mergeBase;
  if (context.baseRef) return context.baseRef.includes('/') ? context.baseRef : `origin/${context.baseRef}`;
  return 'HEAD^';
}

function resolveMergeBase(
  deps: RunDependencies,
  baseRef: string,
  headSha: string,
  fallbackBaseSha: string,
): string | null {
  if (deps.env.PR_IMPACT_MERGE_BASE) return deps.env.PR_IMPACT_MERGE_BASE;
  if (headSha) {
    const candidates = [
      fallbackBaseSha,
      baseRef,
      baseRef && !baseRef.includes('/') ? `origin/${baseRef}` : '',
    ].filter(Boolean);
    for (const candidate of [...new Set(candidates)]) {
      try {
        const mergeBase = String(deps.execFileSync('git', ['merge-base', candidate, headSha], {
          encoding: 'utf8',
          env: deps.env,
          stdio: ['ignore', 'pipe', 'ignore'],
        })).trim();
        if (mergeBase) return mergeBase;
      } catch {
        // Try the next available base identity before falling back to payload
        // metadata. Detached PR checkouts frequently lack a local base branch.
      }
    }
  }
  return fallbackBaseSha || null;
}

function trustedContextFor(deps: RunDependencies, isForkLike: boolean): boolean {
  if (deps.env.GITHUB_ACTOR === 'dependabot[bot]') return false;
  const raw = deps.env.PR_IMPACT_TRUSTED_CONTEXT;
  if (raw !== undefined) return parseBoolean(raw);
  return !isForkLike;
}

function hasTrustedWriteToken(deps: RunDependencies, context: PullRequestContext): boolean {
  return Boolean(deps.env.GITHUB_TOKEN) && !context.isForkLike && (context.tokenPermissions.issuesWrite || context.tokenPermissions.pullRequestsWrite);
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

function runDetector(
  deps: RunDependencies,
  inputs: ActionInputs,
  context: PullRequestContext,
  baseIndexDir: string | null = null,
): DetectorResult {
  const baseRef = resolveDetectorBaseRef(inputs, context);
  const jsonArgs = detectorArgs(inputs, baseRef, context.headSha || 'HEAD', 'json', baseIndexDir);
  try {
    const json = runDetectorCommand(deps, jsonArgs);
    return normalizeDetectorResult(JSON.parse(json), inputs, baseRef);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return createUnavailableDetector(inputs, message, baseRef);
  }
}

function detectorArgs(
  inputs: ActionInputs,
  baseRef: string,
  headRef: string,
  format: 'json' | 'markdown',
  baseIndexDir: string | null = null,
): string[] {
  const args = [
    'detect-changes',
    '--mode', 'base-ref',
    '--base-ref', baseRef,
    '--head-ref', headRef,
    '--format', format,
    '--caller-depth', String(inputs.callerDepth),
    '--max-callers', String(inputs.maxCallers),
  ];
  const failOn = failOnPolicy(inputs);
  if (failOn) args.push('--fail-on', failOn);
  if (baseIndexDir) args.push('--base-index-dir', baseIndexDir);
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
    return String(deps.execFileSync(codegraphBin(deps), args, {
      encoding: 'utf8',
      env: deps.env,
      maxBuffer: 20 * 1024 * 1024,
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

function codegraphBin(deps: RunDependencies): string {
  return deps.env.PR_IMPACT_CODEGRAPH_BIN || 'codegraph';
}

function normalizeDetectorResult(raw: unknown, inputs: ActionInputs, baseRef: string): DetectorResult {
  const candidate = raw as Partial<DetectorResult>;
  const summary = (candidate.summary ?? {}) as Partial<DetectorResult['summary']>;
  return {
    summary: {
      status: isSummaryStatus(summary.status) ? summary.status : 'unavailable',
      baseRef: typeof summary.baseRef === 'string' ? summary.baseRef : baseRef || null,
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

function createUnavailableDetector(
  inputs: ActionInputs,
  message = 'SPEC-020 action helper could not run detect-changes.',
  baseRef = inputs.baseRef,
): DetectorResult {
  return {
    summary: {
      status: 'unavailable',
      baseRef: baseRef || null,
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
    summary: 'failed',
    artifact: 'pending',
    currentCommentId: null,
    duplicateCommentIds: [],
    failedDuplicateCommentIds: [],
    reportPath,
    commentUrl: '',
  };
}

async function deliverReportComment(
  deps: RunDependencies,
  context: PullRequestContext,
  report: string,
  reportPath: string,
  reportFileWritten: boolean,
): Promise<DeliveryResult> {
  const base: DeliveryResult = {
    status: reportFileWritten ? 'fallback' : 'failed',
    comment: 'skipped',
    summary: 'failed',
    artifact: reportFileWritten ? 'pending' : 'failed',
    currentCommentId: null,
    duplicateCommentIds: [],
    failedDuplicateCommentIds: [],
    reportPath,
    commentUrl: '',
  };

  if (!hasTrustedWriteToken(deps, context) || context.pullNumber === null) {
    return base;
  }

  const comments = await listComments(deps, context);
  if (comments === null) {
    return { ...base, comment: 'permission-denied' };
  }

  const marked = comments
    .filter(isActionOwnedComment)
    .sort(compareCommentNewestFirst);
  const current = marked[0];
  const duplicates = marked.slice(1);
  const duplicateIds: string[] = [];
  const failedDuplicateIds: string[] = [];

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
      else failedDuplicateIds.push(String(duplicate.id));
    }
    if (updated) {
      return {
        ...base,
        status: 'comment',
        comment: 'updated',
        currentCommentId: String(current.id),
        duplicateCommentIds: duplicateIds,
        failedDuplicateCommentIds: failedDuplicateIds,
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
    failedDuplicateCommentIds: [],
    commentUrl: created.html_url,
  };
}

async function patchDeliveredComment(
  deps: RunDependencies,
  context: PullRequestContext,
  delivery: DeliveryResult,
  report: string,
): Promise<boolean> {
  if (delivery.currentCommentId === null) return false;
  return patchComment(deps, context, delivery.currentCommentId, report);
}

function writeSummary(deps: RunDependencies, report: string): DeliveryResult['summary'] {
  if (!deps.env.GITHUB_STEP_SUMMARY) return 'failed';
  try {
    deps.appendFileSync(deps.env.GITHUB_STEP_SUMMARY, `${report}\n`, 'utf8');
    return 'written';
  } catch {
    return 'failed';
  }
}

function createInitialNarrative(inputs: ActionInputs, context: PullRequestContext, deps: RunDependencies): NarrativeResult {
  if (inputs.narrative === 'off') {
    return {
      status: 'disabled',
      text: null,
      handle: null,
    };
  }
  if (inputs.narrative === 'trusted' && !hasTrustedWriteToken(deps, context)) {
    return {
      status: 'suppressed',
      text: null,
      handle: null,
    };
  }
  const source = deps.env.PR_IMPACT_NARRATIVE_SOURCE;
  if (source === 'fallback') {
    return { status: 'fallback', text: deps.env.PR_IMPACT_NARRATIVE_TEXT ?? 'Narrative fallback prose.', handle: null };
  }
  if (source === 'pending') {
    return { status: 'pending', text: deps.env.PR_IMPACT_NARRATIVE_TEXT ?? 'Narrative pending prose.', handle: 'pending-pr-impact-narrative' };
  }
  if (source === 'appended') {
    return { status: 'appended', text: deps.env.PR_IMPACT_NARRATIVE_TEXT ?? 'Narrative prose.', handle: null };
  }
  return { status: 'unavailable', text: null, handle: null };
}

function renderReport(args: {
  inputs: ActionInputs;
  context: PullRequestContext;
  detector: DetectorResult;
  delivery: DeliveryResult;
  narrative: NarrativeResult;
  conclusion: FinalConclusion;
  cacheStatus: CacheStatus;
  artifactName: string;
  recordedAt: string;
}): string {
  const { inputs, context, detector, delivery, narrative, conclusion, cacheStatus, artifactName, recordedAt } = args;
  const lines = [
    ACTION_MARKER,
    '',
    '# CodeGraph PR Impact',
    '',
    '## Run metadata',
    '',
    `- Recorded at: ${recordedAt}`,
    `- Action run: ${context.runId}`,
    `- Run attempt: ${context.runAttempt}`,
    `- Repository: ${context.repository || 'unknown'}`,
    `- Pull request: ${context.pullNumber === null ? 'unknown' : `#${context.pullNumber}`}`,
    `- Base ref: ${resolveBaseRef(inputs, context)}`,
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
    `- Threshold breached: ${detector.summary.status === 'threshold_breach'}`,
    `- Cache status: ${cacheStatus}`,
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
    `- Duplicate comments retired: ${delivery.duplicateCommentIds.length}`,
    `- Duplicate cleanup failures: ${delivery.failedDuplicateCommentIds.length}`,
    '- Comment delivery is attempted only when a trusted pull-request token is available.',
    '',
  ];
  if (narrative.text && (narrative.status === 'fallback' || narrative.status === 'pending' || narrative.status === 'appended')) {
    lines.push(
      '## Narrative appendix',
      '',
      '_prose-only narrative. Deterministic facts and final conclusion above remain authoritative._',
      '',
      narrative.text,
      '',
    );
  }
  return lines.join('\n');
}

interface GitHubComment {
  id: number | string;
  body: string;
  created_at?: string;
  html_url: string;
  user?: {
    login?: string;
    type?: string;
  };
}

async function listComments(deps: RunDependencies, context: PullRequestContext): Promise<GitHubComment[] | null> {
  const comments: GitHubComment[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = await fetchJson(deps, `${issueCommentsUrl(deps, context)}?per_page=100&page=${page}`, {
      method: 'GET',
      headers: githubHeaders(deps),
    });
    if (!result.ok) return null;
    if (!Array.isArray(result.json)) return [];
    comments.push(...result.json.filter(isGitHubComment));
    if (result.json.length < 100) break;
  }
  return comments;
}

async function fetchJson(
  deps: RunDependencies,
  url: string,
  init: Parameters<FetchLike>[1],
): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const response = await deps.fetch(url, init);
    if (!response.ok) return { ok: false, status: response.status, json: null };
    try {
      return { ok: true, status: response.status, json: await response.json() };
    } catch {
      return { ok: false, status: response.status, json: null };
    }
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

async function createComment(
  deps: RunDependencies,
  context: PullRequestContext,
  body: string,
): Promise<GitHubComment | null> {
  const result = await fetchJson(deps, issueCommentsUrl(deps, context), {
    method: 'POST',
    headers: githubHeaders(deps),
    body: JSON.stringify({ body }),
  });
  if (!result.ok) return null;
  return isGitHubComment(result.json) ? result.json : null;
}

async function patchComment(
  deps: RunDependencies,
  context: PullRequestContext,
  id: number | string,
  body: string,
): Promise<boolean> {
  const result = await fetchJson(deps, `${apiBase(deps)}/repos/${context.repository}/issues/comments/${id}`, {
    method: 'PATCH',
    headers: githubHeaders(deps),
    body: JSON.stringify({ body }),
  });
  return result.ok;
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

function isActionOwnedComment(comment: GitHubComment): boolean {
  return comment.body.includes(ACTION_MARKER) && comment.user?.login === 'github-actions[bot]';
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> | null {
  return objectValue(value[field]);
}

function requiredStringField(value: Record<string, unknown>, field: string): string | null {
  return typeof value[field] === 'string' && value[field] !== '' ? value[field] : null;
}

function requiredNumberField(value: Record<string, unknown>, field: string): number | null {
  const fieldValue = value[field];
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : null;
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
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

function isCacheStatus(value: unknown): value is CacheStatus {
  return (
    value === 'warm-valid' ||
    value === 'miss' ||
    value === 'stale' ||
    value === 'corrupt' ||
    value === 'incompatible' ||
    value === 'rebuilt' ||
    value === 'unavailable'
  );
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
