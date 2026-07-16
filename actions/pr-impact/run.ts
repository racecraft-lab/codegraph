import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_VERSION = '0.1.0-spec-020';
export const DEFAULT_CODEGRAPH_VERSION = '1.5.0';
export const ACTION_MARKER = '<!-- codegraph-pr-impact-action -->';
const ACTION_RUN_MARKER_PREFIX = '<!-- codegraph-pr-impact-run:';
const MIN_CALLER_DEPTH = 1;
const MAX_CALLER_DEPTH = 3;
const MIN_MAX_CALLERS = 1;
const MAX_MAX_CALLERS = 100;

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
  schemaVersion: 1;
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

type OptionalFileSnapshot =
  | { state: 'present'; content: string }
  | { state: 'absent' }
  | { state: 'read-failed' };

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

interface ParsedActionInputs {
  inputs: ActionInputs;
  error: string | null;
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
  const parsed = parseActionInputsForRun(env);
  if (parsed.error) throw new Error(parsed.error);
  return parsed.inputs;
}

function parseActionInputsForRun(env: NodeJS.ProcessEnv): ParsedActionInputs {
  const parsedNarrative = parseNarrativeInput(readInput(env, 'NARRATIVE', 'off'), 'narrative');
  const requestedCodegraphVersion = readInput(env, 'CODEGRAPH_VERSION', DEFAULT_CODEGRAPH_VERSION);
  const failOnCallersRaw = readInput(env, 'FAIL_ON_CALLERS', '');
  const parsedFailOnCallers = parseOptionalInteger(failOnCallersRaw, 'fail-on-callers');
  const parsedFailOnHubs = parseBooleanInput(readInput(env, 'FAIL_ON_HUBS', 'false'), 'fail-on-hubs');
  const parsedCallerDepth = parseIntegerInput(readInput(env, 'CALLER_DEPTH', '1'), 'caller-depth', 1);
  const parsedMaxCallers = parseIntegerInput(readInput(env, 'MAX_CALLERS', '20'), 'max-callers', 20);
  const inputError = [
    parsedFailOnCallers.error,
    parsedFailOnHubs.error,
    parsedCallerDepth.error,
    parsedMaxCallers.error,
    parsedNarrative.error,
  ].filter((error): error is string => Boolean(error)).join(' ');
  return {
    inputs: {
      codegraphVersion: env.PR_IMPACT_CODEGRAPH_RESOLVED_VERSION || requestedCodegraphVersion,
      baseRef: readInput(env, 'BASE_REF', ''),
      failOnCallers: parsedFailOnCallers.value,
      failOnHubs: parsedFailOnHubs.value,
      callerDepth: clampInteger(parsedCallerDepth.value, MIN_CALLER_DEPTH, MAX_CALLER_DEPTH),
      maxCallers: clampInteger(parsedMaxCallers.value, MIN_MAX_CALLERS, MAX_MAX_CALLERS),
      narrative: parsedNarrative.value,
    },
    error: inputError || null,
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
  const parsedInputs = parseActionInputsForRun(deps.env);
  const inputs = parsedInputs.inputs;
  const context = readPullRequestContext(deps, inputs);
  const recordedAt = deps.now().toISOString();
  const reportPath = deps.env.PR_IMPACT_REPORT_PATH ?? 'pr-impact-report.md';
  const artifactName = deps.env.PR_IMPACT_ARTIFACT_NAME ?? 'codegraph-pr-impact';
  const workspaceHeadError = parsedInputs.error ?? validateWorkspaceHead(deps, context);
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
  let narrative = createInitialNarrative(inputs, context, deps, false);
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
    recordedAt,
  });

  const preliminaryReportFileWritten = writeReportFile(deps, reportPath, preliminaryReport);
  delivery = await deliverReportComment(deps, context, preliminaryReport, reportPath, preliminaryReportFileWritten);
  narrative = createInitialNarrative(inputs, context, deps, delivery.status === 'comment');
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
    recordedAt,
  });
  if (delivery.status === 'comment') {
    const finalizedComment = await patchDeliveredComment(deps, context, delivery, report);
    if (!finalizedComment) {
      delivery = {
        ...delivery,
        status: preliminaryReportFileWritten ? 'fallback' : 'failed',
        comment: 'failed',
        currentCommentId: null,
        commentUrl: '',
      };
      narrative = createInitialNarrative(inputs, context, deps, false);
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
        recordedAt,
      });
    }
  }
  const reportFileWritten = writeReportFile(deps, reportPath, report);
  const summaryFallbackPossible = delivery.status !== 'comment'
    && !reportFileWritten
    && Boolean(deps.env.GITHUB_STEP_SUMMARY);
  delivery = {
    ...delivery,
    status: delivery.status === 'comment' ? 'comment' : reportFileWritten || summaryFallbackPossible ? 'fallback' : 'failed',
    artifact: reportFileWritten ? 'pending' : 'failed',
    summary: 'failed',
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
    recordedAt,
  });
  let finalReportFileWritten = reportFileWritten;
  if (finalReportFileWritten) {
    finalReportFileWritten = writeReportFile(deps, reportPath, report);
    if (!finalReportFileWritten) {
      const summaryCanCarryReport = delivery.status !== 'comment' && Boolean(deps.env.GITHUB_STEP_SUMMARY);
      delivery = {
        ...delivery,
        status: delivery.status === 'comment' ? 'comment' : summaryCanCarryReport ? 'fallback' : 'failed',
        artifact: 'failed',
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
        recordedAt,
      });
    }
  }
  delivery = { ...delivery, summary: writeSummary(deps, report) };
  if (delivery.status === 'fallback' && !finalReportFileWritten && delivery.summary !== 'written') {
    delivery = { ...delivery, status: 'failed' };
    conclusion = determineConclusion(detector, false);
    report = renderReport({
      inputs,
      context,
      detector,
      delivery,
      narrative,
      conclusion,
      cacheStatus,
      artifactName,
      recordedAt,
    });
  }

  emitOutput(deps, 'summary-status', detector.summary.status);
  emitOutput(deps, 'detector-exit-code', String(detector.exitCode));
  emitOutput(deps, 'conclusion', conclusion);
  emitOutput(deps, 'threshold-breached', String(detector.summary.status === 'threshold_breach'));
  emitOutput(deps, 'cache-status', cacheStatus);
  emitOutput(deps, 'delivery-status', delivery.status);
  emitOutput(deps, 'comment-url', delivery.commentUrl);
  emitOutput(deps, 'report-path', finalReportFileWritten ? reportPath : '');
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
  const indexPath = deps.env.PR_IMPACT_CODEGRAPH_PATH ?? '.codegraph';
  const restoredIndexExists = fileExists(deps, indexPath);
  const restoredStatus = restoreHit || fileExists(deps, metadataPath)
    ? validateCacheMetadata(deps, metadataPath, identity)
    : restoredIndexExists
      ? 'stale'
    : 'miss';
  if (restoredStatus === 'warm-valid') return restoredStatus;

  const rebuildMode = restoredStatus === 'miss' ? 'init' : 'index';
  if (!rebuildAndValidateCodeGraphIndex(deps, rebuildMode, metadataPath, identity)) {
    if (!resetCodeGraphIndex(deps) || !rebuildAndValidateCodeGraphIndex(deps, 'init', metadataPath, identity)) {
      return 'unavailable';
    }
  }
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
  const needsBaseIndex = prDiffNeedsBaseIndex(deps, context.mergeBase, context.headSha);
  if (needsBaseIndex === null) {
    return { status: 'failed', dir: null, message: 'Unable to inspect PR diff for deleted symbols before analysis.' };
  }
  if (!needsBaseIndex) return { status: 'not-needed', dir: null };
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

