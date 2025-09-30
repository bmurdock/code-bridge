import * as http from 'http';
import { AddressInfo } from 'net';
import * as vscode from 'vscode';
import {
  ChatRequest,
  createChatMessages,
  createRequestOptions,
  normalizeLanguageModelError,
  NormalizedError,
  parseChatRequest
} from './chat-utils';
import { ZodError } from 'zod';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

export interface BridgeServerOptions {
  host: string;
  port: number;
  authToken?: string;
  autoStart: boolean;
  logLevel: LogLevel;
  maxConcurrent: number;
  maxRequestBody: number;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface ChatOutcomeDetails {
  status: 'completed' | 'cancelled' | 'failed';
  outputChars?: number;
  chunks?: number;
  error?: NormalizedError;
}

export class BridgeServer {
  private server: http.Server | undefined;
  private readonly output: vscode.LogOutputChannel;
  private options: BridgeServerOptions;
  private readonly requestQueue: PendingRequest[] = [];
  private activeRequests = 0;
  private requestIdCounter = 0;

  constructor(options: BridgeServerOptions, output: vscode.LogOutputChannel) {
    this.options = options;
    this.output = output;
  }

  async start(): Promise<void> {
    if (this.server) {
      this.log('warn', 'Bridge server is already running');
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (error) {
          this.log('error', `Unhandled request error: ${String(error)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal Server Error');
          }
        }
      });

      server.listen(this.options.port, this.options.host, () => {
        const address = server.address() as AddressInfo | null;
        const { host, port } = this.resolveAddress(address);
        this.log('info', `Bridge listening on http://${host}:${port}`);
        this.server = server;
        resolve();
      });

      server.on('error', (error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.log('info', 'Bridge server stopped');
          resolve();
        }
      });
    });
  }

  async restart(options: BridgeServerOptions): Promise<void> {
    await this.stop();
    this.options = options;
    await this.start();
  }

  async applyConfig(options: BridgeServerOptions): Promise<void> {
    const requiresRestart =
      options.port !== this.options.port ||
      options.host !== this.options.host ||
      options.authToken !== this.options.authToken;
    this.options = options;

    if (requiresRestart) {
      await this.restart(options);
    }
  }

  isRunning(): boolean {
    return Boolean(this.server);
  }

  getAddress(): { host: string; port: number } | undefined {
    if (!this.server) {
      return undefined;
    }
    const address = this.server.address() as AddressInfo | null;
    return this.resolveAddress(address);
  }

  private log(level: LogLevel, message: string): void {
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

  private logEvent(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      ...data
    };

    this.log(level, JSON.stringify(payload));
  }

  private nextRequestId(): number {
    this.requestIdCounter = (this.requestIdCounter + 1) % Number.MAX_SAFE_INTEGER;
    if (this.requestIdCounter === 0) {
      this.requestIdCounter = 1;
    }
    return this.requestIdCounter;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
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
    } finally {
      this.releaseSlot();
    }
  }

  private handleHealth(res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/json');
    const address = this.getAddress();
    res.end(
      JSON.stringify({
        status: 'ok',
        host: address?.host ?? this.options.host,
        port: address?.port ?? this.options.port,
        activeRequests: this.activeRequests,
        queuedRequests: this.requestQueue.length
      })
    );
  }

  private resolveAddress(address: AddressInfo | null): { host: string; port: number } {
    if (!address) {
      return { host: this.options.host, port: this.options.port };
    }

    let host = address.address;
    if (host === '::' || host === '0.0.0.0') {
      host = this.options.host;
    } else if (host === '::1') {
      host = '127.0.0.1';
    } else if (host.startsWith('::ffff:')) {
      host = host.slice(7);
    }

    return { host, port: address.port };
  }

  private authorize(req: http.IncomingMessage): boolean {
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

  private async handleModels(res: http.ServerResponse) {
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
    } catch (error) {
      this.log('error', `Failed to enumerate models: ${String(error)}`);
      res.statusCode = 503;
      res.end('Language Model API unavailable');
    }
  }

  private async handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
    const wantsStream = this.prefersEventStream(req.headers['accept']);
    const delivery = wantsStream ? 'stream' : 'json';

    let payload: ChatRequest;
    try {
      payload = await this.readAndParseChatPayload(req);
    } catch (error) {
      const payloadError = error as ChatPayloadError;
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
    let status: 'completed' | 'cancelled' | 'failed' = 'completed';
    let outcomeDetails: ChatOutcomeDetails | undefined;
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

      const messages = createChatMessages(payload);
      if (messages.length === 0) {
        status = 'failed';
        res.statusCode = 400;
        res.end('Prompt resulted in empty message list');
        return;
      }

      const options = createRequestOptions(payload);

      if (wantsStream) {
        outcomeDetails = await this.handleChatStreaming(res, model, messages, options, controller.token, payload);
      } else {
        outcomeDetails = await this.handleChatJson(res, model, messages, options, controller.token);
      }
      status = outcomeDetails.status;
    } catch (error) {
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
    } finally {
      controller.dispose();
      req.removeListener('close', disposeOnClose);

      const durationMs = Date.now() - startedAt;
      const level: LogLevel = status === 'failed' ? 'error' : status === 'cancelled' ? 'warn' : 'info';
      const finishPayload: Record<string, unknown> = {
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

  private async handleChatJson(
    res: http.ServerResponse,
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    options: vscode.LanguageModelChatRequestOptions | undefined,
    token: vscode.CancellationToken
  ): Promise<ChatOutcomeDetails> {
    const response = await model.sendRequest(messages, options, token);
    const output = await collectTextFromResponse(response);

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'ok',
        output,
        raw: undefined
      })
    );

    return {
      status: 'completed',
      outputChars: output.length
    };
  }

  private async handleChatStreaming(
    res: http.ServerResponse,
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    options: vscode.LanguageModelChatRequestOptions | undefined,
    token: vscode.CancellationToken,
    payload: ChatRequest
  ): Promise<ChatOutcomeDetails> {
    this.log('debug', 'Starting streaming chat response');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let response: vscode.LanguageModelChatResponse;
    let finalStatus: 'completed' | 'cancelled' | 'failed' = 'completed';
    let chunkCount = 0;
    let outputChars = 0;
    let responseEnded = false;
    try {
      response = await model.sendRequest(messages, options, token);
    } catch (error) {
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
        } else {
          this.writeSseEvent(res, 'done', { status: 'completed' });
          this.log('debug', 'Completed streaming chat response');
        }
      }
    } catch (error) {
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
    } finally {
      if (!responseEnded) {
        res.end();
      }
    }
    return { status: finalStatus, chunks: chunkCount, outputChars };
  }

  private writeSseEvent(res: http.ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private prefersEventStream(acceptHeader: string | undefined): boolean {
    if (!acceptHeader) {
      return false;
    }

    return acceptHeader.split(',').some((part) => part.trim().toLowerCase().startsWith('text/event-stream'));
  }

  private async readAndParseChatPayload(req: http.IncomingMessage): Promise<ChatRequest> {
    let body: Buffer;
    try {
      body = await this.readBody(req);
    } catch (error) {
      throw new ChatPayloadError(413, 'Payload Too Large', error);
    }

    if (body.length === 0) {
      throw new ChatPayloadError(400, 'Empty request');
    }

    try {
      const raw = JSON.parse(body.toString('utf8')) as unknown;
      return parseChatRequest(raw);
    } catch (error) {
      this.log('warn', `Failed to parse chat payload: ${String(error)}`);
      throw new ChatPayloadError(400, 'Invalid request payload', error);
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    try {
      return await new Promise<Buffer>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => {
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
    } catch (error) {
      this.log('error', `Failed to read request body: ${String(error)}`);
      throw error;
    }
  }

  private async acquireSlot(): Promise<boolean> {
    if (this.activeRequests < this.options.maxConcurrent) {
      this.activeRequests += 1;
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      const pending: PendingRequest = {
        resolve: () => resolve(true),
        reject: () => resolve(false)
      };
      this.requestQueue.push(pending);
    });
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const next = this.requestQueue.shift();
    if (next) {
      this.activeRequests += 1;
      next.resolve();
    }
  }

  private async selectModel(
    selector?: ChatRequest['model']
  ): Promise<vscode.LanguageModelChat | undefined> {
    const filters = selector ?? {};
    const models = await vscode.lm.selectChatModels(filters);
    return models[0];
  }

  private normalizeError(error: unknown): NormalizedError {
    return normalizeLanguageModelError(error, this.output);
  }
}

function buildParseErrorPayload(error: unknown): { error: string; details?: unknown } {
  if (error instanceof ZodError) {
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

async function collectTextFromResponse(
  response: vscode.LanguageModelChatResponse | undefined
): Promise<string> {
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
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}
