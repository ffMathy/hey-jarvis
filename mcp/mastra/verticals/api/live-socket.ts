import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { type LiveEvent, onLiveEvent } from '../../utils/live-events.js';
import { logger } from '../../utils/logger.js';
import { forgetPointing, reportPointing } from '../../utils/pointing.js';

/**
 * The WebSocket API: a line from this server to each device that is Jarvis — the phone, the watch
 * and the headset — held open for as long as the device's app is running, whether or not a
 * conversation is under way.
 *
 * **Beside the REST API, not instead of it.** The REST routes (`routes.ts`) are asked: a device or
 * Home Assistant calls, and gets one answer. This is for what the server has to say first, which a
 * device cannot know to ask for, and for what a device keeps the server told of. The conversation
 * itself runs between the device and ElevenLabs; this socket knows nothing of it.
 *
 * **Public and unauthenticated.** The server checks nothing: whoever opens a socket and says hello
 * is sent every live event. Who may reach {@link LIVE_SOCKET_PATH} at all is left to Cloudflare Zero
 * Trust in front of the tunnel (see "MCP Server Access" in `mcp/AGENTS.md`). The hello is not a
 * credential: it says which device a socket is, for the log.
 *
 * **The protocol**, one JSON object per text frame:
 *
 * | Direction | Message | Meaning |
 * | --- | --- | --- |
 * | device → server | `{ type: "hello", device }` | The first frame, within {@link HELLO_TIMEOUT_MS} |
 * | server → device | `{ type: "ready" }` | This socket will now be sent every live event |
 * | server → device | `{ type: "affectedEntities", entities: [{ id, name? }] }` | A request's tool just read or changed these |
 * | device → server | `{ type: "pointing", entity: { id, name? } \| null }` | What sir is pointing at now, or nothing |
 *
 * Every event published on `utils/live-events.ts` goes to every socket that has said hello: a
 * device subscribes by holding a socket open, and acts on the events it cares about. What a socket
 * says it points at is kept until it says otherwise or closes, and written into the next request
 * routed (`utils/pointing.ts`). Anything else a device sends after its hello is ignored, so a device
 * built for a later version of this protocol can still be talked to. A refusal is a close, with one of {@link LIVE_SOCKET_CLOSE_CODES}.
 *
 * **Bounded for the Pi.** At most {@link MAX_LIVE_SOCKETS} at once, of which a socket still to say
 * hello is one; a frame over {@link MAX_FRAME_BYTES} closes its socket; and every socket is pinged
 * every {@link HEARTBEAT_MS} and let go of if it did not answer the last ping — which also keeps
 * Cloudflare, which closes a WebSocket idle for 100 seconds, from closing a quiet one.
 */

/** Where a device opens its socket. Spelled out, since every device builds this exact path. */
export const LIVE_SOCKET_PATH = '/api/live';

/** How long a socket has to say hello before it is closed. */
export const HELLO_TIMEOUT_MS = 10_000;

/** How often every socket is pinged, and how long one has to answer. */
export const HEARTBEAT_MS = 30_000;

/** The most sockets open at once, the ones still to say hello included. */
export const MAX_LIVE_SOCKETS = 32;

/** The largest frame a device may send: a hello is under a hundred bytes. */
export const MAX_FRAME_BYTES = 1024;

/**
 * Why a socket was closed, in the range RFC 6455 leaves to applications: an HTTP status plus 4000.
 *
 * A device tries again after anything but `badHello`, which a second attempt would only repeat.
 */
export const LIVE_SOCKET_CLOSE_CODES = {
  /** The first frame was not a hello. */
  badHello: 4400,
  /** No hello arrived within {@link HELLO_TIMEOUT_MS}. */
  helloTimeout: 4408,
} as const;

/** The devices that open a socket, for the log. */
export const LIVE_SOCKET_DEVICES = ['phone', 'watch', 'vr'] as const;

const helloSchema = z.object({
  type: z.literal('hello'),
  device: z.enum(LIVE_SOCKET_DEVICES),
});

const pointingSchema = z.object({
  type: z.literal('pointing'),
  entity: z.object({ id: z.string(), name: z.string().optional() }).nullable(),
});

/** What the server sends a device: `ready` once it has said hello, then every live event. */
export type LiveServerMessage = { type: 'ready' } | LiveEvent;

