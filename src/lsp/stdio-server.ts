import type { Readable, Writable } from 'node:stream';
import * as fs from 'node:fs';
import { findNearestCodeGraphRoot } from '../directory';
import { attachDaemonClient } from '../server/daemon-client';
import { LspFacade, createDaemonLspReader, type LspRepositoryReader } from './facade';
import {
  LSP_ERROR_CODE,
  formatLspDiagnostic,
  makeJsonRpcError,
  parseJsonRpcEnvelope,
} from './protocol';

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_HEADER_LINES = 32;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_QUEUED_FRAMES = 16;
const MAX_QUEUED_BODY_BYTES = 4 * MAX_BODY_BYTES;
const MAX_INPUT_CHUNK_BYTES = MAX_QUEUED_BODY_BYTES
  + MAX_QUEUED_FRAMES * (MAX_HEADER_BYTES + 4);
const DEFAULT_OUTPUT_DRAIN_TIMEOUT_MS = 5_000;

export class LspFramingError extends Error {}

interface ContentLengthParserLimits {
  maxMessages: number;
  maxBodyBytes: number;
}

export class ContentLengthParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer, limits?: ContentLengthParserLimits): Buffer[] {
    if (chunk.length > 0) this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: Buffer[] = [];
    let messageBytes = 0;
    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        if (this.buffer.length > MAX_HEADER_BYTES) throw new LspFramingError('header limit');
        break;
      }
      if (headerEnd > MAX_HEADER_BYTES) throw new LspFramingError('header limit');
      const headerText = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lines = headerText.split('\r\n');
      if (lines.length > MAX_HEADER_LINES) throw new LspFramingError('header line limit');
      const lengths: number[] = [];
      for (const line of lines) {
        const separator = line.indexOf(':');
        if (separator <= 0) throw new LspFramingError('malformed header');
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (name === 'content-length') {
          if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new LspFramingError('invalid content length');
          lengths.push(Number(value));
        }
      }
      if (lengths.length !== 1 || !Number.isSafeInteger(lengths[0])) {
        throw new LspFramingError('missing or duplicate content length');
      }
      const contentLength = lengths[0]!;
      if (contentLength > MAX_BODY_BYTES) throw new LspFramingError('body limit');
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) break;
      if (limits && (messages.length >= limits.maxMessages
        || contentLength > limits.maxBodyBytes - messageBytes)) {
        throw new LspFramingError('message queue limit');
      }
      messages.push(this.buffer.subarray(bodyStart, bodyEnd));
      messageBytes += contentLength;
      this.buffer = this.buffer.subarray(bodyEnd);
    }
    return messages;
  }

  finish(): void {
    if (this.buffer.length > 0) throw new LspFramingError('premature eof');
  }
}

export interface ServeLspStdioOptions {
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
  close?: () => void;
  installSignalHandlers?: boolean;
  /** Test seam; production uses the fixed five-second output drain budget. */
  outputDrainTimeoutMs?: number;
}

