"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeServer = void 0;
const http = __importStar(require("http"));
const vscode = __importStar(require("vscode"));
const chat_utils_1 = require("./chat-utils");
const zod_1 = require("zod");
const LOG_LEVEL_PRIORITY = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};
class BridgeServer {
    server;
    output;
    options;
    requestQueue = [];
    activeRequests = 0;
    requestIdCounter = 0;
    constructor(options, output) {
        this.options = options;
        this.output = output;
    }
    async start() {
        if (this.server) {
            this.log('warn', 'Bridge server is already running');
            return;
        }
        await new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                try {
                    await this.handleRequest(req, res);
                }
                catch (error) {
                    this.log('error', `Unhandled request error: ${String(error)}`);
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.end('Internal Server Error');
                    }
                }
            });
            server.listen(this.options.port, '127.0.0.1', () => {
                this.log('info', `Bridge listening on http://127.0.0.1:${this.options.port}`);
                this.server = server;
                resolve();
            });
            server.on('error', (error) => {
                reject(error);
            });
        });
    }
    async stop() {
        if (!this.server) {
            return;
        }
        const server = this.server;
        this.server = undefined;
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    this.log('info', 'Bridge server stopped');
                    resolve();
                }
            });
        });
    }
    async restart(options) {
        await this.stop();
        this.options = options;
        await this.start();
    }
    async applyConfig(options) {
        const requiresRestart = options.port !== this.options.port || options.authToken !== this.options.authToken;
        this.options = options;
        if (requiresRestart) {
            await this.restart(options);
        }
    }
    log(level, message) {
        const configuredLevel = LOG_LEVEL_PRIORITY[this.options.logLevel] ?? LOG_LEVEL_PRIORITY.info;
        if (LOG_LEVEL_PRIORITY[level] > configuredLevel) {
            return;
        }
        switch (level) {
            case 'error':
                this.output.error(message);
                break;
            case 'warn':
                this.output.warn(message);
                break;
            case 'info':
                this.output.info(message);
                break;
            case 'debug':
                if (typeof this.output.debug === 'function') {
                    this.output.debug(message);
                }
                break;
        }
    }
    logEvent(level, event, data = {}) {
        const payload = {
            event,
            timestamp: new Date().toISOString(),
            ...data
        };
        this.log(level, JSON.stringify(payload));
    }
    nextRequestId() {
        this.requestIdCounter = (this.requestIdCounter + 1) % Number.MAX_SAFE_INTEGER;
        if (this.requestIdCounter === 0) {
            this.requestIdCounter = 1;
        }
        return this.requestIdCounter;
    }
    async handleRequest(req, res) {
        if (!req.url || !req.method) {
            res.statusCode = 400;
            res.end('Bad Request');
            return;
        }
        if (!this.authorize(req)) {
            res.statusCode = 401;
            res.end('Unauthorized');
            return;
        }
        if (req.method === 'GET' && req.url === '/healthz') {
            this.handleHealth(res);
            return;
        }
        if (!(await this.acquireSlot())) {
            this.log('warn', `Rejecting ${req.method} ${req.url ?? ''}: max concurrency reached`);
            res.statusCode = 503;
            res.end('Server Busy');
            return;
        }
        try {
            this.log('debug', `Handling ${req.method} ${req.url}`);
            if (req.method === 'GET' && req.url === '/models') {
                await this.handleModels(res);
                return;
            }
            if (req.method === 'POST' && req.url === '/chat') {
                await this.handleChat(req, res);
                return;
            }
            this.log('info', `Unhandled route: ${req.method} ${req.url}`);
            res.statusCode = 404;
            res.end('Not Found');
        }
        finally {
            this.releaseSlot();
        }
    }
    handleHealth(res) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            status: 'ok',
            port: this.options.port,
            activeRequests: this.activeRequests,
            queuedRequests: this.requestQueue.length
        }));
    }
    authorize(req) {
        if (!this.options.authToken) {
            return true;
        }
        const header = req.headers['authorization'];
        if (!header) {
            this.log('warn', 'Missing authorization header');
            return false;
        }
        return header === `Bearer ${this.options.authToken}`;
    }
    async handleModels(res) {
        try {
            const models = await vscode.lm.selectChatModels();
            const payload = models.map((model) => ({
                id: model.id,
                vendor: model.vendor,
                family: model.family,
                version: model.version,
                maxInputTokens: model.maxInputTokens
            }));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
        }
        catch (error) {
            this.log('error', `Failed to enumerate models: ${String(error)}`);
            res.statusCode = 503;
            res.end('Language Model API unavailable');
        }
    }
    async handleChat(req, res) {
        const wantsStream = this.prefersEventStream(req.headers['accept']);
        const delivery = wantsStream ? 'stream' : 'json';
        let payload;
        try {
            payload = await this.readAndParseChatPayload(req);
        }
        catch (error) {
            const payloadError = error;
            if (payloadError.statusCode === 413) {
                res.statusCode = 413;
                res.end('Payload Too Large');
                return;
            }
            if (payloadError.message === 'Empty request') {
                res.statusCode = 400;
                res.end('Empty request');
                return;
            }
            const parsePayload = buildParseErrorPayload(payloadError.cause ?? error);
            res.statusCode = payloadError.statusCode ?? 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(parsePayload));
            return;
        }
        const lm = vscode.lm;
        if (!lm) {
            res.statusCode = 503;
            res.end('Language Model API unavailable');
            return;
        }
        const controller = new vscode.CancellationTokenSource();
        const disposeOnClose = () => controller.cancel();
        req.on('close', disposeOnClose);
        const requestId = this.nextRequestId();
        const startedAt = Date.now();
        let status = 'completed';
        let outcomeDetails;
        const messageCount = payload.messages?.length ?? (payload.prompt ? 1 : 0);
        this.logEvent('info', 'chat.request.started', {
            id: requestId,
            delivery,
            stream: wantsStream,
            hasPrompt: Boolean(payload.prompt),
            messageCount
        });
        try {
            this.log('debug', 'Selecting language model');
            const model = await this.selectModel(payload.model);
            if (!model) {
                status = 'failed';
                res.statusCode = 404;
                res.end('Requested model not available');
                return;
            }
            this.logEvent('debug', 'chat.request.modelSelected', {
                id: requestId,
                modelId: model.id,
                vendor: model.vendor,
                family: model.family,
                version: model.version
            });
            const messages = (0, chat_utils_1.createChatMessages)(payload);
            if (messages.length === 0) {
                status = 'failed';
                res.statusCode = 400;
                res.end('Prompt resulted in empty message list');
                return;
            }
            const options = (0, chat_utils_1.createRequestOptions)(payload);
            if (wantsStream) {
                outcomeDetails = await this.handleChatStreaming(res, model, messages, options, controller.token, payload);
            }
            else {
                outcomeDetails = await this.handleChatJson(res, model, messages, options, controller.token);
            }
            status = outcomeDetails.status;
        }
        catch (error) {
            if (controller.token.isCancellationRequested) {
                status = 'cancelled';
                outcomeDetails = { status: 'cancelled' };
                res.statusCode = 499;
                res.end('Client Closed Request');
                return;
            }
            const normalized = this.normalizeError(error);
            res.statusCode = normalized.statusCode;
            res.end(normalized.message);
            this.log('error', `Chat request failed: ${normalized.message}`);
            status = 'failed';
            outcomeDetails = { status: 'failed', error: normalized };
        }
        finally {
            controller.dispose();
            req.removeListener('close', disposeOnClose);
            const durationMs = Date.now() - startedAt;
            const level = status === 'failed' ? 'error' : status === 'cancelled' ? 'warn' : 'info';
            const finishPayload = {
                id: requestId,
                delivery,
                stream: wantsStream,
                status,
                durationMs
            };
            if (outcomeDetails?.outputChars !== undefined) {
                finishPayload.outputChars = outcomeDetails.outputChars;
            }
            if (outcomeDetails?.chunks !== undefined) {
                finishPayload.chunks = outcomeDetails.chunks;
            }
            if (outcomeDetails?.error) {
                finishPayload.errorStatus = outcomeDetails.error.statusCode;
                finishPayload.errorMessage = outcomeDetails.error.message;
            }
            this.logEvent(level, 'chat.request.finished', finishPayload);
        }
    }
    async handleChatJson(res, model, messages, options, token) {
        const response = await model.sendRequest(messages, options, token);
        const output = await collectTextFromResponse(response);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            status: 'ok',
            output,
            raw: undefined
        }));
        return {
            status: 'completed',
            outputChars: output.length
        };
    }
    async handleChatStreaming(res, model, messages, options, token, payload) {
        this.log('debug', 'Starting streaming chat response');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        let response;
        let finalStatus = 'completed';
        let chunkCount = 0;
        let outputChars = 0;
        let responseEnded = false;
        try {
            response = await model.sendRequest(messages, options, token);
        }
        catch (error) {
            const normalized = this.normalizeError(error);
            this.writeSseEvent(res, 'error', {
                statusCode: normalized.statusCode,
                message: normalized.message
            });
            this.log('error', `Streaming chat failed to start: ${normalized.message}`);
            res.end();
            responseEnded = true;
            return { status: 'failed', error: normalized, chunks: chunkCount, outputChars };
        }
        this.writeSseEvent(res, 'metadata', {
            model: {
                id: model.id,
                vendor: model.vendor,
                family: model.family,
                version: model.version
            },
            request: {
                hasPrompt: Boolean(payload.prompt),
                messageCount: messages.length
            }
        });
        try {
            let cancelled = false;
            for await (const chunk of response.text ?? []) {
                chunkCount += 1;
                outputChars += chunk.length;
                if (token.isCancellationRequested) {
                    this.log('info', 'Streaming chat cancelled by client');
                    this.writeSseEvent(res, 'done', { status: 'cancelled' });
                    finalStatus = 'cancelled';
                    cancelled = true;
                    break;
                }
                this.writeSseEvent(res, 'chunk', { text: chunk });
            }
            if (!cancelled) {
                if (token.isCancellationRequested) {
                    this.log('info', 'Streaming chat cancelled by client');
                    this.writeSseEvent(res, 'done', { status: 'cancelled' });
                    finalStatus = 'cancelled';
                }
                else {
                    this.writeSseEvent(res, 'done', { status: 'completed' });
                    this.log('debug', 'Completed streaming chat response');
                }
            }
        }
        catch (error) {
            const normalized = this.normalizeError(error);
            this.writeSseEvent(res, 'error', {
                statusCode: normalized.statusCode,
                message: normalized.message
            });
            this.log('error', `Streaming chat failed: ${normalized.message}`);
            finalStatus = 'failed';
            res.end();
            responseEnded = true;
            return { status: finalStatus, error: normalized, chunks: chunkCount, outputChars };
        }
        finally {
            if (!responseEnded) {
                res.end();
            }
        }
        return { status: finalStatus, chunks: chunkCount, outputChars };
    }
    writeSseEvent(res, event, data) {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    prefersEventStream(acceptHeader) {
        if (!acceptHeader) {
            return false;
        }
        return acceptHeader.split(',').some((part) => part.trim().toLowerCase().startsWith('text/event-stream'));
    }
    async readAndParseChatPayload(req) {
        let body;
        try {
            body = await this.readBody(req);
        }
        catch (error) {
            throw new ChatPayloadError(413, 'Payload Too Large', error);
        }
        if (body.length === 0) {
            throw new ChatPayloadError(400, 'Empty request');
        }
        try {
            const raw = JSON.parse(body.toString('utf8'));
            return (0, chat_utils_1.parseChatRequest)(raw);
        }
        catch (error) {
            this.log('warn', `Failed to parse chat payload: ${String(error)}`);
            throw new ChatPayloadError(400, 'Invalid request payload', error);
        }
    }
    async readBody(req) {
        const chunks = [];
        let total = 0;
        try {
            return await new Promise((resolve, reject) => {
                req.on('data', (chunk) => {
                    total += chunk.length;
                    if (total > this.options.maxRequestBody) {
                        reject(new Error('Request body too large'));
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });
                req.on('end', () => {
                    resolve(Buffer.concat(chunks));
                });
                req.on('error', (error) => {
                    reject(error);
                });
            });
        }
        catch (error) {
            this.log('error', `Failed to read request body: ${String(error)}`);
            throw error;
        }
    }
    async acquireSlot() {
        if (this.activeRequests < this.options.maxConcurrent) {
            this.activeRequests += 1;
            return true;
        }
        return await new Promise((resolve) => {
            const pending = {
                resolve: () => resolve(true),
                reject: () => resolve(false)
            };
            this.requestQueue.push(pending);
        });
    }
    releaseSlot() {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        const next = this.requestQueue.shift();
        if (next) {
            this.activeRequests += 1;
            next.resolve();
        }
    }
    async selectModel(selector) {
        const filters = selector ?? {};
        const models = await vscode.lm.selectChatModels(filters);
        return models[0];
    }
    normalizeError(error) {
        return (0, chat_utils_1.normalizeLanguageModelError)(error, this.output);
    }
}
exports.BridgeServer = BridgeServer;
function buildParseErrorPayload(error) {
    if (error instanceof zod_1.ZodError) {
        return {
            error: 'Invalid request payload',
            details: error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message
            }))
        };
    }
    return { error: 'Invalid request payload' };
}
async function collectTextFromResponse(response) {
    if (!response || !response.text) {
        return '';
    }
    let full = '';
    for await (const fragment of response.text) {
        full += fragment;
    }
    return full;
}
class ChatPayloadError extends Error {
    statusCode;
    cause;
    constructor(statusCode, message, cause) {
        super(message);
        this.statusCode = statusCode;
        this.cause = cause;
    }
}
//# sourceMappingURL=server.js.map