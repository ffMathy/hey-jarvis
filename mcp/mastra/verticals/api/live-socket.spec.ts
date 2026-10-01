import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { ConversationVerdict } from '../vision/index.js';
import {
  attachLiveSocket,
  LIVE_SOCKET_CLOSE_CODES,
  LIVE_SOCKET_PATH,
  type LiveSocketDependencies,
  type LiveSockets,
  MAX_LIVE_SOCKETS,
} from './live-socket.js';

const CONVERSATION_ID = 'conv_0123456789abcdef';

/** Who the check was asked about, and for whom. */
interface CheckCall {
  conversationId: string;
  source: string;
}

let server: Server | undefined;
let live: LiveSockets | undefined;
const opened: WebSocket[] = [];

afterEach(async () => {
  for (const socket of opened.splice(0)) {
    socket.terminate();
  }
  await live?.close();
  live = undefined;
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === 'object' && address !== null;
}

/** A real HTTP server with the live socket on it, answering every check with `verdict`. */
async function serve(
  verdict: ConversationVerdict = 'live',
  dependencies: LiveSocketDependencies = {},
): Promise<{ url: (path?: string) => string; calls: CheckCall[] }> {
  const calls: CheckCall[] = [];
  server = createServer((_request, response) => response.end());
  live = attachLiveSocket(server, {
    isLiveJarvisConversation: async (conversationId, source) => {
      calls.push({ conversationId, source });
      return verdict;
    },
    ...dependencies,
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error('The server is not listening on a port');
  }
  const { port } = address;
  return { url: (path = LIVE_SOCKET_PATH) => `ws://127.0.0.1:${port}${path}`, calls };
}

/**
 * Opens a socket and waits for it to open. Listens for errors for as long as the socket lives, since
 * Bun's `ws` client reports a refused upgrade more than once.
 */
async function connect(url: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  const socket = new WebSocket(url, { headers });
  opened.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.on('error', reject);
  });
  return socket;
}

/** The next message a socket gets, parsed, or how it was closed instead. */
function nextEvent(socket: WebSocket): Promise<{ message: unknown } | { closed: number }> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve({ message: JSON.parse(data.toString()) }));
    socket.once('close', (code) => resolve({ closed: code }));
  });
}

function hello(conversationId = CONVERSATION_ID): string {
  return JSON.stringify({ type: 'hello', conversationId, device: 'phone' });
}

describe('the live socket', () => {
  it('says ready once the conversation it names is live, and is sent what concerns that conversation', async () => {
    const { url, calls } = await serve('live');
    const socket = await connect(url());

    const ready = nextEvent(socket);
    socket.send(hello());
    expect(await ready).toEqual({ message: { type: 'ready' } });
    expect(calls).toEqual([{ conversationId: CONVERSATION_ID, source: '127.0.0.1' }]);

    const sent = nextEvent(socket);
    expect(live?.send(CONVERSATION_ID, { type: 'ready' })).toBe(1);
    expect(await sent).toEqual({ message: { type: 'ready' } });
    expect(live?.send('conv_someoneelse0000', { type: 'ready' })).toBe(0);
  });

  it('stops sending to a socket once it has closed', async () => {
    const { url } = await serve('live');
    const socket = await connect(url());
    const ready = nextEvent(socket);
    socket.send(hello());
    await ready;

    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    socket.close();
    await closed;
    // The server hears of the close a moment after the client does.
    for (let attempt = 0; attempt < 50 && live?.size; attempt++) {
      await Bun.sleep(5);
    }
    expect(live?.send(CONVERSATION_ID, { type: 'ready' })).toBe(0);
  });

  it('counts the asker by CF-Connecting-IP, as the photo slots do', async () => {
    const { url, calls } = await serve('live');
    const socket = await connect(url(), { 'CF-Connecting-IP': '203.0.113.7' });
    const ready = nextEvent(socket);
    socket.send(hello());
    await ready;
    expect(calls[0]?.source).toBe('203.0.113.7');
  });

  const refusals: [Exclude<ConversationVerdict, 'live'>, number][] = [
    ['not-live', LIVE_SOCKET_CLOSE_CODES.notLive],
    ['malformed', LIVE_SOCKET_CLOSE_CODES.badHello],
    ['too-many-checks', LIVE_SOCKET_CLOSE_CODES.tooMany],
    ['unverifiable', LIVE_SOCKET_CLOSE_CODES.unverifiable],
    ['switched-off', LIVE_SOCKET_CLOSE_CODES.switchedOff],
  ];
  for (const [verdict, code] of refusals) {
    it(`closes with ${code} when the check says ${verdict}, and is never sent anything`, async () => {
      const { url } = await serve(verdict);
      const socket = await connect(url());
      const event = nextEvent(socket);
      socket.send(hello());
      expect(await event).toEqual({ closed: code });
      expect(live?.send(CONVERSATION_ID, { type: 'ready' })).toBe(0);
    });
  }

  it('closes a socket whose first frame is not a hello, without asking ElevenLabs', async () => {
    const { url, calls } = await serve('live');
    for (const frame of ['not json', '{"type":"ready"}', '{"type":"hello"}', '{"type":"hello","conversationId":7}']) {
      const socket = await connect(url());
      const event = nextEvent(socket);
      socket.send(frame);
      expect(await event).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.badHello });
    }
    expect(calls).toEqual([]);
  });

  it('closes a socket that says nothing in time', async () => {
    const { url } = await serve('live', { helloTimeoutMs: 20 });
    const socket = await connect(url());
    expect(await nextEvent(socket)).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.helloTimeout });
  });

  it('closes a socket that sends more than a hello could be', async () => {
    const { url, calls } = await serve('live');
    const socket = await connect(url());
    const event = nextEvent(socket);
    socket.send(JSON.stringify({ type: 'hello', conversationId: CONVERSATION_ID, padding: 'x'.repeat(2048) }));
    expect(await event).toEqual({ closed: 1009 });
    expect(calls).toEqual([]);
  });

  it('serves its path in any case, as Express routes it, and nothing else', async () => {
    const { url } = await serve('live');
    await connect(url(LIVE_SOCKET_PATH.toUpperCase()));
    await connect(url(`${LIVE_SOCKET_PATH}?v=1`));
    await expect(connect(url('/api/elsewhere'))).rejects.toThrow();
  });

  it(`refuses a socket past ${MAX_LIVE_SOCKETS} at once`, async () => {
    const { url } = await serve('live');
    await Promise.all(Array.from({ length: MAX_LIVE_SOCKETS }, () => connect(url())));
    await expect(connect(url())).rejects.toThrow();
    expect(live?.size).toBe(MAX_LIVE_SOCKETS);
  });
});
