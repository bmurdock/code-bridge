import Fastify from 'fastify';

async function main() {
  const app = Fastify({ logger: true });

  app.get('/models', async () => {
    return [
      { id: 'mock:gpt', vendor: 'mock', family: 'gpt', version: '1', maxInputTokens: 8192 },
      { id: 'mock:llama', vendor: 'mock', family: 'llama', version: '1', maxInputTokens: 4096 }
    ];
  });

  app.post('/chat', async (req, reply) => {
    const accept = String(req.headers['accept'] || '').toLowerCase();
    const wantsStream = accept.includes('text/event-stream');

    if (!wantsStream) {
      return reply.send({ status: 'ok', output: 'hello from mock bridge' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    function sse(event: string, data: unknown) {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    sse('metadata', { model: { id: 'mock:gpt', vendor: 'mock', family: 'gpt', version: '1' }, request: { hasPrompt: true, messageCount: 1 } });
    sse('chunk', { text: 'hello ' });
    await new Promise((r) => setTimeout(r, 50));
    sse('chunk', { text: 'world' });
    await new Promise((r) => setTimeout(r, 50));
    sse('done', { status: 'completed' });
    reply.raw.end();
    return undefined;
  });

  const port = Number(process.env.MOCK_BRIDGE_PORT || 39218);
  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`Mock bridge listening on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal mock-bridge error:', err);
  process.exitCode = 1;
});

