import { vi } from 'vitest';
import type * as vscode from 'vscode';

type LogMethodMock = ReturnType<typeof vi.fn>;

export type MockedLogOutputChannel = vscode.LogOutputChannel & {
  trace: LogMethodMock;
  debug: LogMethodMock;
  info: LogMethodMock;
  warn: LogMethodMock;
  error: LogMethodMock;
};

let currentOutputChannel: vscode.LogOutputChannel | undefined;

const selectChatModels = vi.fn<() => Promise<vscode.LanguageModelChat[]>>(async () => []);

export const mockedLm = {
  selectChatModels
};

export function setOutputChannelMock(channel: vscode.LogOutputChannel): void {
  currentOutputChannel = channel;
}

export function createLogOutputChannelMock(): MockedLogOutputChannel {
  const onDidChangeLogLevel = (() => ({
    dispose: vi.fn()
  })) as unknown as vscode.Event<vscode.LogLevel>;

  const trace: LogMethodMock = vi.fn();
  const debug: LogMethodMock = vi.fn();
  const info: LogMethodMock = vi.fn();
  const warn: LogMethodMock = vi.fn();
  const error: LogMethodMock = vi.fn();

  const channel = {
    name: 'Mock Output',
    append: vi.fn(),
    appendLine: vi.fn(),
    replace: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    logLevel: 2,
    onDidChangeLogLevel,
    trace,
    debug,
    info,
    warn,
    error
  } as Record<string, unknown>;

  return channel as unknown as MockedLogOutputChannel;
}

export function createVscodeModuleMock() {
  class MockLanguageModelError extends Error {
    constructor(message?: string, public code: string = 'Unknown') {
      super(message);
    }

    static NoPermissions(message?: string) {
      return new MockLanguageModelError(message, 'NoPermissions');
    }

    static NotFound(message?: string) {
      return new MockLanguageModelError(message, 'NotFound');
    }

    static Blocked(message?: string) {
      return new MockLanguageModelError(message, 'Blocked');
    }
  }

  class MockCancellationTokenSource {
    private cancelled = false;
    private readonly listeners = new Set<() => void>();

    public readonly token: vscode.CancellationToken;

    constructor() {
      const onCancellationRequested: vscode.Event<void> = (
        listener,
        _thisArgs,
        disposables
      ) => {
        this.listeners.add(listener);
        const disposable: vscode.Disposable = {
          dispose: () => {
            this.listeners.delete(listener);
          }
        };
        if (Array.isArray(disposables)) {
          disposables.push(disposable);
        }
        return disposable;
      };

      const token: Partial<vscode.CancellationToken> = {
        onCancellationRequested
      };

      Object.defineProperty(token, 'isCancellationRequested', {
        get: () => this.cancelled
      });

      this.token = token as vscode.CancellationToken;
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
  } as const;

  const module = {
    window: {
      createOutputChannel: vi.fn(() => {
        if (!currentOutputChannel) {
          throw new Error('Output channel mock not configured');
        }
        return currentOutputChannel;
      })
    },
    LogLevel,
    LanguageModelChatMessage: {
      User: (content: string) => ({ role: 'user', content: [content] }),
      Assistant: (content: string) => ({ role: 'assistant', content: [content] })
    },
    LanguageModelError: MockLanguageModelError,
    CancellationTokenSource: MockCancellationTokenSource,
    lm: mockedLm
  };

  return module;
}

export function resetMockedLm(): void {
  mockedLm.selectChatModels.mockClear();
}
