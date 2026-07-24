import type { Readable, Writable } from 'node:stream';
import * as fs from 'node:fs';
import { TextDecoder } from 'node:util';
import { findNearestCodeGraphRoot } from '../directory';
import { attachDaemonClient, DaemonUnavailableError } from '../server/daemon-client';
import {
  LspDaemonUnavailableError,
  LspFacade,
  createDaemonLspReader,
  type LspRepositoryReader,
} from './facade';
import {
  LSP_ERROR_CODE,
  LSP_LIFECYCLE_STATE,
  LSP_METHOD,
  formatLspDiagnostic,
  makeJsonRpcError,
  parseJsonRpcEnvelope,
  type JsonRpcId,
  type JsonRpcMessage,
  type LspErrorCode,
  type LspLifecycleState,
} from './protocol';

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_HEADER_LINES = 32;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_QUEUED_FRAMES = 16;
const MAX_QUEUED_BODY_BYTES = 4 * MAX_BODY_BYTES;
const MAX_LIFECYCLE_BODY_BYTES = 2 * MAX_BODY_BYTES;
// A valid 1 MiB UTF-8 source can expand to six ASCII bytes per byte when JSON
// escapes control characters. Keep bounded headroom for that worst case plus
// the JSON-RPC envelope and Content-Length header.
const MAX_OUTPUT_FRAME_BYTES = 8 * MAX_BODY_BYTES;
const MAX_DEFERRED_OUTPUT_FRAMES = 32;
const MAX_DEFERRED_OUTPUT_BYTES = MAX_OUTPUT_FRAME_BYTES;
const DEFAULT_OUTPUT_DRAIN_TIMEOUT_MS = 5_000;
const DEFAULT_INPUT_DRAIN_TIMEOUT_MS = 5_000;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export class LspFramingError extends Error {}
export class LspProjectNotIndexedError extends Error {}

export function lspStartupFailureMessage(error: unknown): string {
  if (error instanceof LspProjectNotIndexedError) {
    return 'Unable to start the LSP facade: select an indexed CodeGraph repository.';
  }
  if (error instanceof DaemonUnavailableError) {
    return 'Unable to start the LSP facade: the CodeGraph daemon is unavailable; retry or restart the daemon.';
  }
  return 'Unable to start the LSP facade: internal startup failure.';
}

export class ContentLengthParser {
  private readonly header = Buffer.allocUnsafe(MAX_HEADER_BYTES + 4);
  private headerLength = 0;
  private body: Buffer | null = null;
  private bodyLength = 0;

  push(chunk: Buffer): Buffer[] {
    return this.pushBounded(chunk, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY).messages;
  }

  pushBounded(
    chunk: Buffer,
    maxMessages: number,
    maxBodyBytes: number,
  ): { messages: Buffer[]; consumedBytes: number } {
    const messages: Buffer[] = [];
    let messageBytes = 0;
    let offset = 0;
    while (offset < chunk.length || (this.body !== null && this.body.length === 0)) {
      if (this.body !== null) {
        if (messages.length >= maxMessages || messageBytes + this.body.length > maxBodyBytes) break;
        const copied = Math.min(this.body.length - this.bodyLength, chunk.length - offset);
        chunk.copy(this.body, this.bodyLength, offset, offset + copied);
        this.bodyLength += copied;
        offset += copied;
        if (this.bodyLength === this.body.length) {
          messages.push(this.body);
          messageBytes += this.body.length;
          this.body = null;
          this.bodyLength = 0;
        }
        continue;
      }

      if (messages.length >= maxMessages) break;

      if (this.headerLength >= this.header.length) throw new LspFramingError('header limit');
      this.header[this.headerLength++] = chunk[offset++]!;
      const headerComplete = this.headerLength >= 4
        && this.header[this.headerLength - 4] === 0x0d
        && this.header[this.headerLength - 3] === 0x0a
        && this.header[this.headerLength - 2] === 0x0d
        && this.header[this.headerLength - 1] === 0x0a;
      if (!headerComplete) {
        if (this.headerLength === this.header.length) throw new LspFramingError('header limit');
        continue;
      }

      const headerEnd = this.headerLength - 4;
      if (headerEnd > MAX_HEADER_BYTES) throw new LspFramingError('header limit');
      const contentLength = this.parseHeader(this.header.subarray(0, headerEnd));
      this.headerLength = 0;
      this.body = contentLength === 0 ? Buffer.alloc(0) : Buffer.allocUnsafe(contentLength);
      this.bodyLength = 0;
    }
    return { messages, consumedBytes: offset };
  }

