"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockedLm = void 0;
exports.setOutputChannelMock = setOutputChannelMock;
exports.createLogOutputChannelMock = createLogOutputChannelMock;
exports.createVscodeModuleMock = createVscodeModuleMock;
exports.resetMockedLm = resetMockedLm;
const vitest_1 = require("vitest");
let currentOutputChannel;
const selectChatModels = vitest_1.vi.fn(async () => []);
exports.mockedLm = {
    selectChatModels
};
function setOutputChannelMock(channel) {
    currentOutputChannel = channel;
}
function createLogOutputChannelMock() {
    const onDidChangeLogLevel = (() => ({
        dispose: vitest_1.vi.fn()
    }));
    const trace = vitest_1.vi.fn();
    const debug = vitest_1.vi.fn();
    const info = vitest_1.vi.fn();
    const warn = vitest_1.vi.fn();
    const error = vitest_1.vi.fn();
    const channel = {
        name: 'Mock Output',
        append: vitest_1.vi.fn(),
        appendLine: vitest_1.vi.fn(),
        replace: vitest_1.vi.fn(),
        clear: vitest_1.vi.fn(),
        show: vitest_1.vi.fn(),
        hide: vitest_1.vi.fn(),
        dispose: vitest_1.vi.fn(),
        logLevel: 2,
        onDidChangeLogLevel,
        trace,
        debug,
        info,
        warn,
        error
    };
    return channel;
}
function createVscodeModuleMock() {
    class MockLanguageModelError extends Error {
        code;
        constructor(message, code = 'Unknown') {
            super(message);
            this.code = code;
        }
        static NoPermissions(message) {
            return new MockLanguageModelError(message, 'NoPermissions');
        }
        static NotFound(message) {
            return new MockLanguageModelError(message, 'NotFound');
        }
        static Blocked(message) {
            return new MockLanguageModelError(message, 'Blocked');
        }
    }
    class MockCancellationTokenSource {
        cancelled = false;
        listeners = new Set();
        token;
        constructor() {
            const onCancellationRequested = (listener, _thisArgs, disposables) => {
                this.listeners.add(listener);
                const disposable = {
                    dispose: () => {
                        this.listeners.delete(listener);
                    }
                };
                if (Array.isArray(disposables)) {
                    disposables.push(disposable);
                }
                return disposable;
            };
            const token = {
                onCancellationRequested
            };
            Object.defineProperty(token, 'isCancellationRequested', {
                get: () => this.cancelled
            });
            this.token = token;
        }
        cancel() {
            if (this.cancelled) {
                return;
            }
            this.cancelled = true;
            for (const listener of Array.from(this.listeners)) {
                listener();
            }
        }
        dispose() {
            this.listeners.clear();
        }
    }
    const LogLevel = {
        Trace: 0,
        Debug: 1,
        Info: 2,
        Warning: 3,
        Error: 4,
        Off: 5
    };
    const module = {
        window: {
            createOutputChannel: vitest_1.vi.fn(() => {
                if (!currentOutputChannel) {
                    throw new Error('Output channel mock not configured');
                }
                return currentOutputChannel;
            })
        },
        LogLevel,
        LanguageModelChatMessage: {
            User: (content) => ({ role: 'user', content: [content] }),
            Assistant: (content) => ({ role: 'assistant', content: [content] })
        },
        LanguageModelError: MockLanguageModelError,
        CancellationTokenSource: MockCancellationTokenSource,
        lm: exports.mockedLm
    };
    return module;
}
function resetMockedLm() {
    exports.mockedLm.selectChatModels.mockClear();
}
//# sourceMappingURL=test-helpers.js.map