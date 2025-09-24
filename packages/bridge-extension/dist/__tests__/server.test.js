"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const test_helpers_1 = require("./test-helpers");
vitest_1.vi.mock('vscode', () => (0, test_helpers_1.createVscodeModuleMock)());
const server_1 = require("../server");
(0, vitest_1.describe)('BridgeServer logging', () => {
    let output;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.resetAllMocks();
        output = (0, test_helpers_1.createLogOutputChannelMock)();
        (0, test_helpers_1.setOutputChannelMock)(output);
        (0, test_helpers_1.resetMockedLm)();
    });
    (0, vitest_1.it)('honors configured log level threshold', () => {
        const server = new server_1.BridgeServer({
            port: 1,
            authToken: undefined,
            autoStart: false,
            logLevel: 'warn',
            maxConcurrent: 4,
            maxRequestBody: 32_768
        }, output);
        server.log('info', 'informational');
        server.log('error', 'critical');
        (0, vitest_1.expect)(output.info).not.toHaveBeenCalled();
        (0, vitest_1.expect)(output.error).toHaveBeenCalledWith('critical');
    });
    (0, vitest_1.it)('updates log threshold when configuration changes', async () => {
        const server = new server_1.BridgeServer({
            port: 1,
            authToken: undefined,
            autoStart: false,
            logLevel: 'info',
            maxConcurrent: 4,
            maxRequestBody: 32_768
        }, output);
        await server.applyConfig({
            port: 1,
            authToken: undefined,
            autoStart: false,
            logLevel: 'debug',
            maxConcurrent: 4,
            maxRequestBody: 32_768
        });
        server.log('debug', 'detailed');
        (0, vitest_1.expect)(output.debug).toHaveBeenCalledWith('detailed');
    });
    (0, vitest_1.it)('emits structured JSON payloads via log events', () => {
        const server = new server_1.BridgeServer({
            port: 1,
            authToken: undefined,
            autoStart: false,
            logLevel: 'info',
            maxConcurrent: 4,
            maxRequestBody: 32_768
        }, output);
        server.logEvent('info', 'test.event', { id: 42 });
        const [[logged]] = output.info.mock.calls;
        const parsed = JSON.parse(logged);
        (0, vitest_1.expect)(parsed.event).toBe('test.event');
        (0, vitest_1.expect)(parsed.id).toBe(42);
        (0, vitest_1.expect)(typeof parsed.timestamp).toBe('string');
    });
});
(0, vitest_1.describe)('BridgeServer integration', () => {
    let output;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.resetAllMocks();
        output = (0, test_helpers_1.createLogOutputChannelMock)();
        (0, test_helpers_1.setOutputChannelMock)(output);
        (0, test_helpers_1.resetMockedLm)();
    });
    async function startServer(options) {
        const bridge = new server_1.BridgeServer(options, output);
        await bridge.start();
        const address = bridge.server?.address();
        const port = typeof address === 'object' && address !== null ? address.port ?? options.port : options.port;
        if (typeof port !== 'number' || port === 0) {
            throw new Error('Bridge server failed to provide listening port');
        }
        return { server: bridge, port };
    }
    function findStructuredLog(mockFn, event) {
        for (const call of mockFn.mock.calls) {
            const [message] = call;
            if (typeof message === 'string' && message.trim().startsWith('{')) {
                const parsed = JSON.parse(message);
                if (parsed.event === event) {
                    return parsed;
                }
            }
        }
        return undefined;
    }
    (0, vitest_1.it)('handles JSON chat requests end-to-end and logs output size', async () => {
        const text = 'hello world';
        const mockModel = {
            id: 'model-json',
            vendor: 'copilot',
            family: 'test',
            version: '1',
            sendRequest: vitest_1.vi.fn(async () => {
                async function* stream() {
                    yield text;
                }
                async function* textIterator() {
                    yield text;
                }
                return {
                    stream: stream(),
                    text: textIterator()
                };
            })
        };
        test_helpers_1.mockedLm.selectChatModels.mockResolvedValue([mockModel]);
        const options = {
            port: 0,
            authToken: undefined,
            autoStart: false,
            logLevel: 'info',
            maxConcurrent: 4,
            maxRequestBody: 32_768
        };
        const { server, port } = await startServer(options);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt: 'hi' })
            });
            (0, vitest_1.expect)(response.status).toBe(200);
            const body = (await response.json());
            (0, vitest_1.expect)(body.output).toBe(text);
            const finishLog = findStructuredLog(output.info, 'chat.request.finished');
            (0, vitest_1.expect)(finishLog).toBeDefined();
            (0, vitest_1.expect)(finishLog).toMatchObject({ status: 'completed', outputChars: text.length });
            (0, vitest_1.expect)(finishLog).not.toHaveProperty('chunks');
        }
        finally {
            await server.stop();
        }
    });
    (0, vitest_1.it)('streams chat responses and records chunk metrics', async () => {
        const chunks = ['Hello', ' World'];
        const mockModel = {
            id: 'model-stream',
            vendor: 'copilot',
            family: 'test',
            version: '1',
            sendRequest: vitest_1.vi.fn(async () => {
                async function* stream() {
                    for (const entry of chunks) {
                        yield entry;
                    }
                }
                async function* textIterator() {
                    for (const entry of chunks) {
                        yield entry;
                    }
                }
                return {
                    stream: stream(),
                    text: textIterator()
                };
            })
        };
        test_helpers_1.mockedLm.selectChatModels.mockResolvedValue([mockModel]);
        const options = {
            port: 0,
            authToken: undefined,
            autoStart: false,
            logLevel: 'info',
            maxConcurrent: 4,
            maxRequestBody: 32_768
        };
        const { server, port } = await startServer(options);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream'
                },
                body: JSON.stringify({ prompt: 'stream me' })
            });
            (0, vitest_1.expect)(response.status).toBe(200);
            const payload = await response.text();
            (0, vitest_1.expect)(payload).toContain('event: metadata');
            (0, vitest_1.expect)(payload).toContain('event: chunk');
            (0, vitest_1.expect)(payload).toContain('event: done');
            const finishLog = findStructuredLog(output.info, 'chat.request.finished');
            (0, vitest_1.expect)(finishLog).toBeDefined();
            (0, vitest_1.expect)(finishLog).toMatchObject({
                status: 'completed',
                chunks: chunks.length,
                outputChars: chunks.join('').length
            });
        }
        finally {
            await server.stop();
        }
    });
});
//# sourceMappingURL=server.test.js.map