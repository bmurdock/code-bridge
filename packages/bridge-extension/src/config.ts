import * as vscode from 'vscode';

export interface BridgeConfig {
  readonly host: string;
  readonly port: number;
  readonly authToken?: string;
  readonly autoStart: boolean;
  readonly logLevel: 'error' | 'warn' | 'info' | 'debug';
  readonly maxConcurrent: number;
  readonly maxRequestBody: number;
}

export function getBridgeConfig(): BridgeConfig {
  const config = vscode.workspace.getConfiguration('lmBridge');

  return {
    host: config.get('host', '127.0.0.1').trim() || '127.0.0.1',
    port: config.get('port', 39217),
    authToken: config.get<string | null>('authToken', null) ?? undefined,
    autoStart: config.get('autoStart', false),
    logLevel: config.get('logLevel', 'info'),
    maxConcurrent: config.get('maxConcurrent', 4),
    maxRequestBody: config.get('maxRequestBody', 32 * 1024)
  } satisfies BridgeConfig;
}
