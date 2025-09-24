import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BridgeClient, type BridgeModel } from './bridgeClient.js';
import {
  mapOllamaOptionsToBridge,
  foldSystemIntoPrompt,
  mapOllamaChatToBridgeMessages,
  type OllamaGenerateRequest,
  type OllamaChatRequest
} from './mapping.js';
import { pipeBridgeSseToOllamaNdjson } from './sseToNdjson.js';
import { selectModelId } from './modelSelect.js';

type FlushableReply = { flush?: () => void };

function writeNdjson(reply: FastifyReply) {
  return (line: string) => {
    reply.raw.write(line + '\n');
  };
}

function flushIfSupported(reply: FastifyReply) {
  const raw = reply.raw as FlushableReply;
  raw.flush?.();
}

export function registerRoutes(app: FastifyInstance, bridge: BridgeClient) {
  // Tags listing
  app.get('/api/tags', async (_req, reply) => {
    const models = await bridge.listModels();
    const payload = {
      models: models.map((model: BridgeModel) => ({
        name: model.id,
        modified_at: null,
        size: null,
        digest: null,
        details: {
          format: null,
          family: model.family ?? null,
          families: null,
          parameter_size: null,
          quantization_level: null
        }
      }))
    };
    return reply.send(payload);
  });

  // Generate
  app.post('/api/generate', async (req: FastifyRequest<{ Body: OllamaGenerateRequest }>, reply) => {
    const body = req.body || ({} as OllamaGenerateRequest);
    const stream = body.stream !== false;
    const { id: selectorId, usedId } = await selectModelId(bridge, body.model);
    const prompt = foldSystemIntoPrompt(body.system, body.prompt);

    const payload = {
      prompt,
      model: selectorId ? { id: selectorId } : undefined,
      options: mapOllamaOptionsToBridge(body.options)
    };

    if (stream) {
      reply.header('Content-Type', 'application/x-ndjson');
      // flush headers
      flushIfSupported(reply);
      const res = await bridge.chatStream(payload);
      await pipeBridgeSseToOllamaNdjson(res, 'generate', usedId || body.model, writeNdjson(reply));
      return reply.raw.end();
    }

    const out = await bridge.chatJson(payload);
    const modelId = usedId || body.model;
    return reply.send({
      model: modelId,
      created_at: new Date().toISOString(),
      response: out.output ?? '',
      done: true
    });
  });

  // Chat
  app.post('/api/chat', async (req: FastifyRequest<{ Body: OllamaChatRequest }>, reply) => {
    const body = req.body || ({} as OllamaChatRequest);
    const stream = body.stream !== false;
    const { id: selectorId, usedId } = await selectModelId(bridge, body.model);

    const messages = mapOllamaChatToBridgeMessages(body.messages || []);
    const payload = {
      messages,
      model: selectorId ? { id: selectorId } : undefined,
      options: mapOllamaOptionsToBridge(body.options)
    };

    if (stream) {
      reply.header('Content-Type', 'application/x-ndjson');
      flushIfSupported(reply);
      const res = await bridge.chatStream(payload);
      await pipeBridgeSseToOllamaNdjson(res, 'chat', usedId || body.model, writeNdjson(reply));
      return reply.raw.end();
    }

    const out = await bridge.chatJson(payload);
    const modelId = usedId || body.model;
    return reply.send({
      model: modelId,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: out.output ?? '' },
      done: true
    });
  });
}
