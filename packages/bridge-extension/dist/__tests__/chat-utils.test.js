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
const vitest_1 = require("vitest");
const zod_1 = require("zod");
const test_helpers_1 = require("./test-helpers");
vitest_1.vi.mock('vscode', () => (0, test_helpers_1.createVscodeModuleMock)());
const vscode = __importStar(require("vscode"));
const chat_utils_1 = require("../chat-utils");
let outputChannelMock;
(0, vitest_1.describe)('chat-utils', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.resetAllMocks();
        outputChannelMock = (0, test_helpers_1.createLogOutputChannelMock)();
        (0, test_helpers_1.setOutputChannelMock)(outputChannelMock);
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.describe)('createChatMessages', () => {
        (0, vitest_1.it)('creates single user message when prompt provided', () => {
            const payload = { prompt: 'hi there' };
            const messages = (0, chat_utils_1.createChatMessages)(payload);
            (0, vitest_1.expect)(messages).toHaveLength(1);
            (0, vitest_1.expect)(messages[0].content?.[0]).toBe('hi there');
        });
        (0, vitest_1.it)('transforms ordered message history', () => {
            const payload = {
                messages: [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'second' }
                ]
            };
            const messages = (0, chat_utils_1.createChatMessages)(payload);
            (0, vitest_1.expect)(messages).toHaveLength(2);
            (0, vitest_1.expect)(messages[0].content?.[0]).toBe('first');
            (0, vitest_1.expect)(messages[1].content?.[0]).toBe('second');
        });
    });
    (0, vitest_1.describe)('normalizeLanguageModelError', () => {
        (0, vitest_1.it)('maps known error codes to HTTP responses', () => {
            const lmError = vscode.LanguageModelError.NoPermissions('denied');
            const normalized = (0, chat_utils_1.normalizeLanguageModelError)(lmError, outputChannelMock);
            (0, vitest_1.expect)(normalized.statusCode).toBe(403);
        });
        (0, vitest_1.it)('falls back to internal error', () => {
            const normalized = (0, chat_utils_1.normalizeLanguageModelError)(new Error('boom'), outputChannelMock);
            (0, vitest_1.expect)(normalized.statusCode).toBe(500);
        });
    });
    (0, vitest_1.describe)('parseChatRequest', () => {
        (0, vitest_1.it)('parses payload with prompt', () => {
            const payload = (0, chat_utils_1.parseChatRequest)({ prompt: 'hello' });
            (0, vitest_1.expect)(payload.prompt).toBe('hello');
        });
        (0, vitest_1.it)('rejects payload without prompt or messages', () => {
            (0, vitest_1.expect)(() => (0, chat_utils_1.parseChatRequest)({})).toThrowError(zod_1.ZodError);
        });
        (0, vitest_1.it)('rejects payload with invalid options', () => {
            (0, vitest_1.expect)(() => (0, chat_utils_1.parseChatRequest)({ prompt: 'hi', options: { temperature: 'warm' } })).toThrowError(zod_1.ZodError);
        });
    });
    (0, vitest_1.describe)('createRequestOptions', () => {
        (0, vitest_1.it)('maps known tuning parameters into modelOptions', () => {
            const options = (0, chat_utils_1.createRequestOptions)({
                prompt: 'hi',
                options: { maxOutputTokens: 1024, temperature: 0.3 }
            });
            (0, vitest_1.expect)(options?.modelOptions).toEqual({ maxOutputTokens: 1024, temperature: 0.3 });
        });
        (0, vitest_1.it)('returns undefined when no tuning options provided', () => {
            const options = (0, chat_utils_1.createRequestOptions)({ prompt: 'hi', options: {} });
            (0, vitest_1.expect)(options).toBeUndefined();
        });
    });
});
//# sourceMappingURL=chat-utils.test.js.map