  finish(): void {
    if (this.headerLength > 0 || this.body !== null) throw new LspFramingError('premature eof');
  }

  private parseHeader(headerBytes: Buffer): number {
    if (headerBytes.some((byte) => byte > 0x7f)) throw new LspFramingError('non-ascii header');
    const lines = headerBytes.toString('ascii').split('\r\n');
    if (lines.length > MAX_HEADER_LINES) throw new LspFramingError('header line limit');
    const lengths: number[] = [];
    for (const line of lines) {
      const separator = line.indexOf(':');
      if (separator <= 0) throw new LspFramingError('malformed header');
      const rawName = line.slice(0, separator);
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(rawName)) {
        throw new LspFramingError('invalid header name');
      }
      const rawValue = line.slice(separator + 1);
      if ([...rawValue].some((character) => {
        const code = character.charCodeAt(0);
        return code !== 0x09 && (code < 0x20 || code > 0x7e);
      })) {
        throw new LspFramingError('invalid header value');
      }
      const name = rawName.toLowerCase();
      const value = rawValue.trim();
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
    return contentLength;
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
  /** Test seam; production uses the fixed five-second EOF request-drain budget. */
  inputDrainTimeoutMs?: number;
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
  let chain = Promise.resolve();
  let lifecycleChain = Promise.resolve();
  let settled = false;
  let exitResolved = false;
  let finalExitCode: number | null = null;
  let inputEnded = false;
  let exitAdmitted = false;
  let fatalFramingFailure = false;
  let queuedFrames = 0;
  let queuedBodyBytes = 0;
  let queuedLifecycleBodyBytes = 0;
  let reservedShutdown = false;
  let reservedExit = false;
  let acceptingNormalFrames = true;
  let normalAdmissionClosedBy: 'shutdown' | 'exit' | null = null;
  let admissionLifecycleState: LspLifecycleState = LSP_LIFECYCLE_STATE.Created;
  let pendingOutputWrites = 0;
  let pendingDiagnosticWrites = 0;
  let outputListenersRemoved = false;
  let diagnosticsListenerRemoved = false;
  let diagnosticsRemovalScheduled = false;
  let outputBackpressured = false;
  let outputDrainTimer: ReturnType<typeof setTimeout> | null = null;
  let inputDrainTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseOutputReady: (() => void) | null = null;
  let outputReady: Promise<void> = Promise.resolve();
  const deferredOutputFrames: Buffer[] = [];
  let deferredOutputBytes = 0;
  const requestControllers = new Map<string, Set<AbortController>>();
  const lifecycleControllers = new Set<AbortController>();
  const configuredOutputDrainTimeout = options.outputDrainTimeoutMs;
  const outputDrainTimeoutMs = typeof configuredOutputDrainTimeout === 'number'
    && Number.isFinite(configuredOutputDrainTimeout)
    && configuredOutputDrainTimeout > 0
    ? configuredOutputDrainTimeout
    : DEFAULT_OUTPUT_DRAIN_TIMEOUT_MS;
  const configuredInputDrainTimeout = options.inputDrainTimeoutMs;
  const inputDrainTimeoutMs = typeof configuredInputDrainTimeout === 'number'
    && Number.isFinite(configuredInputDrainTimeout)
    && configuredInputDrainTimeout > 0
    ? configuredInputDrainTimeout
    : DEFAULT_INPUT_DRAIN_TIMEOUT_MS;
  let resolveExit!: (code: number) => void;
  const exit = new Promise<number>((resolve) => { resolveExit = resolve; });

  const write = (value: unknown): void => {
    if (settled) return;
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    const framed = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
    if (framed.length > MAX_OUTPUT_FRAME_BYTES) {
      log('stream_failure');
      finish(1);
      return;
    }
    if (outputBackpressured || deferredOutputFrames.length > 0) deferOutputFrame(framed);
    else writeOutputFrame(framed);
  };
  const log = (code: Parameters<typeof formatLspDiagnostic>[0]): void => {
    pendingDiagnosticWrites += 1;
    try {
      diagnostics.write(`${formatLspDiagnostic(code)}\n`, () => {
        pendingDiagnosticWrites = Math.max(0, pendingDiagnosticWrites - 1);
        maybeRemoveDiagnosticsListener();
      });
    } catch {
      pendingDiagnosticWrites = Math.max(0, pendingDiagnosticWrites - 1);
      maybeRemoveDiagnosticsListener();
    }
  };
  const finish = (code: number): void => {
    const requestedCode = fatalFramingFailure ? 1 : code;
    if (finalExitCode === null || requestedCode !== 0) finalExitCode = requestedCode;
    if (settled) {
      finalizeExitIfReady();
      return;
    }
    settled = true;
    for (const controllers of requestControllers.values()) {
      for (const controller of controllers) controller.abort();
    }
    requestControllers.clear();
    input.pause();
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('close', onInputClose);
    input.removeListener('error', onError);
    clearInputDrainDeadline();
    if (!outputBackpressured && deferredOutputFrames.length > 0) flushDeferredOutput();
    if (pendingOutputWrites > 0 || outputBackpressured || deferredOutputFrames.length > 0) {
      armOutputDrainDeadline();
    } else {
      releaseOutputGate();
      removeOutputListeners();
    }
    maybeRemoveDiagnosticsListener();
    if (options.installSignalHandlers !== false) {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
    try { options.close?.(); } catch { /* best-effort */ }
    finalizeExitIfReady();
  };
  type AdmissionKind = 'normal' | 'shutdown' | 'exit';
  type PreparedFrame = {
    envelope?: ReturnType<typeof parseJsonRpcEnvelope>;
    controller?: AbortController;
    admittedLifecycleState?: LspLifecycleState;
    admission?: AdmissionKind;
    bodyLength?: number;
    admissionReleased?: boolean;
  };
  const pendingAdmissionFrames: PreparedFrame[] = [];
  const handleFrame = async (frame: PreparedFrame): Promise<void> => {
    if (settled) return;
    if (!frame.envelope) {
      write(makeJsonRpcError(null, LSP_ERROR_CODE.ParseError));
      return;
    }
    const envelope = frame.envelope;
    if (!envelope.ok) {
      write({ jsonrpc: '2.0', id: envelope.id, error: envelope.error });
      return;
    }
    const controller = frame.controller;
    if (controller?.signal.aborted && 'id' in envelope.message) {
      write(makeJsonRpcError(envelope.message.id, LSP_ERROR_CODE.RequestCancelled));
      return;
    }
    let response;
    try {
      const handling = facade.handle(
        envelope.message,
        controller?.signal,
        frame.admittedLifecycleState,
      );
      if (controller && isLifecycleRequest(envelope.message)) {
        lifecycleControllers.delete(controller);
        unregisterRequestController(controller);
      }
      response = await handling;
    } catch (error) {
      if (!controller?.signal.aborted) throw error;
    }
    if (envelope.message.method === LSP_METHOD.Shutdown
      && facade.lifecycleState === LSP_LIFECYCLE_STATE.Shutdown) {
      acceptingNormalFrames = false;
      if (normalAdmissionClosedBy === null) normalAdmissionClosedBy = 'shutdown';
    }
    if (settled) return;
    if (controller?.signal.aborted && 'id' in envelope.message) {
      write(makeJsonRpcError(envelope.message.id, LSP_ERROR_CODE.RequestCancelled));
    } else if (response) write(response);
    if (facade.requestedExitCode !== null) {
      try { parser.finish(); } catch {
        fatalFramingFailure = true;
        log('invalid_frame');
      }
      finish(facade.requestedExitCode);
    }
  };
  function onData(value: Buffer | string): void {
    if (settled || exitAdmitted) return;
    try {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      let offset = 0;
      while (!settled && !exitAdmitted && offset < chunk.length) {
        const parsed = parser.pushBounded(chunk.subarray(offset), 1, MAX_BODY_BYTES);
        offset += parsed.consumedBytes;
        const body = parsed.messages[0];
        if (!body) {
          if (parsed.consumedBytes === 0) break;
          continue;
        }
        const frame = prepareFrame(body);
        if (!frame) continue;
        const admission = admitFrame(frame, body.length);
        if (!admission) {
          const message = frame.envelope?.ok ? frame.envelope.message : null;
          if (message?.method === LSP_METHOD.Shutdown
            && 'id' in message
            && admissionLifecycleState === LSP_LIFECYCLE_STATE.Created) {
            rejectRequestFrame(frame, LSP_ERROR_CODE.ServerNotInitialized);
            continue;
          }
          const closedBy = acceptingNormalFrames
            ? (admissionLifecycleState === LSP_LIFECYCLE_STATE.Shutdown ? 'shutdown' : null)
            : normalAdmissionClosedBy;
          if (closedBy) rejectClosedFrame(frame, closedBy);
          else rejectOverloadedFrame(frame);
          continue;
        }
        enqueueFrame(frame, admission, body.length);
      }
    } catch {
      fatalFramingFailure = true;
      log('invalid_frame');
      finish(1);
    }
  }
  function onEnd(): void {
    if (settled || inputEnded || exitAdmitted) return;
    inputEnded = true;
    try { parser.finish(); } catch {
      fatalFramingFailure = true;
      log('invalid_frame');
      finish(1);
      return;
    }
    armInputDrainDeadline();
    const finishAfterDrain = () => {
      clearInputDrainDeadline();
      finish(facade.requestedExitCode ?? 1);
    };
    void Promise.all([chain, lifecycleChain]).then(finishAfterDrain, finishAfterDrain);
  }
  function onInputClose(): void {
    onEnd();
  }
  function prepareFrame(body: Buffer): PreparedFrame | null {
    let value: unknown;
    try { value = JSON.parse(UTF8_DECODER.decode(body)); }
    catch { return {}; }
    const envelope = parseJsonRpcEnvelope(value);
    if (!envelope.ok) return { envelope };
    const cancellationId = cancelRequestId(envelope.message);
    if (cancellationId !== undefined) {
      const controllers = requestControllers.get(requestKey(cancellationId));
      if (controllers) {
        let cancelledLifecycle = false;
        for (const controller of controllers) {
          const lifecycle = lifecycleControllers.has(controller);
          cancelledLifecycle ||= lifecycle;
          controller.abort();
        }
        // Cancellation changes projected lifecycle immediately, but the
        // bounded admission reservation remains until its callback finalizes.
        if (cancelledLifecycle) recomputeAdmissionLifecycle();
      }
      return null;
    }
    if (!('id' in envelope.message)) return { envelope };
    const controller = new AbortController();
    const key = requestKey(envelope.message.id);
    let controllers = requestControllers.get(key);
    if (!controllers) {
      controllers = new Set();
      requestControllers.set(key, controllers);
    }
    controllers.add(controller);
    return { envelope, controller };
  }
  function unregisterRequestController(controller: AbortController | undefined): void {
    if (!controller) return;
    for (const [key, controllers] of requestControllers) {
      if (!controllers.delete(controller)) continue;
      if (controllers.size === 0) requestControllers.delete(key);
      return;
    }
  }
  function admitFrame(frame: PreparedFrame, bodyLength: number): AdmissionKind | null {
    const message = frame.envelope?.ok ? frame.envelope.message : null;
    if (message?.method === LSP_METHOD.Shutdown && 'id' in message) {
      if (reservedShutdown || queuedLifecycleBodyBytes + bodyLength > MAX_LIFECYCLE_BODY_BYTES) return null;
      reservedShutdown = true;
      queuedLifecycleBodyBytes += bodyLength;
      recordAdmissionLifecycle(frame, message);
      return 'shutdown';
    }
    if (message?.method === LSP_METHOD.Exit && !('id' in message)) {
      if (reservedExit || queuedLifecycleBodyBytes + bodyLength > MAX_LIFECYCLE_BODY_BYTES) return null;
      reservedExit = true;
      queuedLifecycleBodyBytes += bodyLength;
      acceptingNormalFrames = false;
      normalAdmissionClosedBy = 'exit';
      exitAdmitted = true;
      recordAdmissionLifecycle(frame, message);
      return 'exit';
    }
    if (!acceptingNormalFrames) return null;
    if (queuedFrames < MAX_QUEUED_FRAMES && queuedBodyBytes + bodyLength <= MAX_QUEUED_BODY_BYTES) {
      queuedFrames += 1;
      queuedBodyBytes += bodyLength;
      if (message) recordAdmissionLifecycle(frame, message);
      return 'normal';
    }
    return null;
  }
  function recordAdmissionLifecycle(frame: PreparedFrame, message: JsonRpcMessage): void {
    pendingAdmissionFrames.push(frame);
    frame.admittedLifecycleState = admissionLifecycleState;
    admissionLifecycleState = facade.admissionLifecycleStateAfter(admissionLifecycleState, message);
  }
  function recomputeAdmissionLifecycle(startIndex = 0): void {
    let state = facade.lifecycleState;
    for (let index = startIndex; index < pendingAdmissionFrames.length; index += 1) {
      const frame = pendingAdmissionFrames[index]!;
      const message = frame.envelope?.ok ? frame.envelope.message : null;
      if (!message) continue;
      frame.admittedLifecycleState = state;
      if (frame.controller?.signal.aborted) continue;
      state = facade.admissionLifecycleStateAfter(state, message);
    }
    admissionLifecycleState = state;
  }
  function forgetAdmissionLifecycle(frame: PreparedFrame): void {
    const index = pendingAdmissionFrames.indexOf(frame);
    if (index === -1) return;
    const message = frame.envelope?.ok ? frame.envelope.message : null;
    pendingAdmissionFrames.splice(index, 1);
    if (message?.method === LSP_METHOD.Initialize
      || message?.method === LSP_METHOD.Shutdown
      || message?.method === LSP_METHOD.Exit) {
      recomputeAdmissionLifecycle(index);
    }
  }
  function enqueueFrame(frame: PreparedFrame, admission: AdmissionKind, bodyLength: number): void {
    frame.admission = admission;
    frame.bodyLength = bodyLength;
    const lifecycle = admission !== 'normal';
    const message = frame.envelope?.ok ? frame.envelope.message : null;
    const control = lifecycle
      || (message?.method === LSP_METHOD.Initialize && 'id' in message);
    if (control && frame.controller) lifecycleControllers.add(frame.controller);
    if (message?.method === LSP_METHOD.Exit && !('id' in message)) {
      for (const controllers of requestControllers.values()) {
        for (const controller of controllers) {
          const projectedClosed = pendingAdmissionFrames.some((frame) =>
            frame.controller === controller
            && frame.admittedLifecycleState === LSP_LIFECYCLE_STATE.Shutdown);
          if (!lifecycleControllers.has(controller) && !projectedClosed) controller.abort();
        }
      }
    }
    const run = async () => {
      if (!control) await outputReady;
      await handleFrame(frame);
    };
    const next = (control ? lifecycleChain : chain)
      .then(run)
      .catch((error) => {
        if (settled) return;
        log(error instanceof LspDaemonUnavailableError ? 'daemon_unavailable' : 'internal_failure');
        finish(1);
      })
      .finally(() => {
        if (frame.controller) lifecycleControllers.delete(frame.controller);
        unregisterRequestController(frame.controller);
        forgetAdmissionLifecycle(frame);
        releaseFrameAdmission(frame);
        maybeResumeInput();
      });
    if (control) lifecycleChain = next;
    else chain = next;
  }
  function releaseAdmission(admission: AdmissionKind, bodyLength: number): void {
    if (admission === 'normal') {
      queuedFrames = Math.max(0, queuedFrames - 1);
      queuedBodyBytes = Math.max(0, queuedBodyBytes - bodyLength);
      return;
    }
    queuedLifecycleBodyBytes = Math.max(0, queuedLifecycleBodyBytes - bodyLength);
    if (admission === 'shutdown') reservedShutdown = false;
    else reservedExit = false;
  }
  function releaseFrameAdmission(frame: PreparedFrame): void {
    if (frame.admissionReleased || frame.admission === undefined || frame.bodyLength === undefined) return;
    frame.admissionReleased = true;
    releaseAdmission(frame.admission, frame.bodyLength);
  }
  function rejectOverloadedFrame(frame: PreparedFrame): void {
    unregisterRequestController(frame.controller);
    if (!frame.envelope) {
      write(makeJsonRpcError(null, LSP_ERROR_CODE.ParseError));
      return;
    }
    if (!frame.envelope.ok) {
      write({ jsonrpc: '2.0', id: frame.envelope.id, error: frame.envelope.error });
      return;
    }
    if ('id' in frame.envelope.message) {
      write(makeJsonRpcError(frame.envelope.message.id, LSP_ERROR_CODE.RequestFailed, 'overloaded'));
    }
  }
  function rejectRequestFrame(frame: PreparedFrame, code: LspErrorCode): void {
    unregisterRequestController(frame.controller);
    const message = frame.envelope?.ok ? frame.envelope.message : null;
    if (message && 'id' in message) write(makeJsonRpcError(message.id as JsonRpcId, code));
  }
  function rejectClosedFrame(frame: PreparedFrame, closedBy = normalAdmissionClosedBy): void {
    unregisterRequestController(frame.controller);
    if (closedBy !== 'shutdown') return;
    if (!frame.envelope) {
      write(makeJsonRpcError(null, LSP_ERROR_CODE.ParseError));
      return;
    }
    if (!frame.envelope.ok) {
      write({ jsonrpc: '2.0', id: frame.envelope.id, error: frame.envelope.error });
      return;
    }
    if ('id' in frame.envelope.message) {
      write(makeJsonRpcError(frame.envelope.message.id, LSP_ERROR_CODE.InvalidRequest));
    }
  }
  function onError(): void {
    if (exitAdmitted) return;
    log('stream_failure');
    finish(1);
  }
  function onOutputError(): void {
    log('stream_failure');
    discardDeferredOutput();
    finish(1);
    try { output.destroy(); } catch { /* best-effort */ }
    finalizeExitIfReady(true);
  }
  function onOutputClose(): void {
    const lostOutput = pendingOutputWrites > 0 || outputBackpressured || deferredOutputFrames.length > 0;
    discardDeferredOutput();
    outputBackpressured = false;
    releaseOutputGate();
    if (settled) {
      if (lostOutput) {
        log('stream_failure');
        finish(1);
      }
      clearOutputDrainDeadline();
      removeOutputListeners(true);
      finalizeExitIfReady(true);
      return;
    }
    log('stream_failure');
    finish(1);
    clearOutputDrainDeadline();
    removeOutputListeners(true);
    finalizeExitIfReady(true);
  }
  function writeOutputFrame(framed: Buffer): void {
    if (output.destroyed) {
      failOutputTransport();
      return;
    }
    pendingOutputWrites += 1;
    try {
      const accepted = output.write(framed, (error) => {
        pendingOutputWrites = Math.max(0, pendingOutputWrites - 1);
        if (error) {
          onOutputError();
          return;
        }
        if (settled && pendingOutputWrites === 0
          && !outputBackpressured && deferredOutputFrames.length === 0) {
          clearOutputDrainDeadline();
          finalizeExitIfReady();
          const immediate = setImmediate(removeOutputListeners);
          immediate.unref?.();
        }
      });
      if (!accepted) waitForOutputDrain();
    } catch {
      pendingOutputWrites = Math.max(0, pendingOutputWrites - 1);
      onOutputError();
    }
  }
  function deferOutputFrame(framed: Buffer): void {
    if (deferredOutputFrames.length >= MAX_DEFERRED_OUTPUT_FRAMES
      || deferredOutputBytes + framed.length > MAX_DEFERRED_OUTPUT_BYTES) {
      failOutputTransport();
      return;
    }
    deferredOutputFrames.push(framed);
    deferredOutputBytes += framed.length;
  }
  function flushDeferredOutput(): void {
    while (!outputBackpressured && deferredOutputFrames.length > 0) {
      const framed = deferredOutputFrames.shift()!;
      deferredOutputBytes = Math.max(0, deferredOutputBytes - framed.length);
      writeOutputFrame(framed);
    }
    if (!outputBackpressured && deferredOutputFrames.length === 0) {
      releaseOutputGate();
      maybeResumeInput();
      if (settled && pendingOutputWrites === 0) {
        finalizeExitIfReady();
        removeOutputListeners();
      }
    }
  }
  function discardDeferredOutput(): void {
    deferredOutputFrames.length = 0;
    deferredOutputBytes = 0;
  }
  function failOutputTransport(): void {
    discardDeferredOutput();
    log('stream_failure');
    finish(1);
    try { output.destroy(); } catch { /* best-effort */ }
    finalizeExitIfReady(true);
  }
  function waitForOutputDrain(): void {
    if (outputBackpressured) return;
    outputBackpressured = true;
    input.pause();
    if (!releaseOutputReady) {
      outputReady = new Promise<void>((resolve) => { releaseOutputReady = resolve; });
    }
    output.once('drain', onOutputDrain);
    armOutputDrainDeadline();
  }
  function onOutputDrain(): void {
    outputBackpressured = false;
    output.removeListener('drain', onOutputDrain);
    clearOutputDrainDeadline();
    flushDeferredOutput();
  }
  function onOutputDrainTimeout(): void {
    outputDrainTimer = null;
    log('stream_failure');
    discardDeferredOutput();
    finish(1);
    clearOutputDrainDeadline();
    try { output.destroy(); } catch { /* best-effort */ }
    finalizeExitIfReady(true);
  }
  function armOutputDrainDeadline(): void {
    if (outputDrainTimer) return;
    outputDrainTimer = setTimeout(onOutputDrainTimeout, outputDrainTimeoutMs);
    outputDrainTimer.unref?.();
  }
  function clearOutputDrainDeadline(): void {
    if (outputDrainTimer) clearTimeout(outputDrainTimer);
    outputDrainTimer = null;
  }
  function armInputDrainDeadline(): void {
    if (inputDrainTimer) return;
    inputDrainTimer = setTimeout(() => {
      inputDrainTimer = null;
      finish(1);
    }, inputDrainTimeoutMs);
  }
  function clearInputDrainDeadline(): void {
    if (inputDrainTimer) clearTimeout(inputDrainTimer);
    inputDrainTimer = null;
  }
  function releaseOutputGate(): void {
    const release = releaseOutputReady;
    releaseOutputReady = null;
    release?.();
  }
  function finalizeExitIfReady(force = false): void {
    if (!settled || exitResolved) return;
    if (!force && (pendingOutputWrites > 0 || outputBackpressured || deferredOutputFrames.length > 0)) return;
    exitResolved = true;
    clearOutputDrainDeadline();
    releaseOutputGate();
    resolveExit(finalExitCode ?? 1);
  }
  function maybeResumeInput(): void {
    if (!settled && !inputEnded && !exitAdmitted && !outputBackpressured
      && deferredOutputFrames.length === 0 && input.isPaused()) {
      input.resume();
    }
  }
  function removeOutputListeners(force = false): void {
    if (outputListenersRemoved) {
      maybeRemoveDiagnosticsListener();
      return;
    }
    if (!force && (!settled || pendingOutputWrites > 0
      || outputBackpressured || deferredOutputFrames.length > 0)) return;
    outputListenersRemoved = true;
    output.removeListener('close', onOutputClose);
    output.removeListener('error', onOutputError);
    output.removeListener('drain', onOutputDrain);
    maybeRemoveDiagnosticsListener();
  }
  function onDiagnosticsError(): void {
    // Diagnostic delivery is best-effort and must never terminate the server.
  }
  function maybeRemoveDiagnosticsListener(): void {
    if (!settled
      || pendingOutputWrites > 0
      || !outputListenersRemoved
      || pendingDiagnosticWrites > 0
      || diagnosticsListenerRemoved
      || diagnosticsRemovalScheduled) return;
    diagnosticsRemovalScheduled = true;
    scheduleDiagnosticsRemoval();
  }
  function scheduleDiagnosticsRemoval(): void {
    const immediate = setImmediate(() => {
      diagnosticsRemovalScheduled = false;
      if (!settled || pendingDiagnosticWrites > 0) return void maybeRemoveDiagnosticsListener();
      diagnosticsListenerRemoved = true;
      diagnostics.removeListener('error', onDiagnosticsError);
    });
    immediate.unref?.();
  }
  function onSignal(): void {
    finish(facade.requestedExitCode ?? 1);
  }

  input.on('data', onData);
  input.once('end', onEnd);
  input.once('close', onInputClose);
  input.once('error', onError);
  output.on('close', onOutputClose);
  output.on('error', onOutputError);
  diagnostics.on('error', onDiagnosticsError);
  if (options.installSignalHandlers !== false) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  input.resume();
  return exit;
}

export async function runLspStdioServer(projectPath = process.cwd()): Promise<number> {
  let root = findNearestCodeGraphRoot(projectPath);
  if (!root) throw new LspProjectNotIndexedError();
  try { root = fs.realpathSync(root); } catch { /* resolved fallback is sufficient */ }
  const client = await attachDaemonClient(root);
  return serveLspStdio(createDaemonLspReader(root, client, undefined, true), { close: () => client.close() });
}

function requestKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function isLifecycleRequest(message: JsonRpcMessage): boolean {
  return 'id' in message
    && (message.method === LSP_METHOD.Initialize || message.method === LSP_METHOD.Shutdown);
}

function cancelRequestId(message: JsonRpcMessage): JsonRpcId | undefined {
  if ('id' in message || message.method !== LSP_METHOD.CancelRequest || !isRecord(message.params)) return undefined;
  const id = message.params.id;
  if (typeof id === 'string') return id;
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
