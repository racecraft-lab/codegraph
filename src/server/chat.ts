/**
 * SPEC-006 browser chat adapter over the SPEC-018 LLM seam.
 *
 * This module deliberately stays thin: the browser sends same-origin requests,
 * provider config and secrets stay backend-only, and graph context is assembled
 * from existing server-side graph/read contracts before calling `generate()`.
 */

import { loadLlmConfig } from '../llm/config';
import { generate, type ProseTask } from '../llm/generate';
import { redeemHandle } from '../llm/agent-bundle';
import { readNode, type DaemonReadClient } from './daemon-client';
import { apiError, notFound, type ApiError } from './errors';
import type { HandlerResult, RepoInfo, Route, RouteContext } from './routes';

export interface ChatApiDeps {
  defaultRepo: RepoInfo;
  resolveRepo(repoId: string | undefined): RepoInfo | null;
  getClient(repo: RepoInfo): Promise<DaemonReadClient>;
  evictClient(repo: RepoInfo, client: DaemonReadClient): void;
}

interface ChatRequestBody {
  repo?: string;
  message?: string;
  selectedNodeId?: string;
  view?: string;
}

interface ChatContextMetadata {
  repo: { id: string; name: string };
  view: string;
  selectedNodeId?: string;
  symbols: Array<{ id: string; name: string; kind: string; file?: string; line?: number }>;
  files: string[];
  truncated: boolean;
  insufficiencyReason?: string;
}

interface ChatGraphContext {
  lines: string[];
  metadata: ChatContextMetadata;
}

type ChatBodyResult = { ok: true; body: ChatRequestBody } | { ok: false; error: ApiError };

const MAX_CHAT_BODY_BYTES = 64 * 1024;

function chatStatusBody(repo: RepoInfo) {
  const config = loadLlmConfig(process.env);
  if (config === null) {
    return {
      state: 'dormant',
      message: 'No LLM provider is configured. Chat is disabled without making provider calls.',
      providerConfigured: false,
      repo: repo.id,
    };
  }
  if ('misconfigured' in config) {
    return {
      state: 'misconfigured',
      message: `LLM configuration is incomplete or invalid: ${config.missingVariable}.`,
      providerConfigured: false,
      repo: repo.id,
    };
  }
  if (config.mode === 'agent') {
    return {
      state: 'enabled',
      message: 'Agent bundle mode is configured. Answers may return pending bundle handles.',
      providerConfigured: true,
      repo: repo.id,
    };
  }
  return {
    state: 'enabled',
    message: 'Endpoint mode is configured. Browser requests remain same-origin.',
    providerConfigured: true,
    repo: repo.id,
  };
}

async function readJsonBody(ctx: RouteContext): Promise<ChatBodyResult> {
  if (!ctx.req) return { ok: false, error: apiError('invalid_request', { message: 'Missing request body.' }) };
  const raw = await new Promise<string | ApiError>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversized = false;
    let settled = false;
    const settle = (value: string | ApiError) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    ctx.req!.on('data', (chunk: unknown) => {
      if (oversized) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.byteLength;
      if (total > MAX_CHAT_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
        settle(apiError('invalid_request', { message: 'Request body is too large.' }));
        return;
      }
      chunks.push(buf);
    });
    ctx.req!.on('end', () => {
      if (!oversized) settle(Buffer.concat(chunks).toString('utf8'));
    });
    ctx.req!.on('error', () => {
      chunks.length = 0;
      settle(apiError('invalid_request', { message: 'Request body could not be read.' }));
    });
  });
  if (typeof raw !== 'string') return { ok: false, error: raw };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: apiError('invalid_request', { message: 'Request body must be a JSON object.' }) };
    }
    return { ok: true, body: parsed as ChatRequestBody };
  } catch {
    return { ok: false, error: apiError('invalid_request', { message: 'Request body must be valid JSON.' }) };
  }
}

function resolveChatRepo(deps: ChatApiDeps, repoId: string | undefined): RepoInfo | ApiError {
  const repo = deps.resolveRepo(repoId);
  return repo ?? notFound('repo');
}

function fallbackFor(body: ChatRequestBody): string {
  const subject = body.selectedNodeId ? `selected symbol ${body.selectedNodeId}` : 'the selected repository';
  return `CodeGraph chat is unavailable. Use search, graph, and impact views for ${subject} while provider-backed prose is unavailable.`;
}

function baseContext(repo: RepoInfo, body: ChatRequestBody): ChatGraphContext {
  const view = body.view ?? 'repository';
  const insufficiencyReason = body.selectedNodeId ? undefined : 'No selected symbol was provided.';
  const metadata: ChatContextMetadata = {
    repo: { id: repo.id, name: repo.name },
    view,
    selectedNodeId: body.selectedNodeId,
    symbols: [],
    files: [],
    truncated: false,
    insufficiencyReason,
  };
  return {
    lines: [
      `Repository: ${repo.name} (${repo.id})`,
      `View: ${view}`,
      ...(insufficiencyReason ? [`Context limitation: ${insufficiencyReason}`] : []),
    ],
    metadata,
  };
}

