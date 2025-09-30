import * as vscode from 'vscode';

export type BridgeStatusKind = 'stopped' | 'starting' | 'running' | 'error';

interface StatusUpdateOptions {
  readonly host?: string;
  readonly port?: number;
  readonly detail?: string;
}

let statusItem: vscode.StatusBarItem | undefined;

export function ensureStatusBar(): vscode.StatusBarItem {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.name = 'Copilot LM Bridge';
    statusItem.command = 'lmBridge.showActions';
    statusItem.tooltip = 'Manage Copilot LM Bridge server';
    statusItem.text = 'Copilot Bridge: Stopped';
    statusItem.show();
  }
  return statusItem;
}

export function updateStatus(kind: BridgeStatusKind, options: StatusUpdateOptions = {}): void {
  if (!statusItem) {
    return;
  }

  const { host, port, detail } = options;
  const location = host && port ? `${host}:${port}` : port ? `:${port}` : undefined;

  switch (kind) {
    case 'stopped':
      statusItem.text = 'Copilot Bridge: Stopped';
      statusItem.tooltip = createTooltip('Bridge server is not running', location);
      break;
    case 'starting':
      statusItem.text = location ? `Copilot Bridge: Starting @ ${location}` : 'Copilot Bridge: Starting';
      statusItem.tooltip = createTooltip('Starting bridge server', location, detail);
      break;
    case 'running':
      statusItem.text = location ? `Copilot Bridge: Listening @ ${location}` : 'Copilot Bridge: Listening';
      statusItem.tooltip = createTooltip('Bridge server is accepting requests', location, detail);
      break;
    case 'error':
      statusItem.text = location ? `Copilot Bridge: Error @ ${location}` : 'Copilot Bridge: Error';
      statusItem.tooltip = createTooltip('Bridge server encountered an error', location, detail);
      break;
    default: {
      const exhaustiveCheck: never = kind;
      return exhaustiveCheck;
    }
  }
}

export function disposeStatusBar(): void {
  statusItem?.dispose();
  statusItem = undefined;
}

function createTooltip(status: string, location?: string, detail?: string): string {
  const parts = [status];
  if (location) {
    parts.push(`Endpoint: http://${location}`);
  }
  if (detail) {
    parts.push(detail);
  }
  return parts.join('\n');
}
