export type StreamKind = 'generate' | 'chat';

export type NdjsonWriteFn = (line: string) => void;

type ReaderLike = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock(): void;
};

type ReadableStreamLike = {
  getReader(): ReaderLike;
};

export type BridgeStreamLike = {
  body?: AsyncIterable<Uint8Array> | ReadableStreamLike | null;
};

export async function pipeBridgeSseToOllamaNdjson(
  bridgeResponse: BridgeStreamLike,
  kind: StreamKind,
  modelIdForOutput: string,
  writeLine: NdjsonWriteFn
): Promise<{ chunks: number; outputChars: number; status: string }> {
  const reader = getAsyncIterableFromBody(bridgeResponse.body);
  const decoder = new TextDecoder();
  let buffer = '';
  let chunks = 0;
  let outputChars = 0;
  let finalStatus = 'completed';

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = await processBuffer(buffer);
  }
  buffer += decoder.decode(new Uint8Array(), { stream: false });
  buffer = await processBuffer(buffer, true);

  return { chunks, outputChars, status: finalStatus };

  async function processBuffer(buf: string, flush = false): Promise<string> {
    buf = buf.replace(/\r\n/g, '\n');
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const raw = buf.slice(0, idx);
      await handleEvent(raw);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf('\n\n');
    }
    if (flush && buf.trim()) await handleEvent(buf);
    return flush ? '' : buf;
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
      if (field === 'event') event = val;
      else if (field === 'data') dataLines.push(val);
    }

    const dataStr = dataLines.join('\n');
    const payload = dataStr ? safeParse(dataStr, event) : undefined;

    switch (event) {
      case 'chunk': {
        const text = extractChunkText(payload);
        outputChars += text.length;
        chunks += 1;
        const line =
          kind === 'generate'
            ? JSON.stringify({
                model: modelIdForOutput,
                created_at: new Date().toISOString(),
                response: text,
                done: false
              })
            : JSON.stringify({
                model: modelIdForOutput,
                created_at: new Date().toISOString(),
                message: { role: 'assistant', content: text, images: null },
                done: false
              });
        writeLine(line);
        break;
      }
      case 'done': {
        finalStatus = extractDoneStatus(payload);
        const line =
          kind === 'generate'
            ? JSON.stringify({
                model: modelIdForOutput,
                created_at: new Date().toISOString(),
                response: '',
                done: true
              })
            : JSON.stringify({
                model: modelIdForOutput,
                created_at: new Date().toISOString(),
                done: true
              });
        writeLine(line);
        break;
      }
      case 'error': {
        // Propagate as best effort by writing a final done and letting connection close
        finalStatus = 'failed';
        const line = JSON.stringify({
          model: modelIdForOutput,
          created_at: new Date().toISOString(),
          done: true
        });
        writeLine(line);
        break;
      }
      default:
        // ignore other events
        break;
    }
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

function extractChunkText(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

function extractDoneStatus(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'status' in payload) {
    const status = (payload as { status?: unknown }).status;
    if (typeof status === 'string') return status;
  }
  return 'completed';
}
