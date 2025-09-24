export interface NormalizedBridgeError {
  statusCode: number;
  message: string;
  details?: unknown;
}

export class BridgeError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly body?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

const defaultError: NormalizedBridgeError = {
  statusCode: 502,
  message: 'Bridge request failed'
};

const bridgeErrorMap: Map<number, NormalizedBridgeError> = new Map(
  [
    [400, { statusCode: 400, message: 'Invalid request sent to bridge' }],
    [401, { statusCode: 401, message: 'Bridge authentication failed' }],
    [403, { statusCode: 403, message: 'Bridge denied the request' }],
    [404, { statusCode: 404, message: 'Requested resource not available' }],
    [413, { statusCode: 413, message: 'Prompt payload too large' }],
    [429, { statusCode: 429, message: 'Bridge quota exceeded' }],
    [499, { statusCode: 499, message: 'Bridge cancelled the request' }],
    [503, { statusCode: 503, message: 'Bridge service unavailable' }]
  ]
);

export function normalizeBridgeError(status: number, responseText?: string): NormalizedBridgeError {
  const normalized = bridgeErrorMap.get(status) ?? defaultError;
  const result: NormalizedBridgeError = { ...normalized };

  if (!responseText) {
    return result;
  }

  const parsed = parseJson(responseText);
  if (parsed && typeof parsed === 'object') {
    if ('message' in parsed && typeof parsed.message === 'string') {
      result.message = parsed.message;
    }
    if ('error' in parsed && typeof parsed.error === 'string') {
      result.message = parsed.error;
    }
    if ('details' in parsed) {
      result.details = parsed.details;
    }
  } else {
    result.message = `${result.message}: ${responseText}`.trim();
  }

  return result;
}

export function coerceBridgeError(error: unknown): NormalizedBridgeError {
  if (error instanceof BridgeError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      details: error.details ?? parseJson(error.body ?? '') ?? undefined
    };
  }

  if (error instanceof Error) {
    return { statusCode: 500, message: error.message };
  }

  return defaultError;
}

export function summarizeErrorDetails(details: unknown): string | undefined {
  if (!details) {
    return undefined;
  }

  if (Array.isArray(details)) {
    const parts = details
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          const path = 'path' in entry ? String((entry as Record<string, unknown>).path) : undefined;
          const message = 'message' in entry ? String((entry as Record<string, unknown>).message) : undefined;
          if (path && message) {
            return `- ${path}: ${message}`;
          }
          if (message) {
            return `- ${message}`;
          }
        }
        return `- ${JSON.stringify(entry)}`;
      })
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.join('\n');
    }
  }

  if (typeof details === 'string') {
    return details;
  }

  if (typeof details === 'object') {
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function parseJson(text: string): unknown | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
