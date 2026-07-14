/**
 * LLM status snapshot — unit tests (SPEC-018 slice 1, T005).
 *
 * Pins `resolveLlmStatus(env): LlmStatus` (data-model §8 / contracts/status-llm-json.md) — the
 * pure, network-free observability snapshot that `CodeGraph.getLlmStatus()` (Group D) delegates to.
 * Mirrors `EmbeddingStatus`, with one deliberate divergence: the plaintext-remote advisory lives
 * IN status (FR-006), not pass-time-only as in embeddings.
 *
 * Four states: endpoint-active (redacted endpoint + model, plaintextWarning ONLY for a
 * plaintext-remote url), agent stub (mode:'agent', no pendingBundles in slice 1), dormant
 * (activationVars), misconfigured (mirrors the misconfig fields). The API key must NEVER appear
 * in any field, and computing status must be network- and filesystem-free (SC-002/SC-004).
 *
 * Pure over an INJECTED env object (never process.env) — hermetic, no temp dirs, no teardown.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// Default import (NOT `import * as fs`): vitest cannot spy on a frozen ESM namespace object.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveLlmStatus } from '../src/llm/config';
import type { LlmStatusActive } from '../src/llm/config';
import { emitBundle } from '../src/llm/agent-bundle';
import type { ProseTask, OutputContract } from '../src/llm/generate';

const ENDPOINT_URL = 'https://api.example.com';
const ENDPOINT_MODEL = 'gpt-4o-mini';
const ACTIVATION_VARS = ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'];

/** A base env with BOTH activation variables set, plus optional overrides. */
function endpointEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    CODEGRAPH_LLM_URL: ENDPOINT_URL,
    CODEGRAPH_LLM_MODEL: ENDPOINT_MODEL,
    ...extra,
  };
}

describe('resolveLlmStatus — endpoint active (data-model §8)', () => {
  it('reports { active, mode:"endpoint", endpoint (redacted), model } and NO warning for https', () => {
    expect(resolveLlmStatus(endpointEnv())).toEqual({
      active: true,
      mode: 'endpoint',
      endpoint: 'https://api.example.com',
      model: ENDPOINT_MODEL,
    });
  });

  it('redacts the endpoint to scheme + host + port — raw userinfo/path/query never appears', () => {
    const status = resolveLlmStatus(
      endpointEnv({ CODEGRAPH_LLM_URL: 'https://user:secret@api.example.com:8443/v1/chat?token=abc' }),
    ) as LlmStatusActive;
    expect(status.endpoint).toBe('https://api.example.com:8443');
    const serialized = JSON.stringify(status);
    for (const leak of ['user', 'secret', 'token', 'abc', 'v1', 'chat']) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('carries a plaintextWarning IN status ONLY for a plaintext-remote endpoint (FR-006 divergence)', () => {
    const status = resolveLlmStatus(endpointEnv({ CODEGRAPH_LLM_URL: 'http://10.1.2.3:11434/v1/chat' })) as LlmStatusActive;
    expect(status.active).toBe(true);
    expect(status.mode).toBe('endpoint');
    expect(status.endpoint).toBe('http://10.1.2.3:11434');
    expect(typeof status.plaintextWarning).toBe('string');
    const warning = status.plaintextWarning as string;
    expect(warning).toContain('10.1.2.3'); // redacted host, not the raw url
    expect(warning).toContain('https'); // suggests the fix
    expect(warning).toMatch(/cleartext|plaintext/i);
  });

  it('omits plaintextWarning for a loopback-http endpoint (the designed local case)', () => {
    const status = resolveLlmStatus(endpointEnv({ CODEGRAPH_LLM_URL: 'http://localhost:11434/v1/chat' })) as LlmStatusActive;
    expect(status.active).toBe(true);
    expect(status.endpoint).toBe('http://localhost:11434');
    expect(status.plaintextWarning).toBeUndefined();
    expect('plaintextWarning' in status).toBe(false);
  });

  it('omits plaintextWarning for an https endpoint', () => {
    const status = resolveLlmStatus(endpointEnv()) as LlmStatusActive;
    expect(status.plaintextWarning).toBeUndefined();
  });

  it('the plaintext-remote endpoint case redacts credentials out of the in-status warning too', () => {
    const status = resolveLlmStatus(
      endpointEnv({ CODEGRAPH_LLM_URL: 'http://alice:s3cr3t@10.1.2.3:11434/v1/chat?apikey=leak789' }),
    ) as LlmStatusActive;
    const warning = status.plaintextWarning as string;
    expect(warning).toContain('http://10.1.2.3:11434');
    for (const credential of ['alice', 's3cr3t', 'leak789']) {
      expect(warning).not.toContain(credential);
    }
  });
});

describe('resolveLlmStatus — agent active (slice 1 stub)', () => {
  it('reports { active:true, mode:"agent" } with NO pendingBundles in slice 1', () => {
    const status = resolveLlmStatus(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'agent' }));
    expect(status).toEqual({ active: true, mode: 'agent' });
    expect('pendingBundles' in status).toBe(false);
  });

  it('is agent even with no URL/MODEL set (agent is explicit-only)', () => {
    expect(resolveLlmStatus({ CODEGRAPH_LLM_PROVIDER: 'agent' })).toEqual({ active: true, mode: 'agent' });
  });
});

