# Codex CLI Integration Guide

This guide walks through connecting the Codex CLI to the Copilot bridge so that Copilot models can be invoked from the terminal. It assumes you already have VS Code with the GitHub Copilot extension installed and an active Copilot subscription.

## 1. Build the workspace

```bash
npm install
npm run build
```

The build step emits TypeScript output for both the VS Code bridge extension and the MCP sidecar into their respective `dist/` folders.

## 2. Launch the VS Code bridge

1. Open this repository in VS Code.
2. Use the *Run and Debug* panel to launch the “Copilot LM Bridge” debug configuration. This starts the extension, which in turn hosts the HTTP bridge on `127.0.0.1` using the configured `lmBridge.port` (default `39217`).
3. Optionally set `lmBridge.authToken` in VS Code settings if you want the bridge to enforce bearer authentication. Record the token value; you will provide the same token to the sidecar in a later step.

You can confirm the bridge is running by visiting `http://127.0.0.1:39217/healthz` from a browser or `curl`. A healthy bridge reports {"status":"ok"}.

## 3. Launch the MCP sidecar

In a terminal, start the sidecar using the compiled entry point.

```bash
LM_BRIDGE_URL=http://127.0.0.1:39217 \
LM_BRIDGE_TOKEN="<optional token>" \
npx copilot-mcp
```

Environment variables:

- `LM_BRIDGE_URL` — base URL for the bridge. Only change this if you customized the port or bound the bridge to a different host.
- `LM_BRIDGE_TOKEN` — optional bearer token that must match `lmBridge.authToken` if you enabled bridge authentication.

The sidecar exposes two MCP tools:

- `copilot.listModels` for enumerating available Copilot models.
- `copilot.chat` for sending prompts and receiving streamed completions.

## 4. Register the sidecar with Codex CLI

With the sidecar running, add it to Codex CLI. The exact command can vary with your CLI profile setup; the following example registers the sidecar and points a Copilot profile at it.

```bash
codex mcp add copilot local --command "npx" --args "copilot-mcp"

# Optional profile that maps Codex -m flag to the MCP tool
codex profiles set copilot --model copilot.chat
```

Verify Codex can call the tools:

```bash
codex mcp call copilot copilot.listModels

codex chat -m copilot "Explain what this project does"
```

During chat requests the sidecar streams partial output back to the CLI. Cancellation in Codex (Ctrl+C) propagates to the bridge and interrupts the underlying Copilot request.

## 5. Troubleshooting

- **Bridge returns 401 Unauthorized:** Ensure `LM_BRIDGE_TOKEN` matches the VS Code `lmBridge.authToken` value.
- **Bridge unreachable:** Confirm the bridge debug session is running and that your firewall allows local loopback traffic.
- **Streaming falls back to JSON:** The sidecar automatically retries with non-streaming responses if the SSE connection fails. Check the VS Code output channel for detailed errors.

Refer to `docs/architecture.md` for high-level design context and to `README.md` for a repository overview.
