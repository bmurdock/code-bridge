#!/usr/bin/env node
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { BridgeClient } from './bridgeClient.js';
import { registerRoutes } from './routes.js';

async function main() {
  const cfg = loadConfig();
  const app = Fastify({ logger: true });
  const bridge = new BridgeClient(cfg);

  registerRoutes(app, bridge);

  app.get('/', async () => ({ status: 'ok', service: 'ollama-proxy', upstream: cfg.bridgeUrl }));

  await app.listen({ port: cfg.port, host: '127.0.0.1' });
  app.log.info(`Ollama proxy listening on http://127.0.0.1:${cfg.port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error starting ollama-proxy:', err);
  process.exitCode = 1;
});