describe('resolveLlmStatus — dormant (data-model §8)', () => {
  it('reports { active:false, activationVars:[URL, MODEL] } when nothing is set', () => {
    expect(resolveLlmStatus({})).toEqual({ active: false, activationVars: ACTIVATION_VARS });
  });

  it('is dormant for API-key-only (the key is never an activation variable)', () => {
    expect(resolveLlmStatus({ CODEGRAPH_LLM_API_KEY: 'sk-secret-key' })).toEqual({
      active: false,
      activationVars: ACTIVATION_VARS,
    });
  });
});

describe('resolveLlmStatus — misconfigured (mirrors the misconfig fields)', () => {
  it('a half-config (only URL) reports missingVariable MODEL, with NO invalidValue/missingVariables', () => {
    expect(resolveLlmStatus({ CODEGRAPH_LLM_URL: ENDPOINT_URL })).toEqual({
      active: false,
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_MODEL',
    });
  });

  it('a half-config (only MODEL) reports missingVariable URL', () => {
    expect(resolveLlmStatus({ CODEGRAPH_LLM_MODEL: ENDPOINT_MODEL })).toEqual({
      active: false,
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_URL',
    });
  });

  it('explicit endpoint with NEITHER set carries missingVariable + missingVariables', () => {
    expect(resolveLlmStatus({ CODEGRAPH_LLM_PROVIDER: 'endpoint' })).toEqual({
      active: false,
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_URL',
      missingVariables: ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'],
    });
  });

  it('an unrecognized provider carries invalidValue + allowedValues', () => {
    expect(resolveLlmStatus({ CODEGRAPH_LLM_PROVIDER: 'local' })).toEqual({
      active: false,
      misconfigured: true,
      missingVariable: 'CODEGRAPH_LLM_PROVIDER',
      invalidValue: 'local',
      allowedValues: ['endpoint', 'agent'],
    });
  });
});

