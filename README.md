# Copilot Bridge for Codex CLI

This repository contains a two-part implementation that exposes GitHub Copilot models to the Codex CLI via VS Code's Language Model API and the Model Context Protocol (MCP).

## Packages

- `packages/bridge-extension`: VS Code extension exposing `/models` and `/chat` endpoints over HTTP, enforcing local access controls.
- `packages/copilot-sidecar`: MCP server that forwards Codex CLI tool calls to the bridge and surfaces results to the terminal.
- `packages/ollama-proxy`: Ollama-compatible HTTP proxy that translates `/api/generate`, `/api/chat`, and `/api/tags` to the bridge’s `/chat` and `/models`.

## Getting Started

1. Install dependencies with `npm install`.
2. Build the workspace with `npm run build`.
3. Run lint checks via `npm run lint` (per-package ESLint driven by the root config).
4. Execute unit tests with `npm run test` (Vitest across workspaces).
5. Launch the VS Code extension using the debugger and confirm the bridge server starts.
6. Run the MCP sidecar via `npx copilot-mcp` and register it with Codex CLI (see `docs/integration-guide.md`).
7. Review contributor expectations in [`AGENTS.md`](AGENTS.md) before opening PRs.

## Ollama-compatible Proxy (packages/ollama-proxy)

The Ollama proxy is a standalone service that looks like an Ollama server to clients, but forwards requests to the VS Code Language Model API through the bridge-extension.

- Upstream (bridge): `/models`, `/chat`
- Downstream (Ollama clients): `/api/generate`, `/api/chat`, `/api/tags`
- Streaming: translates bridge SSE events (metadata/chunk/done/error) to Ollama NDJSON lines

### When to use it

Use the proxy when you want existing Ollama-compatible tools to talk to the VS Code Language Model API without changes.

### Install & run

1) Install dependencies once at repo root:
   - `npm install`

2) Start the proxy (point at your bridge server):
   - `LM_BRIDGE_URL=http://127.0.0.1:39217 OLLAMA_PROXY_PORT=11434 npm run dev -w packages/ollama-proxy`
   - Proxy listens at `http://127.0.0.1:11434`

3) Optional: run with the included mock bridge (for local validation without VS Code):
   - Terminal A: `npm run dev:mock -w packages/ollama-proxy` (mock on `http://127.0.0.1:39218`)
   - Terminal B: `LM_BRIDGE_URL=http://127.0.0.1:39218 OLLAMA_PROXY_PORT=11434 npm run dev -w packages/ollama-proxy`

Environment variables:

- `LM_BRIDGE_URL` (default `http://127.0.0.1:39217`)
- `LM_BRIDGE_TOKEN` (optional bearer token passed to bridge)
- `OLLAMA_PROXY_PORT` (default `11434`)

### Endpoints

- `POST /api/generate`
  - Maps to bridge `/chat` using the `prompt`
  - Streaming (default): emits NDJSON lines `{ model, created_at, response, done: false }` and a final `{ done: true }`
  - Non-stream: returns one JSON `{ model, created_at, response, done: true }`

- `POST /api/chat`
  - Maps to bridge `/chat` using `messages`
  - Streaming: NDJSON lines `{ model, created_at, message: { role: 'assistant', content }, done: false }` + final line `{ done: true }`
  - Non-stream: returns `{ model, created_at, message: { role: 'assistant', content }, done: true }`

- `GET /api/tags`
  - Maps to bridge `/models` and returns `{ models: [{ name, details.family, ... }] }` (limited metadata)

### Options mapping and roles

- Supported options → bridge: `temperature`, `num_predict` → `maxOutputTokens`
- Unsupported options (e.g., `top_p`, `top_k`, penalties, `seed`, `stop`, images, tools, `keep_alive`) are ignored
- Roles:
  - `system` content is prefixed into the next user/assistant message as `"System: ..."`
  - `tool` messages are folded into a user message as `"Tool: ..."`

### Limitations

- Token-level stats (eval_count/durations) are not available from the bridge and are omitted
- Images, tools, and other Ollama features not supported by the bridge are ignored or folded into plain text
- Model lookup prefers exact id, then simple family/vendor heuristic, else defers to the bridge’s default model

### Quick curl examples (against the proxy)

- List models: `curl http://127.0.0.1:11434/api/tags`
- Generate (stream): `curl -N http://127.0.0.1:11434/api/generate -d '{"model":"<id>","prompt":"hello"}'`
- Generate (non-stream): `curl http://127.0.0.1:11434/api/generate -d '{"model":"<id>","prompt":"hello","stream":false}'`
- Chat (stream): `curl -N http://127.0.0.1:11434/api/chat -d '{"model":"<id>","messages":[{"role":"user","content":"hi"}]}'`
- Chat (non-stream): `curl http://127.0.0.1:11434/api/chat -d '{"model":"<id>","messages":[{"role":"user","content":"hi"}],"stream":false}'`

## Status

The current code base now delivers end-to-end streaming with room left for polish:

- Extension activation, configuration handling, HTTP routing, throttling, cancellation, and streaming LM invocation are implemented.
- `/chat` payloads are validated with Zod and respond with structured JSON errors when inputs fail schema checks.
- The MCP sidecar forwards requests via stdio, surfaces bridge errors, and emits incremental tool progress (including final status summaries and output metrics) while consuming streamed responses.
- Workspace linting and Vitest suites cover utility logic plus streaming, fallback, and progress scenarios; broader integration and observability tests are still planned.
- Bridge logs structured chat lifecycle events (including duration, output size, and streaming chunk counts) with configurable verbosity via `lmBridge.logLevel`, making streaming/session diagnostics easier.
- Upcoming focus areas include richer logging controls, model caching, and expanded CLI integration docs.

## Streaming Contract

Clients can opt into streaming by setting `Accept: text/event-stream` on `/chat` requests. The bridge will return a Server-Sent Events (SSE) feed using the following event types:

- `metadata` – sent once per request with model details and request metadata.
- `chunk` – emitted for each partial text fragment; JSON payload shape `{ "text": string }`.
- `done` – indicates completion with `{ "status": "completed" | "cancelled" }`.
- `error` – terminal fault with `{ "statusCode": number, "message": string }` (no further events follow).

If a client omits the SSE `Accept` header, the bridge falls back to the original JSON response format. The sidecar automatically prefers SSE, streams partial tokens to Codex via MCP progress notifications, and retries with JSON if streaming is unavailable or fails with a transport error.

See `docs/architecture.md` for the planning details derived from `project.prd.md`.
