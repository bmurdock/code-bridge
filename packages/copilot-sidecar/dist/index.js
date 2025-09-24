#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fetch, { Headers } from 'node-fetch';
import { BridgeError, normalizeBridgeError, coerceBridgeError, summarizeErrorDetails } from './errors.js';
export class BridgeClient {
    baseUrl;
    token;
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    async listModels() {
        const response = await fetch(new URL('/models', this.baseUrl), {
            headers: this.buildHeaders()
        });
        if (!response.ok) {
            const text = await safeReadText(response);
            const normalized = normalizeBridgeError(response.status, text);
            throw new BridgeError(normalized.statusCode, normalized.message, text, normalized.details);
        }
        return (await response.json());
    }
    async chat(payload, signal, handlers) {
        let response = await this.fetchChat(payload, signal, true);
        if (response.ok && this.isEventStreamResponse(response)) {
            try {
                return await this.consumeEventStream(response, handlers);
            }
            catch (error) {
                if (error instanceof BridgeError && error.statusCode < 500) {
                    throw error;
                }
                // Streaming failed unexpectedly, attempt JSON fallback.
                response = await this.fetchChat(payload, signal, false);
            }
        }
        if (!response.ok) {
            const text = await safeReadText(response);
            const normalized = normalizeBridgeError(response.status, text);
            throw new BridgeError(normalized.statusCode, normalized.message, text, normalized.details);
        }
        return await this.consumeJsonResponse(response);
    }
    buildHeaders(extra = {}) {
        const headers = new Headers(extra);
        if (this.token) {
            headers.set('Authorization', `Bearer ${this.token}`);
        }
        return headers;
    }
    async fetchChat(payload, signal, preferStream) {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (preferStream) {
            headers['Accept'] = 'text/event-stream';
        }
        return await fetch(new URL('/chat', this.baseUrl), {
            method: 'POST',
            headers: this.buildHeaders(headers),
            body: JSON.stringify(payload),
            signal
        });
    }
    isEventStreamResponse(response) {
        const contentType = response.headers.get('content-type');
        return Boolean(contentType && contentType.toLowerCase().includes('text/event-stream'));
    }
    async consumeJsonResponse(response) {
        const body = (await response.json());
        return {
            status: typeof body.status === 'string' ? body.status : 'ok',
            received: typeof body.received === 'number' ? body.received : Date.now(),
            output: typeof body.output === 'string' ? body.output : undefined,
            metadata: body.metadata,
            stats: body.output
                ? {
                    outputChars: body.output.length
                }
                : undefined
        };
    }
    async consumeEventStream(response, handlers) {
        if (!response.body) {
            throw new BridgeError(502, 'Bridge streaming response missing body', undefined);
        }
        const stream = response.body;
        const decoder = new TextDecoder();
        let buffer = '';
        const state = {
            output: '',
            status: 'completed',
            chunks: 0
        };
        try {
            for await (const chunk of stream) {
                buffer += decoder.decode(chunk, { stream: true });
                buffer = await this.processEventStreamBuffer(buffer, handlers, state);
            }
            // Flush remaining buffered data.
            buffer += decoder.decode(new Uint8Array(), { stream: false });
            buffer = await this.processEventStreamBuffer(buffer, handlers, state, true);
        }
        catch (error) {
            if (error instanceof BridgeError) {
                throw error;
            }
            throw new BridgeError(502, 'Failed to read streaming response', String(error));
        }
        finally {
            const body = response.body;
            if (typeof body?.destroy === 'function') {
                body.destroy();
            }
            else if (typeof body?.cancel === 'function') {
                void body.cancel();
            }
        }
        return {
            status: state.status,
            received: Date.now(),
            output: state.output,
            metadata: state.metadata,
            stats: {
                chunks: state.chunks || undefined,
                outputChars: state.output.length || undefined
            }
        };
    }
    async processEventStreamBuffer(buffer, handlers, state, flush = false) {
        buffer = buffer.replace(/\r\n/g, '\n');
        let delimiterIndex = buffer.indexOf('\n\n');
        while (delimiterIndex !== -1) {
            const rawEvent = buffer.slice(0, delimiterIndex);
            buffer = buffer.slice(delimiterIndex + 2);
            await this.handleSseEvent(rawEvent, handlers, state);
            delimiterIndex = buffer.indexOf('\n\n');
        }
        if (flush && buffer.trim().length > 0) {
            await this.handleSseEvent(buffer, handlers, state);
            return '';
        }
        return buffer;
    }
    async handleSseEvent(rawEvent, handlers, state) {
        if (!rawEvent.trim()) {
            return;
        }
        const lines = rawEvent.split('\n');
        let eventName = 'message';
        const dataLines = [];
        for (const line of lines) {
            if (!line || line.startsWith(':')) {
                continue;
            }
            const separator = line.indexOf(':');
            if (separator === -1) {
                continue;
            }
            const field = line.slice(0, separator).trim();
            let value = line.slice(separator + 1);
            if (value.startsWith(' ')) {
                value = value.slice(1);
            }
            if (field === 'event') {
                eventName = value;
            }
            else if (field === 'data') {
                dataLines.push(value);
            }
        }
        const dataPayload = dataLines.join('\n');
        const parsedData = dataPayload ? this.safeParseJson(dataPayload, eventName) : undefined;
        const parsedRecord = this.asRecord(parsedData);
        switch (eventName) {
            case 'metadata': {
                state.metadata = parsedData;
                await Promise.resolve(handlers?.onMetadata?.(parsedData));
                break;
            }
            case 'chunk': {
                const text = typeof parsedRecord?.text === 'string' ? parsedRecord.text : '';
                state.output += text;
                state.chunks += 1;
                if (text) {
                    await Promise.resolve(handlers?.onChunk?.(text));
                }
                break;
            }
            case 'done': {
                const status = typeof parsedRecord?.status === 'string' ? parsedRecord.status : 'completed';
                state.status = status;
                await Promise.resolve(handlers?.onDone?.({ status }));
                break;
            }
            case 'error': {
                const statusCode = typeof parsedRecord?.statusCode === 'number' ? parsedRecord.statusCode : 502;
                const message = typeof parsedRecord?.message === 'string' ? parsedRecord.message : 'Streaming error';
                await Promise.resolve(handlers?.onError?.({ statusCode, message }));
                throw new BridgeError(statusCode, message, dataPayload);
            }
            default:
                // Ignore unknown events but allow handlers to inspect metadata if desired.
                await Promise.resolve(handlers?.onMetadata?.({ event: eventName, data: parsedData }));
                break;
        }
    }
    safeParseJson(data, eventName) {
        try {
            return JSON.parse(data);
        }
        catch (error) {
            throw new BridgeError(502, `Invalid JSON payload for ${eventName} event`, data, {
                cause: error instanceof Error ? error.message : String(error)
            });
        }
    }
    asRecord(value) {
        if (typeof value === 'object' && value !== null) {
            return value;
        }
        return undefined;
    }
}
const server = new McpServer({
    name: 'copilot-mcp-sidecar',
    version: '0.1.0'
});
const baseUrl = new URL(process.env.LM_BRIDGE_URL ?? 'http://127.0.0.1:39217');
const token = process.env.LM_BRIDGE_TOKEN;
const bridge = new BridgeClient(baseUrl, token);
registerCopilotTools(server, bridge);
export function registerCopilotTools(targetServer, copilotBridge) {
    targetServer.registerTool('copilot.listModels', {
        title: 'List Copilot Models',
        description: 'Retrieve Copilot language models exposed via the VS Code bridge.',
        inputSchema: {
            vendor: z.string().optional(),
            family: z.string().optional()
        }
    }, async ({ vendor, family }) => {
        try {
            const models = await copilotBridge.listModels();
            const filtered = models.filter((model) => {
                if (vendor && model.vendor !== vendor) {
                    return false;
                }
                if (family && model.family !== family) {
                    return false;
                }
                return true;
            });
            const summary = filtered.length
                ? `Returned ${filtered.length} model${filtered.length === 1 ? '' : 's'}.`
                : 'No models matched the provided filters.';
            return {
                content: [
                    {
                        type: 'text',
                        text: summary
                    }
                ],
                structuredContent: {
                    models: filtered
                }
            };
        }
        catch (error) {
            return buildErrorResult(error);
        }
    });
    targetServer.registerTool('copilot.chat', {
        title: 'Send Copilot Chat Prompt',
        description: 'Forward a prompt to the Copilot bridge and return the completion.',
        inputSchema: {
            prompt: z.string().min(1, 'prompt is required'),
            model: z
                .object({
                id: z.string().optional(),
                vendor: z.string().optional(),
                family: z.string().optional(),
                version: z.string().optional()
            })
                .optional()
        }
    }, async ({ prompt, model }, context) => {
        const controller = new AbortController();
        context.signal.addEventListener('abort', () => controller.abort());
        const progressToken = context._meta?.progressToken;
        let progressCount = 0;
        let latestStatus = 'running';
        let latestMetadata;
        const sendProgress = async (message) => {
            if (!progressToken || !message.trim()) {
                return;
            }
            try {
                await context.sendNotification({
                    method: 'notifications/progress',
                    params: {
                        progressToken,
                        progress: ++progressCount,
                        message
                    }
                });
            }
            catch {
                // Ignore progress notification failures to avoid interrupting the request.
            }
        };
        try {
            const response = await copilotBridge.chat({
                prompt,
                id: model?.id,
                vendor: model?.vendor,
                family: model?.family,
                version: model?.version
            }, controller.signal, {
                onMetadata: async (metadata) => {
                    latestMetadata = metadata;
                },
                onChunk: async (chunk) => {
                    await sendProgress(chunk);
                },
                onDone: async ({ status }) => {
                    latestStatus = status;
                },
                onError: async ({ message }) => {
                    await sendProgress(message);
                }
            });
            const outputText = response.output ?? '';
            const statsSummary = [];
            if (response.stats?.outputChars) {
                statsSummary.push(`${response.stats.outputChars} chars`);
            }
            if (response.stats?.chunks) {
                statsSummary.push(`${response.stats.chunks} chunks`);
            }
            const summaryMessage = [`Status: ${response.status ?? latestStatus}`]
                .concat(statsSummary.length ? [`Details: ${statsSummary.join(', ')}`] : [])
                .join(' — ');
            await sendProgress(summaryMessage);
            return {
                content: [
                    {
                        type: 'text',
                        text: outputText
                    }
                ],
                structuredContent: {
                    status: response.status ?? latestStatus,
                    received: response.received,
                    output: response.output,
                    metadata: response.metadata ?? latestMetadata,
                    stats: response.stats
                }
            };
        }
        catch (error) {
            const normalized = coerceBridgeError(error);
            await sendProgress(`Status: failed — ${normalized.message}`);
            return buildErrorResult(error);
        }
    });
}
export async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
if (process.env.NODE_ENV !== 'test') {
    main().catch((error) => {
        const normalized = coerceBridgeError(error);
        console.error('Fatal MCP sidecar error:', normalized.message);
        if (normalized.details) {
            console.error('Details:', normalized.details);
        }
        process.exitCode = 1;
    });
}
async function safeReadText(response) {
    try {
        return await response.text();
    }
    catch {
        return undefined;
    }
}
export function buildErrorResult(error) {
    const normalized = coerceBridgeError(error);
    const detailSummary = summarizeErrorDetails(normalized.details);
    const textLines = [normalized.message];
    if (detailSummary) {
        textLines.push('', detailSummary);
    }
    return {
        isError: true,
        content: [
            {
                type: 'text',
                text: textLines.join('\n').trim()
            }
        ],
        structuredContent: normalized.details ? { details: normalized.details } : undefined
    };
}
//# sourceMappingURL=index.js.map