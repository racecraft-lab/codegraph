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
export function createRunDependencies() {
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
        fetch: globalThis.fetch,
    };
}
export function parseActionInputs(env) {
    const narrative = readInput(env, 'NARRATIVE', 'off');
    const requestedCodegraphVersion = readInput(env, 'CODEGRAPH_VERSION', DEFAULT_CODEGRAPH_VERSION);
    return {
        codegraphVersion: env.PR_IMPACT_CODEGRAPH_RESOLVED_VERSION || requestedCodegraphVersion,
        baseRef: readInput(env, 'BASE_REF', ''),
        failOnCallers: parseOptionalInteger(readInput(env, 'FAIL_ON_CALLERS', '')),
        failOnHubs: parseBoolean(readInput(env, 'FAIL_ON_HUBS', 'false')),
        callerDepth: clampInteger(parseInteger(readInput(env, 'CALLER_DEPTH', '1'), 1), MIN_CALLER_DEPTH, MAX_CALLER_DEPTH),
        maxCallers: clampInteger(parseInteger(readInput(env, 'MAX_CALLERS', '20'), 20), MIN_MAX_CALLERS, MAX_MAX_CALLERS),
        narrative: narrative === 'trusted' ? 'trusted' : 'off',
    };
}
export function determineConclusion(detector, durableReportAvailable) {
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
export async function runAction(deps = createRunDependencies()) {
    const inputs = parseActionInputs(deps.env);
    const context = readPullRequestContext(deps, inputs);
    const reportPath = deps.env.PR_IMPACT_REPORT_PATH ?? 'pr-impact-report.md';
    const artifactName = deps.env.PR_IMPACT_ARTIFACT_NAME ?? 'codegraph-pr-impact';
    const workspaceHeadError = validateWorkspaceHead(deps, context);
    const cacheStatus = workspaceHeadError ? 'unavailable' : prepareCache(deps, inputs, context);
    const effectiveBaseRef = resolveBaseRef(inputs, context);
    const baseIndex = cacheStatus === 'unavailable'
        ? { status: 'not-needed', dir: null }
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
        recordedAt: deps.now().toISOString(),
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
                recordedAt: deps.now().toISOString(),
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
        recordedAt: deps.now().toISOString(),
    });
    delivery = { ...delivery, summary: writeSummary(deps, report) };
    if (delivery.status === 'fallback' && !reportFileWritten && delivery.summary !== 'written') {
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
            recordedAt: deps.now().toISOString(),
        });
    }
    if (reportFileWritten)
        writeReportFile(deps, reportPath, report);
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
function prepareCache(deps, inputs, context) {
    const explicitStatus = deps.env.PR_IMPACT_CACHE_STATUS;
    if (isCacheStatus(explicitStatus))
        return explicitStatus;
    const identity = cacheIdentity(deps, inputs, context);
    const metadataPath = deps.env.PR_IMPACT_CACHE_METADATA_PATH ?? '.codegraph/pr-impact-cache.json';
    const restoreHit = deps.env.PR_IMPACT_CACHE_RESTORE_HIT === 'true';
    const restoredStatus = restoreHit || fileExists(deps, metadataPath)
        ? validateCacheMetadata(deps, metadataPath, identity)
        : 'miss';
    if (restoredStatus === 'warm-valid')
        return restoredStatus;
    const rebuildMode = restoredStatus === 'miss' ? 'init' : 'index';
    if (!rebuildAndValidateCodeGraphIndex(deps, rebuildMode, metadataPath, identity)) {
        if (rebuildMode !== 'index' || !resetCodeGraphIndex(deps) || !rebuildAndValidateCodeGraphIndex(deps, 'init', metadataPath, identity)) {
            return 'unavailable';
        }
    }
    return 'rebuilt';
}
function validateWorkspaceHead(deps, context) {
    if (deps.env.PR_IMPACT_VALIDATE_HEAD !== 'true' || !context.headSha)
        return null;
    try {
        const actual = String(deps.execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })).trim();
        if (actual === context.headSha)
            return null;
        return `Checked-out workspace HEAD (${actual || 'unknown'}) does not match pull request head SHA (${context.headSha}); checkout github.event.pull_request.head.sha before running CodeGraph PR impact.`;
    }
    catch {
        return 'Unable to verify checked-out workspace HEAD before CodeGraph PR impact analysis.';
    }
}
function prepareBaseIndexIfNeeded(deps, context) {
    if (deps.env.PR_IMPACT_PREPARE_BASE_INDEX !== 'true') {
        return deps.env.PR_IMPACT_BASE_INDEX_DIR
            ? { status: 'ready', dir: deps.env.PR_IMPACT_BASE_INDEX_DIR }
            : { status: 'not-needed', dir: null };
    }
    if (!context.mergeBase)
        return { status: 'not-needed', dir: null };
    const needsBaseIndex = prDiffNeedsBaseIndex(deps, context.mergeBase, context.headSha);
    if (needsBaseIndex === null) {
        return { status: 'failed', dir: null, message: 'Unable to inspect PR diff for deleted symbols before analysis.' };
    }
    if (!needsBaseIndex)
        return { status: 'not-needed', dir: null };
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
    }
    catch (error) {
        deps.rmSync(baseIndexDir, { recursive: true, force: true });
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'failed', dir: null, message: `Unable to prepare base CodeGraph index for deleted-file analysis: ${message}` };
    }
    finally {
        try {
            deps.execFileSync('git', ['worktree', 'remove', '--force', baseWorktreePath], {
                encoding: 'utf8',
                env: deps.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch {
            deps.rmSync(baseWorktreePath, { recursive: true, force: true });
        }
    }
}
function prDiffNeedsBaseIndex(deps, mergeBase, headSha) {
    try {
        const nameStatus = String(deps.execFileSync('git', ['diff', '--name-status', '-z', mergeBase, headSha || 'HEAD', '--'], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        }));
        if (nameStatusHasDeletedFile(nameStatus))
            return true;
        const patch = String(deps.execFileSync('git', ['diff', '--no-ext-diff', '--no-color', '--unified=0', mergeBase, headSha || 'HEAD', '--'], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        }));
        return patchDeletesContent(patch);
    }
    catch {
        return null;
    }
}
function patchDeletesContent(patch) {
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
        if (inHunk && line.startsWith('-'))
            return true;
    }
    return false;
}
function nameStatusHasDeletedFile(output) {
    const parts = output.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length;) {
        const status = parts[i++];
        if (status.startsWith('D'))
            return true;
        i += status.startsWith('R') || status.startsWith('C') ? 2 : 1;
    }
    return false;
}
function isPlainCodeGraphDirName(dir) {
    return dir !== ''
        && dir !== '.'
        && !dir.includes('..')
        && !dir.includes('/')
        && !dir.includes('\\');
}
function cacheIdentity(deps, inputs, context) {
    return {
        repository: context.repository || deps.env.GITHUB_REPOSITORY || 'unknown',
        codegraphVersion: inputs.codegraphVersion,
        baseRef: inputs.baseRef || context.baseRef || 'HEAD^',
        headSha: context.headSha || deps.env.GITHUB_SHA || 'unknown',
        mergeBase: context.mergeBase ?? 'unknown',
        lockfileHash: hashFirstExistingFile(deps, ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']),
    };
}
function validateCacheMetadata(deps, metadataPath, expected) {
    let metadata;
    try {
        metadata = JSON.parse(String(deps.readFileSync(metadataPath, 'utf8')));
    }
    catch {
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
    for (const field of ['baseRef', 'headSha', 'mergeBase', 'lockfileHash']) {
        if (metadata.identity[field] !== expected[field])
            return 'stale';
    }
    return validateWarmIndexHealth(deps, expected);
}
function validateWarmIndexHealth(deps, expected) {
    let status;
    try {
        status = JSON.parse(String(deps.execFileSync(codegraphBin(deps), ['status', '--json'], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })));
    }
    catch {
        return 'stale';
    }
    const report = objectValue(status);
    if (!report)
        return 'stale';
    const version = requiredStringField(report, 'version');
    if (version === null || version !== expected.codegraphVersion) {
        return 'incompatible';
    }
    if (!hasOwn(report, 'worktreeMismatch') || report.worktreeMismatch !== null) {
        return 'stale';
    }
    const pending = objectField(report, 'pendingChanges');
    if (!pending ||
        requiredNumberField(pending, 'added') === null ||
        requiredNumberField(pending, 'modified') === null ||
        requiredNumberField(pending, 'removed') === null) {
        return 'stale';
    }
    if (requiredNumberField(pending, 'added') > 0 || requiredNumberField(pending, 'modified') > 0 || requiredNumberField(pending, 'removed') > 0) {
        return 'stale';
    }
    const index = objectField(report, 'index');
    if (!index)
        return 'stale';
    const builtWithExtractionVersion = requiredNumberField(index, 'builtWithExtractionVersion');
    const currentExtractionVersion = requiredNumberField(index, 'currentExtractionVersion');
    if (builtWithExtractionVersion === null || currentExtractionVersion === null) {
        return 'incompatible';
    }
    if (builtWithExtractionVersion !== currentExtractionVersion) {
        return 'incompatible';
    }
    if (index.reindexRecommended !== false)
        return 'stale';
    if (index.state !== 'complete')
        return 'stale';
    const pendingRefs = requiredNumberField(index, 'pendingRefs');
    if (pendingRefs === null || pendingRefs !== 0)
        return 'stale';
    return 'warm-valid';
}
function rebuildAndValidateCodeGraphIndex(deps, mode, metadataPath, identity) {
    if (!rebuildCodeGraphIndex(deps, mode))
        return false;
    writeCacheMetadata(deps, metadataPath, identity);
    return validateWarmIndexHealth(deps, identity) === 'warm-valid';
}
function rebuildCodeGraphIndex(deps, mode) {
    const gitignorePath = deps.env.PR_IMPACT_GITIGNORE_PATH ?? '.gitignore';
    const gitignore = mode === 'init' ? readOptionalFile(deps, gitignorePath) : null;
    if (gitignore?.state === 'read-failed')
        return false;
    try {
        deps.execFileSync(codegraphBin(deps), [mode], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        if (gitignore)
            restoreOptionalFile(deps, gitignorePath, gitignore);
    }
}
function resetCodeGraphIndex(deps) {
    try {
        deps.rmSync(deps.env.PR_IMPACT_CODEGRAPH_PATH ?? '.codegraph', { recursive: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
function readOptionalFile(deps, path) {
    try {
        if (!deps.existsSync(path))
            return { state: 'absent' };
    }
    catch {
        return { state: 'read-failed' };
    }
    try {
        return { state: 'present', content: String(deps.readFileSync(path, 'utf8')) };
    }
    catch {
        return { state: 'read-failed' };
    }
}
function fileExists(deps, path) {
    try {
        return deps.existsSync(path);
    }
    catch {
        return false;
    }
}
function restoreOptionalFile(deps, path, snapshot) {
    try {
        if (snapshot.state === 'present') {
            deps.writeFileSync(path, snapshot.content, 'utf8');
        }
        else if (snapshot.state === 'absent' && deps.existsSync(path)) {
            deps.rmSync(path, { force: true });
        }
    }
    catch {
        // Restoring the advisory .gitignore mutation is best-effort; the action
        // still reports through the deterministic detector result below.
    }
}
function writeCacheMetadata(deps, metadataPath, identity) {
    try {
        deps.mkdirSync(dirname(metadataPath), { recursive: true });
        const metadata = {
            schemaVersion: 1,
            helperVersion: HELPER_VERSION,
            recordedAt: new Date().toISOString(),
            identity,
        };
        deps.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    }
    catch {
        // A metadata write failure should not make a freshly rebuilt index unusable
        // for the current analysis; the next run will simply rebuild again.
    }
}
function hashFirstExistingFile(deps, paths) {
    for (const path of paths) {
        try {
            return createHash('sha256').update(String(deps.readFileSync(path, 'utf8'))).digest('hex');
        }
        catch {
            // Try the next lockfile name.
        }
    }
    return 'missing';
}
function writeReportFile(deps, reportPath, report) {
    try {
        deps.mkdirSync(dirname(reportPath), { recursive: true });
        deps.writeFileSync(reportPath, report, 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
function readPullRequestContext(deps, inputs) {
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
        mergeBase: resolveMergeBase(deps, baseRef, headSha, baseSha, Boolean(inputs.baseRef)),
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
function resolveBaseRef(inputs, context) {
    return inputs.baseRef || context.baseRef || 'HEAD^';
}
function resolveDetectorBaseRef(inputs, context) {
    if (context.mergeBase)
        return context.mergeBase;
    if (inputs.baseRef)
        return inputs.baseRef;
    if (context.baseRef)
        return context.baseRef.includes('/') ? context.baseRef : `origin/${context.baseRef}`;
    return 'HEAD^';
}
function resolveMergeBase(deps, baseRef, headSha, fallbackBaseSha, explicitBaseRef = false) {
    if (deps.env.PR_IMPACT_MERGE_BASE)
        return deps.env.PR_IMPACT_MERGE_BASE;
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
                if (mergeBase)
                    return mergeBase;
            }
            catch {
                // Try the next available base identity before falling back to payload
                // metadata. Detached PR checkouts frequently lack a local base branch.
            }
        }
    }
    return explicitBaseRef ? null : fallbackBaseSha || null;
}
function baseRefMergeCandidates(baseRef) {
    if (!baseRef)
        return [];
    const candidates = [baseRef];
    if (!baseRef.startsWith('origin/')) {
        candidates.push(`origin/${baseRef}`);
    }
    return [...new Set(candidates)];
}
function trustedContextFor(deps, isForkLike) {
    if (deps.env.GITHUB_ACTOR === 'dependabot[bot]')
        return false;
    const raw = deps.env.PR_IMPACT_TRUSTED_CONTEXT;
    if (raw !== undefined)
        return parseBoolean(raw);
    return !isForkLike;
}
function hasTrustedWriteToken(deps, context) {
    return Boolean(deps.env.GITHUB_TOKEN) && !context.isForkLike && (context.tokenPermissions.issuesWrite || context.tokenPermissions.pullRequestsWrite);
}
function readGitHubEvent(deps) {
    const eventPath = deps.env.GITHUB_EVENT_PATH;
    if (!eventPath)
        return {};
    try {
        return JSON.parse(String(deps.readFileSync(eventPath, 'utf8')));
    }
    catch {
        return {};
    }
}
function runDetector(deps, inputs, context, baseIndexDir = null) {
    const baseRef = resolveDetectorBaseRef(inputs, context);
    const jsonArgs = detectorArgs(inputs, baseRef, context.headSha || 'HEAD', 'json', baseIndexDir);
    try {
        const json = runDetectorCommand(deps, jsonArgs);
        return normalizeDetectorResult(JSON.parse(json), inputs, baseRef);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createUnavailableDetector(inputs, message, baseRef);
    }
}
function detectorArgs(inputs, baseRef, headRef, format, baseIndexDir = null) {
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
    if (failOn)
        args.push('--fail-on', failOn);
    if (baseIndexDir)
        args.push('--base-index-dir', baseIndexDir);
    return args;
}
function failOnPolicy(inputs) {
    const policies = [];
    if (inputs.failOnCallers !== null)
        policies.push(`callers>${inputs.failOnCallers}`);
    if (inputs.failOnHubs)
        policies.push('hub');
    return policies.join(',');
}
function runDetectorCommand(deps, args) {
    try {
        return String(deps.execFileSync(codegraphBin(deps), args, {
            encoding: 'utf8',
            env: deps.env,
            maxBuffer: 20 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        }));
    }
    catch (error) {
        const maybe = error;
        if ((maybe.status === 1 || maybe.status === 2 || maybe.status === 3) && maybe.stdout) {
            return String(maybe.stdout);
        }
        throw error;
    }
}
function codegraphBin(deps) {
    return deps.env.PR_IMPACT_CODEGRAPH_BIN || 'codegraph';
}
function normalizeDetectorResult(raw, inputs, baseRef) {
    const candidate = raw;
    const summary = (candidate.summary ?? {});
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
function createUnavailableDetector(inputs, message = 'SPEC-020 action helper could not run detect-changes.', baseRef = inputs.baseRef) {
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
function createInitialDelivery(reportPath) {
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
async function deliverReportComment(deps, context, report, reportPath, reportFileWritten) {
    const base = {
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
    const duplicates = marked.slice(1);
    const duplicateIds = [];
    const failedDuplicateIds = [];
    if (current) {
        if (isNewerRunComment(current, context))
            return { ...base, comment: 'skipped' };
        const updated = await patchComment(deps, context, current.id, report);
        for (const duplicate of duplicates) {
            const retired = await patchComment(deps, context, duplicate.id, `${ACTION_MARKER}\n\n_Retired duplicate CodeGraph PR impact report._`);
            if (retired)
                duplicateIds.push(String(duplicate.id));
            else
                failedDuplicateIds.push(String(duplicate.id));
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
    if (!created)
        return { ...base, comment: 'failed' };
    const refreshed = await listComments(deps, context);
    const markedAfterCreate = refreshed === null ? [created] : sortActionOwnedComments(refreshed);
    const currentAfterCreate = markedAfterCreate[0] ?? created;
    const postCreateDuplicateIds = [];
    const postCreateFailedDuplicateIds = [];
    for (const duplicate of markedAfterCreate.slice(1)) {
        const retired = await patchComment(deps, context, duplicate.id, `${ACTION_MARKER}\n\n_Retired duplicate CodeGraph PR impact report._`);
        if (retired)
            postCreateDuplicateIds.push(String(duplicate.id));
        else
            postCreateFailedDuplicateIds.push(String(duplicate.id));
    }
    if (isNewerRunComment(currentAfterCreate, context)) {
        return {
            ...base,
            comment: 'skipped',
            duplicateCommentIds: postCreateDuplicateIds,
            failedDuplicateCommentIds: postCreateFailedDuplicateIds,
        };
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
async function patchDeliveredComment(deps, context, delivery, report) {
    if (delivery.currentCommentId === null)
        return false;
    const comments = await listComments(deps, context);
    if (comments === null)
        return false;
    const current = comments.find((comment) => String(comment.id) === String(delivery.currentCommentId));
    if (!current || isNewerRunComment(current, context))
        return false;
    return patchComment(deps, context, delivery.currentCommentId, report);
}
function writeSummary(deps, report) {
    if (!deps.env.GITHUB_STEP_SUMMARY)
        return 'failed';
    try {
        deps.appendFileSync(deps.env.GITHUB_STEP_SUMMARY, `${report}\n`, 'utf8');
        return 'written';
    }
    catch {
        return 'failed';
    }
}
function createInitialNarrative(inputs, context, deps, privilegedDeliveryObserved) {
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
function renderReport(args) {
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
        lines.push('## Narrative appendix', '', '_prose-only narrative. Deterministic facts and final conclusion above remain authoritative._', '', narrative.text, '');
    }
    return lines.join('\n');
}
async function listComments(deps, context) {
    const comments = [];
    for (let page = 1; page <= 10; page++) {
        const result = await fetchJson(deps, `${issueCommentsUrl(deps, context)}?per_page=100&page=${page}`, {
            method: 'GET',
            headers: githubHeaders(deps),
        });
        if (!result.ok)
            return null;
        if (!Array.isArray(result.json))
            return [];
        comments.push(...result.json.filter(isGitHubComment));
        if (result.json.length < 100)
            break;
    }
    return comments;
}
async function fetchJson(deps, url, init) {
    try {
        const response = await deps.fetch(url, init);
        if (!response.ok)
            return { ok: false, status: response.status, json: null };
        try {
            return { ok: true, status: response.status, json: await response.json() };
        }
        catch {
            return { ok: false, status: response.status, json: null };
        }
    }
    catch {
        return { ok: false, status: 0, json: null };
    }
}
async function createComment(deps, context, body) {
    const result = await fetchJson(deps, issueCommentsUrl(deps, context), {
        method: 'POST',
        headers: githubHeaders(deps),
        body: JSON.stringify({ body }),
    });
    if (!result.ok)
        return null;
    return isGitHubComment(result.json) ? result.json : null;
}
async function patchComment(deps, context, id, body) {
    const result = await fetchJson(deps, `${apiBase(deps)}/repos/${context.repository}/issues/comments/${id}`, {
        method: 'PATCH',
        headers: githubHeaders(deps),
        body: JSON.stringify({ body }),
    });
    return result.ok;
}
function issueCommentsUrl(deps, context) {
    return `${apiBase(deps)}/repos/${context.repository}/issues/${context.pullNumber}/comments`;
}
function apiBase(deps) {
    return deps.env.GITHUB_API_URL ?? 'https://api.github.com';
}
function githubHeaders(deps) {
    const headers = {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (deps.env.GITHUB_TOKEN)
        headers.Authorization = `Bearer ${deps.env.GITHUB_TOKEN}`;
    return headers;
}
function compareCommentNewestFirst(left, right) {
    const leftIdentity = parseActionRunIdentity(left.body);
    const rightIdentity = parseActionRunIdentity(right.body);
    const identityOrder = compareActionRunIdentityNewestFirst(leftIdentity, rightIdentity);
    if (identityOrder !== 0)
        return identityOrder;
    const leftTime = Date.parse(left.created_at ?? '');
    const rightTime = Date.parse(right.created_at ?? '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
    }
    return Number(right.id) - Number(left.id);
}
function isActionOwnedComment(comment) {
    return comment.body.includes(ACTION_MARKER) && comment.user?.login === 'github-actions[bot]';
}
function sortActionOwnedComments(comments) {
    return comments
        .filter(isActionOwnedComment)
        .sort(compareCommentNewestFirst);
}
function actionRunMarker(context) {
    return `${ACTION_RUN_MARKER_PREFIX}${context.runId || 'unknown'}:${context.runAttempt || 'unknown'}:${context.headSha || 'unknown'} -->`;
}
function parseActionRunIdentity(body) {
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
function compareActionRunIdentityNewestFirst(left, right) {
    if (!left || !right)
        return 0;
    const leftRun = Number(left.runId);
    const rightRun = Number(right.runId);
    if (Number.isFinite(leftRun) && Number.isFinite(rightRun) && leftRun !== rightRun)
        return rightRun - leftRun;
    const leftAttempt = Number(left.runAttempt);
    const rightAttempt = Number(right.runAttempt);
    if (Number.isFinite(leftAttempt) && Number.isFinite(rightAttempt) && leftAttempt !== rightAttempt)
        return rightAttempt - leftAttempt;
    return 0;
}
function isNewerRunComment(comment, context) {
    const commentIdentity = parseActionRunIdentity(comment.body);
    if (!commentIdentity)
        return false;
    return compareActionRunIdentityNewestFirst(commentIdentity, {
        runId: context.runId,
        runAttempt: context.runAttempt,
        headSha: context.headSha,
    }) < 0;
}
function isGitHubComment(value) {
    const candidate = value;
    return (candidate !== null &&
        typeof candidate === 'object' &&
        (typeof candidate.id === 'number' || typeof candidate.id === 'string') &&
        typeof candidate.body === 'string' &&
        typeof candidate.html_url === 'string');
}
function formatChangedSymbols(items) {
    if (items.length === 0)
        return ['- None.'];
    return items.map((item) => {
        const symbol = item;
        return `- ${markdownInline(stringField(symbol, 'qualifiedName') || stringField(symbol, 'name') || 'unknown')} (${markdownInline(stringField(symbol, 'kind') || 'symbol')}) — ${markdownInline(stringField(symbol, 'filePath') || 'unknown path')}`;
    });
}
function formatCallers(items) {
    if (items.length === 0)
        return ['- None.'];
    return items.map((item) => {
        const caller = item;
        return `- ${markdownInline(stringField(caller, 'qualifiedName') || stringField(caller, 'name') || 'unknown')} — ${markdownInline(stringField(caller, 'filePath') || 'unknown path')}`;
    });
}
function formatAffectedFlows(flows) {
    const lines = [`- State: ${markdownInline(flows.state)}`];
    if (flows.items.length === 0)
        return lines;
    for (const item of flows.items) {
        const flow = item;
        lines.push(`- ${markdownInline(stringField(flow, 'name') || stringField(flow, 'flowId') || 'unknown flow')}`);
    }
    return lines;
}
function formatItems(items) {
    if (items.length === 0)
        return ['- None.'];
    return items.map((item) => `- ${markdownInline(JSON.stringify(item))}`);
}
function emitOutput(deps, name, value) {
    const outputFile = deps.env.GITHUB_OUTPUT;
    if (outputFile) {
        deps.appendFileSync(outputFile, `${name}=${escapeOutputFileValue(value)}\n`, 'utf8');
        return;
    }
    deps.stdout.write(`::set-output name=${name}::${escapeCommandValue(value)}\n`);
}
function readInput(env, name, fallback) {
    return env[`INPUT_${name}`] ?? fallback;
}
function stringAt(value, pathParts) {
    let current = value;
    for (const part of pathParts) {
        if (current === null || typeof current !== 'object')
            return '';
        current = current[part];
    }
    return typeof current === 'string' ? current : '';
}
function numberAt(value, pathParts) {
    let current = value;
    for (const part of pathParts) {
        if (current === null || typeof current !== 'object')
            return null;
        current = current[part];
    }
    return typeof current === 'number' ? current : null;
}
function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function objectValue(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function objectField(value, field) {
    return objectValue(value[field]);
}
function requiredStringField(value, field) {
    return typeof value[field] === 'string' && value[field] !== '' ? value[field] : null;
}
function requiredNumberField(value, field) {
    const fieldValue = value[field];
    return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : null;
}
function hasOwn(value, field) {
    return Object.prototype.hasOwnProperty.call(value, field);
}
function stringField(value, field) {
    const fieldValue = value[field];
    return typeof fieldValue === 'string' ? fieldValue : '';
}
function normalizeAffectedFlows(value) {
    const flows = value;
    return {
        state: typeof flows?.state === 'string' ? flows.state : 'unavailable',
        items: Array.isArray(flows?.items) ? flows.items : [],
        truncated: typeof flows?.truncated === 'boolean' ? flows.truncated : false,
    };
}
function isSummaryStatus(value) {
    return value === 'clean' || value === 'impact' || value === 'threshold_breach' || value === 'unavailable';
}
function isDetectorExitCode(value) {
    return value === 0 || value === 1 || value === 2 || value === 3;
}
function isCacheStatus(value) {
    return (value === 'warm-valid' ||
        value === 'miss' ||
        value === 'stale' ||
        value === 'corrupt' ||
        value === 'incompatible' ||
        value === 'rebuilt' ||
        value === 'unavailable');
}
function parseOptionalInteger(raw) {
    if (raw.trim() === '')
        return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseInteger(raw, fallback) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function clampInteger(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function parseBoolean(raw) {
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}
function numberLimit(limits, field, fallback) {
    const value = limits[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function markdownInline(raw) {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r\n|\r|\n/g, ' ↵ ')
        .replace(/\\/g, '\\\\')
        .replace(/([`*_\[\]()#!|])/g, '\\$1');
}
function escapeOutputFileValue(value) {
    return value.replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function escapeCommandValue(value) {
    return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function isDirectRun(metaUrl, argvPath) {
    return argvPath !== undefined && fileURLToPath(metaUrl) === argvPath;
}
if (isDirectRun(import.meta.url, process.argv[1])) {
    runAction().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`CodeGraph PR impact helper failed: ${message}\n`);
        process.exitCode = 1;
    });
}
