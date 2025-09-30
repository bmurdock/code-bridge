import { randomUUID } from 'node:crypto';

export type BridgeStreamLike = {
  body?: AsyncIterable<Uint8Array> | ReadableStreamLike | null;
};

type ReadableStreamLike = {
  getReader(): ReaderLike;
};

type ReaderLike = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock(): void;
};

export type WriteSseData = (data: string) => void;

export interface StreamMetrics {
  chunks: number;
  outputChars: number;
  status: 'completed' | 'cancelled' | 'failed';
  completionId: string;
  created: number;
}

export async function pipeBridgeSseToOpenAi(
  bridgeResponse: BridgeStreamLike,
  modelIdForOutput: string,
  writeData: WriteSseData
): Promise<StreamMetrics> {
  const FAILED_STATUS: StreamMetrics['status'] = 'failed';
  const reader = getAsyncIterableFromBody(bridgeResponse.body);
  const decoder = new TextDecoder();
  let buffer = '';
  let chunks = 0;
  let outputChars = 0;
  let finalStatus: StreamMetrics['status'] = 'completed';
  let sentDoneSignal = false;
  const completionId = formatCompletionId(randomUUID());
  const started = Math.floor(Date.now() / 1000);
  let resolvedModelId = modelIdForOutput;
  let sentInitialRole = false;

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = await processBuffer(buffer);
  }
  buffer += decoder.decode(new Uint8Array(), { stream: false });
  buffer = await processBuffer(buffer, true);

  if ((finalStatus as StreamMetrics['status']) === FAILED_STATUS && !sentDoneSignal) {
    // emit final [DONE] even on failure to allow client cleanup
    writeData('[DONE]');
  }

  return { chunks, outputChars, status: finalStatus, completionId, created: started };

  async function processBuffer(buf: string, flush = false): Promise<string> {
    buf = buf.replace(/\r\n/g, '\n');
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const raw = buf.slice(0, idx);
      await handleEvent(raw);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf('\n\n');
    }
    if (flush && buf.trim()) {
      await handleEvent(buf);
      return '';
    }
    return buf;
  }

  async function handleEvent(raw: string): Promise<void> {
    if (!raw.trim()) return;
    const lines = raw.split('\n');
    let event = 'message';
    const dataLines: string[] = [];

    for (const l of lines) {
      if (!l || l.startsWith(':')) continue;
      const sep = l.indexOf(':');
      if (sep === -1) continue;
      const field = l.slice(0, sep).trim();
      let val = l.slice(sep + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      if (field === 'event') {
        event = val;
      } else if (field === 'data') {
        dataLines.push(val);
      }
    }

    const dataStr = dataLines.join('\n');
    const payload = dataStr ? safeParse(dataStr, event) : undefined;

    switch (event) {
      case 'metadata': {
        const modelId = extractModelId(payload);
        if (modelId) {
          resolvedModelId = modelId;
        }
        emitInitialRoleChunk();
        break;
      }
      case 'chunk': {
        emitInitialRoleChunk();
        const text = extractChunkText(payload);
        if (!text) return;
        outputChars += text.length;
        chunks += 1;
        writeData(
          JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created: started,
            model: resolvedModelId,
            system_fingerprint: 'bridge-proxy',
            choices: [
              {
                index: 0,
                delta: { content: text },
                logprobs: null,
                finish_reason: null
              }
            ]
          })
        );
        break;
      }
      case 'done': {
        finalStatus = extractDoneStatus(payload);
        const finishReason = finalStatus === 'completed' ? 'stop' : finalStatus === 'cancelled' ? 'cancelled' : 'error';
        writeData(
          JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created: started,
            model: resolvedModelId,
            system_fingerprint: 'bridge-proxy',
            choices: [
              {
                index: 0,
                delta: {},
                logprobs: null,
                finish_reason: finishReason
              }
            ]
          })
        );
        writeData('[DONE]');
        sentDoneSignal = true;
        break;
      }
      case 'error': {
        finalStatus = FAILED_STATUS;
        const normalized = normalizeError(payload);
        writeData(
          JSON.stringify({
            error: {
              message: normalized.message,
              code: normalized.code,
              type: 'proxy_error'
            }
          })
        );
        if (!sentDoneSignal) {
          writeData('[DONE]');
          sentDoneSignal = true;
        }
        break;
      }
      default:
        break;
    }
  }

  function emitInitialRoleChunk() {
    if (sentInitialRole) return;
    sentInitialRole = true;
    writeData(
      JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created: started,
        model: resolvedModelId,
        system_fingerprint: 'bridge-proxy',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            logprobs: null,
            finish_reason: null
          }
        ]
      })
    );
  }
}

function safeParse(s: string, ctx: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`Invalid JSON in SSE ${ctx}`);
  }
}

type BridgeStreamBody = AsyncIterable<Uint8Array> | ReadableStreamLike | null | undefined;

function getAsyncIterableFromBody(body: BridgeStreamBody): AsyncIterable<Uint8Array> {
  if (!body) throw new Error('Bridge stream missing body');
  if (isAsyncIterable(body)) return body;
  if (isReadableStream(body)) return readableStreamToAsyncIterable(body);
  throw new Error('Bridge stream body is not async iterable');
}

function isAsyncIterable(value: BridgeStreamBody): value is AsyncIterable<Uint8Array> {
  return Boolean(value && typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function');
}

function isReadableStream(value: unknown): value is ReadableStreamLike {
  return Boolean(value && typeof (value as ReadableStreamLike).getReader === 'function');
}

function readableStreamToAsyncIterable(stream: ReadableStreamLike): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
  };
}

function extractModelId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const maybeModel = (payload as { model?: { id?: unknown } }).model;
  if (maybeModel && typeof maybeModel === 'object' && typeof maybeModel.id === 'string') {
    return maybeModel.id;
  }
  return undefined;
}

function extractChunkText(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

function extractDoneStatus(payload: unknown): StreamMetrics['status'] {
  if (payload && typeof payload === 'object' && 'status' in payload) {
    const status = (payload as { status?: unknown }).status;
    if (status === 'completed' || status === 'cancelled' || status === 'failed') {
      return status;
    }
  }
  return 'completed';
}

function normalizeError(payload: unknown): { message: string; code: string | null } {
  if (payload && typeof payload === 'object') {
    const maybeMessage = (payload as { message?: unknown }).message;
    const maybeCode = (payload as { statusCode?: unknown }).statusCode;
    return {
      message: typeof maybeMessage === 'string' ? maybeMessage : 'Bridge streaming error',
      code: typeof maybeCode === 'number' ? `bridge_${maybeCode}` : null
    };
  }
  return { message: 'Bridge streaming error', code: null };
}

function formatCompletionId(id: string): string {
  return `chatcmpl-${id.replace(/-/g, '')}`;
}
