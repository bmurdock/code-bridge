import { describe, expect, it } from 'vitest';
import { determineAutoStartAction } from '../autoStart';
import type { BridgeConfig } from '../config';

const baseConfig: BridgeConfig = {
  host: '127.0.0.1',
  port: 39217,
  authToken: undefined,
  autoStart: false,
  logLevel: 'info',
  maxConcurrent: 4,
  maxRequestBody: 32_768
};

function createConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return { ...baseConfig, ...overrides };
}

describe('determineAutoStartAction', () => {
  it('requests start when autoStart enabled and server stopped', () => {
    const previous = createConfig({ autoStart: false });
    const next = createConfig({ autoStart: true });

    const action = determineAutoStartAction(previous, next, false);

    expect(action).toBe('start');
  });

  it('does not restart when already running with autoStart enabled', () => {
    const previous = createConfig({ autoStart: true });
    const next = createConfig({ autoStart: true });

    const action = determineAutoStartAction(previous, next, true);

    expect(action).toBe('none');
  });

  it('requests stop when autoStart disabled while running', () => {
    const previous = createConfig({ autoStart: true });
    const next = createConfig({ autoStart: false });

    const action = determineAutoStartAction(previous, next, true);

    expect(action).toBe('stop');
  });

  it('keeps server running when autoStart already disabled', () => {
    const previous = createConfig({ autoStart: false });
    const next = createConfig({ autoStart: false });

    const action = determineAutoStartAction(previous, next, true);

    expect(action).toBe('none');
  });
});
