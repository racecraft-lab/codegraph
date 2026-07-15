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
}

interface ChatRequestBody {
  repo?: string;
  message?: string;
  selectedNodeId?: string;
  view?: string;
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
    ctx.req!.on('data', (chunk: unknown) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.byteLength;
      if (total > MAX_CHAT_BODY_BYTES) {
        resolve(apiError('invalid_request', { message: 'Request body is too large.' }));
        return;
      }
      chunks.push(buf);
    });
    ctx.req!.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    ctx.req!.on('error', () => resolve(apiError('invalid_request', { message: 'Request body could not be read.' })));
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

async function graphContext(deps: ChatApiDeps, repo: RepoInfo, body: ChatRequestBody): Promise<string[]> {
  const context = [`Repository: ${repo.name} (${repo.id})`, `View: ${body.view ?? 'repository'}`];
  if (!body.selectedNodeId) return context;
  try {
    const client = await deps.getClient(repo);
    const node = await readNode(client, body.selectedNodeId);
    if (node) {
      context.push(
        `Selected symbol: ${node.name}`,
        `Kind: ${node.kind}`,
        node.file ? `File: ${node.file}${node.line ? `:${node.line}` : ''}` : 'File: unknown',
        node.signature ? `Signature: ${node.signature}` : 'Signature: unavailable',
      );
    }
  } catch {
    context.push('Selected symbol context could not be loaded from the local graph daemon.');
  }
  return context;
}

function taskFor(repo: RepoInfo, body: ChatRequestBody, context: string[]): ProseTask {
  return {
    instructions:
      `Answer this CodeGraph browser question about ${repo.name} using only the supplied graph context. ` +
      `Be explicit when the context is insufficient.\n\nQuestion: ${body.message ?? ''}`,
    graphContext: context,
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
        },
      };
    }

    const context = await graphContext(deps, repo, request);
    const result = await generate(repo.root, taskFor(repo, request, context));
    if (result.source === 'endpoint') {
      return { status: 200, body: { state: 'answer', answer: result.text } };
    }
    if (result.source === 'pending-bundle') {
      return {
        status: 200,
        body: {
          state: 'pending_bundle',
          answer: result.text,
          bundleHandle: result.handle,
          message: 'Agent bundle emitted and pending completion.',
        },
      };
    }
    return { status: 200, body: { state: 'fallback', answer: result.text } };
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
