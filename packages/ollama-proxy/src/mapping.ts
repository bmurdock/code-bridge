import type { ChatPayload } from './bridgeClient.js';

export interface OllamaGenerateRequest {
  model: string;
  prompt?: string;
  stream?: boolean;
  options?: Record<string, unknown>;
  system?: string;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  options?: Record<string, unknown>;
}

export function mapOllamaOptionsToBridge(ollamaOptions: Record<string, unknown> | undefined): ChatPayload['options'] {
  if (!ollamaOptions) return undefined;
  const out: ChatPayload['options'] = {};
  // Map only the supported ones
  if (typeof ollamaOptions.temperature === 'number') out.temperature = ollamaOptions.temperature;
  if (typeof ollamaOptions.num_predict === 'number') out.maxOutputTokens = Math.max(1, Math.floor(ollamaOptions.num_predict));
  return Object.keys(out).length ? out : undefined;
}

export function foldSystemIntoPrompt(system: string | undefined, prompt: string | undefined): string | undefined {
  if (!system) return prompt;
  const sys = system.trim();
  if (!prompt) return sys ? `System: ${sys}` : undefined;
  return sys ? `System: ${sys}\n\n${prompt}` : prompt;
}

export function mapOllamaChatToBridgeMessages(messages: OllamaChatMessage[]): ChatPayload['messages'] {
  const out: NonNullable<ChatPayload['messages']> = [];
  let systemBuffer = '';

  for (const m of messages) {
    if (m.role === 'system') {
      systemBuffer += (systemBuffer ? '\n' : '') + m.content;
      continue;
    }
    let content = m.content;
    if (systemBuffer) {
      content = `System: ${systemBuffer}\n\n${content}`;
      systemBuffer = '';
    }
    if (m.role === 'assistant') out.push({ role: 'assistant', content });
    else if (m.role === 'user' || m.role === 'tool') out.push({ role: 'user', content: m.role === 'tool' ? `Tool: ${content}` : content });
  }

  if (systemBuffer) {
    out.unshift({ role: 'user', content: `System: ${systemBuffer}` });
  }

  return out;
}
