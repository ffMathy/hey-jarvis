import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

/**
 * The WebSocket API: a line from this server to each device sir is talking to Jarvis on — the phone,
 * the watch and the headset — for as long as the conversation lasts.
 *
 * **Beside the REST API, not instead of it.** The REST routes (`routes.ts`) are asked: a device or
 * Home Assistant calls, and gets one answer. This is for what the server has to say first, while a
 * conversation is under way, which a device cannot know to ask for. The conversation itself still
 * runs between the device and ElevenLabs; this socket carries only what the server adds to it.
 *
 * **Public and unauthenticated.** The server checks nothing: whoever opens a socket and says hello
 * is told what concerns the conversation it names. Who may reach {@link LIVE_SOCKET_PATH} at all is
 * left to Cloudflare Zero Trust in front of the tunnel (see "MCP Server Access" in `mcp/AGENTS.md`).
 * The hello is not a credential, only an address: it says which conversation a socket is for, so
 * the server knows where to send what it has to say.
 *
 * **The protocol**, one JSON object per text frame:
 *
 * | Direction | Message | Meaning |
 * | --- | --- | --- |
 * | device → server | `{ type: "hello", conversationId, device }` | The first frame, within {@link HELLO_TIMEOUT_MS} |
 * | server → device | `{ type: "ready" }` | This socket will now be told what concerns that conversation |
 *
 * Everything else a device sends after `ready` is ignored, so a device built for a later version of
 * this protocol can still be talked to. A refusal is a close, with one of {@link LIVE_SOCKET_CLOSE_CODES}.
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
  /** The first frame was not a hello naming a conversation. */
  badHello: 4400,
  /** No hello arrived within {@link HELLO_TIMEOUT_MS}. */
  helloTimeout: 4408,
} as const;

/** The longest conversation id taken: ElevenLabs' are well under it. */
const MAX_CONVERSATION_ID_LENGTH = 128;

/** The devices that open a socket, for the log. */
export const LIVE_SOCKET_DEVICES = ['phone', 'watch', 'vr'] as const;

const helloSchema = z.object({
  type: z.literal('hello'),
  conversationId: z.string().trim().min(1).max(MAX_CONVERSATION_ID_LENGTH),
  device: z.enum(LIVE_SOCKET_DEVICES).optional(),
});

/** What the server sends a device. */
export type LiveServerMessage = { type: 'ready' };

/** The open sockets, by the conversation each said hello for. */
export interface LiveSockets {
  /** Sends `message` to every socket in `conversationId`, and says to how many. */
  send(conversationId: string, message: LiveServerMessage): number;
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

/** The hello in a frame, or `undefined` for anything else. */
function readHello(data: RawData, isBinary: boolean): z.infer<typeof helloSchema> | undefined {
  if (isBinary) {
    return undefined;
  }
  try {
    const parsed = helloSchema.safeParse(JSON.parse(data.toString()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves {@link LIVE_SOCKET_PATH} on `server`, and hands back the sockets it opens.
 *
 * Any other upgrade is refused: nothing else on this server speaks WebSocket.
 */
export function attachLiveSocket(server: Server, options: LiveSocketOptions = {}): LiveSockets {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const byConversation = new Map<string, Set<WebSocket>>();
  const answeredLastPing = new WeakMap<WebSocket, boolean>();

  const forget = (conversationId: string, socket: WebSocket) => {
    const conversation = byConversation.get(conversationId);
    conversation?.delete(socket);
    if (conversation?.size === 0) {
      byConversation.delete(conversationId);
    }
  };

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
        return;
      }
      saidHello = true;
      clearTimeout(helloTimer);

      const hello = readHello(data, isBinary);
      if (!hello) {
        socket.close(LIVE_SOCKET_CLOSE_CODES.badHello);
        return;
      }

      const conversation = byConversation.get(hello.conversationId) ?? new Set<WebSocket>();
      conversation.add(socket);
      byConversation.set(hello.conversationId, conversation);
      socket.once('close', () => forget(hello.conversationId, socket));
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

  return {
    send: (conversationId, message) => {
      const conversation = byConversation.get(conversationId);
      if (!conversation) {
        return 0;
      }
      const frame = JSON.stringify(message);
      for (const socket of conversation) {
        socket.send(frame);
      }
      return conversation.size;
    },
    get size() {
      return sockets.clients.size;
    },
    close: async () => {
      clearInterval(heartbeat);
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
