import type { BridgeConfig } from './config';

export type AutoStartAction = 'start' | 'stop' | 'none';

export function determineAutoStartAction(
  previous: BridgeConfig | undefined,
  next: BridgeConfig,
  serverRunning: boolean
): AutoStartAction {
  if (next.autoStart && !serverRunning) {
    return 'start';
  }

  if (!next.autoStart && serverRunning && previous?.autoStart !== next.autoStart) {
    return 'stop';
  }

  return 'none';
}