describe('resolveLlmStatus — hermetic: network-free, fs-free, never exposes the API key (SC-002/SC-004)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never opens a socket or the filesystem, and the API key appears in NO status field', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const readFileSpy = vi.spyOn(fs, 'readFileSync');
    const statSpy = vi.spyOn(fs, 'statSync');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    const existsSpy = vi.spyOn(fs, 'existsSync');
    const openSpy = vi.spyOn(fs, 'openSync');

    const SECRET = 'sk-super-secret-KEY-42';
    const statuses = [
      resolveLlmStatus({}), // dormant
      resolveLlmStatus(endpointEnv({ CODEGRAPH_LLM_API_KEY: SECRET })), // endpoint + key
      resolveLlmStatus(endpointEnv({ CODEGRAPH_LLM_URL: 'http://10.1.2.3:11434', CODEGRAPH_LLM_API_KEY: SECRET })), // plaintext-remote + key
      resolveLlmStatus(endpointEnv({ CODEGRAPH_LLM_PROVIDER: 'agent', CODEGRAPH_LLM_API_KEY: SECRET })), // agent + key
      resolveLlmStatus({ CODEGRAPH_LLM_PROVIDER: 'endpoint', CODEGRAPH_LLM_API_KEY: SECRET }), // misconfig + key
      resolveLlmStatus({ CODEGRAPH_LLM_PROVIDER: 'bogus' }), // invalid provider
    ];

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(existsSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();

    for (const status of statuses) {
      expect(JSON.stringify(status)).not.toContain(SECRET);
    }
  });
});

// --------------------------------------------------------------------------
// Finding 2 (rp-review): `codegraph status` has an early return for an UNINITIALIZED
// project (no graph DB). Agent mode is filesystem-only — a project can carry pending
// task bundles (or have CODEGRAPH_LLM_* set) with no DB — so the uninitialized path
// must STILL report the network-free, DB-free LLM snapshot in both --json and human
// output, mirroring the initialized path's `LLM:` block. Unlike the unit tests above,
// this block exercises the built binary end-to-end (a real temp root, no graph DB).
const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
const PROSE_CONTRACT: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };
function makeTask(): ProseTask {
  return { instructions: 'Summarize.', graphContext: [], outputContract: PROSE_CONTRACT, fallback: 'FB' };
}

interface StatusRun {
  status: number | null;
  stdout: string;
  stderr: string;
}
function runStatus(cwd: string, args: string[], extraEnv: Record<string, string> = {}): StatusRun {
  const env = { ...process.env };
  for (const k of [
    'CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL', 'CODEGRAPH_LLM_API_KEY', 'CODEGRAPH_LLM_PROVIDER',
    'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY', 'CODEGRAPH_EMBEDDING_PROVIDER',
  ]) delete env[k];
  const r = spawnSync(process.execPath, [BIN, 'status', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1', DO_NOT_TRACK: '1', ...extraEnv },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function parseJsonLine(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim().split('\n').filter(Boolean).pop()!);
}

describe('codegraph status — uninitialized project still reports the LLM snapshot (Finding 2)', () => {
  const roots: string[] = [];
  function makeRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-status-uninit-'));
    roots.push(dir);
    return dir;
  }
  afterEach(() => {
    while (roots.length) {
      const dir = roots.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--json on an uninitialized project includes the dormant `llm` snapshot', () => {
    const root = makeRoot();
    const r = runStatus(root, ['--json']);
    expect(r.status).toBe(0);
    const out = parseJsonLine(r.stdout);
    expect(out.initialized).toBe(false);
    expect(out.llm).toEqual({ active: false, activationVars: ['CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL'] });
  });

  it('--json on an uninitialized project with agent bundles reports agent mode + pending count', () => {
    const root = makeRoot();
    emitBundle(root, makeTask()); // one pending bundle, NO graph DB → still uninitialized
    const r = runStatus(root, ['--json'], { CODEGRAPH_LLM_PROVIDER: 'agent' });
    expect(r.status).toBe(0);
    const out = parseJsonLine(r.stdout);
    expect(out.initialized).toBe(false);
    expect(out.llm).toEqual({ active: true, mode: 'agent', pendingBundles: 1 });
  });

  it('human status on an uninitialized project renders the LLM block (agent + pending)', () => {
    const root = makeRoot();
    emitBundle(root, makeTask());
    const r = runStatus(root, [], { CODEGRAPH_LLM_PROVIDER: 'agent' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('LLM:');
    expect(r.stdout).toContain('agent');
    expect(r.stdout).toContain('1 pending bundle');
  });
});
