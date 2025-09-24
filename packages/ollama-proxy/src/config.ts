export interface ProxyConfig {
  port: number;
  bridgeUrl: string; // e.g., http://127.0.0.1:39217
  bridgeToken?: string;
}

export function loadConfig(): ProxyConfig {
  const port = Number(process.env.OLLAMA_PROXY_PORT || 11434);
  const bridgeUrl = process.env.LM_BRIDGE_URL || 'http://127.0.0.1:39217';
  const bridgeToken = process.env.LM_BRIDGE_TOKEN || undefined;
  return { port, bridgeUrl, bridgeToken };
}

