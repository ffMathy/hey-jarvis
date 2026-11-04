import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { publishLiveEvent } from '../../utils/live-events.js';
import { currentPointing, resetPointingForTest } from '../../utils/pointing.js';
import type { StoredGlance } from '../visualize/glance-store.js';
import {
  attachLiveSocket,
  GLANCE_ACTION_REFUSALS,
  type GlanceRequestOutcome,
  LIVE_SOCKET_CLOSE_CODES,
  type LiveSocketOptions,
  type LiveSockets,
  MAX_FRAME_BYTES,
  MAX_GLANCE_REQUEST_ID_LENGTH,
  MAX_LIVE_SOCKETS,
  PAIRED_LIVE_SOCKET_PATH,
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

/** The prompts the stand-in runner was asked to run, in order. */
let ranRequests: string[] = [];

/** A runner that answers every request at once, as the routed request would have. */
async function answerAtOnce(request: string): Promise<GlanceRequestOutcome> {
  ranRequests.push(request);
  return { ok: true, message: `Done: ${request}.` };
}

/** The token of the one device paired with the servers these specs start. */
const DEVICE_TOKEN = 'd'.repeat(43);

/** A real HTTP server with the live socket on it, with no glance unless the spec gives one. */
async function serve(options: Partial<LiveSocketOptions> = {}): Promise<{ url: (path?: string) => string }> {
  ranRequests = [];
  server = createServer((_request, response) => response.end());
  live = attachLiveSocket(server, {
    runRequest: answerAtOnce,
    currentGlance: async () => undefined,
    isPairedDevice: async (token) => token === DEVICE_TOKEN,
    ...options,
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error('The server is not listening on a port');
  }
  const { port } = address;
  return { url: (path = PAIRED_LIVE_SOCKET_PATH) => `ws://127.0.0.1:${port}${path}` };
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

/** A paired device's hello. */
function hello(device = 'phone'): string {
  return JSON.stringify({ type: 'hello', device, token: DEVICE_TOKEN });
}

describe('the live socket', () => {
  it('says ready to a paired device’s hello, and then sends it every live event', async () => {
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
    await connect(url(PAIRED_LIVE_SOCKET_PATH.toUpperCase()));
    await connect(url(`${PAIRED_LIVE_SOCKET_PATH}?v=1`));
    await expect(connect(url('/api/elsewhere'))).rejects.toThrow();
    // Every app pairs, so the socket Cloudflare Access stood in front of is not served at all.
    await expect(connect(url('/api/live'))).rejects.toThrow();
  });

  it(`refuses a socket past ${MAX_LIVE_SOCKETS} at once`, async () => {
    const { url } = await serve();
    await Promise.all(Array.from({ length: MAX_LIVE_SOCKETS }, () => connect(url())));
    await expect(connect(url())).rejects.toThrow();
    expect(live?.size).toBe(MAX_LIVE_SOCKETS);
  });
});

const GLANCE: StoredGlance = {
  id: '6f1c9a4e-2b3d-4c5e-8f70-1a2b3c4d5e6f',
  url: 'https://jarvis.example.com/artifacts/0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b',
  artifactId: '0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b',
  title: 'Your parcel arrives this afternoon',
  generatedAt: '2026-11-01T10:00:00.000Z',
  actions: [{ id: 'unlock-front-door', label: 'Unlock the door', prompt: 'Unlock the front door' }],
};

/** The glance as the wire carries it: everything but the file its page is. */
const { artifactId: _artifactId, ...GLANCE_ON_THE_WIRE } = GLANCE;

/** A socket that has said hello, and every frame it has been sent, from the first. */
interface ListeningSocket {
  socket: WebSocket;
  frames: unknown[];
}

/**
 * Opens a socket, says hello, and waits for `ready` — and for the glance after it, when the server
 * has one. Every frame is recorded from the start, since two can arrive in the same moment.
 */
async function readySocket(url: string, expectsGlance: boolean): Promise<ListeningSocket> {
  const socket = await connect(url);
  const frames: unknown[] = [];
  socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
  socket.send(hello());
  await until(() => frames.length === (expectsGlance ? 2 : 1));
  expect(frames[0]).toEqual({ type: 'ready' });
  return { socket, frames };
}

/** The frames a socket is sent after the ones it has already been sent. */
async function framesAfter(listening: ListeningSocket, count: number, act: () => void): Promise<unknown[]> {
  const seen = listening.frames.length;
  act();
  await until(() => listening.frames.length >= seen + count);
  return listening.frames.slice(seen);
}

function glanceAction(actionId = 'unlock-front-door', glanceId = GLANCE.id, requestId = 'request-1'): string {
  return JSON.stringify({ type: 'glanceAction', requestId, glanceId, actionId });
}

function result(ok: boolean, message: string, requestId = 'request-1') {
  return { type: 'glanceActionResult', requestId, ok, message };
}

describe('the glance on the live socket', () => {
  it('sends the current glance right after ready, without the file it is kept in', async () => {
    const { url } = await serve({ currentGlance: async () => GLANCE });
    const { frames } = await readySocket(url(), true);

    expect(frames).toEqual([{ type: 'ready' }, { type: 'glance', glance: GLANCE_ON_THE_WIRE }]);
  });

  it('sends nothing after ready when there is no glance', async () => {
    const { url } = await serve();
    const listening = await readySocket(url(), false);

    const sent = await framesAfter(listening, 1, () =>
      publishLiveEvent({ type: 'affectedEntities', entities: [{ id: 'light.hall' }] }),
    );
    expect(sent).toEqual([{ type: 'affectedEntities', entities: [{ id: 'light.hall' }] }]);
  });

  it('sends a newly published glance to every socket', async () => {
    const { url } = await serve();
    const sockets = await Promise.all([readySocket(url(), false), readySocket(url(), false)]);

    publishLiveEvent({ type: 'glance', glance: GLANCE_ON_THE_WIRE });
    await until(() => sockets.every((listening) => listening.frames.length === 2));

    for (const { frames } of sockets) {
      expect(frames[1]).toEqual({ type: 'glance', glance: GLANCE_ON_THE_WIRE });
    }
  });

  it("runs a pressed action's own prompt, and answers only the socket that pressed it", async () => {
    const { url } = await serve({ currentGlance: async () => GLANCE });
    const [pressing, watching] = await Promise.all([readySocket(url(), true), readySocket(url(), true)]);

    const answered = await framesAfter(pressing, 1, () => pressing.socket.send(glanceAction()));

    expect(answered).toEqual([result(true, 'Done: Unlock the front door.')]);
    expect(ranRequests).toEqual(['Unlock the front door']);
    expect(watching.frames).toHaveLength(2);
  });

  it('refuses an action on a glance that has been replaced, and runs nothing', async () => {
    const { url } = await serve({ currentGlance: async () => GLANCE });
    const listening = await readySocket(url(), true);

    const answered = await framesAfter(listening, 1, () =>
      listening.socket.send(glanceAction('unlock-front-door', '7a2d0b5f-3c4e-4d6f-9a81-2b3c4d5e6f70')),
    );

    expect(answered).toEqual([result(false, GLANCE_ACTION_REFUSALS.staleGlance)]);
    expect(ranRequests).toEqual([]);
  });

  it('refuses an action when there is no glance at all', async () => {
    const { url } = await serve();
    const listening = await readySocket(url(), false);

    const answered = await framesAfter(listening, 1, () => listening.socket.send(glanceAction()));

    expect(answered).toEqual([result(false, GLANCE_ACTION_REFUSALS.staleGlance)]);
    expect(ranRequests).toEqual([]);
  });

  it('refuses an action the glance does not offer, and runs nothing', async () => {
    const { url } = await serve({ currentGlance: async () => GLANCE });
    const listening = await readySocket(url(), true);

    const answered = await framesAfter(listening, 1, () => listening.socket.send(glanceAction('open-garage')));

    expect(answered).toEqual([result(false, GLANCE_ACTION_REFUSALS.unknownAction)]);
    expect(ranRequests).toEqual([]);
  });

  it('refuses a second action while one runs, and answers the first when it is done', async () => {
    let finishFirst: (outcome: GlanceRequestOutcome) => void = () => undefined;
    const { url } = await serve({
      currentGlance: async () => GLANCE,
      runRequest: (request) => {
        ranRequests.push(request);
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      },
    });
    const listening = await readySocket(url(), true);

    listening.socket.send(glanceAction('unlock-front-door', GLANCE.id, 'first'));
    await until(() => ranRequests.length === 1);
    const refused = await framesAfter(listening, 1, () =>
      listening.socket.send(glanceAction('unlock-front-door', GLANCE.id, 'second')),
    );
    const answered = await framesAfter(listening, 1, () =>
      finishFirst({ ok: true, message: 'The front door is unlocked.' }),
    );

    expect(refused).toEqual([result(false, GLANCE_ACTION_REFUSALS.busy, 'second')]);
    expect(answered).toEqual([result(true, 'The front door is unlocked.', 'first')]);
    expect(ranRequests).toEqual(['Unlock the front door']);
  });

  it('answers a runner that throws as a failure, rather than leaving the button waiting', async () => {
    const { url } = await serve({
      currentGlance: async () => GLANCE,
      runRequest: async () => {
        throw new Error('routing exploded');
      },
    });
    const listening = await readySocket(url(), true);

    const answered = await framesAfter(listening, 1, () => listening.socket.send(glanceAction()));

    expect(answered).toEqual([result(false, GLANCE_ACTION_REFUSALS.failed)]);
  });

  it('ignores a glance action frame that breaks the schema', async () => {
    const { url } = await serve({ currentGlance: async () => GLANCE });
    const listening = await readySocket(url(), true);

    const answered = await framesAfter(listening, 1, () => {
      for (const frame of [
        { type: 'glanceAction', glanceId: GLANCE.id, actionId: 'unlock-front-door' },
        { type: 'glanceAction', requestId: '', glanceId: GLANCE.id, actionId: 'unlock-front-door' },
        {
          type: 'glanceAction',
          requestId: 'x'.repeat(MAX_GLANCE_REQUEST_ID_LENGTH + 1),
          glanceId: GLANCE.id,
          actionId: 'unlock-front-door',
        },
        { type: 'glanceAction', requestId: 'request-1', glanceId: GLANCE.id },
      ]) {
        listening.socket.send(JSON.stringify(frame));
      }
      // A frame that is answered, sent last, shows the ones before it were read and ignored.
      listening.socket.send(glanceAction('open-garage', GLANCE.id, 'last'));
    });

    expect(answered).toEqual([result(false, GLANCE_ACTION_REFUSALS.unknownAction, 'last')]);
    expect(ranRequests).toEqual([]);
  });

  it('fits the longest glance action a device may send in one frame', () => {
    const longest = JSON.stringify({
      type: 'glanceAction',
      requestId: 'x'.repeat(MAX_GLANCE_REQUEST_ID_LENGTH),
      glanceId: 'x'.repeat(64),
      actionId: 'x'.repeat(64),
    });
    expect(Buffer.byteLength(longest)).toBeLessThan(MAX_FRAME_BYTES);
  });
});

describe('the paired live socket', () => {
  const PAIRED_TOKEN = 'p'.repeat(43);
  const isPairedDevice = async (token: string) => token === PAIRED_TOKEN;

  function pairedHello(token?: string): string {
    return JSON.stringify({ type: 'hello', device: 'phone', ...(token === undefined ? {} : { token }) });
  }

  it('says ready to a hello with a paired device’s token, and sends it every live event', async () => {
    const { url } = await serve({ isPairedDevice });
    const socket = await connect(url(PAIRED_LIVE_SOCKET_PATH));

    const ready = nextEvent(socket);
    socket.send(pairedHello(PAIRED_TOKEN));
    expect(await ready).toEqual({ message: { type: 'ready' } });

    const sent = nextEvent(socket);
    publishLiveEvent({ type: 'affectedEntities', entities: [{ id: 'calendar.family' }] });
    expect(await sent).toEqual({ message: { type: 'affectedEntities', entities: [{ id: 'calendar.family' }] } });
  });

  it('closes a hello with no token, or one no paired device has, and sends it nothing', async () => {
    const { url } = await serve({ isPairedDevice });
    const withNone = await connect(url(PAIRED_LIVE_SOCKET_PATH));
    const withMadeUp = await connect(url(PAIRED_LIVE_SOCKET_PATH));

    const closedWithNone = nextEvent(withNone);
    const closedWithMadeUp = nextEvent(withMadeUp);
    withNone.send(pairedHello());
    withMadeUp.send(pairedHello('m'.repeat(43)));

    expect(await closedWithNone).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.unpaired });
    expect(await closedWithMadeUp).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.unpaired });
    expect(live?.listening).toBe(0);
  });

  it('acts on nothing a socket sends while its token is still being checked', async () => {
    let letThrough: (paired: boolean) => void = () => undefined;
    const { url } = await serve({
      isPairedDevice: () =>
        new Promise<boolean>((resolve) => {
          letThrough = resolve;
        }),
      currentGlance: async () => GLANCE,
    });
    const socket = await connect(url(PAIRED_LIVE_SOCKET_PATH));
    const closed = nextEvent(socket);

    socket.send(pairedHello('m'.repeat(43)));
    socket.send(
      JSON.stringify({ type: 'glanceAction', requestId: 'r1', glanceId: GLANCE.id, actionId: GLANCE.actions[0]?.id }),
    );
    await Bun.sleep(50);
    letThrough(false);

    expect(await closed).toEqual({ closed: LIVE_SOCKET_CLOSE_CODES.unpaired });
    expect(ranRequests).toEqual([]);
  });
});
