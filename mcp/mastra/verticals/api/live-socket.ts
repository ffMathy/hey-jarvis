import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { type LiveEvent, onLiveEvent } from '../../utils/live-events.js';
import { logger } from '../../utils/logger.js';
import { forgetPointing, reportPointing } from '../../utils/pointing.js';
import { readCurrentGlance, type StoredGlance, toGlanceSummary } from '../visualize/glance-store.js';

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
 * Trust in front of the tunnel (see "MCP Server Access" in `.claude/rules/mcp-mcp-server-access.md`). The hello is not a
 * credential: it says which device a socket is, for the log.
 *
 * **The protocol**, one JSON object per text frame:
 *
 * | Direction | Message | Meaning |
 * | --- | --- | --- |
 * | device → server | `{ type: "hello", device }` | The first frame, within {@link HELLO_TIMEOUT_MS} |
 * | server → device | `{ type: "ready" }` | This socket will now be sent every live event |
 * | server → device | `{ type: "affectedEntities", entities: [{ id, name? }] }` | A request's tool just read or changed these |
 * | server → device | `{ type: "agentActivity", delegationId, agentId, state }` | Where one of a request's agents has got to |
 * | device → server | `{ type: "pointing", entity: { id, name? } \| null }` | What sir is pointing at now, or nothing |
 * | server → device | `{ type: "glance", glance: { id, url, title, generatedAt, actions: [{ id, label, prompt }] } }` | The current glance: right after `ready` when there is one, and to every socket whenever a new one is built |
 * | device → server | `{ type: "glanceAction", requestId, glanceId, actionId }` | Sir pressed a button on the glance |
 * | server → device | `{ type: "glanceActionResult", requestId, ok, message }` | How that went, to that socket only |
 *
 * **A glance action runs only what the server planned.** It is looked up on the *current* glance by
 * both ids, so a device cannot have any prompt run but one the server itself put on the glance, and
 * a page that has since been replaced runs nothing. The prompt is then routed like the same words
 * spoken, through {@link LiveSocketOptions.runRequest}. One action runs at a time: another pressed
 * meanwhile is refused rather than queued, so a button pressed twice does not do it twice.
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

/** The longest id a device may name a glance action request by. */
export const MAX_GLANCE_REQUEST_ID_LENGTH = 64;

const glanceActionSchema = z.object({
  type: z.literal('glanceAction'),
  requestId: z.string().min(1).max(MAX_GLANCE_REQUEST_ID_LENGTH),
  glanceId: z.string().min(1).max(64),
  actionId: z.string().min(1).max(64),
});

/** What the server tells the one socket that asked for a glance action. */
export interface GlanceActionResult {
  type: 'glanceActionResult';
  requestId: string;
  ok: boolean;
  /** A short sentence to show sir. */
  message: string;
}

/**
 * What the server sends a device: `ready` once it has said hello, then every live event, and the
 * answer to each glance action it asks for.
 */
export type LiveServerMessage = { type: 'ready' } | LiveEvent | GlanceActionResult;

/** What became of a request run for a glance action. */
export interface GlanceRequestOutcome {
  ok: boolean;
  message: string;
}

/** Why a glance action is refused, as sir is shown it. */
export const GLANCE_ACTION_REFUSALS = {
  busy: 'Jarvis is still doing the last thing you asked. Try again in a moment.',
  staleGlance: 'That page is out of date. Open Jarvis again for the current one.',
  unknownAction: 'That button is not on the current page.',
  failed: 'That could not be done: the request failed.',
} as const;

/** The open sockets. */
export interface LiveSockets {
  /** How many have said hello, and are sent every live event. */
  readonly listening: number;
  /** How many sockets are open, those still to say hello included. */
  readonly size: number;
  /** Closes every socket and stops listening for new ones. */
  close(): Promise<void>;
}

