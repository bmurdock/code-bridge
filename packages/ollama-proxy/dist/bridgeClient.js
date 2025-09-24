export class BridgeClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    buildHeaders(extra) {
        const h = { ...(extra || {}) };
        if (this.cfg.bridgeToken)
            h['Authorization'] = `Bearer ${this.cfg.bridgeToken}`;
        return h;
    }
    async listModels() {
        const url = new URL('/models', this.cfg.bridgeUrl);
        const res = await fetch(url, { headers: this.buildHeaders() });
        if (!res.ok)
            throw new Error(`Bridge /models failed: ${res.status}`);
        return (await res.json());
    }
    async chatJson(payload) {
        const url = new URL('/chat', this.cfg.bridgeUrl);
        const res = await fetch(url, {
            method: 'POST',
            headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        if (!res.ok)
            throw new Error(`Bridge /chat failed: ${res.status} ${text}`);
        return JSON.parse(text);
    }
    async chatStream(payload) {
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
//# sourceMappingURL=bridgeClient.js.map