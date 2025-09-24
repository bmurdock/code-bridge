"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const server_1 = require("./server");
let server;
async function activate(context) {
    const output = vscode.window.createOutputChannel('Copilot LM Bridge', { log: true });
    output.info('Activating Copilot LM Bridge extension');
    const config = getOptions();
    server = new server_1.BridgeServer(config, output);
    if (config.autoStart) {
        try {
            await server.start();
            output.info('Bridge server started automatically');
        }
        catch (error) {
            output.error(`Failed to auto-start bridge: ${String(error)}`);
        }
    }
    context.subscriptions.push(vscode.commands.registerCommand('lmBridge.restart', async () => {
        if (!server) {
            server = new server_1.BridgeServer(getOptions(), output);
        }
        await server.restart(getOptions());
    }), vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration('lmBridge')) {
            return;
        }
        const options = getOptions();
        output.info('Configuration changed; applying new settings');
        await server?.applyConfig(options);
    }), { dispose: () => server?.stop() });
}
async function deactivate() {
    await server?.stop();
    server = undefined;
}
function getOptions() {
    const config = vscode.workspace.getConfiguration('lmBridge');
    return {
        port: config.get('port', 39217),
        authToken: config.get('authToken', null) ?? undefined,
        autoStart: config.get('autoStart', false),
        logLevel: config.get('logLevel', 'info'),
        maxConcurrent: config.get('maxConcurrent', 4),
        maxRequestBody: config.get('maxRequestBody', 32 * 1024)
    };
}
//# sourceMappingURL=extension.js.map