/** What the socket needs from outside it, and what a spec may change. */
export interface LiveSocketOptions {
  /** {@link HELLO_TIMEOUT_MS} unless a spec would rather not wait it out. */
  helloTimeoutMs?: number;
  /**
   * Runs a glance action's prompt to completion, as a request routed like the same words spoken,
   * and says how it went. Handed in by `mcp-server.ts`, which holds the Mastra instance routing
   * plans against; a spec hands in a fake.
   */
  runRequest: (request: string) => Promise<GlanceRequestOutcome>;
  /** The current glance; the one `visualize/glance-store.ts` keeps unless a spec says otherwise. */
  currentGlance?: () => Promise<StoredGlance | undefined>;
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

/** Sends `message` to `socket`, unless it has closed meanwhile. */
function sendIfOpen(socket: WebSocket, message: LiveServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Tells a socket that has just said hello of the current glance, if there is one. A glance that
 * cannot be read costs the socket its glance until the next is built, and nothing else.
 */
async function sendCurrentGlance(
  socket: WebSocket,
  currentGlance: () => Promise<StoredGlance | undefined>,
): Promise<void> {
  try {
    const glance = await currentGlance();
    if (glance) {
      sendIfOpen(socket, { type: 'glance', glance: toGlanceSummary(glance) });
    }
  } catch (error) {
    logger.warn('[Live] Could not read the current glance for a new socket', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Carries out glance actions, one at a time across every socket: the action is looked up on the
 * current glance (the guard — see the protocol above), its prompt run by `runRequest`, and the
 * outcome made the answer. Never rejects: every way an action does not happen is an answer saying so.
 */
function createGlanceActionRunner(
  currentGlance: () => Promise<StoredGlance | undefined>,
  runRequest: LiveSocketOptions['runRequest'],
): (frame: z.infer<typeof glanceActionSchema>) => Promise<GlanceActionResult> {
  let running = false;

  return async ({ requestId, glanceId, actionId }) => {
    const answer = (ok: boolean, message: string): GlanceActionResult => ({
      type: 'glanceActionResult',
      requestId,
      ok,
      message,
    });

    if (running) {
      logger.info('[Live] Refused a glance action while another runs', { glanceId, actionId });
      return answer(false, GLANCE_ACTION_REFUSALS.busy);
    }
    running = true;
    try {
      const glance = await currentGlance();
      if (!glance || glance.id !== glanceId) {
        logger.info('[Live] Refused an action on a glance that is not the current one', { glanceId, actionId });
        return answer(false, GLANCE_ACTION_REFUSALS.staleGlance);
      }
      const action = glance.actions.find((candidate) => candidate.id === actionId);
      if (!action) {
        logger.info('[Live] Refused an action the glance does not offer', { glanceId, actionId });
        return answer(false, GLANCE_ACTION_REFUSALS.unknownAction);
      }

      logger.info('[Live] Running a glance action', { glanceId, actionId });
      const outcome = await runRequest(action.prompt);
      logger.info('[Live] A glance action finished', { glanceId, actionId, ok: outcome.ok });
      return answer(outcome.ok, outcome.message);
    } catch (error) {
      logger.error('[Live] A glance action failed', {
        glanceId,
        actionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return answer(false, GLANCE_ACTION_REFUSALS.failed);
    } finally {
      running = false;
    }
  };
}

/**
 * Serves {@link LIVE_SOCKET_PATH} on `server`, sends every live event to every socket that has said
 * hello, and hands back the sockets it opens.
 *
 * Any other upgrade is refused: nothing else on this server speaks WebSocket.
 */
export function attachLiveSocket(server: Server, options: LiveSocketOptions): LiveSockets {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const currentGlance = options.currentGlance ?? (() => readCurrentGlance());
  const runGlanceAction = createGlanceActionRunner(currentGlance, options.runRequest);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const listening = new Set<WebSocket>();
  const answeredLastPing = new WeakMap<WebSocket, boolean>();

  /** What a socket that has said hello may send: where sir points, and the glance's buttons. */
  const handleFrameAfterHello = (socket: WebSocket, data: RawData, isBinary: boolean) => {
    const pointing = readFrame(pointingSchema, data, isBinary);
    if (pointing) {
      reportPointing(socket, pointing.entity ?? undefined);
      return;
    }
    const glanceAction = readFrame(glanceActionSchema, data, isBinary);
    if (glanceAction) {
      void runGlanceAction(glanceAction).then((result) => sendIfOpen(socket, result));
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
        handleFrameAfterHello(socket, data, isBinary);
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
      void sendCurrentGlance(socket, currentGlance);
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
