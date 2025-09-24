# Copilot Bridge for Codex CLI - Project Context

## Project Overview

This repository implements a bridge that exposes GitHub Copilot models to the Codex CLI via VS Code's Language Model API and the Model Context Protocol (MCP). It uses a two-part architecture:

1. **VS Code Bridge Extension**: Exposes VS Code's Language Model API over a local HTTP endpoint
2. **MCP Sidecar**: Forwards Codex CLI tool calls to the bridge and surfaces results to the terminal

The project enables developers to interact with Copilot models from a generic CLI environment while preserving consent, authentication, and billing flows managed by VS Code and GitHub.

## Project Structure

```
code-bridge/
├── packages/
│   ├── bridge-extension/     # VS Code extension exposing LM API over HTTP
│   └── copilot-sidecar/      # MCP server forwarding requests to the bridge
├── docs/
│   └── architecture.md       # Architecture planning document
├── AGENTS.md                 # Repository guidelines and coding conventions
├── project.prd.md            # Product requirements document
└── README.md                 # Project overview and getting started guide
```

## Key Components

### Bridge Extension (`packages/bridge-extension`)
- Exposes POST `/chat` endpoint for user prompts
- Exposes GET `/models` endpoint for model discovery
- Enforces localhost-only binding (127.0.0.1) for security
- Supports optional bearer token authentication
- Implements request throttling (max concurrent requests)
- Handles request size limits (default 32 KiB)
- Provides logging via VS Code's LogOutputChannel
- Integrates cancellation via CancellationTokenSource

### MCP Sidecar (`packages/copilot-sidecar`)
- Implements MCP tools `copilot.chat` and `copilot.listModels`
- Forwards requests to the bridge extension via HTTP
- Handles structured error propagation without crashing
- Supports configuration via environment variables:
  - `LM_BRIDGE_URL` - Bridge endpoint (default: http://127.0.0.1:39217)
  - `LM_BRIDGE_TOKEN` - Optional bearer token for authentication

## Development Environment

### Prerequisites
- Node.js 18+
- VS Code with Language Model API support
- GitHub Copilot extension
- OpenAI Codex CLI with MCP support

### Build Commands
- `npm install` - Install all dependencies
- `npm run build` - Compile both packages with TypeScript
- `npm run lint` - Run ESLint across workspaces
- `npm run test` - Execute Vitest test suites
- `npm run format` - Check code formatting with Prettier

### Package Scripts
Each package has its own scripts:
- `npm run build` - Compile TypeScript to JavaScript
- `npm run lint` - Run ESLint on source files
- `npm run test` - Execute package-specific tests

## Configuration

### Bridge Extension Configuration
Available via VS Code settings:
- `lmBridge.port` - Port for HTTP server (default: 39217)
- `lmBridge.authToken` - Optional bearer token for authentication
- `lmBridge.autoStart` - Auto-start server on extension activation
- `lmBridge.logLevel` - Logging level (error, warn, info, debug)
- `lmBridge.maxConcurrent` - Max concurrent LM requests (default: 4)
- `lmBridge.maxRequestBody` - Max request body size in bytes (default: 32768)

### Sidecar Configuration
Environment variables:
- `LM_BRIDGE_URL` - Bridge endpoint URL
- `LM_BRIDGE_TOKEN` - Optional bearer token
- `NODE_ENV` - Set to "test" for test environment

## Development Guidelines

### Coding Style
- TypeScript with strict mode enabled
- ES2022 target
- 2-space indentation
- Descriptive async function names (e.g., `handleChatRequest`)
- Use Zod schemas for runtime validation
- Avoid broad `any` types

### Testing
- Unit tests in `src/__tests__/` using Vitest
- Test files named `*.test.ts`
- Mock `vscode.lm` for bridge testing
- Integration tests for end-to-end flows

### Commit Guidelines
- Conventional, present-tense commits
- Reference docs when behavior changes
- PRs should describe functional impact
- Include screenshots/logs for UX changes when practical

## Current Status

The implementation focuses on core plumbing and developer experience scaffolding:
- Extension activation, configuration, HTTP routing, throttling, cancellation implemented
- `/chat` payloads validated with Zod with structured JSON error responses
- MCP sidecar connects via stdio and defines tools
- Workspace linting (ESLint/Prettier) and Vitest suites cover utility logic
- Streaming passthrough, model caching, observability, and CLI setup docs are next milestones

See `docs/architecture.md` for detailed planning and current milestones.