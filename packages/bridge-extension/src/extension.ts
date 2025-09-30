import * as vscode from 'vscode';
import { BridgeServer } from './server';
import { BridgeConfig, getBridgeConfig } from './config';
import { disposeStatusBar, ensureStatusBar, updateStatus } from './status';
import { determineAutoStartAction } from './autoStart';

let server: BridgeServer | undefined;
let currentConfig: BridgeConfig | undefined;
let output: vscode.LogOutputChannel | undefined;

interface BridgeActionPick extends vscode.QuickPickItem {
  action: 'start' | 'stop' | 'restart' | 'settings' | 'logs' | 'health';
}

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export async function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Copilot LM Bridge', { log: true });
  logBridgeEvent('info', 'extension.activate', {});

  currentConfig = getBridgeConfig();
  ensureStatusBar();
  refreshStatus();

  server = new BridgeServer(currentConfig, output);

  if (currentConfig.autoStart) {
    await startBridge('auto-start');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('lmBridge.openLogs', async () => {
      if (output) {
        output.show(true);
      } else {
        await vscode.window.showInformationMessage('Bridge log channel is not available yet.');
      }
    }),
    vscode.commands.registerCommand('lmBridge.checkHealth', async () => {
      await checkBridgeHealth();
    }),
    vscode.commands.registerCommand('lmBridge.showActions', async () => {
      logBridgeEvent('debug', 'command.showActions.invoke');
      await showBridgeActions();
    }),
    vscode.commands.registerCommand('lmBridge.start', async () => {
      currentConfig = getBridgeConfig();
      if (!output) {
        return;
      }
      if (!server) {
        server = new BridgeServer(currentConfig, output);
      }
      logBridgeEvent('info', 'command.start.invoke', {
        host: currentConfig.host,
        port: currentConfig.port
      });
      await startBridge('manual start');
    }),
    vscode.commands.registerCommand('lmBridge.stop', async () => {
      currentConfig = currentConfig ?? getBridgeConfig();
      if (!server || !currentConfig) {
        await vscode.window.showInformationMessage('Copilot LM Bridge server is not running.');
        logBridgeEvent('warn', 'command.stop.skipped', { reason: 'not_running' });
        refreshStatus();
        return;
      }

      if (currentConfig.autoStart) {
        const response = await vscode.window.showWarningMessage(
          'Auto-start is enabled. The server may start again when the configuration changes. Stop the bridge anyway?',
          { modal: true },
          'Stop Anyway',
          'Cancel'
        );
        if (response !== 'Stop Anyway') {
          logBridgeEvent('info', 'command.stop.cancelled', { reason: 'autoStartEnabled' });
          return;
        }
      }

      logBridgeEvent('info', 'command.stop.invoke', {
        host: currentConfig.host,
        port: currentConfig.port
      });
      await stopBridge();
    }),
    vscode.commands.registerCommand('lmBridge.restart', async () => {
      currentConfig = getBridgeConfig();
      if (!output) {
        return;
      }
      if (!server) {
        server = new BridgeServer(currentConfig, output);
      }

      updateStatus('starting', {
        host: currentConfig.host,
        port: currentConfig.port,
        detail: 'Restarting bridge server'
      });

      try {
        await server.restart(currentConfig);
        logBridgeEvent('info', 'command.restart.success', {
          host: currentConfig.host,
          port: currentConfig.port
        });
        refreshStatus();
      } catch (error) {
        logBridgeEvent('error', 'command.restart.failure', {
          host: currentConfig.host,
          port: currentConfig.port,
          error: formatError(error)
        });
        updateStatus('error', {
          host: currentConfig.host,
          port: currentConfig.port,
          detail: formatError(error)
        });
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('lmBridge')) {
        return;
      }

      const previous = currentConfig;
      const updated = getBridgeConfig();
      currentConfig = updated;
      if (!output || !server) {
        if (output) {
          output.warn('Bridge server unavailable; deferring configuration application');
        }
        return;
      }

      logBridgeEvent('info', 'config.changed', {
        host: updated.host,
        port: updated.port
      });
      if (server.isRunning()) {
        updateStatus('starting', {
          host: updated.host,
          port: updated.port,
          detail: 'Applying updated configuration'
        });
      } else {
        updateStatus('stopped', {
          host: updated.host,
          port: updated.port
        });
      }

      try {
        await server.applyConfig(updated);
        const action = determineAutoStartAction(previous, updated, server.isRunning());
        switch (action) {
          case 'start':
            await startBridge('config change (autoStart enabled)');
            break;
          case 'stop':
            await stopBridge();
            break;
          case 'none':
            refreshStatus();
            break;
        }
      } catch (error) {
        logBridgeEvent('error', 'config.apply.failure', {
          host: updated.host,
          port: updated.port,
          error: formatError(error)
        });
        updateStatus('error', {
          host: updated.host,
          port: updated.port,
          detail: formatError(error)
        });
      }
    }),
    new vscode.Disposable(() => {
      void stopBridge();
    })
  );
}

