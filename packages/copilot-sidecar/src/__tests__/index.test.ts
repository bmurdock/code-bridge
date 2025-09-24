import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BridgeError } from '../errors';
import {
  registerCopilotTools,
  type CopilotBridgeClient,
  type BridgeModel,
  buildErrorResult
} from '../index';

describe('copilot sidecar tools', () => {
  interface ToolContext {
    signal: AbortSignal;
    sendNotification: (notification: {
      method: string;
      params?: Record<string, unknown>;
    }) => Promise<void>;
    _meta?: Record<string, unknown>;
  }

  type ToolHandler = (
    args: Record<string, unknown>,
    context: ToolContext
  ) => CallToolResult | Promise<CallToolResult>;

  interface RegisteredToolMock {
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }

  const registered: Record<string, { handler: ToolHandler }> = {};

  function createServerStub(): McpServer {
    const registerTool = vi.fn(
      (
        name: string,
        _config: unknown,
        handler: ToolHandler
      ) => {
        registered[name] = { handler };
        const registration: RegisteredToolMock = {
          enable: vi.fn(),
          disable: vi.fn(),
          update: vi.fn(),
          remove: vi.fn()
        };
        return registration as unknown as RegisteredTool;
      }
    );

    return { registerTool } as unknown as McpServer;
  }

  function createBridgeStub(overrides: Partial<CopilotBridgeClient> = {}): CopilotBridgeClient {
    return {
      listModels: vi.fn(async () => []),
      chat: vi.fn(async (_payload, _signal, handlers) => {
        await handlers?.onMetadata?.({ model: { id: 'stub' } });
        await handlers?.onChunk?.('partial');
        await handlers?.onDone?.({ status: 'completed' });
        return {
          status: 'completed',
          received: 0,
          output: 'partial',
          stats: { chunks: 1, outputChars: 'partial'.length }
        };
      }),
      ...overrides
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(registered)) {
      delete registered[key];
    }
  });

  it('returns structured model list data alongside summary text', async () => {
    const models: BridgeModel[] = [
      { id: 'm1', vendor: 'copilot', family: 'test', version: '1' }
    ];

    const bridge = createBridgeStub({
      listModels: vi.fn(async () => models)
    });

    const server = createServerStub();
    registerCopilotTools(server, bridge);

    const result = await registered['copilot.listModels'].handler(
      { vendor: 'copilot' },
      {
        signal: new AbortController().signal,
        sendNotification: vi.fn(async () => undefined),
        _meta: {}
      }
    );

    expect(result.content?.[0]?.text).toContain('Returned 1 model');
    expect(result.structuredContent).toEqual({ models });
    expect(bridge.listModels).toHaveBeenCalledTimes(1);
  });

  it('emits progress notifications when chunks arrive', async () => {
    const bridge = createBridgeStub();
    const server = createServerStub();
    registerCopilotTools(server, bridge);

    const abort = new AbortController();
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    const result = await registered['copilot.chat'].handler(
      { prompt: 'stream' },
      {
        signal: abort.signal,
        sendNotification,
        _meta: { progressToken: 'p-1' }
      }
    );

    expect(sendNotification).toHaveBeenCalled();
    const calls = sendNotification.mock.calls;
    const progressMessages = calls.map(([arg]) => arg?.params?.message).filter(Boolean);
    expect(progressMessages.some((msg: string) => msg.includes('partial'))).toBe(true);
    expect(progressMessages.some((msg: string) => msg.includes('Status: completed'))).toBe(true);
    const firstCall = calls[0]?.[0];
    expect(firstCall?.method).toBe('notifications/progress');
    expect(firstCall?.params?.progressToken).toBe('p-1');
    expect(result.content?.[0]?.text).toBe('partial');
    expect(result.structuredContent?.status).toBe('completed');
    expect(result.structuredContent?.stats).toEqual({ chunks: 1, outputChars: 'partial'.length });
  });

  it('surfaces bridge errors in chat handler', async () => {
    const bridge = createBridgeStub({
      chat: vi.fn(async () => {
        throw new BridgeError(403, 'Denied', undefined, { reason: 'no-access' });
      })
    });

    const server = createServerStub();
    registerCopilotTools(server, bridge);

    const abort = new AbortController();
    const result = await registered['copilot.chat'].handler(
      { prompt: 'hi' },
      {
        signal: abort.signal,
        sendNotification: vi.fn(async () => undefined),
        _meta: {}
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Denied');
    expect(result.structuredContent).toEqual({ details: { reason: 'no-access' } });
    expect(bridge.chat).toHaveBeenCalledTimes(1);
  });

  it('buildErrorResult normalizes non-BridgeError instances', () => {
    const outcome = buildErrorResult(new Error('boom'));
    expect(outcome.isError).toBe(true);
    expect(outcome.content?.[0]?.text).toContain('boom');
  });
});
