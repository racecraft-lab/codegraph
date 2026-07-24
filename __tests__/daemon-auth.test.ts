import { describe, expect, it } from 'vitest';
import {
  createDaemonAuthNonce,
  createDaemonAuthSecret,
  createDaemonClientProof,
  createDaemonServerProof,
  daemonProofMatches,
  isValidDaemonAuthNonce,
  isValidDaemonAuthProof,
  isValidDaemonAuthSecret,
  type DaemonClientProofFields,
  type DaemonServerProofFields,
} from '../src/mcp/daemon-auth';

describe('daemon authentication proofs', () => {
  const secret = '11'.repeat(32);
  const server: DaemonServerProofFields = {
    codegraph: '1.5.0',
    pid: 42,
    socketPath: '/tmp/codegraph.sock',
    instanceId: 'instance-a',
    nonce: '22'.repeat(32),
  };
  const client: DaemonClientProofFields = {
    pid: 84,
    hostPid: 21,
    instanceId: server.instanceId,
    serverNonce: server.nonce,
    nonce: '33'.repeat(32),
  };

  it('binds every server identity field and separates server proofs from clients', () => {
    const proof = createDaemonServerProof(secret, server);
    const mutations: DaemonServerProofFields[] = [
      { ...server, codegraph: '1.5.1' },
      { ...server, pid: server.pid + 1 },
      { ...server, socketPath: `${server.socketPath}.other` },
      { ...server, instanceId: `${server.instanceId}-other` },
      { ...server, nonce: '44'.repeat(32) },
    ];
    for (const fields of mutations) {
      expect(daemonProofMatches(createDaemonServerProof(secret, fields), proof)).toBe(false);
    }
    expect(daemonProofMatches(createDaemonClientProof(secret, client), proof)).toBe(false);
  });

  it('binds every client identity field and rejects malformed proofs', () => {
    const proof = createDaemonClientProof(secret, client);
    const mutations: DaemonClientProofFields[] = [
      { ...client, pid: client.pid + 1 },
      { ...client, hostPid: null },
      { ...client, instanceId: `${client.instanceId}-other` },
      { ...client, serverNonce: '55'.repeat(32) },
      { ...client, nonce: '66'.repeat(32) },
    ];
    for (const fields of mutations) {
      expect(daemonProofMatches(createDaemonClientProof(secret, fields), proof)).toBe(false);
    }
    expect(daemonProofMatches(proof, proof)).toBe(true);
    expect(daemonProofMatches('not-hex', proof)).toBe(false);
    expect(daemonProofMatches('00'.repeat(31), proof)).toBe(false);
    expect(isValidDaemonAuthProof(proof)).toBe(true);
  });

  it('generates independent fixed-width secrets and nonces', () => {
    const firstSecret = createDaemonAuthSecret();
    const secondSecret = createDaemonAuthSecret();
    const firstNonce = createDaemonAuthNonce();
    const secondNonce = createDaemonAuthNonce();

    expect(isValidDaemonAuthSecret(firstSecret)).toBe(true);
    expect(isValidDaemonAuthSecret(secondSecret)).toBe(true);
    expect(isValidDaemonAuthNonce(firstNonce)).toBe(true);
    expect(isValidDaemonAuthNonce(secondNonce)).toBe(true);
    expect(new Set([firstSecret, secondSecret, firstNonce, secondNonce]).size).toBe(4);
  });
});
