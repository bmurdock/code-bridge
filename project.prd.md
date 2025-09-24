# **Title**

Copilot Bridge for Codex CLI via VS Code LM API and MCP Sidecar

# **Overview**

This project delivers a bridge allowing the OpenAI Codex CLI (or any MCP-capable client) to use GitHub Copilot models exposed through VS Code’s Language Model (LM) API. The design introduces a two-part architecture: a VS Code extension that exposes the LM API over a local HTTP endpoint, and a lightweight MCP sidecar server that maps Codex CLI tool requests to that endpoint. This enables developers to interact with Copilot models from a generic CLI environment while preserving consent, authentication, and billing flows managed by VS Code and GitHub.

# **Objectives**

* Enable Codex CLI to use GitHub Copilot models through a compliant bridge.
* Preserve VS Code’s LM API consent, authentication, and vendor restrictions.
* Provide a secure, robust local interface (127.0.0.1) for MCP clients.
* Support model discovery and metadata (id, vendor, family, version, token limits).
* Ensure streaming, cancellation, and error handling are correctly surfaced to CLI users.
* Deliver maintainable, modular architecture (VS Code extension + MCP sidecar).

# **Scope**

* Implementation of a VS Code extension (“Bridge”) exposing LM API via HTTP.
* Implementation of an MCP sidecar server forwarding requests from Codex CLI to the bridge.
* Support for `/chat` endpoint (chat completions) and `/models` endpoint (model discovery).
* Handling of cancellation tokens, graceful shutdown, and request back-pressure.
* Security controls for local-only binding, optional bearer token authentication.
* Logging via VS Code’s LogOutputChannel, configurable port, vendor, and auto-start option.

# **Out of Scope**

* Providing direct, unauthenticated Copilot APIs outside of VS Code.
* Reverse-engineering Copilot APIs or bypassing GitHub billing/authentication.
* Support for non-Copilot providers beyond those VS Code registers (e.g., LM Studio).
* Advanced Copilot features such as file edits, tool-calling, or agent workflows.
* Deployment packaging for enterprise distribution (VSIX signing must be considered separately).

# **Requirements**

* **VS Code Extension**

  * Expose POST `/chat` for user prompts; accept `prompt`, `vendor`, `family`, `id`, `version`.
  * Expose GET `/models` returning available models with `id`, `vendor`, `family`, `version`, `maxInputTokens`.
  * Enforce 127.0.0.1 binding; configurable port via `lmBridge.port`.
  * Optional bearer auth via `LM_BRIDGE_TOKEN`.
  * Integrate cancellation via `CancellationTokenSource`, tied to client connection close.
  * Limit request body size (default 32 KiB).
  * Back-pressure or concurrency limit (e.g., max 4 concurrent `sendRequest`).
  * Logging via `LogOutputChannel` with rotation or log level config.
  * Handle graceful shutdown (close sockets, emit error frame).

* **MCP Sidecar**

  * Implement tool `copilot.chat` forwarding prompts to `/chat`.
  * Implement tool `copilot.listModels` calling `/models`.
  * Structured error handling: never crash on bridge errors, return error text to client.
  * Configurable bridge base URL via `LM_BRIDGE_URL` (default [http://127.0.0.1:39217](http://127.0.0.1:39217)).
  * Optional streaming of partial outputs as Codex CLI supports incremental tool results.

* **Codex CLI Integration**

  * Register MCP server with Codex CLI (`codex mcp add …`).
  * Support invocation of `copilot.chat` and `copilot.listModels`.
  * Allow CLI profiles to map Codex `-m` flags to Copilot MCP tools.

# **Dependencies**

* **VS Code** with LM API support (`vscode.lm`).
* **GitHub Copilot extension** (manages auth, subscription, and model registration).
* **OpenAI Codex CLI** with MCP support enabled.
* **Model Context Protocol (MCP) SDK** for Node.
* Local dev environment with Node.js 18+ and TypeScript build toolchain.

# **Acceptance Criteria**

* Bridge runs as a VS Code extension, binds to configured port, responds to `/models` and `/chat`.
* MCP sidecar successfully maps `copilot.chat` → `/chat` and `copilot.listModels` → `/models`.
* CLI user can run a Codex command that invokes Copilot through the bridge and receive streamed output.
* Cancelling the CLI request interrupts Copilot generation (verified with CancellationToken).
* Oversized payloads (>32 KiB) are rejected with HTTP 413.
* Log output shows errors, request lifecycle, and graceful shutdown messages.
* Security verified: server is not accessible outside localhost without explicit opt-in, bearer token works if enabled.

# **Open Questions**

* *Information missing: Which Copilot model families and versions should be prioritized (e.g., `gpt-4o`, `claude-3.7-sonnet`, etc.)?*
* *Information missing: Should partial streaming be mandatory for CLI experience or remain optional?*
* *Information missing: Is there a need for metrics/observability endpoints (`/metrics` for Prometheus) in initial scope?*
* *Information missing: Should bridge auto-start on VS Code launch be enabled by default, or left as opt-in?*