/** The open sockets. */
export interface LiveSockets {
  /** How many have said hello, and are sent every live event. */
  readonly listening: number;
  /** How many sockets are open, those still to say hello included. */
  readonly size: number;
  /** Closes every socket and stops listening for new ones. */
  close(): Promise<void>;
}

/** What a spec may change. */
export interface LiveSocketOptions {
  /** {@link HELLO_TIMEOUT_MS} unless a spec would rather not wait it out. */
  helloTimeoutMs?: number;
}

/** Whether an upgrade is for {@link LIVE_SOCKET_PATH}, in any case and with any query, as Express would route it. */
function isLiveSocketRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? '').split('?')[0]?.toLowerCase();
  return path === LIVE_SOCKET_PATH || path === `${LIVE_SOCKET_PATH}/`;
}

/** Refuses an upgrade before it becomes a socket. */
function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** RFC 6455's close code for a frame larger than the endpoint takes. */
const MESSAGE_TOO_BIG = 1009;

/** How many bytes a frame holds, however `ws` handed it over. */
function byteLengthOf(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((total, part) => total + part.byteLength, 0);
  }
  return data.byteLength;
}

/** A text frame read by `schema`, or `undefined` for anything else. */
function readFrame<Schema extends z.ZodType>(
  schema: Schema,
  data: RawData,
  isBinary: boolean,
): z.infer<Schema> | undefined {
  if (isBinary) {
    return undefined;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(data.toString()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves {@link LIVE_SOCKET_PATH} on `server`, sends every live event to every socket that has said
 * hello, and hands back the sockets it opens.
 *
 * Any other upgrade is refused: nothing else on this server speaks WebSocket.
 */
export function attachLiveSocket(server: Server, options: LiveSocketOptions = {}): LiveSockets {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const listening = new Set<WebSocket>();
  const answeredLastPing = new WeakMap<WebSocket, boolean>();

  const welcome = (socket: WebSocket) => {
    let saidHello = false;
    const helloTimer = setTimeout(() => socket.close(LIVE_SOCKET_CLOSE_CODES.helloTimeout), helloTimeoutMs);
    socket.once('close', () => clearTimeout(helloTimer));

    socket.on('message', (data, isBinary) => {
      // Checked here as well as by `maxPayload`, which Bun's own implementation of `ws` — the one
      // this server runs on — does not enforce.
      if (byteLengthOf(data) > MAX_FRAME_BYTES) {
        socket.close(MESSAGE_TOO_BIG);
        return;
      }
      if (saidHello) {
        const pointing = readFrame(pointingSchema, data, isBinary);
        if (pointing) {
          reportPointing(socket, pointing.entity ?? undefined);
        }
        return;
      }
      saidHello = true;
      clearTimeout(helloTimer);

      const hello = readFrame(helloSchema, data, isBinary);
      if (!hello) {
        socket.close(LIVE_SOCKET_CLOSE_CODES.badHello);
        return;
      }

      listening.add(socket);
      socket.once('close', () => {
        listening.delete(socket);
        forgetPointing(socket);
      });
      logger.info('[Live] Socket ready', { device: hello.device, open: sockets.clients.size });
      socket.send(JSON.stringify({ type: 'ready' } satisfies LiveServerMessage));
    });
  };

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isLiveSocketRequest(request)) {
      refuseUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (sockets.clients.size >= MAX_LIVE_SOCKETS) {
      refuseUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      answeredLastPing.set(webSocket, true);
      webSocket.on('pong', () => answeredLastPing.set(webSocket, true));
      // A socket that errors is closed by `ws` itself; listening keeps the error from being thrown.
      webSocket.on('error', () => undefined);
      welcome(webSocket);
    });
  };
  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!answeredLastPing.get(socket)) {
        socket.terminate();
        continue;
      }
      answeredLastPing.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const stopListening = onLiveEvent((event) => {
    const frame = JSON.stringify(event satisfies LiveServerMessage);
    for (const socket of listening) {
      if (socket.readyState === socket.OPEN) {
        socket.send(frame);
      }
    }
  });

  return {
    get listening() {
      return listening.size;
    },
    get size() {
      return sockets.clients.size;
    },
    close: async () => {
      clearInterval(heartbeat);
      stopListening();
      server.off('upgrade', onUpgrade);
      for (const socket of sockets.clients) {
        socket.terminate();
      }
      // Not waited on: with every socket terminated there is nothing left for it to do, and Bun's
      // implementation of `ws` never calls back.
      sockets.close();
    },
  };
}
