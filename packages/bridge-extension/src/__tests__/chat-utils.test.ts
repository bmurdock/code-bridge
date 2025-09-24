import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ZodError } from 'zod';

import {
  createLogOutputChannelMock,
  createVscodeModuleMock,
  setOutputChannelMock
} from './test-helpers';

vi.mock('vscode', () => createVscodeModuleMock());

import * as vscode from 'vscode';
import {
  createChatMessages,
  createRequestOptions,
  normalizeLanguageModelError,
  parseChatRequest,
  type ChatRequest
} from '../chat-utils';

let outputChannelMock: vscode.LogOutputChannel;

describe('chat-utils', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    outputChannelMock = createLogOutputChannelMock();
    setOutputChannelMock(outputChannelMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createChatMessages', () => {
    it('creates single user message when prompt provided', () => {
      const payload: ChatRequest = { prompt: 'hi there' };
      const messages = createChatMessages(payload);
      expect(messages).toHaveLength(1);
      expect(messages[0].content?.[0]).toBe('hi there');
    });

    it('transforms ordered message history', () => {
      const payload: ChatRequest = {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' }
        ]
      };

      const messages = createChatMessages(payload);
      expect(messages).toHaveLength(2);
      expect(messages[0].content?.[0]).toBe('first');
      expect(messages[1].content?.[0]).toBe('second');
    });
  });

  describe('normalizeLanguageModelError', () => {
    it('maps known error codes to HTTP responses', () => {
      const lmError = vscode.LanguageModelError.NoPermissions('denied');
      const normalized = normalizeLanguageModelError(lmError, outputChannelMock);
      expect(normalized.statusCode).toBe(403);
    });

    it('falls back to internal error', () => {
      const normalized = normalizeLanguageModelError(new Error('boom'), outputChannelMock);
      expect(normalized.statusCode).toBe(500);
    });
  });

  describe('parseChatRequest', () => {
    it('parses payload with prompt', () => {
      const payload = parseChatRequest({ prompt: 'hello' });
      expect(payload.prompt).toBe('hello');
    });

    it('rejects payload without prompt or messages', () => {
      expect(() => parseChatRequest({})).toThrowError(ZodError);
    });

    it('rejects payload with invalid options', () => {
      expect(() => parseChatRequest({ prompt: 'hi', options: { temperature: 'warm' } })).toThrowError(
        ZodError
      );
    });
  });

  describe('createRequestOptions', () => {
    it('maps known tuning parameters into modelOptions', () => {
      const options = createRequestOptions({
        prompt: 'hi',
        options: { maxOutputTokens: 1024, temperature: 0.3 }
      });

      expect(options?.modelOptions).toEqual({ maxOutputTokens: 1024, temperature: 0.3 });
    });

    it('returns undefined when no tuning options provided', () => {
      const options = createRequestOptions({ prompt: 'hi', options: {} });
      expect(options).toBeUndefined();
    });
  });
});
