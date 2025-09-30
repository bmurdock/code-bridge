# Architecture Plan

## Workstreams

1. **VS Code LM Bridge Extension**
 - Provide HTTP interface around `vscode.lm` API: GET `/models`, POST `/chat`.
- Configuration surface via `lmBridge.host`, `lmBridge.port`, `lmBridge.authToken`, `lmBridge.autoStart` (setting flips start/stop automatically).
 - Status bar item mirrors bridge lifecycle, showing the active endpoint and opening an action picker for start/stop/restart/configuration shortcuts, log access, and the built-in health check; command invocations emit structured JSON log entries.
 - Local-only binding with optional bearer auth.
 - Concurrency gating and request size limits.
  - Log channel with level support. *(basic logging is in place; rotation/levels still TODO)*
  - Graceful shutdown and cancellation tied to HTTP connections. *(cancellation currently tied to request close; graceful shutdown polish pending)*

2. **MCP Copilot Sidecar**
 - MCP server exposing `copilot.chat` and `copilot.listModels` tools.
 - Streams responses through Codex CLI using incremental tool outputs. *(implemented via SSE pipeline)*
  - Bridges cancellation and errors without crashing.
  - Config via environment (`LM_BRIDGE_URL`, auth token, timeouts).

3. **Codex CLI Integration Assets**
   - Provide instructions and templates for registering MCP server.
   - Profile mapping samples for CLI `-m` flag.

## Milestones

- **M0: Scaffold & Tooling** *(Completed)*
  - Initialize npm workspaces, TypeScript configs, lint/test placeholders. ✅
  - Document architecture and developer setup. ✅

- **M1: VS Code Bridge MVP** *(Mostly complete; streaming/log polish pending)*
  - HTTP server skeleton with route handlers. ✅
  - Wire up VS Code extension activation and configuration. ✅
  - Implement LM request execution, cancellation linkage, and payload validation. ✅
  - Streaming responses and advanced logging/metrics remain outstanding.

- **M2: MCP Sidecar MVP** *(Completed for non-streaming flows)*
  - CLI entry point using `@modelcontextprotocol/sdk`. ✅
  - Tool definitions forwarding to bridge endpoints. ✅
  - Error normalization and detail surfacing added post-MVP.

- **M3: Streaming, Cancellation, Security** *(Completed)*
  - Cancellation propagation (bridge ↔ sidecar). ✅
  - Optional bearer auth. ✅
  - Streaming passthrough. ✅

- **M4: DX Polish** *(In progress)*
  - Logging, error telemetry, docs, samples. ⏳ *(structured chat events + sidecar progress summaries landed)*
  - Codex CLI integration playbooks. ✅ (see `docs/integration-guide.md`)

## Open Questions

- Which Copilot model families should appear by default?
- Should CLI streaming be opt-in or always on?
- Do we need observability endpoints beyond logs for v1?
- Should extension auto-start server on VS Code launch?

## Risks & Mitigations

- **Authentication failures:** rely on VS Code Copilot extension flows; surface clear errors via both HTTP and MCP results.
- **Concurrency overload:** enforce request queue with max parallel sends; consider fallback response 503.
- **Transport drift:** leverage MCP TypeScript SDK docs for compatibility.

## References

- Model Context Protocol TypeScript SDK – tooling approach and transport patterns.
