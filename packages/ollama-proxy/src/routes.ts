import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BridgeClient } from './bridgeClient.js';
import { parseOpenAiChatCompletionRequest } from './mapping.js';
import { pipeBridgeSseToOpenAi } from './sseToOpenAi.js';
import { selectModelId } from './modelSelect.js';

interface ChatRequestBody {
  Body: unknown;
}

const SYSTEM_FINGERPRINT = 'bridge-proxy';

export function registerRoutes(app: FastifyInstance, bridge: BridgeClient) {
  app.get('/v1/models', async (_req, reply) => {
    try {
      const models = await bridge.listModels();
      const now = Math.floor(Date.now() / 1000);
      return reply.send({
        object: 'list',
        data: models.map((model) => ({
          id: model.id,
          object: 'model',
          created: now,
          owned_by: model.vendor,
          permission: [],
          metadata: {
            family: model.family ?? null,
            version: model.version ?? null,
            max_input_tokens: model.maxInputTokens ?? null
          }
        })),
        has_more: false
      });
    } catch (error) {
      return sendProxyError(reply, 502, `Failed to list models: ${stringifyError(error)}`);
    }
  });

  app.post('/v1/chat/completions', async (req: FastifyRequest<ChatRequestBody>, reply) => {
    const parseResult = parseOpenAiChatCompletionRequest(req.body);
    if (!parseResult.ok) {
      return sendProxyError(reply, 400, parseResult.error.message, parseResult.error.code);
    }

    const { model, stream, chatPayload } = parseResult.value;

    let selectorId: string | undefined;
    let usedId: string | undefined;

    try {
      const modelSelection = await selectModelId(bridge, model);
      selectorId = modelSelection.id;
      usedId = modelSelection.usedId;
      if (!usedId) {
        return sendProxyError(reply, 404, `Model '${model}' not found`, 'model_not_found');
      }
    } catch (error) {
      return sendProxyError(reply, 502, `Model lookup failed: ${stringifyError(error)}`);
    }

    const payload = {
      ...chatPayload,
      model: selectorId ? { id: selectorId } : undefined
    };

    const effectiveModelId = usedId ?? model;

    if (stream) {
      return handleStreamingCompletion(reply, bridge, payload, effectiveModelId);
    }

    return handleJsonCompletion(reply, bridge, payload, effectiveModelId);
  });
}

function flushIfSupported(reply: FastifyReply) {
  const raw = reply.raw as { flush?: () => void };
  raw.flush?.();
}

async function handleStreamingCompletion(
  reply: FastifyReply,
  bridge: BridgeClient,
  payload: Parameters<BridgeClient['chatStream']>[0],
  modelId: string
) {
  reply.header('Content-Type', 'text/event-stream');
  reply.header('Cache-Control', 'no-cache');
  reply.header('Connection', 'keep-alive');

  let bridgeResponse: Response;
  try {
    bridgeResponse = await bridge.chatStream(payload);
  } catch (error) {
    return sendProxyError(reply, 502, `Bridge streaming request failed: ${stringifyError(error)}`);
  }

  const writeData = (data: string) => {
    reply.raw.write(`data: ${data}\n\n`);
    flushIfSupported(reply);
  };

  try {
    await pipeBridgeSseToOpenAi(bridgeResponse, modelId, writeData);
  } catch (error) {
    writeData(
      JSON.stringify({
        error: {
          message: `Failed to translate bridge stream: ${stringifyError(error)}`,
          type: 'proxy_error',
          code: null,
          param: null
        }
      })
    );
    writeData('[DONE]');
  } finally {
    reply.raw.end();
  }
}

async function handleJsonCompletion(
  reply: FastifyReply,
  bridge: BridgeClient,
  payload: Parameters<BridgeClient['chatJson']>[0],
  modelId: string
) {
  let result: Awaited<ReturnType<BridgeClient['chatJson']>>;
  try {
    result = await bridge.chatJson(payload);
  } catch (error) {
    return sendProxyError(reply, 502, `Bridge request failed: ${stringifyError(error)}`);
  }

  if (result.status !== 'ok') {
    return sendProxyError(reply, 502, 'Bridge returned an unexpected response');
  }

  const created = Math.floor(Date.now() / 1000);
  const completionId = formatCompletionId(randomUUID());
  const text = result.output ?? '';
  const completionTokens = estimateTokenCount(text);
  const promptTokens = 0;

  return reply.send({
    id: completionId,
    object: 'chat.completion',
    created,
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
          refusal: null,
          annotations: []
        },
        logprobs: null,
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: {
        cached_tokens: 0,
        audio_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0,
        accepted_prediction_tokens: 0,
        rejected_prediction_tokens: 0
      }
    },
    service_tier: 'default',
    system_fingerprint: SYSTEM_FINGERPRINT
  });
}

function sendProxyError(reply: FastifyReply, statusCode: number, message: string, code = 'proxy_error') {
  reply.status(statusCode);
  return reply.send({
    error: {
      message,
      type: code,
      param: null,
      code
    }
  });
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown error';
}

function formatCompletionId(id: string): string {
  return `chatcmpl-${id.replace(/-/g, '')}`;
}

function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