function prDiffNeedsBaseIndex(deps: RunDependencies, mergeBase: string, headSha: string): boolean | null {
  try {
    const nameStatus = String(deps.execFileSync('git', ['diff', '--name-status', '-z', mergeBase, headSha || 'HEAD', '--'], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    if (nameStatusHasDeletedFile(nameStatus)) return true;
    const patch = String(deps.execFileSync('git', ['diff', '--no-ext-diff', '--no-color', '--unified=0', mergeBase, headSha || 'HEAD', '--'], {
      encoding: 'utf8',
      env: deps.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    return patchDeletesContent(patch);
  } catch {
    return null;
  }
}

function patchDeletesContent(patch: string): boolean {
  let inHunk = false;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@ ')) {
      inHunk = true;
      continue;
    }
    if (inHunk && line.startsWith('-')) return true;
  }
  return false;
}

function nameStatusHasDeletedFile(output: string): boolean {
  const parts = output.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]!;
    if (status.startsWith('D')) return true;
    i += status.startsWith('R') || status.startsWith('C') ? 2 : 1;
  }
  return false;
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
  const pendingRefs = requiredNumberField(index, 'pendingRefs');
  if (pendingRefs === null || pendingRefs !== 0) return 'stale';
  return 'warm-valid';
}

function rebuildAndValidateCodeGraphIndex(
  deps: RunDependencies,
  mode: 'init' | 'index',
  metadataPath: string,
  identity: CacheIdentity,
): boolean {
  if (!rebuildCodeGraphIndex(deps, mode)) return false;
  writeCacheMetadata(deps, metadataPath, identity);
  return validateWarmIndexHealth(deps, identity) === 'warm-valid';
}

function rebuildCodeGraphIndex(deps: RunDependencies, mode: 'init' | 'index'): boolean {
  const gitignorePath = deps.env.PR_IMPACT_GITIGNORE_PATH ?? '.gitignore';
  const gitignore = mode === 'init' ? readOptionalFile(deps, gitignorePath) : null;
  if (gitignore?.state === 'read-failed') return false;
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

function readOptionalFile(deps: RunDependencies, path: string): OptionalFileSnapshot {
  try {
    if (!deps.existsSync(path)) return { state: 'absent' };
  } catch {
    return { state: 'read-failed' };
  }
  try {
    return { state: 'present', content: String(deps.readFileSync(path, 'utf8')) };
  } catch {
    return { state: 'read-failed' };
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
  snapshot: OptionalFileSnapshot,
): void {
  try {
    if (snapshot.state === 'present') {
      deps.writeFileSync(path, snapshot.content, 'utf8');
    } else if (snapshot.state === 'absent' && deps.existsSync(path)) {
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
  const hasTrustedToken = Boolean(deps.env.GITHUB_TOKEN) &&
    hasTrustedContext &&
    parseBooleanInput(deps.env.PR_IMPACT_TOKEN_WRITE ?? 'false', 'PR_IMPACT_TOKEN_WRITE').value;

  return {
    repository,
    pullNumber,
    baseRef,
    headSha,
    mergeBase: resolveMergeBase(deps, baseRef, headSha, baseSha, Boolean(inputs.baseRef)),
    runId: deps.env.GITHUB_RUN_ID ?? 'unknown',
    runAttempt: deps.env.GITHUB_RUN_ATTEMPT ?? 'unknown',
    isForkLike,
    tokenPermissions: {
      contentsRead: true,
      issuesWrite: false,
      pullRequestsWrite: hasTrustedToken,
    },
  };
}

function resolveBaseRef(inputs: ActionInputs, context: PullRequestContext): string {
  return inputs.baseRef || context.baseRef || 'HEAD^';
}

function resolveDetectorBaseRef(inputs: ActionInputs, context: PullRequestContext): string {
  if (context.mergeBase) return context.mergeBase;
  if (inputs.baseRef) return inputs.baseRef;
  if (context.baseRef) return context.baseRef.includes('/') ? context.baseRef : `origin/${context.baseRef}`;
  return 'HEAD^';
}

function resolveMergeBase(
  deps: RunDependencies,
  baseRef: string,
  headSha: string,
  fallbackBaseSha: string,
  explicitBaseRef = false,
): string | null {
  if (deps.env.PR_IMPACT_MERGE_BASE) return deps.env.PR_IMPACT_MERGE_BASE;
  if (headSha) {
    const baseRefCandidates = baseRefMergeCandidates(baseRef);
    const candidates = explicitBaseRef
      ? baseRefCandidates
      : [fallbackBaseSha, ...baseRefCandidates].filter(Boolean);
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
  return explicitBaseRef ? null : fallbackBaseSha || null;
}

function baseRefMergeCandidates(baseRef: string): string[] {
  if (!baseRef) return [];
  const candidates = [baseRef];
  if (!baseRef.startsWith('origin/')) {
    candidates.push(`origin/${baseRef}`);
  }
  return [...new Set(candidates)];
}

function trustedContextFor(deps: RunDependencies, isForkLike: boolean): boolean {
  if (deps.env.GITHUB_ACTOR === 'dependabot[bot]') return false;
  const raw = deps.env.PR_IMPACT_TRUSTED_CONTEXT;
  if (raw !== undefined) return parseBooleanInput(raw, 'PR_IMPACT_TRUSTED_CONTEXT').value;
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
  const candidate = validatedDetectorPayload(raw);
  if (!candidate) {
    return createUnavailableDetector(inputs, 'Detector returned malformed detect-changes JSON.', baseRef);
  }
  const { summary } = candidate;
  return {
    schemaVersion: 1,
    summary: {
      status: summary.status,
      baseRef: (summary.baseRef ?? baseRef) || null,
      changedSymbolCount: summary.changedSymbolCount,
      unmappedHunkCount: summary.unmappedHunkCount,
      callerCount: summary.callerCount,
      affectedFlowCount: summary.affectedFlowCount,
      riskCount: summary.riskCount,
      warningCount: summary.warningCount,
    },
    exitCode: candidate.exitCode,
    changedSymbols: candidate.changedSymbols,
    unmappedHunks: candidate.unmappedHunks,
    callers: candidate.callers,
    affectedFlows: normalizeAffectedFlows(candidate.affectedFlows),
    risks: candidate.risks,
    warnings: candidate.warnings,
    limits: candidate.limits,
  };
}

function validatedDetectorPayload(raw: unknown): DetectorResult | null {
  const candidate = objectValue(raw);
  if (!candidate || candidate.schemaVersion !== 1) return null;

  const summary = objectField(candidate, 'summary');
  if (!summary) return null;

  const status = summary.status;
  const exitCode = candidate.exitCode;
  if (!isSummaryStatus(status) || !isDetectorExitCode(exitCode)) return null;
  if (exitCode !== exitCodeForSummaryStatus(status)) return null;

  const rawBaseRef = summary.baseRef;
  if (!hasOwn(summary, 'baseRef')) return null;
  if (!(typeof rawBaseRef === 'string' || rawBaseRef === null)) return null;
  const baseRef = rawBaseRef as string | null;

  const changedSymbolCount = requiredCountField(summary, 'changedSymbolCount');
  const unmappedHunkCount = requiredCountField(summary, 'unmappedHunkCount');
  const callerCount = requiredCountField(summary, 'callerCount');
  const affectedFlowCount = requiredCountField(summary, 'affectedFlowCount');
  const riskCount = requiredCountField(summary, 'riskCount');
  const warningCount = requiredCountField(summary, 'warningCount');
  if (
    changedSymbolCount === null ||
    unmappedHunkCount === null ||
    callerCount === null ||
    affectedFlowCount === null ||
    riskCount === null ||
    warningCount === null
  ) {
    return null;
  }

  const affectedFlows = objectField(candidate, 'affectedFlows');
  const limits = objectField(candidate, 'limits');
  if (
    !Array.isArray(candidate.changedSymbols) ||
    !Array.isArray(candidate.unmappedHunks) ||
    !Array.isArray(candidate.callers) ||
    !affectedFlows ||
    typeof affectedFlows.state !== 'string' ||
    !Array.isArray(affectedFlows.items) ||
    typeof affectedFlows.truncated !== 'boolean' ||
    !Array.isArray(candidate.risks) ||
    !Array.isArray(candidate.warnings) ||
    !limits
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    summary: {
      status,
      baseRef,
      changedSymbolCount,
      unmappedHunkCount,
      callerCount,
      affectedFlowCount,
      riskCount,
      warningCount,
    },
    exitCode,
    changedSymbols: candidate.changedSymbols,
    unmappedHunks: candidate.unmappedHunks,
    callers: candidate.callers,
    affectedFlows: {
      state: affectedFlows.state,
      items: affectedFlows.items,
      truncated: affectedFlows.truncated,
    },
    risks: candidate.risks,
    warnings: candidate.warnings,
    limits,
  };
}

function createUnavailableDetector(
  inputs: ActionInputs,
  message = 'SPEC-020 action helper could not run detect-changes.',
  baseRef = inputs.baseRef,
): DetectorResult {
  return {
    schemaVersion: 1,
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

  const marked = sortActionOwnedComments(comments);
  const current = marked[0];

  if (current && isNewerRunComment(current, context)) return { ...base, comment: 'skipped' };

  const created = await createComment(deps, context, report);
  if (!created) return { ...base, comment: 'failed' };
  const refreshed = await listComments(deps, context);
  const markedAfterCreate = refreshed === null ? [created] : sortActionOwnedComments(refreshed);
  const currentAfterCreate = markedAfterCreate[0] ?? created;
  const postCreateDuplicateIds: string[] = [];
  const postCreateFailedDuplicateIds: string[] = [];
  if (isNewerRunComment(currentAfterCreate, context)) {
    const retiredCurrentRun = await retireCurrentRunComments(deps, context, markedAfterCreate);
    return {
      ...base,
      comment: 'skipped',
      duplicateCommentIds: retiredCurrentRun.retired,
      failedDuplicateCommentIds: retiredCurrentRun.failed,
    };
  }
  if (!isSameRunComment(currentAfterCreate, context)) {
    return { ...base, comment: 'failed' };
  }
  for (const duplicate of markedAfterCreate.slice(1)) {
    if (isNewerRunComment(duplicate, context)) continue;
    const retired = await patchComment(
      deps,
      context,
      duplicate.id,
      `${ACTION_MARKER}\n\n_Retired duplicate CodeGraph PR impact report._`,
    );
    if (retired) postCreateDuplicateIds.push(String(duplicate.id));
    else postCreateFailedDuplicateIds.push(String(duplicate.id));
  }
  return {
    ...base,
    status: 'comment',
    comment: 'created',
    currentCommentId: String(currentAfterCreate.id),
    duplicateCommentIds: postCreateDuplicateIds,
    failedDuplicateCommentIds: postCreateFailedDuplicateIds,
    commentUrl: currentAfterCreate.html_url,
  };
}

async function patchDeliveredComment(
  deps: RunDependencies,
  context: PullRequestContext,
  delivery: DeliveryResult,
  report: string,
): Promise<boolean> {
  if (delivery.currentCommentId === null) return false;
  const comments = await listComments(deps, context);
  if (comments === null) return false;
  const marked = sortActionOwnedComments(comments);
  if (marked.some((comment) => isNewerRunComment(comment, context))) {
    await retireCurrentRunComments(deps, context, marked);
    return false;
  }
  const current = comments.find((comment) => String(comment.id) === String(delivery.currentCommentId));
  if (!current || !isSameRunComment(current, context)) return false;
  return patchComment(deps, context, delivery.currentCommentId, report);
}

async function retireCurrentRunComments(
  deps: RunDependencies,
  context: PullRequestContext,
  comments: GitHubComment[],
): Promise<{ retired: string[]; failed: string[] }> {
  const retired: string[] = [];
  const failed: string[] = [];
  for (const comment of comments) {
    if (!isSameRunComment(comment, context)) continue;
    const ok = await patchComment(
      deps,
      context,
      comment.id,
      `${ACTION_MARKER}\n${actionRunMarker(context)}\n\n_Retired duplicate CodeGraph PR impact report._`,
    );
    if (ok) retired.push(String(comment.id));
    else failed.push(String(comment.id));
  }
  return { retired, failed };
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

function createInitialNarrative(inputs: ActionInputs, context: PullRequestContext, deps: RunDependencies, privilegedDeliveryObserved: boolean): NarrativeResult {
  if (inputs.narrative === 'off') {
    return {
      status: 'disabled',
      text: null,
      handle: null,
    };
  }
  if (inputs.narrative === 'trusted' && (!hasTrustedWriteToken(deps, context) || !privilegedDeliveryObserved)) {
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
  const callerDepth = numberLimit(detector.limits, 'callerDepth', inputs.callerDepth);
  const maxCallers = numberLimit(detector.limits, 'maxCallers', inputs.maxCallers);
  const lines = [
    ACTION_MARKER,
    actionRunMarker(context),
    '',
    '# CodeGraph PR Impact',
    '',
    '## Run metadata',
    '',
    `- Recorded at: ${recordedAt}`,
    `- Action run: ${markdownInline(context.runId || 'unknown')}`,
    `- Run attempt: ${markdownInline(context.runAttempt || 'unknown')}`,
    `- Repository: ${markdownInline(context.repository || 'unknown')}`,
    `- Pull request: ${context.pullNumber === null ? 'unknown' : `#${context.pullNumber}`}`,
    `- Base ref: ${markdownInline(resolveBaseRef(inputs, context))}`,
    `- Head SHA: ${markdownInline(context.headSha || 'unknown')}`,
    `- Merge base: ${markdownInline(context.mergeBase ?? 'unknown')}`,
    `- CodeGraph version: ${markdownInline(inputs.codegraphVersion)}`,
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
    `- Artifact: ${markdownInline(artifactName)}`,
    '',
    '## Changed symbols',
    '',
    ...formatChangedSymbols(detector.changedSymbols),
    '',
    '## Unmapped hunks',
    '',
    ...formatUnmappedHunks(detector.unmappedHunks),
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
    `- Caller depth: ${callerDepth}`,
    `- Max callers: ${maxCallers}`,
    '',
    '## Fallback delivery note',
    '',
    `- Report path: ${markdownInline(delivery.reportPath)}`,
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
      ...formatNarrativeText(narrative.text),
      '',
    );
  }
  return lines.join('\n');
}

function formatNarrativeText(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  return lines.map((line) => `> ${line ? markdownInline(line) : ' '}`);
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

interface ActionRunIdentity {
  runId: string;
  runAttempt: string;
  headSha: string;
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
  const leftIdentity = parseActionRunIdentity(left.body);
  const rightIdentity = parseActionRunIdentity(right.body);
  const identityOrder = compareActionRunIdentityNewestFirst(leftIdentity, rightIdentity);
  if (identityOrder !== 0) return identityOrder;
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

function sortActionOwnedComments(comments: GitHubComment[]): GitHubComment[] {
  return comments
    .filter(isActionOwnedComment)
    .sort(compareCommentNewestFirst);
}

function actionRunMarker(context: PullRequestContext): string {
  return `${ACTION_RUN_MARKER_PREFIX}${context.runId || 'unknown'}:${context.runAttempt || 'unknown'}:${context.headSha || 'unknown'} -->`;
}

function parseActionRunIdentity(body: string): ActionRunIdentity | null {
  const marker = body.match(/<!-- codegraph-pr-impact-run:([^:>]+):([^:>]+):([^ >]+) -->/);
  if (marker) {
    return {
      runId: marker[1] ?? '',
      runAttempt: marker[2] ?? '',
      headSha: marker[3] ?? '',
    };
  }
  const runId = body.match(/^- Action run: ([^\n]+)$/m)?.[1]?.trim();
  const runAttempt = body.match(/^- Run attempt: ([^\n]+)$/m)?.[1]?.trim();
  const headSha = body.match(/^- Head SHA: ([^\n]+)$/m)?.[1]?.trim();
  return runId && runAttempt && headSha ? { runId, runAttempt, headSha } : null;
}

function compareActionRunIdentityNewestFirst(left: ActionRunIdentity | null, right: ActionRunIdentity | null): number {
  if (!left || !right) return 0;
  const leftRun = Number(left.runId);
  const rightRun = Number(right.runId);
  if (Number.isFinite(leftRun) && Number.isFinite(rightRun) && leftRun !== rightRun) return rightRun - leftRun;
  const leftAttempt = Number(left.runAttempt);
  const rightAttempt = Number(right.runAttempt);
  if (Number.isFinite(leftAttempt) && Number.isFinite(rightAttempt) && leftAttempt !== rightAttempt) return rightAttempt - leftAttempt;
  return 0;
}

function isNewerRunComment(comment: GitHubComment, context: PullRequestContext): boolean {
  const commentIdentity = parseActionRunIdentity(comment.body);
  if (!commentIdentity) return false;
  return compareActionRunIdentityNewestFirst(commentIdentity, {
    runId: context.runId,
    runAttempt: context.runAttempt,
    headSha: context.headSha,
  }) < 0;
}

function isSameRunComment(comment: GitHubComment, context: PullRequestContext): boolean {
  const commentIdentity = parseActionRunIdentity(comment.body);
  return Boolean(
    commentIdentity &&
    commentIdentity.runId === context.runId &&
    commentIdentity.runAttempt === context.runAttempt &&
    commentIdentity.headSha === context.headSha,
  );
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
    return `- ${markdownInline(stringField(symbol, 'qualifiedName') || stringField(symbol, 'name') || 'unknown')} (${markdownInline(stringField(symbol, 'kind') || 'symbol')}) — ${markdownInline(stringField(symbol, 'filePath') || 'unknown path')}`;
  });
}

function formatUnmappedHunks(items: unknown[]): string[] {
  if (items.length === 0) return ['- None.'];
  return items.map((item) => {
    const hunk = item as Record<string, unknown>;
    const path = stringField(hunk, 'newPath') || stringField(hunk, 'oldPath') || 'unknown path';
    const range = formatHunkRange(hunk);
    const reason = stringField(hunk, 'reason') || 'unknown';
    const message = stringField(hunk, 'message');
    const suffix = message ? ` — ${markdownInline(message)}` : '';
    return `- ${markdownInline(path)}${range ? `:${markdownInline(range)}` : ''} — ${markdownInline(reason)}${suffix}`;
  });
}

function formatCallers(items: unknown[]): string[] {
  if (items.length === 0) return ['- None.'];
  return items.map((item) => {
    const caller = item as Record<string, unknown>;
    return `- ${markdownInline(stringField(caller, 'qualifiedName') || stringField(caller, 'name') || 'unknown')} — ${markdownInline(stringField(caller, 'filePath') || 'unknown path')}`;
  });
}

function formatAffectedFlows(flows: DetectorResult['affectedFlows']): string[] {
  const lines = [`- State: ${markdownInline(flows.state)}`];
  if (flows.items.length === 0) return lines;
  for (const item of flows.items) {
    const flow = item as Record<string, unknown>;
    lines.push(`- ${markdownInline(stringField(flow, 'name') || stringField(flow, 'flowId') || 'unknown flow')}`);
  }
  return lines;
}

function formatItems(items: unknown[]): string[] {
  if (items.length === 0) return ['- None.'];
  return items.map((item) => `- ${markdownInline(JSON.stringify(item))}`);
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

function requiredCountField(value: Record<string, unknown>, field: string): number | null {
  const fieldValue = value[field];
  return typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue) && fieldValue >= 0
    ? fieldValue
    : null;
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const object = objectValue(value);
  if (!object) return '';
  const fieldValue = object[field];
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

function exitCodeForSummaryStatus(status: SummaryStatus): DetectorExitCode {
  if (status === 'unavailable') return 3;
  if (status === 'threshold_breach') return 2;
  if (status === 'impact') return 1;
  return 0;
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

function parseOptionalInteger(raw: string, label: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, error: null };
  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: `Invalid ${label}: expected a non-negative integer or an empty value, received ${JSON.stringify(raw)}.`,
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return {
      value: null,
      error: `Invalid ${label}: expected a safe non-negative integer or an empty value, received ${JSON.stringify(raw)}.`,
    };
  }
  return { value: parsed, error: null };
}

function parseIntegerInput(raw: string, label: string, fallback: number): { value: number; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: fallback, error: null };
  if (!/^\d+$/.test(trimmed)) {
    return {
      value: fallback,
      error: `Invalid ${label}: expected a non-negative integer or an empty value, received ${JSON.stringify(raw)}.`,
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return {
      value: fallback,
      error: `Invalid ${label}: expected a safe non-negative integer or an empty value, received ${JSON.stringify(raw)}.`,
    };
  }
  return { value: parsed, error: null };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseBooleanInput(raw: string, label: string): { value: boolean; error: string | null } {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return { value: false, error: null };
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return { value: true, error: null };
  if (['0', 'false', 'no', 'off'].includes(normalized)) return { value: false, error: null };
  return {
    value: false,
    error: `Invalid ${label}: expected true, false, 1, 0, yes, no, on, off, or an empty value, received ${JSON.stringify(raw)}.`,
  };
}

function parseNarrativeInput(raw: string, label: string): { value: ActionInputs['narrative']; error: string | null } {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '' || normalized === 'off') return { value: 'off', error: null };
  if (normalized === 'trusted') return { value: 'trusted', error: null };
  return {
    value: 'off',
    error: `Invalid ${label}: expected off, trusted, or an empty value, received ${JSON.stringify(raw)}.`,
  };
}

function numberLimit(limits: Record<string, unknown>, field: string, fallback: number): number {
  const value = limits[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatHunkRange(value: unknown): string {
  const hunk = objectValue(value);
  if (!hunk) return '';
  const newStart = positiveNumberOrNull(hunk.newStart);
  const newLines = numberOr(hunk.newLines, 1);
  const oldStart = positiveNumberOrNull(hunk.oldStart);
  const oldLines = numberOr(hunk.oldLines, 1);
  const start = newStart !== null && newLines !== 0 ? newStart : oldStart;
  const lines = newStart !== null && newLines !== 0 ? newLines : oldLines;
  if (!start) return '';
  return lines && lines > 1 ? `${start}+${lines}` : String(start);
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function markdownInline(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, ' ↵ ')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]()#!|])/g, '\\$1');
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
