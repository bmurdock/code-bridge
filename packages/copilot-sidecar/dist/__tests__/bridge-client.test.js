import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient } from '../index';
const { fetchMock, HeadersStub } = vi.hoisted(() => {
    const mock = vi.fn();
    class HeadersStubImpl {
        values = new Map();
        constructor(init) {
            if (init && typeof init === 'object') {
                for (const [key, value] of Object.entries(init)) {
                    this.set(key, value);
                }
            }
        }
        set(key, value) {
            this.values.set(key.toLowerCase(), value);
        }
        get(key) {
            return this.values.get(key.toLowerCase()) ?? null;
        }
    }
    return { fetchMock: mock, HeadersStub: HeadersStubImpl };
});
vi.mock('node-fetch', () => ({
    __esModule: true,
    default: fetchMock,
    Headers: HeadersStub
}));
describe('BridgeClient', () => {
    afterEach(() => {
        fetchMock.mockReset();
    });
    it('decorates requests with bearer token when provided', async () => {
        const models = [{ id: 'x', vendor: 'copilot' }];
        fetchMock.mockResolvedValue({ ok: true, json: async () => models });
        const client = new BridgeClient(new URL('http://127.0.0.1:39217'), 'secret');
        const result = await client.listModels();
        expect(result).toEqual(models);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [requestUrl, options] = fetchMock.mock.calls[0];
        expect(String(requestUrl)).toBe('http://127.0.0.1:39217/models');
        expect(options?.headers.get('Authorization')).toBe('Bearer secret');
    });
    it('sends chat payload with SSE preference and falls back to JSON when unsupported', async () => {
        const response = { status: 'ok', received: 42, output: 'hello' };
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => response,
            headers: new HeadersStub({ 'content-type': 'application/json' })
        });
        const client = new BridgeClient(new URL('http://127.0.0.1:39217'), 'token');
        const payload = { prompt: 'hi there' };
        const result = await client.chat(payload);
        expect(result.status).toBe(response.status);
        expect(result.received).toBe(response.received);
        expect(result.output).toBe(response.output);
        expect(result.stats?.outputChars).toBe(response.output.length);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options?.method).toBe('POST');
        expect(options?.body).toBe(JSON.stringify(payload));
        expect(options?.headers.get('Content-Type')).toBe('application/json');
        expect(options?.headers.get('Accept')).toBe('text/event-stream');
    });
    it('consumes SSE stream and invokes handlers', async () => {
        const metadataEvent = 'event: metadata\ndata: {"model":{"id":"copilot"}}\n\n';
        const chunkEvent = 'event: chunk\ndata: {"text":"hello"}\n\n';
        const doneEvent = 'event: done\ndata: {"status":"completed"}\n\n';
        const body = {
            [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(metadataEvent);
                yield Buffer.from(chunkEvent);
                yield Buffer.from(doneEvent);
            },
            destroy: vi.fn()
        };
        fetchMock.mockResolvedValue({
            ok: true,
            headers: new HeadersStub({ 'content-type': 'text/event-stream' }),
            body
        });
        const client = new BridgeClient(new URL('http://127.0.0.1:39217'), undefined);
        const handlers = {
            onMetadata: vi.fn(),
            onChunk: vi.fn(),
            onDone: vi.fn()
        };
        const result = await client.chat({ prompt: 'stream please' }, undefined, handlers);
        expect(result.output).toBe('hello');
        expect(result.status).toBe('completed');
        expect(result.metadata).toEqual({ model: { id: 'copilot' } });
        expect(result.stats).toEqual({ chunks: 1, outputChars: 'hello'.length });
        expect(handlers.onMetadata).toHaveBeenCalledTimes(1);
        expect(handlers.onChunk).toHaveBeenCalledWith('hello');
        expect(handlers.onDone).toHaveBeenCalledWith({ status: 'completed' });
    });
    it('refetches without SSE when streaming reader fails', async () => {
        const failingBody = {
            [Symbol.asyncIterator]() {
                return {
                    next: async () => {
                        throw new Error('stream failure');
                    }
                };
            },
            destroy: vi.fn()
        };
        fetchMock
            .mockResolvedValueOnce({
            ok: true,
            headers: new HeadersStub({ 'content-type': 'text/event-stream' }),
            body: failingBody
        })
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'ok', received: 1, output: 'fallback' }),
            headers: new HeadersStub({ 'content-type': 'application/json' })
        });
        const client = new BridgeClient(new URL('http://127.0.0.1:39217'), undefined);
        const result = await client.chat({ prompt: 'retry' });
        expect(result.output).toBe('fallback');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [, firstOptions] = fetchMock.mock.calls[0];
        const [, secondOptions] = fetchMock.mock.calls[1];
        expect(firstOptions?.headers.get('Accept')).toBe('text/event-stream');
        expect(secondOptions?.headers.get('Accept')).toBeNull();
    });
    it('normalizes errors when bridge responds with failure status', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: 'Invalid request payload', details: { prompt: 'required' } })
        });
        const client = new BridgeClient(new URL('http://127.0.0.1:39217'), undefined);
        await expect(client.listModels()).rejects.toMatchObject({
            statusCode: 400,
            message: 'Invalid request payload',
            details: { prompt: 'required' }
        });
    });
});
//# sourceMappingURL=bridge-client.test.js.map