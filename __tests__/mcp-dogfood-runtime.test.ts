import { describe, expect, it, vi } from 'vitest';
import {
  isSupportedDogfoodNodeVersion,
  selectDogfoodNodeRuntime,
} from '../scripts/lib/dogfood-node-runtime.mjs';

describe('MCP dogfood Node runtime selection', () => {
  it('matches the package Node engine range', () => {
    expect(isSupportedDogfoodNodeVersion('22.23.4')).toBe(true);
    expect(isSupportedDogfoodNodeVersion('22.24.0')).toBe(true);
    expect(isSupportedDogfoodNodeVersion('24.22.1')).toBe(true);

    for (const version of ['20.19.0', '22.23.3', '23.11.0', '24.22.0', '24.22.1-rc.1']) {
      expect(isSupportedDogfoodNodeVersion(version)).toBe(false);
    }
    expect(isSupportedDogfoodNodeVersion('20.18.3')).toBe(false);
    expect(isSupportedDogfoodNodeVersion('21.7.3')).toBe(false);
    expect(isSupportedDogfoodNodeVersion('22.11.0')).toBe(false);
    expect(isSupportedDogfoodNodeVersion('25.1.0')).toBe(false);
    expect(isSupportedDogfoodNodeVersion('26.5.0')).toBe(false);
    expect(isSupportedDogfoodNodeVersion('not-a-version')).toBe(false);
  });

  it('keeps the current executable when its runtime is supported', () => {
    const probeVersion = vi.fn();
    expect(selectDogfoodNodeRuntime({
      currentExecutable: '/current/node',
      currentVersion: '24.22.1',
      pathValue: '/bad:/good',
      pathDelimiter: ':',
      executableName: 'node',
      probeVersion,
    })).toBe('/current/node');
    expect(probeVersion).not.toHaveBeenCalled();
  });

  it('skips unsupported PATH candidates and selects the first supported runtime', () => {
    const probeVersion = vi.fn((candidate: string) => new Map([
      ['/bad/node', '26.5.0'],
      ['/good/node', '22.23.4'],
      ['/later/node', '24.22.1'],
    ]).get(candidate) ?? null);

    expect(selectDogfoodNodeRuntime({
      currentExecutable: '/bad/node',
      currentVersion: '26.5.0',
      pathValue: '/bad:/good:/later',
      pathDelimiter: ':',
      executableName: 'node',
      probeVersion,
    })).toBe('/good/node');
    expect(probeVersion.mock.calls.map(([candidate]) => candidate)).toEqual([
      '/good/node',
    ]);
  });

  it('fails clearly when PATH has no supported Node runtime', () => {
    expect(() => selectDogfoodNodeRuntime({
      currentExecutable: '/bad/node',
      currentVersion: '26.5.0',
      pathValue: '/bad:/older',
      pathDelimiter: ':',
      executableName: 'node',
      probeVersion: (candidate) => candidate === '/older/node' ? '18.20.0' : '26.5.0',
    })).toThrow(/Node 22\.23\.4\+ or 24\.22\.1\+/);
  });
});
