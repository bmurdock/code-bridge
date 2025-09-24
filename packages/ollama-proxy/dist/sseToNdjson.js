export async function pipeBridgeSseToOllamaNdjson(bridgeResponse, kind, modelIdForOutput, writeLine) {
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
    async function processBuffer(buf, flush = false) {
        buf = buf.replace(/\r\n/g, '\n');
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
            const raw = buf.slice(0, idx);
            await handleEvent(raw);
            buf = buf.slice(idx + 2);
            idx = buf.indexOf('\n\n');
        }
        if (flush && buf.trim())
            await handleEvent(buf);
        return flush ? '' : buf;
    }
    async function handleEvent(raw) {
        if (!raw.trim())
            return;
        const lines = raw.split('\n');
        let event = 'message';
        const dataLines = [];
        for (const l of lines) {
            if (!l || l.startsWith(':'))
                continue;
            const sep = l.indexOf(':');
            if (sep === -1)
                continue;
            const field = l.slice(0, sep).trim();
            let val = l.slice(sep + 1);
            if (val.startsWith(' '))
                val = val.slice(1);
            if (field === 'event')
                event = val;
            else if (field === 'data')
                dataLines.push(val);
        }
        const dataStr = dataLines.join('\n');
        const payload = dataStr ? safeParse(dataStr, event) : undefined;
        switch (event) {
            case 'chunk': {
                const text = extractChunkText(payload);
                outputChars += text.length;
                chunks += 1;
                const line = kind === 'generate'
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
                const line = kind === 'generate'
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
function safeParse(s, ctx) {
    try {
        return JSON.parse(s);
    }
    catch {
        throw new Error(`Invalid JSON in SSE ${ctx}`);
    }
}
function getAsyncIterableFromBody(body) {
    if (!body)
        throw new Error('Bridge stream missing body');
    if (isAsyncIterable(body))
        return body;
    if (isReadableStream(body))
        return readableStreamToAsyncIterable(body);
    throw new Error('Bridge stream body is not async iterable');
}
function isAsyncIterable(value) {
    return Boolean(value && typeof value[Symbol.asyncIterator] === 'function');
}
function isReadableStream(value) {
    return Boolean(value && typeof value.getReader === 'function');
}
function readableStreamToAsyncIterable(stream) {
    return {
        async *[Symbol.asyncIterator]() {
            const reader = stream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (value)
                        yield value;
                }
            }
            finally {
                reader.releaseLock();
            }
        }
    };
}
function extractChunkText(payload) {
    if (payload && typeof payload === 'object' && 'text' in payload) {
        const text = payload.text;
        if (typeof text === 'string')
            return text;
    }
    return '';
}
function extractDoneStatus(payload) {
    if (payload && typeof payload === 'object' && 'status' in payload) {
        const status = payload.status;
        if (typeof status === 'string')
            return status;
    }
    return 'completed';
}
//# sourceMappingURL=sseToNdjson.js.map