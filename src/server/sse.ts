/**
 * SPEC-005 Slice-2 Server-Sent Events writer (FR-023).
 *
 * Per-subscriber framing with backpressure discipline: the `snapshot` frame is
 * ALWAYS delivered on connect. A separate terminal `done`/`error` frame is
 * delivered only for a job still RUNNING at subscribe time (it fires when the
 * job later reaches terminal). A subscriber connecting to an already-finished
 * job gets the terminal STATE inside that one snapshot (its payload carries the
 * terminal status) and the stream then closes — no separate done/error frame.
 * Live `progress` frames (the library's IndexProgress fires per file —
 * thousands of times) coalesce to the LATEST pending frame when the socket
 * refuses a write, so a slow subscriber never grows an unbounded in-memory
 * backlog and never stalls the job or the other subscribers. A `:`-prefixed
 * heartbeat comment (~15s) keeps a quiet stream under the common proxy/browser
 * idle timeout.
 *
 * @module server/sse
 */

import type { IndexProgress } from '../extraction';
import type { JobDescriptor, ReindexJob } from './jobs';

/**
 * The minimal writable surface the writer needs — `node:http`'s
 * `ServerResponse` satisfies it (a `Writable`: `write()` returns a boolean, and
 * it emits `drain`/`close`). A fake sink lets T037 unit-test backpressure with
 * no socket.
 */
export interface SseSink {
  write(chunk: string): boolean;
  end(cb?: () => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  writableEnded?: boolean;
}

/** Minimal `req`-like surface the stream glue needs (client-disconnect signal). */
export interface SseRequest {
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** An SSE-capable response: the {@link SseSink} plus `writeHead` for the FR-023 headers. */
export type SseResponse = SseSink & {
  writeHead(status: number, headers: Record<string, string>): void;
};

/** Default heartbeat interval — ~15s, below the common 30–60s proxy/browser idle timeout. */
const DEFAULT_HEARTBEAT_MS = 15_000;

/** Resolve the heartbeat interval, honoring a test/ops env override. */
function resolveHeartbeatMs(): number {
  const raw = process.env.CODEGRAPH_SSE_HEARTBEAT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 10 ? n : DEFAULT_HEARTBEAT_MS;
}

/** One SSE frame: `event: <name>\ndata: <json>\n\n`. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Per-subscriber SSE frame writer with FR-023 backpressure. `snapshot` and the
 * terminal frame are written directly (the runtime queues them — bounded, one
 * each); `progress` frames coalesce to the latest pending on backpressure and
 * flush on `drain`, so this writer never buffers the whole run.
 */
export class SseWriter {
  private readonly sink: SseSink;
  private draining = false;
  private pendingProgress: IndexProgress | null = null;
  private closed = false;
  private terminalWritten = false;

  constructor(sink: SseSink) {
    this.sink = sink;
    this.sink.on('drain', this.onDrain);
  }

  /** Fired when the socket buffer drains: flush the single coalesced pending progress. */
  private onDrain = (): void => {
    if (this.closed) return;
    this.draining = false;
    if (this.pendingProgress) {
      const p = this.pendingProgress;
      this.pendingProgress = null;
      this.writeProgress(p); // re-attempt; may re-enter draining
    }
  };

  private writeFrame(event: string, data: unknown): void {
    if (this.closed) return;
    // Always attempt the write (the runtime queues it even when it returns
    // false); track backpressure so the NEXT progress coalesces.
    const ok = this.sink.write(frame(event, data));
    if (!ok) this.draining = true;
  }

  /** The immediate snapshot of current state on connect — always delivered (FR-023). */
  writeSnapshot(descriptor: JobDescriptor): void {
    this.writeFrame('snapshot', descriptor);
  }

  /**
   * A live progress frame. Under backpressure it does NOT queue a new frame —
   * it coalesces to the LATEST pending (each frame carries absolute
   * `current`/`total`, so a slow subscriber may skip superseded intermediates).
   */
  writeProgress(progress: IndexProgress): void {
    if (this.closed) return;
    if (this.draining) {
      this.pendingProgress = progress; // coalesce to latest — bounded to one frame
      return;
    }
    const ok = this.sink.write(frame('progress', progress));
    if (!ok) this.draining = true;
  }

  /** The single terminal frame (`done`/`error`) — always delivered — then end the stream. */
  writeTerminal(descriptor: JobDescriptor): void {
    if (this.closed || this.terminalWritten) return;
    this.terminalWritten = true;
    this.writeFrame(descriptor.status === 'done' ? 'done' : 'error', descriptor);
    this.close();
  }

  /** A `:`-prefixed comment heartbeat (ignored by `EventSource`, keeps the stream warm). */
  writeHeartbeat(): void {
    if (this.closed) return;
    this.sink.write(': heartbeat\n\n');
  }

  /** Stop writing and end the response. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingProgress = null;
    try {
      this.sink.end();
    } catch {
      /* already ended / socket gone */
    }
  }
}

/**
 * Wire a live job to an HTTP response as an SSE stream (FR-023): the streaming
 * headers, the immediate snapshot, live progress + the single terminal frame,
 * and a heartbeat. A client disconnect stops writes to THIS response but never
 * cancels the job; if the job already finished, the snapshot is terminal and the
 * stream closes immediately.
 */
export function streamJobToResponse(res: SseResponse, req: SseRequest | undefined, job: ReindexJob): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Disable reverse-proxy response buffering that would batch/withhold the stream.
    'X-Accel-Buffering': 'no',
  });

  const writer = new SseWriter(res);
  writer.writeSnapshot(job.descriptor());
  if (job.isTerminal()) {
    // Already finished: the snapshot is terminal — close immediately (FR-023).
    writer.close();
    return;
  }

  let done = false;
  let unsubscribe: () => void = () => undefined;
  const heartbeat = setInterval(() => writer.writeHeartbeat(), resolveHeartbeatMs());
  heartbeat.unref?.();

  const finishStream = (descriptor: JobDescriptor): void => {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    unsubscribe();
    writer.writeTerminal(descriptor);
  };

  unsubscribe = job.subscribe((evt) => {
    if (evt.type === 'progress') writer.writeProgress(evt.progress);
    else finishStream(evt.descriptor);
  });

  // Race guard: the job may have reached terminal between the snapshot check and
  // the subscribe above (the subscriber would then miss the past terminal event).
  if (job.isTerminal()) finishStream(job.descriptor());

  // Client disconnect: stop writing to THIS response, but NEVER cancel the job
  // (FR-023) and never touch the other subscribers.
  req?.on('close', () => {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    unsubscribe();
    writer.close();
  });
}
