import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { DEFAULT_LSP_TIMEOUT_MS, LspReasonCode } from './types';

type JsonRpcId = number;
type JsonRpcParams = unknown[] | object | null;
type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingRequest {
  method: string;
  timeout: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface LspClientExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LspInitializeParams {
  processId: number | null;
  rootUri: string | null;
  rootPath: string | null;
  capabilities: Record<string, unknown>;
  initializationOptions?: unknown;
}

export interface LspJsonRpcClientOptions {
  command: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  rootUri?: string | null;
  rootPath?: string | null;
  initializationOptions?: unknown;
  stderrBufferLimit?: number;
}

export interface LspRequestOptions {
  timeoutMs?: number;
}

export class LspClientError extends Error {
  readonly reasonCode: LspReasonCode;

  constructor(message: string, reasonCode: LspReasonCode, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LspClientError';
    this.reasonCode = reasonCode;
  }
}

export class LspRequestTimeoutError extends LspClientError {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(
      `LSP request "${method}" timed out after ${timeoutMs}ms`,
      method === 'initialize' ? 'initialize-timeout' : 'request-timeout',
    );
    this.name = 'LspRequestTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class LspServerExitedError extends LspClientError {
  readonly exit: LspClientExit;

  constructor(exit: LspClientExit) {
    super(`LSP server exited before completing pending requests`, 'server-crash');
    this.name = 'LspServerExitedError';
    this.exit = exit;
  }
}

export class LspProtocolError extends LspClientError {
  constructor(message: string) {
    super(message, 'malformed-protocol-response');
    this.name = 'LspProtocolError';
  }
}

export class LspJsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: JsonRpcErrorResponse['error']) {
    super(error.message);
    this.name = 'LspJsonRpcError';
    this.code = error.code;
    this.data = error.data;
  }
}

export class LspJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly timeoutMs: number;
  private readonly rootUri: string | null;
  private readonly rootPath: string | null;
  private readonly initializationOptions: unknown;
  private readonly stderrBufferLimit: number;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = '';
  private nextId = 1;
  private closed = false;
  private exited: LspClientExit | null = null;
  private readonly exitPromise: Promise<LspClientExit>;
  private resolveExit!: (exit: LspClientExit) => void;

  constructor(options: LspJsonRpcClientOptions) {
    if (options.command.length === 0) {
      throw new Error('LSP client command must include an executable');
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LSP_TIMEOUT_MS;
    this.rootUri = options.rootUri ?? null;
    this.rootPath = options.rootPath ?? null;
    this.initializationOptions = options.initializationOptions;
    this.stderrBufferLimit = options.stderrBufferLimit ?? 256 * 1024;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    const [executable, ...args] = options.command;
    this.child = spawn(executable!, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: 'pipe',
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => this.handleStderr(chunk));
    this.child.on('error', (error) => this.rejectPending(error));
    this.child.on('exit', (code, signal) => this.handleExit({ code, signal }));
  }

  async initialize(params: Partial<LspInitializeParams> = {}): Promise<unknown> {
    const initializeParams: LspInitializeParams = {
      processId: process.pid,
      rootUri: this.rootUri,
      rootPath: this.rootPath,
      capabilities: {},
      ...params,
    };
    if (initializeParams.initializationOptions === undefined && this.initializationOptions !== undefined) {
      initializeParams.initializationOptions = this.initializationOptions;
    }
    const result = await this.request('initialize', initializeParams);
    this.notify('initialized', {});
    return result;
  }

  request(method: string, params: JsonRpcParams = null, options: LspRequestOptions = {}): Promise<unknown> {
    if (this.closed || this.exited) {
      return Promise.reject(new LspClientError('LSP client is not running', 'server-crash'));
    }

    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new LspRequestTimeoutError(method, timeoutMs));
      }, timeoutMs);
      timeout.unref?.();
      this.pending.set(id, { method, timeout, resolve, reject });

      try {
        this.writeMessage({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  notify(method: string, params: JsonRpcParams = null): void {
    if (this.closed || this.exited) return;
    this.writeMessage({ jsonrpc: '2.0', method, params });
  }

  async shutdown(): Promise<unknown> {
    let result: unknown;
    try {
      result = await this.request('shutdown');
      this.notify('exit');
      this.child.stdin.end();
      await this.waitForExitWithTimeout(this.timeoutMs);
    } catch (error) {
      this.kill();
      throw new LspClientError('LSP shutdown failed', 'shutdown-failure', { cause: error });
    }
    this.closed = true;
    return result;
  }

  waitForExit(): Promise<LspClientExit> {
    return this.exitPromise;
  }

  getStderr(): string {
    return this.stderrBuffer;
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.rejectPending(new LspClientError('LSP client disposed', 'server-crash'));
    if (!this.exited) {
      this.kill();
      await this.waitForExitWithTimeout(250).catch(() => undefined);
    }
  }

  private writeMessage(message: Record<string, unknown>): void {
    const body = JSON.stringify(message);
    const encoded = Buffer.byteLength(body, 'utf8');
    this.child.stdin.write(`Content-Length: ${encoded}\r\n\r\n${body}`);
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    this.drainStdout();
  }

  private drainStdout(): void {
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.stdoutBuffer.subarray(0, headerEnd).toString('ascii');
      const contentLength = parseContentLength(header);
      if (contentLength === null) {
        this.failProtocol('Malformed LSP response: missing Content-Length header');
        return;
      }

      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.stdoutBuffer.length < bodyEnd) return;

      const body = this.stdoutBuffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        this.failProtocol('Malformed LSP response: response body is not valid JSON');
        return;
      }
      if (!isJsonRpcObject(parsed)) {
        this.failProtocol('Malformed LSP response: expected a JSON-RPC object');
        return;
      }
      this.handleJsonRpcMessage(parsed);
    }
  }

  private handleJsonRpcMessage(message: Record<string, unknown>): void {
    if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
      this.handleResponse(message as unknown as JsonRpcResponse);
      return;
    }
    if (typeof message.id === 'number' && typeof message.method === 'string') {
      this.writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if ('error' in message) {
      pending.reject(new LspJsonRpcError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  private handleStderr(chunk: Buffer): void {
    this.stderrBuffer += chunk.toString('utf8');
    if (this.stderrBuffer.length > this.stderrBufferLimit) {
      this.stderrBuffer = this.stderrBuffer.slice(this.stderrBuffer.length - this.stderrBufferLimit);
    }
  }

  private handleExit(exit: LspClientExit): void {
    if (this.exited) return;
    this.exited = exit;
    this.resolveExit(exit);
    if (this.pending.size > 0) {
      this.rejectPending(new LspServerExitedError(exit));
    }
  }

  private failProtocol(message: string): void {
    const error = new LspProtocolError(message);
    this.rejectPending(error);
    this.kill();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private kill(): void {
    if (!this.exited && !this.child.killed) {
      this.child.kill();
    }
  }

  private async waitForExitWithTimeout(timeoutMs: number): Promise<LspClientExit> {
    if (this.exited) return this.exited;
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.exitPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`LSP server did not exit within ${timeoutMs}ms`)), timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function parseContentLength(header: string): number | null {
  const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
  if (!match) return null;
  return Number(match[1]);
}

function isJsonRpcObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