export async function serveLspStdio(
  reader: LspRepositoryReader,
  options: ServeLspStdioOptions = {},
): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostics = options.diagnostics ?? process.stderr;
  const parser = new ContentLengthParser();
  const facade = new LspFacade(reader);
  const configuredDrainTimeout = options.outputDrainTimeoutMs;
  const outputDrainTimeoutMs = typeof configuredDrainTimeout === 'number'
    && Number.isFinite(configuredDrainTimeout)
    && configuredDrainTimeout > 0
    ? configuredDrainTimeout
    : DEFAULT_OUTPUT_DRAIN_TIMEOUT_MS;
  let chain = Promise.resolve();
  let settled = false;
  let queuedFrames = 0;
  let queuedBodyBytes = 0;
  let inputPauseScheduled = false;
  let cancelOutputDrain: (() => void) | null = null;
  let resolveExit!: (code: number) => void;
  const exit = new Promise<number>((resolve) => { resolveExit = resolve; });

  const write = async (value: unknown): Promise<void> => {
    if (settled) return;
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    const frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
    let accepted: boolean;
    try {
      accepted = output.write(frame);
    } catch {
      log('stream_failure');
      finish(1);
      return;
    }
    if (accepted || settled) return;
    input.pause();
    try {
      await new Promise<void>((resolve, reject) => {
        let completed = false;
        const complete = (error?: Error): void => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          output.removeListener('drain', onDrain);
          output.removeListener('error', onDrainError);
          if (cancelOutputDrain === cancel) cancelOutputDrain = null;
          if (error) reject(error);
          else resolve();
        };
        const cancel = (): void => complete();
        const onDrain = (): void => complete();
        const onDrainError = (): void => complete(new Error('output stream failure'));
        const timer = setTimeout(
          () => complete(new Error('output drain timeout')),
          outputDrainTimeoutMs,
        );
        cancelOutputDrain = cancel;
        output.once('drain', onDrain);
        output.once('error', onDrainError);
      });
    } catch {
      log('stream_failure');
      finish(1);
      return;
    }
    maybeResumeInput();
  };
  const log = (code: Parameters<typeof formatLspDiagnostic>[0]): void => {
    try { diagnostics.write(`${formatLspDiagnostic(code)}\n`); } catch { /* best-effort */ }
  };
  const finish = (code: number): void => {
    if (settled) return;
    settled = true;
    cancelOutputDrain?.();
    try { input.pause(); } catch { /* best-effort */ }
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('error', onError);
    output.removeListener('error', onOutputError);
    if (options.installSignalHandlers !== false) {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
    try { options.close?.(); } catch { /* best-effort */ }
    resolveExit(code);
  };
  const handleBody = async (body: Buffer): Promise<void> => {
    if (settled) return;
    let value: unknown;
    try {
      value = JSON.parse(body.toString('utf8'));
    } catch {
      await write(makeJsonRpcError(null, LSP_ERROR_CODE.ParseError));
      return;
    }
    const envelope = parseJsonRpcEnvelope(value);
    if (!envelope.ok) {
      await write({ jsonrpc: '2.0', id: envelope.id, error: envelope.error });
      return;
    }
    if (settled) return;
    const response = await facade.handle(envelope.message);
    if (settled) return;
    if (response) await write(response);
    if (facade.requestedExitCode !== null) finish(facade.requestedExitCode);
  };
  function onData(value: Buffer | string): void {
    if (settled) return;
    try {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (chunk.length > MAX_INPUT_CHUNK_BYTES) throw new LspFramingError('input chunk limit');
      for (const body of parser.push(chunk, {
        maxMessages: MAX_QUEUED_FRAMES,
        maxBodyBytes: MAX_QUEUED_BODY_BYTES,
      })) {
        if (queuedFrames >= MAX_QUEUED_FRAMES
          || body.length > MAX_QUEUED_BODY_BYTES - queuedBodyBytes) {
          finish(1);
          break;
        }
        queuedFrames += 1;
        queuedBodyBytes += body.length;
        chain = chain
          .then(() => handleBody(body))
          .catch(() => {
            log('internal_failure');
            finish(1);
          })
          .finally(() => {
            queuedFrames = Math.max(0, queuedFrames - 1);
            queuedBodyBytes = Math.max(0, queuedBodyBytes - body.length);
            maybeResumeInput();
          });
      }
      scheduleInputPause();
    } catch {
      log('invalid_frame');
      finish(1);
    }
  }
  function onEnd(): void {
    if (settled) return;
    try {
      parser.finish();
    } catch {
      log('invalid_frame');
      finish(1);
      return;
    }
    void chain.finally(() => finish(facade.requestedExitCode ?? 1));
  }
  function onError(): void {
    log('stream_failure');
    finish(1);
  }
  function onOutputError(): void {
    log('stream_failure');
    finish(1);
  }
  function onSignal(): void {
    finish(facade.requestedExitCode ?? 1);
  }
  function maybeResumeInput(): void {
    if (!settled && queuedFrames === 0 && cancelOutputDrain === null) input.resume();
  }
  function scheduleInputPause(): void {
    if (settled || queuedFrames === 0 || inputPauseScheduled) return;
    inputPauseScheduled = true;
    setImmediate(() => {
      inputPauseScheduled = false;
      if (!settled && queuedFrames > 0) input.pause();
    });
  }

  input.on('data', onData);
  input.once('end', onEnd);
  input.once('error', onError);
  output.once('error', onOutputError);
  if (options.installSignalHandlers !== false) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  input.resume();
  return exit;
}

export async function runLspStdioServer(projectPath = process.cwd()): Promise<number> {
  let root = findNearestCodeGraphRoot(projectPath);
  if (!root) throw new Error('No indexed CodeGraph repository found');
  try { root = fs.realpathSync(root); } catch { /* resolved fallback is sufficient */ }
  const client = await attachDaemonClient(root);
  return serveLspStdio(createDaemonLspReader(root, client), { close: () => client.close() });
}