export async function deactivate(): Promise<void> {
  await stopBridge();
  disposeStatusBar();
  output?.dispose();
  logBridgeEvent('info', 'extension.deactivate');
  server = undefined;
  currentConfig = undefined;
  output = undefined;
}

async function startBridge(reason: string): Promise<void> {
  if (!output || !currentConfig) {
    return;
  }

  if (!server) {
    server = new BridgeServer(currentConfig, output);
  }

  if (server.isRunning()) {
    refreshStatus();
    return;
  }

  updateStatus('starting', {
    host: currentConfig.host,
    port: currentConfig.port,
    detail: `Starting bridge (${reason})`
  });

  try {
    await server.start();
    logBridgeEvent('info', 'bridge.start.success', {
      reason,
      host: currentConfig.host,
      port: currentConfig.port
    });
    refreshStatus();
  } catch (error) {
    logBridgeEvent('error', 'bridge.start.failure', {
      reason,
      host: currentConfig.host,
      port: currentConfig.port,
      error: formatError(error)
    });
    updateStatus('error', {
      host: currentConfig.host,
      port: currentConfig.port,
      detail: formatError(error)
    });
  }
}

async function stopBridge(): Promise<void> {
  if (!server || !currentConfig) {
    return;
  }

  if (!server.isRunning()) {
    refreshStatus();
    return;
  }

  try {
    await server.stop();
    logBridgeEvent('info', 'bridge.stop.success', {
      host: currentConfig.host,
      port: currentConfig.port
    });
  } catch (error) {
    logBridgeEvent('error', 'bridge.stop.failure', {
      host: currentConfig.host,
      port: currentConfig.port,
      error: formatError(error)
    });
  } finally {
    refreshStatus();
  }
}

async function showBridgeActions(): Promise<void> {
  currentConfig = currentConfig ?? getBridgeConfig();
  const running = server?.isRunning() ?? false;

  const picks: BridgeActionPick[] = [];
  if (running) {
    picks.push({ label: '$(debug-stop) Stop Bridge', detail: 'Shut down the HTTP bridge server', action: 'stop' });
    picks.push({ label: '$(debug-restart) Restart Bridge', detail: 'Restart the bridge without changing settings', action: 'restart' });
  } else {
    picks.push({ label: '$(debug-start) Start Bridge', detail: 'Launch the HTTP bridge server', action: 'start' });
  }
  picks.push({ label: '$(gear) Bridge Settings…', detail: 'Open lmBridge.* settings', action: 'settings' });
  picks.push({ label: '$(output) View Bridge Logs', detail: 'Open the Copilot LM Bridge output channel', action: 'logs' });
  picks.push({ label: '$(pulse) Check Bridge Health', detail: 'Ping the /healthz endpoint to verify responsiveness', action: 'health' });

  const selection = await vscode.window.showQuickPick(picks, {
    title: 'Copilot LM Bridge',
    placeHolder: running ? 'Bridge is listening' : 'Bridge is stopped'
  });

  if (!selection) {
    return;
  }

  switch (selection.action) {
    case 'start':
      await vscode.commands.executeCommand('lmBridge.start');
      break;
    case 'stop':
      await vscode.commands.executeCommand('lmBridge.stop');
      break;
    case 'restart':
      await vscode.commands.executeCommand('lmBridge.restart');
      break;
    case 'settings':
      await vscode.commands.executeCommand('workbench.action.openSettings', 'lmBridge');
      break;
    case 'logs':
      await vscode.commands.executeCommand('lmBridge.openLogs');
      break;
    case 'health':
      await vscode.commands.executeCommand('lmBridge.checkHealth');
      break;
  }
}

