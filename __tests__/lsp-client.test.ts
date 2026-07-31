import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tempDirs: string[] = [];
const clients: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  const pendingClients = clients.splice(0);
  await Promise.all(pendingClients.map((client) => client.dispose().catch(() => undefined)));
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadClientModule(): Promise<any> {
  try {
    return await import('../src/lsp/client');
  } catch (error) {
    expect.fail(`Expected src/lsp/client.ts to export the JSON-RPC client, but import failed: ${(error as Error).message}`);
  }
}

async function createClient(serverSource: string, options: Record<string, unknown> = {}): Promise<any> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-client-'));
  tempDirs.push(dir);
  const serverPath = path.join(dir, 'server.cjs');
  fs.writeFileSync(serverPath, serverSource);

  const { LspJsonRpcClient } = await loadClientModule();
  const client = new LspJsonRpcClient({
    command: [process.execPath, serverPath],
    timeoutMs: 2000,
    ...options,
  });
  clients.push(client);
  return client;
}

function rpcServerSource(handlerBody: string): string {
  return `
function frame(message) {
  const body = JSON.stringify(message);
  return 'Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body;
}

function send(message) {
  process.stdout.write(frame(message));
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  drainInput();
});

function drainInput() {
  while (true) {
    const headerEnd = input.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) return;
    const header = input.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) process.exit(91);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (input.length < bodyEnd) return;
    const body = input.subarray(bodyStart, bodyEnd).toString('utf8');
    input = input.subarray(bodyEnd);
    handleMessage(JSON.parse(body));
  }
}

function handleMessage(message) {
${handlerBody}
}
`;
}

describe('LspJsonRpcClient', () => {
  it('initializes a stdio language server and sends the initialized notification', async () => {
    const client = await createClient(rpcServerSource(`
  globalThis.initializedSeen = globalThis.initializedSeen || false;
  if (message.method === 'initialize') {
    globalThis.initializeParams = message.params;
    respond(message.id, { capabilities: { definitionProvider: true }, serverInfo: { name: 'fixture-server' } });
    return;
  }
  if (message.method === 'initialized') {
    globalThis.initializedSeen = true;
    return;
  }
  if (message.method === 'test/seen') {
    respond(message.id, {
      initializedSeen: globalThis.initializedSeen,
      initializeParams: globalThis.initializeParams
    });
    return;
  }
  if (message.method === 'shutdown') {
    respond(message.id, null);
    return;
  }
  if (message.method === 'exit') process.exit(0);
`));

    const result = await client.initialize({
      rootUri: 'file:///fixture-workspace',
      capabilities: { workspace: { configuration: true } },
      initializationOptions: { codegraph: true },
    });
    expect(result).toEqual({
      capabilities: { definitionProvider: true },
      serverInfo: { name: 'fixture-server' },
    });

    const seen = await client.request('test/seen');
    expect(seen).toEqual({
      initializedSeen: true,
      initializeParams: {
        processId: process.pid,
        rootUri: 'file:///fixture-workspace',
        rootPath: null,
        capabilities: { workspace: { configuration: true } },
        initializationOptions: { codegraph: true },
      },
    });
  });

  it('routes out-of-order responses by request id', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/slow') {
    setTimeout(() => respond(message.id, { method: 'slow', value: message.params.value }), 25);
    return;
  }
  if (message.method === 'test/fast') {
    respond(message.id, { method: 'fast', value: message.params.value });
    return;
  }
`));

    await expect(Promise.all([
      client.request('test/slow', { value: 1 }),
      client.request('test/fast', { value: 2 }),
    ])).resolves.toEqual([
      { method: 'slow', value: 1 },
      { method: 'fast', value: 2 },
    ]);
  });

  it('rejects a request that exceeds its bounded timeout', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/hang') return;
`), { timeoutMs: 25 });

    await expect(client.request('test/hang')).rejects.toMatchObject({
      name: 'LspRequestTimeoutError',
      reasonCode: 'request-timeout',
    });
  });

  it('maps initialize timeout to the initialize-specific degradation reason', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'initialize') return;
`), { timeoutMs: 25 });

    await expect(client.initialize({ rootUri: 'file:///fixture-workspace' })).rejects.toMatchObject({
      name: 'LspRequestTimeoutError',
      reasonCode: 'initialize-timeout',
    });
  });

  it('performs shutdown by sending shutdown then exit and waiting for process exit', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'shutdown') {
    globalThis.shutdownSeen = true;
    respond(message.id, null);
    return;
  }
  if (message.method === 'exit') {
    process.stderr.write('shutdown-seen=' + String(globalThis.shutdownSeen));
    process.exit(globalThis.shutdownSeen ? 0 : 19);
  }
`));

    await expect(client.shutdown()).resolves.toBeNull();
    await expect(client.waitForExit()).resolves.toMatchObject({ code: 0, signal: null });
    expect(client.getStderr()).toContain('shutdown-seen=true');
  });

  it('maps shutdown failures to a degradation reason without hanging disposal', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'shutdown') return;
