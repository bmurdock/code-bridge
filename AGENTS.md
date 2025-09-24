# Repository Guidelines

## Project Structure & Module Organization
The workspace roots live beside `package.json` and `tsconfig.base.json`; documentation belongs in `docs/` (see `docs/architecture.md` for cross-checking changes). Bridge extension sources sit in `packages/bridge-extension/src/`, with `extension.ts` wiring activation and `server.ts` exposing HTTP endpoints; sidecar logic resides in `packages/copilot-sidecar/src/`, where `index.ts` registers MCP tools and proxies bridge calls. Keep tests close to the code in `src/__tests__/`, and publish only TypeScript outputs into each package’s `dist/` directory.

## Build, Test, and Development Commands
Run `npm install` once per machine to hydrate the workspace. Use `npm run build` to compile both packages with `tsc`, `npm run test` to execute Vitest suites, `npm run lint` to apply ESLint across workspaces, and `npm run format` to check Prettier formatting. Favor local iteration with `npm run build -- --watch` when adjusting TypeScript entry points.

## Coding Style & Naming Conventions
Author code in strict TypeScript targeting ES2022 with two-space indentation. Prefer descriptive async names such as `handleChatRequest`, funnel logging through `vscode.window.createOutputChannel`, and pass option objects instead of positional parameters. Avoid `any`; validate bridge and sidecar payloads using shared `zod` schemas before forwarding.

## Testing Guidelines
Vitest powers unit coverage; add new specs under `src/__tests__/` alongside features using the `*.test.ts` suffix. Mock `vscode.lm` when validating bridge `/chat` flows and exercise sidecar responses for model discovery, streaming, and error normalization. Before landing features, run `npm run test` and capture edge cases like cancellation and 413 payload rejections.

## Commit & Pull Request Guidelines
Write conventional, present-tense commit subjects (e.g., `feat: add bridge auth gate`) and keep changes scoped. PRs should summarize functional impact, list manual or automated checks, call out related docs (especially updates to `docs/architecture.md`), and attach screenshots or logs for UX-facing tweaks. Highlight open questions from the PRD to keep reviewers aligned.

## Architecture Overview
The bridge extension exposes VS Code commands, while the MCP sidecar proxies requests to the bridge over HTTP; keep the contract synchronized via shared types. Align server handlers with documented endpoints in `server.ts`, and reflect structural shifts promptly in `docs/` so downstream automation stays accurate.
