import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLogOutputChannelMock,
  createVscodeModuleMock,
  setOutputChannelMock,
  mockedLm,
  resetMockedLm,
  type MockedLogOutputChannel
} from './test-helpers';

vi.mock('vscode', () => createVscodeModuleMock());

import * as vscode from 'vscode';
import { BridgeServer } from '../server';
import type { BridgeServerOptions } from '../server';

describe('BridgeServer logging', () => {
  let output: MockedLogOutputChannel;

  beforeEach(() => {
    vi.resetAllMocks();
    output = createLogOutputChannelMock();
    setOutputChannelMock(output);
    resetMockedLm();
  });

  it('honors configured log level threshold', () => {
    const server = new BridgeServer(
      {
        host: '127.0.0.1',
        port: 1,
        authToken: undefined,
        autoStart: false,
        logLevel: 'warn',
        maxConcurrent: 4,
        maxRequestBody: 32_768
      },
      output
    );

    (server as unknown as { log(level: string, message: string): void }).log('info', 'informational');
    (server as unknown as { log(level: string, message: string): void }).log('error', 'critical');

    expect(output.info).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith('critical');
  });

  it('updates log threshold when configuration changes', async () => {
    const server = new BridgeServer(
      {
        host: '127.0.0.1',
        port: 1,
        authToken: undefined,
        autoStart: false,
        logLevel: 'info',
        maxConcurrent: 4,
        maxRequestBody: 32_768
      },
      output
    );

    await server.applyConfig({
      host: '127.0.0.1',
      port: 1,
      authToken: undefined,
      autoStart: false,
      logLevel: 'debug',
      maxConcurrent: 4,
      maxRequestBody: 32_768
    });

    (server as unknown as { log(level: string, message: string): void }).log('debug', 'detailed');

    expect(output.debug).toHaveBeenCalledWith('detailed');
  });

  it('emits structured JSON payloads via log events', () => {
    const server = new BridgeServer(
      {
        host: '127.0.0.1',
        port: 1,
        authToken: undefined,
        autoStart: false,
        logLevel: 'info',
        maxConcurrent: 4,
        maxRequestBody: 32_768
      },
      output
    );

    (server as unknown as { logEvent(level: string, event: string, data?: Record<string, unknown>): void }).logEvent(
      'info',
      'test.event',
      { id: 42 }
    );

    const [[logged]] = output.info.mock.calls as [[string]];
    const parsed = JSON.parse(logged);
    expect(parsed.event).toBe('test.event');
    expect(parsed.id).toBe(42);
    expect(typeof parsed.timestamp).toBe('string');
  });
});

describe('BridgeServer integration', () => {
  let output: MockedLogOutputChannel;

  beforeEach(() => {
    vi.resetAllMocks();
    output = createLogOutputChannelMock();
    setOutputChannelMock(output);
    resetMockedLm();
  });

  async function startServer(options: BridgeServerOptions): Promise<{
    server: BridgeServer;
    port: number;
  }> {
    const bridge = new BridgeServer(options, output);
    await bridge.start();
    const address = (bridge as unknown as { server?: { address(): unknown } }).server?.address();
    const port = typeof address === 'object' && address !== null ? (address as { port?: number }).port ?? options.port : options.port;
    if (typeof port !== 'number' || port === 0) {
      throw new Error('Bridge server failed to provide listening port');
    }
    return { server: bridge, port };
  }

  function findStructuredLog(mockFn: ReturnType<typeof vi.fn>, event: string) {
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

  it('handles JSON chat requests end-to-end and logs output size', async () => {
    const text = 'hello world';
    const mockModel: Partial<vscode.LanguageModelChat> = {
      id: 'model-json',
      vendor: 'copilot',
      family: 'test',
      version: '1',
      sendRequest: vi.fn(async () => {
        async function* stream(): AsyncGenerator<unknown> {
          yield text;
        }
        async function* textIterator(): AsyncGenerator<string> {
          yield text;
        }
        return {
          stream: stream(),
          text: textIterator()
        };
      })
    };

    mockedLm.selectChatModels.mockResolvedValue([mockModel as vscode.LanguageModelChat]);

    const options = {
      host: '127.0.0.1',
      port: 0,
      authToken: undefined,
      autoStart: false,
      logLevel: 'info' as const,
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

      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; output: string };
      expect(body.output).toBe(text);

      const finishLog = findStructuredLog(output.info, 'chat.request.finished');
      expect(finishLog).toBeDefined();
      expect(finishLog).toMatchObject({ status: 'completed', outputChars: text.length });
      expect(finishLog).not.toHaveProperty('chunks');
    } finally {
      await server.stop();
    }
  });

  it('streams chat responses and records chunk metrics', async () => {
    const chunks = ['Hello', ' World'];
    const mockModel: Partial<vscode.LanguageModelChat> = {
      id: 'model-stream',
      vendor: 'copilot',
      family: 'test',
      version: '1',
      sendRequest: vi.fn(async () => {
        async function* stream(): AsyncGenerator<unknown> {
          for (const entry of chunks) {
            yield entry;
          }
        }

        async function* textIterator(): AsyncGenerator<string> {
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

    mockedLm.selectChatModels.mockResolvedValue([mockModel as vscode.LanguageModelChat]);

    const options = {
      host: '127.0.0.1',
      port: 0,
      authToken: undefined,
      autoStart: false,
      logLevel: 'info' as const,
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

      expect(response.status).toBe(200);
      const payload = await response.text();
      expect(payload).toContain('event: metadata');
      expect(payload).toContain('event: chunk');
      expect(payload).toContain('event: done');

      const finishLog = findStructuredLog(output.info, 'chat.request.finished');
      expect(finishLog).toBeDefined();
      expect(finishLog).toMatchObject({
        status: 'completed',
        chunks: chunks.length,
        outputChars: chunks.join('').length
      });
    } finally {
      await server.stop();
    }
  });
});
