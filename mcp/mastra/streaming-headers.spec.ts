import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { stripTransferEncodingHeader } from './streaming-headers.js';

/**
 * Mirrors what `@mastra/hono` does for a route with `responseType: 'stream'` and
 * `streamFormat: 'sse'`: it declares the transfer encoding itself, then streams.
 */
function createApp() {
  const app = new Hono();
  app.use('*', stripTransferEncodingHeader);

  app.get('/api/agents/calendar/stream', (c) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Transfer-Encoding', 'chunked');
    return stream(c, async (s) => {
      await s.write('data: {"chunk":1}\n\n');
      await s.close();
    });
  });

  app.get('/api/agents', (c) => c.json({ agents: [] }));

  return app;
}

describe('stripTransferEncodingHeader', () => {
  it('removes the transfer encoding a streaming route declares', async () => {
    const response = await createApp().request('/api/agents/calendar/stream');

    // Left in place, the HTTP server adds a second copy of this header and Go's
    // net/http — the client cloudflared reaches the origin with — refuses the response
    // with "too many transfer encodings".
    expect(response.headers.get('Transfer-Encoding')).toBeNull();
  });

  it('leaves the rest of a streaming response alone', async () => {
    const response = await createApp().request('/api/agents/calendar/stream');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(await response.text()).toBe('data: {"chunk":1}\n\n');
  });

  it('leaves non-streaming responses alone', async () => {
    const response = await createApp().request('/api/agents');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agents: [] });
  });
});
