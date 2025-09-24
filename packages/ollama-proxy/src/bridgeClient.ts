import type { ProxyConfig } from './config.js';

export interface BridgeModel {
  id: string;
  vendor: string;
  family?: string;
  version?: string;
  maxInputTokens?: number;
}

export interface BridgeChatJsonResponse {
  status: string;
  output?: string;
}

export type ChatPayload = {
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: { id?: string; vendor?: string; family?: string; version?: string };
  options?: { temperature?: number; maxOutputTokens?: number };
};

export class BridgeClient {
  constructor(private cfg: ProxyConfig) {}

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra || {}) };
    if (this.cfg.bridgeToken) h['Authorization'] = `Bearer ${this.cfg.bridgeToken}`;
    return h;
  }

  async listModels(): Promise<BridgeModel[]> {
    const url = new URL('/models', this.cfg.bridgeUrl);
    const res = await fetch(url, { headers: this.buildHeaders() });
    if (!res.ok) throw new Error(`Bridge /models failed: ${res.status}`);
    return (await res.json()) as BridgeModel[];
  }

  async chatJson(payload: ChatPayload): Promise<BridgeChatJsonResponse> {
    const url = new URL('/chat', this.cfg.bridgeUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Bridge /chat failed: ${res.status} ${text}`);
    return JSON.parse(text) as BridgeChatJsonResponse;
  }

  async chatStream(payload: ChatPayload): Promise<Response> {
    const url = new URL('/chat', this.cfg.bridgeUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Bridge /chat stream failed: ${res.status} ${text}`);
    }
    return res;
  }
}