`), { timeoutMs: 25 });

    await expect(client.shutdown()).rejects.toMatchObject({
      name: 'LspClientError',
      reasonCode: 'shutdown-failure',
    });
  });

  it('rejects pending requests when the server process exits', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/exit') process.exit(17);
`));

    await expect(client.request('test/exit')).rejects.toMatchObject({
      name: 'LspServerExitedError',
      reasonCode: 'server-crash',
    });
    await expect(client.waitForExit()).resolves.toMatchObject({ code: 17, signal: null });
  });

  it('settles exit state when the server process cannot be spawned', async () => {
    const { LspJsonRpcClient } = await loadClientModule();
    const missingExecutable = path.join(os.tmpdir(), `cg-missing-lsp-${process.pid}-${Date.now()}`);
    const client = new LspJsonRpcClient({
      command: [missingExecutable],
      timeoutMs: 25,
    });
    clients.push(client);

    await expect(client.request('test/missing')).rejects.toMatchObject({
      name: 'LspClientError',
      reasonCode: 'server-crash',
    });
    await expect(client.waitForExit()).resolves.toMatchObject({ code: null, signal: null });
  });

  it('rejects pending requests when stdin emits a pipe error', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/hang') return;
`), { timeoutMs: 500 });

    const request = client.request('test/hang');
    client.child.stdin.emit('error', new Error('fixture EPIPE'));

    await expect(request).rejects.toMatchObject({
      name: 'LspClientError',
      reasonCode: 'server-crash',
    });
  });

  it('drains multiple stdout frames delivered in a single chunk', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/first') {
    globalThis.firstId = message.id;
  }
  if (message.method === 'test/second') {
    globalThis.secondId = message.id;
  }
  if (globalThis.firstId !== undefined && globalThis.secondId !== undefined && !globalThis.flushed) {
    globalThis.flushed = true;
    process.stdout.write(
      frame({ jsonrpc: '2.0', id: globalThis.secondId, result: 'second' }) +
      frame({ jsonrpc: '2.0', id: globalThis.firstId, result: 'first' })
    );
  }
`));

    await expect(Promise.all([
      client.request('test/first'),
      client.request('test/second'),
    ])).resolves.toEqual(['first', 'second']);
  });

  it('drains stderr while requests are in flight', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/stderr') {
    process.stderr.write('stderr-start\\n' + 'x'.repeat(128000) + '\\nstderr-end\\n', () => {
      respond(message.id, { ok: true });
    });
  }
`), { timeoutMs: 1000 });

    await expect(client.request('test/stderr')).resolves.toEqual({ ok: true });
    expect(client.getStderr()).toContain('stderr-start');
    expect(client.getStderr()).toContain('stderr-end');
  });

  it('rejects pending requests when a malformed response is received', async () => {
    const client = await createClient(rpcServerSource(`
  if (message.method === 'test/malformed') {
    const body = 'not-json';
    process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body);
  }
`));

    await expect(client.request('test/malformed')).rejects.toMatchObject({
      name: 'LspProtocolError',
      reasonCode: 'malformed-protocol-response',
    });
  });
});

/**
 * Analysis-heavy servers (jdtls, the Dart analysis server) return `initialize`
 * in milliseconds and only then start the project scan that the first position
 * request blocks on. Measured against this repository, jdtls answered its first
 * `textDocument/definition` in ~35s and every later one in ~26ms. A single
 * timeout cannot serve both phases, so the client carries a separate warm-up
 * budget that ends at the first answered non-initialize request.
 */
describe('LSP client warm-up budget', () => {
  // initialize answers at once; the first work request is slower than the
  // steady-state budget but inside the warm-up budget.
  const slowFirstRequestServer = rpcServerSource(`
  if (message.method === 'initialize') return respond(message.id, { capabilities: {} });
  if (message.method === 'test/work') {
    const delay = handledWork === 0 ? 220 : 0;
    handledWork += 1;
    return setTimeout(() => respond(message.id, { attempt: handledWork }), delay);
  }
`).replace('function handleMessage(message) {', 'let handledWork = 0;\nfunction handleMessage(message) {');

  it('spans initialize and the first work request, so a slow cold start is not killed', async () => {
    const client = await createClient(slowFirstRequestServer, {
      timeoutMs: 60,
      startupTimeoutMs: 4000,
    });

    await client.initialize();
    // 220ms > the 60ms steady-state budget: this only resolves if the warm-up
    // budget is still in force after initialize returned.
    await expect(client.request('test/work')).resolves.toEqual({ attempt: 1 });
  });

  it('reverts to the steady-state budget once a work request has been answered', async () => {
    const neverAnswersSecond = rpcServerSource(`
  if (message.method === 'initialize') return respond(message.id, { capabilities: {} });
  if (message.method === 'test/work') {
    handledWork += 1;
    if (handledWork === 1) return respond(message.id, { attempt: 1 });
    return; // second request is never answered
  }
`).replace('function handleMessage(message) {', 'let handledWork = 0;\nfunction handleMessage(message) {');

    const client = await createClient(neverAnswersSecond, {
      timeoutMs: 80,
      startupTimeoutMs: 30_000,
    });

    await client.initialize();
    await expect(client.request('test/work')).resolves.toEqual({ attempt: 1 });
    // Warm-up is over, so the 80ms steady-state budget applies rather than the
    // 30s startup budget — otherwise this test would hang for 30 seconds.
    await expect(client.request('test/work')).rejects.toMatchObject({
      name: 'LspRequestTimeoutError',
    });
  });

  it('defaults the warm-up budget to timeoutMs so existing callers are unchanged', async () => {
    const client = await createClient(slowFirstRequestServer, { timeoutMs: 60 });

    await client.initialize();
    await expect(client.request('test/work')).rejects.toMatchObject({
      name: 'LspRequestTimeoutError',
    });
  });
});
