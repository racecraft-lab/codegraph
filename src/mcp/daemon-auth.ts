import * as crypto from 'node:crypto';

export const DAEMON_HANDSHAKE_PROTOCOL = 3 as const;

const HEX_256 = /^[0-9a-f]{64}$/i;

export function createDaemonAuthSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createDaemonAuthNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isValidDaemonAuthSecret(value: unknown): value is string {
  return typeof value === 'string' && HEX_256.test(value);
}

export function isValidDaemonAuthNonce(value: unknown): value is string {
  return typeof value === 'string' && HEX_256.test(value);
}

export function isValidDaemonAuthProof(value: unknown): value is string {
  return typeof value === 'string' && HEX_256.test(value);
}

/** PID 1 is an init/reaper, not a useful host-liveness target. */
export function normalizeDaemonHostPid(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 1
    ? value
    : null;
}

export interface DaemonServerProofFields {
  codegraph: string;
  pid: number;
  socketPath: string;
  instanceId: string;
  nonce: string;
}

export interface DaemonClientProofFields {
  pid: number;
  hostPid: number | null;
  instanceId: string;
  serverNonce: string;
  nonce: string;
}

function sign(secret: string, domain: 'server' | 'client', fields: readonly unknown[]): string {
  return crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(JSON.stringify([domain, DAEMON_HANDSHAKE_PROTOCOL, ...fields]))
    .digest('hex');
}

export function createDaemonServerProof(
  secret: string,
  fields: DaemonServerProofFields,
): string {
  return sign(secret, 'server', [
    fields.codegraph,
    fields.pid,
    fields.socketPath,
    fields.instanceId,
    fields.nonce,
  ]);
}

export function createDaemonClientProof(
  secret: string,
  fields: DaemonClientProofFields,
): string {
  return sign(secret, 'client', [
    fields.pid,
    fields.hostPid,
    fields.instanceId,
    fields.serverNonce,
    fields.nonce,
  ]);
}

export function daemonProofMatches(actual: unknown, expected: string): boolean {
  if (!isValidDaemonAuthProof(actual) || !isValidDaemonAuthProof(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
