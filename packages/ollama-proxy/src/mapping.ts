import type { ChatPayload } from './bridgeClient.js';

type SupportedRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

type MessageContent = string | Array<{ type: string; text?: string }>;

export interface OpenAIChatCompletionMessage {
  role: SupportedRole;
  content?: MessageContent;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
  function_call?: unknown;
}

export interface OpenAIChatCompletionRequest {
  model?: unknown;
  messages?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  n?: unknown;
  stream?: unknown;
  tools?: unknown;
  response_format?: unknown;
}

export interface ParsedChatCompletionRequest {
  model: string;
  stream: boolean;
  chatPayload: ChatPayload;
}

export interface ParseError {
  message: string;
  code: string;
}

export type ParseResult = { ok: true; value: ParsedChatCompletionRequest } | { ok: false; error: ParseError };

export function parseOpenAiChatCompletionRequest(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') {
    return invalid('Invalid request payload: expected JSON object');
  }

  const req = body as OpenAIChatCompletionRequest;

  if (typeof req.model !== 'string' || !req.model.trim()) {
    return invalid('Missing required field "model"');
  }

  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return invalid('Missing required field "messages"');
  }

  if (req.n !== undefined && req.n !== 1) {
    return invalid('Only n=1 is supported');
  }

  if (req.tools !== undefined) {
    return invalid('Tool calls are not supported by the bridge');
  }

  if (req.response_format !== undefined) {
    return invalid('Custom response formats are not supported by the bridge');
  }

  const mappedMessages = mapMessages(req.messages as unknown[]);
  if (!mappedMessages.ok) {
    return invalid(mappedMessages.error);
  }

  const options = mapOptions(req.temperature, req.max_tokens);

  const payload: ChatPayload = {
    messages: mappedMessages.value,
    options
  };

  const stream = Boolean(req.stream);

  return {
    ok: true,
    value: {
      model: req.model,
      stream,
      chatPayload: payload
    }
  };
}

function mapOptions(temperature: unknown, maxTokens: unknown): ChatPayload['options'] {
  const options: ChatPayload['options'] = {};
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    options.temperature = temperature;
  }
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    options.maxOutputTokens = Math.floor(maxTokens);
  }
  return Object.keys(options).length ? options : undefined;
}

function mapMessages(messages: unknown[]): { ok: true; value: NonNullable<ChatPayload['messages']> } | { ok: false; error: string } {
  const out: NonNullable<ChatPayload['messages']> = [];
  let systemBuffer = '';

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Each message must be an object' };
    }

    const message = raw as OpenAIChatCompletionMessage;
    if (!isSupportedRole(message.role)) {
      return { ok: false, error: `Unsupported message role: ${String(message.role)}` };
    }

    if (message.tool_calls || message.function_call) {
      return { ok: false, error: 'Tool calls and function calls are not supported' };
    }

    const text = extractMessageText(message.content);
    if (!text.ok) {
      return { ok: false, error: text.error };
    }

    const trimmed = text.value.trim();
    if (message.role === 'system' || message.role === 'developer') {
      if (trimmed) {
        systemBuffer = systemBuffer ? `${systemBuffer}\n${trimmed}` : trimmed;
      }
      continue;
    }

    let content = trimmed;
    if (systemBuffer) {
      content = `System: ${systemBuffer}${content ? `\n\n${content}` : ''}`;
      systemBuffer = '';
    }

    if (message.role === 'assistant') {
      out.push({ role: 'assistant', content });
    } else if (message.role === 'user') {
      out.push({ role: 'user', content });
    } else if (message.role === 'tool') {
      const prefixed = content ? `Tool: ${content}` : 'Tool: (empty result)';
      out.push({ role: 'user', content: prefixed });
    }
  }

  if (systemBuffer) {
    out.unshift({ role: 'user', content: `System: ${systemBuffer}` });
  }

  if (out.length === 0) {
    return { ok: false, error: 'Messages resolved to an empty conversation' };
  }

  return { ok: true, value: out };
}

function extractMessageText(content: MessageContent | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (content === undefined || content === null) {
    return { ok: true, value: '' };
  }

  if (typeof content === 'string') {
    return { ok: true, value: content }; // allow empty strings
  }

  if (!Array.isArray(content)) {
    return { ok: false, error: 'Message content must be a string or array of content parts' };
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object' || typeof part.type !== 'string') {
      return { ok: false, error: 'Invalid message content part' };
    }
    if (part.type === 'text' || part.type === 'input_text') {
      if (typeof part.text === 'string') {
        parts.push(part.text);
      }
    } else {
      return { ok: false, error: `Unsupported content part type: ${part.type}` };
    }
  }

  return { ok: true, value: parts.join('') };
}

function isSupportedRole(role: unknown): role is SupportedRole {
  return role === 'system' || role === 'developer' || role === 'user' || role === 'assistant' || role === 'tool';
}

function invalid(message: string): { ok: false; error: ParseError } {
  return { ok: false, error: { message, code: 'invalid_request_error' } };
}
