# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a two-part bridge system that exposes GitHub Copilot models to the Codex CLI via VS Code's Language Model API and the Model Context Protocol (MCP):

- **VS Code Extension** (`packages/bridge-extension`): Exposes `/models` and `/chat` endpoints over HTTP, enforcing local access controls
- **MCP Sidecar** (`packages/copilot-sidecar`): Forwards Codex CLI tool calls to the bridge and surfaces results to the terminal

## Development Commands

All commands run from the repository root using npm workspaces:

- `npm install` - Install all workspace dependencies
- `npm run build` - Compile both packages with TypeScript
- `npm run lint` - Run ESLint across all workspaces
- `npm run test` - Execute Vitest suites across workspaces
- `npm run format` - Check formatting with Prettier

### Package-specific commands:
- **Bridge Extension**: Build with F5 debug launch in VS Code, or `npm run compile` in `packages/bridge-extension`
- **MCP Sidecar**: Run via `npm run dev` in `packages/copilot-sidecar` or use the built binary `npx copilot-mcp`

## Architecture

### Bridge Extension (`packages/bridge-extension/src/`)
- `extension.ts` - VS Code extension activation and lifecycle
- `server.ts` - HTTP server hosting `/models` and `/chat` endpoints
- `chat-utils.ts` - Request validation and LM API integration utilities

### MCP Sidecar (`packages/copilot-sidecar/src/`)
- `index.ts` - MCP server implementation with `copilot.chat` and `copilot.listModels` tools
- `errors.ts` - Error normalization and structured error handling

## Configuration

### Bridge Extension Settings
- `lmBridge.port` (default: 39217) - HTTP server port
- `lmBridge.authToken` - Optional bearer token for authentication
- `lmBridge.autoStart` (default: false) - Auto-start server on extension activation
- `lmBridge.logLevel` - Logging verbosity level
- `lmBridge.maxConcurrent` (default: 4) - Maximum concurrent LM requests
- `lmBridge.maxRequestBody` (default: 32768) - Request body size limit in bytes

### MCP Sidecar Environment
- `LM_BRIDGE_URL` (default: http://127.0.0.1:39217) - Bridge server URL
- `LM_BRIDGE_TOKEN` - Bearer token for bridge authentication

## Code Style

- TypeScript with strict mode, ES2022 target
- 2-space indentation, descriptive async function names
- Use Zod schemas for runtime validation (see `chat-utils.ts` and `errors.ts`)
- Avoid `any` types, prefer explicit typing
- Logging via `vscode.window.createOutputChannel` for the bridge extension

## Testing

- Unit tests in `src/__tests__/` using Vitest
- Test files named `*.test.ts`
- Current coverage includes bridge chat utilities and sidecar error normalization
- Mock `vscode.lm` API for bridge testing
- Integration tests should cover `/models`, `/chat`, cancellation, and error paths

## Integration Flow

1. VS Code extension starts HTTP bridge on configured port
2. MCP sidecar registers with Codex CLI via `codex mcp add`
3. CLI invokes `copilot.chat` or `copilot.listModels` tools
4. Sidecar forwards requests to bridge `/chat` and `/models` endpoints
5. Bridge calls VS Code LM API and returns structured responses
6. Results flow back through sidecar to CLI with proper error handling

## Status & TODOs

Current implementation covers core functionality. Outstanding items include:
- Streaming response passthrough (bridge → sidecar → CLI)
- Advanced logging and observability
- CLI integration documentation and setup guides