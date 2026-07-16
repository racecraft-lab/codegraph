import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const HELPER_VERSION = '0.1.0-spec-020';
export const DEFAULT_CODEGRAPH_VERSION = '1.4.1';
export const ACTION_MARKER = '<!-- codegraph-pr-impact-action -->';
export function createRunDependencies() {
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
        fetch: globalThis.fetch,
    };
}
export function parseActionInputs(env) {
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
    const cacheStatus = prepareCache(deps, inputs, context);
    const effectiveBaseRef = resolveBaseRef(inputs, context);
    const detector = cacheStatus === 'unavailable'
        ? createUnavailableDetector(inputs, 'CodeGraph cache/index is unavailable.', effectiveBaseRef)
        : runDetector(deps, inputs, context);
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
        artifact: reportFileWritten ? 'uploaded' : 'failed',
        summary: writeSummary(deps, report),
    };
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
        if (reportFileWritten)
            writeReportFile(deps, reportPath, report);
    }
    emitOutput(deps, 'summary-status', detector.summary.status);
    emitOutput(deps, 'detector-exit-code', String(detector.exitCode));
    emitOutput(deps, 'conclusion', conclusion);
    emitOutput(deps, 'threshold-breached', String(detector.summary.status === 'threshold_breach'));
    emitOutput(deps, 'cache-status', cacheStatus);
    emitOutput(deps, 'delivery-status', delivery.status);
    emitOutput(deps, 'comment-url', delivery.commentUrl);
    emitOutput(deps, 'report-path', reportPath);
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
    const restoredStatus = restoreHit ? validateCacheMetadata(deps, metadataPath, identity) : 'miss';
    if (restoredStatus === 'warm-valid')
        return restoredStatus;
    if (!rebuildCodeGraphIndex(deps))
        return 'unavailable';
    writeCacheMetadata(deps, metadataPath, identity);
    return 'rebuilt';
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
        status = JSON.parse(String(deps.execFileSync('codegraph', ['status', '--json'], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })));
    }
    catch {
        return 'stale';
    }
    const report = status;
    if (stringField(report, 'version') !== '' && stringField(report, 'version') !== expected.codegraphVersion) {
        return 'incompatible';
    }
    if (report.worktreeMismatch !== null && report.worktreeMismatch !== undefined) {
        return 'stale';
    }
    const pending = report.pendingChanges;
    if (pending && (numberOr(pending.added, 0) > 0 || numberOr(pending.modified, 0) > 0 || numberOr(pending.removed, 0) > 0)) {
        return 'stale';
    }
    const index = report.index;
    if (!index)
        return 'stale';
    if (numberOr(index.builtWithExtractionVersion, -1) !== numberOr(index.currentExtractionVersion, -2)) {
        return 'incompatible';
    }
    if (index.reindexRecommended === true)
        return 'stale';
    if (index.state !== null && index.state !== undefined && index.state !== 'complete')
        return 'stale';
    return 'warm-valid';
}
function rebuildCodeGraphIndex(deps) {
    try {
        deps.execFileSync('codegraph', ['index'], {
            encoding: 'utf8',
            env: deps.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return true;
    }
    catch {
        return false;
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
    return {
        repository,
        pullNumber,
        baseRef,
        headSha,
        mergeBase: resolveMergeBase(deps, baseRef, headSha, baseSha),
        runId: deps.env.GITHUB_RUN_ID ?? 'unknown',
        runAttempt: deps.env.GITHUB_RUN_ATTEMPT ?? 'unknown',
        isForkLike: headRepo !== '' && baseRepo !== '' && headRepo !== baseRepo,
        tokenPermissions: {
            contentsRead: true,
            issuesWrite: Boolean(deps.env.GITHUB_TOKEN),
            pullRequestsWrite: Boolean(deps.env.GITHUB_TOKEN),
        },
    };
}
function resolveBaseRef(inputs, context) {
    return inputs.baseRef || context.baseRef || 'HEAD^';
}
function resolveMergeBase(deps, baseRef, headSha, fallbackBaseSha) {
    if (deps.env.PR_IMPACT_MERGE_BASE)
        return deps.env.PR_IMPACT_MERGE_BASE;
    if (baseRef && headSha) {
        try {
            return String(deps.execFileSync('git', ['merge-base', baseRef, headSha], {
                encoding: 'utf8',
                env: deps.env,
                stdio: ['ignore', 'pipe', 'ignore'],
            })).trim() || fallbackBaseSha || null;
        }
        catch {
            // Event payload base SHA is a safe fallback for metadata when the local
            // checkout cannot compute a merge base, but cache validation still treats
            // the recorded identity as exact for that run.
        }
    }
    return fallbackBaseSha || null;
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
function runDetector(deps, inputs, context) {
    const baseRef = resolveBaseRef(inputs, context);
    const jsonArgs = detectorArgs(inputs, baseRef, 'json');
    const markdownArgs = detectorArgs(inputs, baseRef, 'markdown');
    try {
        const json = runDetectorCommand(deps, jsonArgs);
        runDetectorCommand(deps, markdownArgs);
        return normalizeDetectorResult(JSON.parse(json), inputs, baseRef);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createUnavailableDetector(inputs, message, baseRef);
    }
}
function detectorArgs(inputs, baseRef, format) {
    const args = [
        'detect-changes',
        '--mode', 'base-ref',
        '--base-ref', baseRef,
        '--format', format,
        '--caller-depth', String(inputs.callerDepth),
        '--max-callers', String(inputs.maxCallers),
    ];
    const failOn = failOnPolicy(inputs);
    if (failOn)
        args.push('--fail-on', failOn);
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
        return String(deps.execFileSync('codegraph', args, {
            encoding: 'utf8',
            env: deps.env,
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
        artifact: 'uploaded',
        currentCommentId: null,
        duplicateCommentIds: [],
        reportPath,
        commentUrl: '',
    };
}
async function deliverReportComment(deps, context, report, reportPath, reportFileWritten) {
    const base = {
        status: reportFileWritten ? 'fallback' : 'failed',
        comment: 'skipped',
        summary: 'failed',
        artifact: reportFileWritten ? 'uploaded' : 'failed',
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
    const duplicateIds = [];
    if (current) {
        const updated = await patchComment(deps, context, current.id, report);
        for (const duplicate of duplicates) {
            const retired = await patchComment(deps, context, duplicate.id, `${ACTION_MARKER}\n\n_Retired duplicate CodeGraph PR impact report._`);
            if (retired)
                duplicateIds.push(String(duplicate.id));
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
    if (!created)
        return { ...base, comment: 'failed' };
    return {
        ...base,
        status: 'comment',
        comment: 'created',
        currentCommentId: String(created.id),
        commentUrl: created.html_url,
    };
}
async function patchDeliveredComment(deps, context, delivery, report) {
    if (delivery.currentCommentId === null)
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
function createInitialNarrative(inputs, context, deps) {
    if (inputs.narrative === 'off') {
        return {
            status: 'disabled',
            text: null,
            handle: null,
        };
    }
    if (inputs.narrative === 'trusted' && (context.isForkLike || !deps.env.GITHUB_TOKEN)) {
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
        `- Base ref: ${detector.summary.baseRef || context.baseRef || inputs.baseRef || 'unresolved'}`,
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
        '- Comment delivery is attempted only when a trusted pull-request token is available.',
        '',
    ];
    if (narrative.text && (narrative.status === 'fallback' || narrative.status === 'pending' || narrative.status === 'appended')) {
        lines.push('## Narrative appendix', '', '_prose-only narrative. Deterministic facts and final conclusion above remain authoritative._', '', narrative.text, '');
    }
    return lines.join('\n');
}
async function listComments(deps, context) {
    const response = await deps.fetch(issueCommentsUrl(deps, context), {
        method: 'GET',
        headers: githubHeaders(deps),
    });
    if (!response.ok)
        return null;
    const json = await response.json();
    if (!Array.isArray(json))
        return [];
    return json.filter(isGitHubComment);
}
async function createComment(deps, context, body) {
    const response = await deps.fetch(issueCommentsUrl(deps, context), {
        method: 'POST',
        headers: githubHeaders(deps),
        body: JSON.stringify({ body }),
    });
    if (!response.ok)
        return null;
    const json = await response.json();
    return isGitHubComment(json) ? json : null;
}
async function patchComment(deps, context, id, body) {
    const response = await deps.fetch(`${apiBase(deps)}/repos/${context.repository}/issues/comments/${id}`, {
        method: 'PATCH',
        headers: githubHeaders(deps),
        body: JSON.stringify({ body }),
    });
    return response.ok;
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
    const leftTime = Date.parse(left.created_at ?? '');
    const rightTime = Date.parse(right.created_at ?? '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
    }
    return Number(right.id) - Number(left.id);
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
        return `- ${stringField(symbol, 'qualifiedName') || stringField(symbol, 'name') || 'unknown'} (${stringField(symbol, 'kind') || 'symbol'}) — ${stringField(symbol, 'filePath') || 'unknown path'}`;
    });
}
function formatCallers(items) {
    if (items.length === 0)
        return ['- None.'];
    return items.map((item) => {
        const caller = item;
        return `- ${stringField(caller, 'qualifiedName') || stringField(caller, 'name') || 'unknown'} — ${stringField(caller, 'filePath') || 'unknown path'}`;
    });
}
function formatAffectedFlows(flows) {
    const lines = [`- State: ${flows.state}`];
    if (flows.items.length === 0)
        return lines;
    for (const item of flows.items) {
        const flow = item;
        lines.push(`- ${stringField(flow, 'name') || stringField(flow, 'flowId') || 'unknown flow'}`);
    }
    return lines;
}
function formatItems(items) {
    if (items.length === 0)
        return ['- None.'];
    return items.map((item) => `- ${JSON.stringify(item)}`);
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
function parseBoolean(raw) {
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
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