async function graphContext(deps: ChatApiDeps, repo: RepoInfo, body: ChatRequestBody): Promise<ChatGraphContext> {
  const context = baseContext(repo, body);
  if (!body.selectedNodeId) return context;
  let client: DaemonReadClient | undefined;
  try {
    client = await deps.getClient(repo);
    const node = await readNode(client, body.selectedNodeId);
    if (node) {
      context.metadata.symbols.push({
        id: node.id,
        name: node.name,
        kind: node.kind,
        ...(node.file ? { file: node.file } : {}),
        ...(node.line ? { line: node.line } : {}),
      });
      if (node.file) context.metadata.files.push(node.file);
      context.metadata.insufficiencyReason = undefined;
      context.lines.push(
        `Selected symbol: ${node.name}`,
        `Kind: ${node.kind}`,
        node.file ? `File: ${node.file}${node.line ? `:${node.line}` : ''}` : 'File: unknown',
        node.signature ? `Signature: ${node.signature}` : 'Signature: unavailable',
      );
    } else {
      context.metadata.insufficiencyReason = 'Selected symbol was not found in the local graph.';
      context.lines.push(`Context limitation: ${context.metadata.insufficiencyReason}`);
    }
  } catch {
    if (client) deps.evictClient(repo, client);
    context.metadata.insufficiencyReason = 'Selected symbol context could not be loaded from the local graph daemon.';
    context.lines.push(context.metadata.insufficiencyReason);
  }
  return context;
}

function taskFor(repo: RepoInfo, body: ChatRequestBody, context: ChatGraphContext): ProseTask {
  return {
    instructions:
      `Answer this CodeGraph browser question about ${repo.name} using only the supplied graph context. ` +
      `Be explicit when the context is insufficient.\n\nQuestion: ${body.message ?? ''}`,
    graphContext: context.lines,
    outputContract: { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] },
    fallback: fallbackFor(body),
  };
}

function statusHandler(deps: ChatApiDeps) {
  return (ctx: RouteContext): HandlerResult => {
    const repo = resolveChatRepo(deps, ctx.query.get('repo') ?? undefined);
    if ('status' in repo) return repo;
    return { status: 200, body: chatStatusBody(repo) };
  };
}

function messagesHandler(deps: ChatApiDeps) {
  return async (ctx: RouteContext): Promise<HandlerResult> => {
    const body = await readJsonBody(ctx);
    if (!body.ok) return body.error;
    const request = body.body;
    if (!request.message || typeof request.message !== 'string' || !request.message.trim()) {
      return apiError('invalid_request', { message: 'Missing required body field: message' });
    }
    if (request.repo !== undefined && typeof request.repo !== 'string') {
      return apiError('invalid_request', { message: 'Body field repo must be a string.', details: { param: 'repo' } });
    }
    if (request.selectedNodeId !== undefined && typeof request.selectedNodeId !== 'string') {
      return apiError('invalid_request', { message: 'Body field selectedNodeId must be a string.', details: { param: 'selectedNodeId' } });
    }
    if (request.view !== undefined && typeof request.view !== 'string') {
      return apiError('invalid_request', { message: 'Body field view must be a string.', details: { param: 'view' } });
    }

    const repo = resolveChatRepo(deps, request.repo);
    if ('status' in repo) return repo;

    const config = loadLlmConfig(process.env);
    if (config === null) {
      return {
        status: 200,
        body: {
          state: 'dormant',
          answer: fallbackFor(request),
          message: 'LLM provider is not configured.',
          context: baseContext(repo, request).metadata,
        },
      };
    }
    if ('misconfigured' in config) {
      return {
        status: 200,
        body: {
          state: 'misconfigured',
          answer: fallbackFor(request),
          message: `LLM configuration is incomplete or invalid: ${config.missingVariable}.`,
          context: baseContext(repo, request).metadata,
        },
      };
    }

    const context = await graphContext(deps, repo, request);
    const result = await generate(repo.root, taskFor(repo, request, context));
    if (result.source === 'endpoint') {
      return { status: 200, body: { state: 'answer', answer: result.text, context: context.metadata } };
    }
    if (result.source === 'pending-bundle') {
      return {
        status: 200,
        body: {
          state: 'pending_bundle',
          answer: result.text,
          bundleHandle: result.handle,
          message: 'Agent bundle emitted and pending completion.',
          context: context.metadata,
        },
      };
    }
    return { status: 200, body: { state: 'fallback', answer: result.text, context: context.metadata } };
  };
}

function bundleHandler(deps: ChatApiDeps) {
  return (ctx: RouteContext): HandlerResult => {
    const repo = resolveChatRepo(deps, ctx.query.get('repo') ?? undefined);
    if ('status' in repo) return repo;
    const handle = ctx.params.handle ?? '';
    const result = redeemHandle(repo.root, handle);
    if (result.status === 'completed') {
      return { status: 200, body: { state: 'answer', answer: result.text } };
    }
    if (result.status === 'pending') {
      return { status: 200, body: { state: 'pending_bundle', bundleHandle: handle, message: 'Agent bundle is still pending.' } };
    }
    return notFound('route');
  };
}

export function buildChatRoutes(deps: ChatApiDeps): Route[] {
  return [
    { method: 'GET', pattern: '/api/chat/status', handler: statusHandler(deps) },
    { method: 'POST', pattern: '/api/chat/messages', handler: messagesHandler(deps) },
    { method: 'GET', pattern: '/api/chat/bundles/:handle', handler: bundleHandler(deps) },
  ];
}
