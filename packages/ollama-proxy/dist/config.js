export function loadConfig() {
    const port = Number(process.env.OLLAMA_PROXY_PORT || 11434);
    const bridgeUrl = process.env.LM_BRIDGE_URL || 'http://127.0.0.1:39217';
    const bridgeToken = process.env.LM_BRIDGE_TOKEN || undefined;
    return { port, bridgeUrl, bridgeToken };
}
//# sourceMappingURL=config.js.map