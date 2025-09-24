import * as vscode from 'vscode';
import { BridgeServer, BridgeServerOptions } from './server';

let server: BridgeServer | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Copilot LM Bridge', { log: true });
  output.info('Activating Copilot LM Bridge extension');

  const config = getOptions();
  server = new BridgeServer(config, output);

  if (config.autoStart) {
    try {
      await server.start();
      output.info('Bridge server started automatically');
    } catch (error) {
      output.error(`Failed to auto-start bridge: ${String(error)}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('lmBridge.restart', async () => {
      if (!server) {
        server = new BridgeServer(getOptions(), output);
      }
      await server.restart(getOptions());
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('lmBridge')) {
        return;
      }

      const options = getOptions();
      output.info('Configuration changed; applying new settings');
      await server?.applyConfig(options);
    }),
    { dispose: () => server?.stop() }
  );
}

export async function deactivate(): Promise<void> {
  await server?.stop();
  server = undefined;
}

function getOptions(): BridgeServerOptions {
  const config = vscode.workspace.getConfiguration('lmBridge');
  return {
    port: config.get('port', 39217),
    authToken: config.get<string | null>('authToken', null) ?? undefined,
    autoStart: config.get('autoStart', false),
    logLevel: config.get('logLevel', 'info'),
    maxConcurrent: config.get('maxConcurrent', 4),
    maxRequestBody: config.get('maxRequestBody', 32 * 1024)
  };
}
