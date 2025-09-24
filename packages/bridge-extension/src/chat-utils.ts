import * as vscode from 'vscode';
import { z } from 'zod';

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']).default('user'),
  content: z.string().min(1, 'content is required')
});

const chatModelSelectorSchema = z
  .object({
    id: z.string().min(1).optional(),
    vendor: z.string().min(1).optional(),
    family: z.string().min(1).optional(),
    version: z.string().min(1).optional()
  })
  .optional();

const chatOptionsSchema = z
  .object({
    temperature: z.number().finite().optional(),
    maxOutputTokens: z.number().int().positive().optional()
  })
  .optional();

const chatRequestSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    messages: z.array(chatMessageSchema).nonempty().optional(),
    model: chatModelSelectorSchema,
    options: chatOptionsSchema
  })
  .refine((value) => Boolean(value.prompt) || Boolean(value.messages), {
    message: 'prompt or messages is required'
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface NormalizedError {
  statusCode: number;
  message: string;
}

const FALLBACK_LANGUAGE_MODEL_ERROR: NormalizedError = {
  statusCode: 502,
  message: 'Language model request failed'
};

const LANGUAGE_MODEL_ERROR_MAP: Map<string, NormalizedError> = initializeErrorMap();

export function normalizeLanguageModelError(
  error: unknown,
  output: vscode.LogOutputChannel
): NormalizedError {
  if (error instanceof vscode.LanguageModelError) {
    output.warn(`Language model error (${error.code}): ${error.message}`);
    const normalized =
      LANGUAGE_MODEL_ERROR_MAP.get(error.code) ??
      LANGUAGE_MODEL_ERROR_MAP.get(error.code.toLowerCase()) ??
      FALLBACK_LANGUAGE_MODEL_ERROR;
    return normalized;
  }

  output.error(`Unhandled chat error: ${String(error)}`);
  return { statusCode: 500, message: 'Internal Server Error' };
}

export function createChatMessages(
  payload: ChatRequest
): vscode.LanguageModelChatMessage[] {
  const messages: vscode.LanguageModelChatMessage[] = [];

  if (payload.messages && payload.messages.length > 0) {
    for (const entry of payload.messages) {
      if (!entry || typeof entry.content !== 'string') {
        continue;
      }

      if (entry.role === 'assistant') {
        messages.push(vscode.LanguageModelChatMessage.Assistant(entry.content));
      } else {
        messages.push(vscode.LanguageModelChatMessage.User(entry.content));
      }
    }
  } else if (typeof payload.prompt === 'string') {
    messages.push(vscode.LanguageModelChatMessage.User(payload.prompt));
  }

  return messages;
}

export function createRequestOptions(
  payload: ChatRequest
): vscode.LanguageModelChatRequestOptions | undefined {
  if (!payload.options) {
    return undefined;
  }

  const modelOptions: Record<string, unknown> = {};

  if (typeof payload.options.maxOutputTokens === 'number') {
    modelOptions.maxOutputTokens = payload.options.maxOutputTokens;
  }

  if (typeof payload.options.temperature === 'number') {
    modelOptions.temperature = payload.options.temperature;
  }

  if (Object.keys(modelOptions).length === 0) {
    return undefined;
  }

  return { modelOptions };
}

export function parseChatRequest(raw: unknown): ChatRequest {
  return chatRequestSchema.parse(raw);
}

export function initializeErrorMap(): Map<string, NormalizedError> {
  const entries: Array<[string, NormalizedError]> = [
    ['provider_not_found', { statusCode: 404, message: 'Requested model not available' }],
    ['model_not_found', { statusCode: 404, message: 'Requested model not available' }],
    ['not_allowed', { statusCode: 403, message: 'Model access not permitted' }],
    ['consent_required', { statusCode: 403, message: 'Model access not permitted' }],
    ['quota_exceeded', { statusCode: 429, message: 'Quota exceeded' }]
  ];

  try {
    const notFoundCode = vscode.LanguageModelError.NotFound().code;
    entries.push([notFoundCode, { statusCode: 404, message: 'Requested model not available' }]);
  } catch {
    // Ignore if the static constructor is unavailable.
  }

  try {
    const noPermissionsCode = vscode.LanguageModelError.NoPermissions().code;
    entries.push([noPermissionsCode, { statusCode: 403, message: 'Model access not permitted' }]);
  } catch {
    // Ignore if the static constructor is unavailable.
  }

  try {
    const blockedCode = vscode.LanguageModelError.Blocked().code;
    entries.push([blockedCode, { statusCode: 429, message: 'Quota exceeded' }]);
  } catch {
    // Ignore if the static constructor is unavailable.
  }

  return new Map(entries);
}
