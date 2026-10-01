import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import WebSocket from 'ws';
import { publishLiveEvent } from '../../utils/live-events.js';
import { currentPointing, resetPointingForTest } from '../../utils/pointing.js';
import {
  attachLiveSocket,
  LIVE_SOCKET_CLOSE_CODES,
  LIVE_SOCKET_PATH,
  type LiveSocketOptions,
  type LiveSockets,
  MAX_LIVE_SOCKETS,
  registerLiveSignInPage,
} from './live-socket.js';

let server: Server | undefined;
let live: LiveSockets | undefined;
const opened: WebSocket[] = [];

/** Waits for `condition`, for up to a second. */
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await Bun.sleep(10);
  }
  expect(condition()).toBe(true);
}

afterEach(async () => {
  resetPointingForTest();
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

/** A real HTTP server with the live socket on it. */
async function serve(options: LiveSocketOptions = {}): Promise<{ url: (path?: string) => string }> {
  server = createServer((_request, response) => response.end());
  live = attachLiveSocket(server, options);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error('The server is not listening on a port');
  }
  const { port } = address;
  return { url: (path = LIVE_SOCKET_PATH) => `ws://127.0.0.1:${port}${path}` };
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

function hello(device = 'phone'): string {
  return JSON.stringify({ type: 'hello', device });
}

describe('the sign-in page', () => {
  it('answers a browser that opens the socket’s path as a page, and caches nothing', async () => {
    const app = express();
    const router = express.Router();
    registerLiveSignInPage(router);
    app.use(router);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
    const address = server.address();
    if (!isAddressInfo(address)) {
      throw new Error('The server is not listening on a port');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${LIVE_SOCKET_PATH}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('You are through to your Jarvis server');
  });
});

describe('the live socket', () => {
  it('says ready to any hello, asking nobody, and then sends it every live event', async () => {
    const { url } = await serve();
    const socket = await connect(url());

    const ready = nextEvent(socket);
    socket.send(hello());
    expect(await ready).toEqual({ message: { type: 'ready' } });
    expect(live?.listening).toBe(1);

    const sent = nextEvent(socket);
    publishLiveEvent({
      type: 'affectedEntities',
      entities: [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }],
    });
    expect(await sent).toEqual({
      message: { type: 'affectedEntities', entities: [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }] },
    });
  });

  it('sends every socket that has said hello the same event', async () => {
    const { url } = await serve();
    const sockets = await Promise.all([connect(url()), connect(url())]);
    await Promise.all(
      sockets.map((socket, index) => {
        const ready = nextEvent(socket);
        socket.send(hello(index === 0 ? 'phone' : 'vr'));
        return ready;
      }),
    );

    const received = sockets.map((socket) => nextEvent(socket));
    publishLiveEvent({ type: 'affectedEntities', entities: [{ id: 'calendar.family' }] });
    for (const event of await Promise.all(received)) {
      expect(event).toEqual({ message: { type: 'affectedEntities', entities: [{ id: 'calendar.family' }] } });
    }
  });

  it('sends nothing to a socket that has not said hello yet', async () => {
    const { url } = await serve();
    const socket = await connect(url());
    const frames: unknown[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())));

    publishLiveEvent({ type: 'affectedEntities', entities: [{ id: 'light.hall' }] });
    const ready = nextEvent(socket);
    socket.send(hello());
    await ready;
    expect(frames).toEqual([{ type: 'ready' }]);
  });

  it('stops sending to a socket once it has closed, and stops listening for events once closed itself', async () => {
    const { url } = await serve();
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
    expect(live?.listening).toBe(0);
    publishLiveEvent({ type: 'affectedEntities', entities: [{ id: 'light.hall' }] });
  });

  it('keeps what a socket says sir points at until it says otherwise or closes', async () => {
    const { url } = await serve();
    const socket = await connect(url());
    const ready = nextEvent(socket);
    socket.send(hello());
    await ready;

    socket.send(JSON.stringify({ type: 'pointing', entity: { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' } }));
    await until(() => currentPointing() !== undefined);
    expect(currentPointing()).toEqual({ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' });

    socket.send(JSON.stringify({ type: 'pointing', entity: null }));
    await until(() => currentPointing() === undefined);

    socket.send(JSON.stringify({ type: 'pointing', entity: { id: 'light.porch' } }));
    await until(() => currentPointing() !== undefined);
    socket.close();
    await until(() => currentPointing() === undefined);
    expect(currentPointing()).toBeUndefined();
  });

  it('closes a socket whose first frame is not a hello', async () => {
    const { url } = await serve();
    for (const frame of [
      'not json',
      '{"type":"ready"}',
      '{"type":"hello"}',
      '{"type":"hello","device":"toaster"}',
      '["hello"]',
    ]) {
      const socket = await connect(url());
      const event = nextEvent(socket);
      socket.send(frame);
      expect(await event).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.badHello });
    }
  });

  it('closes a socket that says nothing in time', async () => {
    const { url } = await serve({ helloTimeoutMs: 20 });
    const socket = await connect(url());
    expect(await nextEvent(socket)).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.helloTimeout });
  });

  it('closes a socket that sends more than a hello could be', async () => {
    const { url } = await serve();
    const socket = await connect(url());
    const event = nextEvent(socket);
    socket.send(JSON.stringify({ type: 'hello', device: 'phone', padding: 'x'.repeat(2048) }));
    expect(await event).toEqual({ closed: 1009 });
  });

  it('serves its path in any case, as Express routes it, and nothing else', async () => {
    const { url } = await serve();
    await connect(url(LIVE_SOCKET_PATH.toUpperCase()));
    await connect(url(`${LIVE_SOCKET_PATH}?v=1`));
    await expect(connect(url('/api/elsewhere'))).rejects.toThrow();
  });

  it(`refuses a socket past ${MAX_LIVE_SOCKETS} at once`, async () => {
    const { url } = await serve();
    await Promise.all(Array.from({ length: MAX_LIVE_SOCKETS }, () => connect(url())));
    await expect(connect(url())).rejects.toThrow();
    expect(live?.size).toBe(MAX_LIVE_SOCKETS);
  });
});