async function checkBridgeHealth(): Promise<void> {
  currentConfig = currentConfig ?? getBridgeConfig();
  const address = server?.getAddress();
  const host = address?.host ?? currentConfig.host;
  const port = address?.port ?? currentConfig.port;
  const url = `http://${host}:${port}/healthz`;

  const progressTitle = `Checking Copilot LM Bridge health @ ${host}:${port}`;
  try {
    const payload = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressTitle
      },
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }
          return (await response.json()) as {
            status?: string;
            activeRequests?: number;
            queuedRequests?: number;
          };
        } finally {
          clearTimeout(timeout);
        }
      }
    );

    const status = payload?.status ?? 'unknown';
    const active = typeof payload?.activeRequests === 'number' ? payload.activeRequests : undefined;
    const queued = typeof payload?.queuedRequests === 'number' ? payload.queuedRequests : undefined;
    const lines = [
      `Status: ${status}`,
      active !== undefined ? `Active requests: ${active}` : undefined,
      queued !== undefined ? `Queued requests: ${queued}` : undefined
    ]
      .filter(Boolean)
      .join('\n');

    logBridgeEvent('info', 'bridge.health.success', {
      host,
      port,
      status,
      activeRequests: active,
      queuedRequests: queued
    });

    const action = await vscode.window.showInformationMessage(
      [`Copilot LM Bridge is responsive at http://${host}:${port}`, lines].filter(Boolean).join('\n'),
      'Open Logs'
    );
    if (action === 'Open Logs') {
      await vscode.commands.executeCommand('lmBridge.openLogs');
    }
  } catch (error) {
    const message = `Bridge health check failed for http://${host}:${port}: ${formatError(error)}`;
    logBridgeEvent('warn', 'bridge.health.failure', {
      host,
      port,
      error: formatError(error)
    });
    const action = await vscode.window.showErrorMessage(message, 'Open Logs');
    if (action === 'Open Logs') {
      await vscode.commands.executeCommand('lmBridge.openLogs');
    }
  }
}

function logBridgeEvent(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  if (!output) {
    return;
  }
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    ...data
  };
  const message = JSON.stringify(payload);

  switch (level) {
    case 'trace':
      if (typeof (output as vscode.LogOutputChannel & { trace?: (message: string) => void }).trace === 'function') {
        (output as vscode.LogOutputChannel & { trace: (message: string) => void }).trace(message);
      } else {
        output.debug?.(message);
      }
      break;
    case 'debug':
      if (typeof output.debug === 'function') {
        output.debug(message);
      } else {
        output.info(message);
      }
      break;
    case 'info':
      output.info(message);
      break;
    case 'warn':
      output.warn(message);
      break;
    case 'error':
      output.error(message);
      break;
  }
}

function refreshStatus(): void {
  if (!currentConfig) {
    return;
  }

  const address = server?.getAddress();
  const host = address?.host ?? currentConfig.host;
  const port = address?.port ?? currentConfig.port;

  if (server?.isRunning()) {
    updateStatus('running', { host, port });
  } else {
    updateStatus('stopped', { host, port });
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
