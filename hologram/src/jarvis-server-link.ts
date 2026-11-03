import { type AffectedEntity, affectedEntitiesOf, affectedEntityOf } from './affected-entities';
import { type AgentActivity, agentActivityOf } from './agent-activity';
import {
  DROPPED_RESULT,
  GLANCE_ACTION_TIMEOUT_MS,
  GLANCE_REQUEST_ID_MAX_LENGTH,
  type Glance,
  type GlanceActionAnswer,
  type GlanceActionResult,
  glanceActionAnswerOf,
  glanceActionFrame,
  glanceOf,
  NOT_CONNECTED_RESULT,
  TIMED_OUT_RESULT,
} from './glance';

/**
 * A device's line to the Jarvis server: a WebSocket each device that is Jarvis — the phone, the
 * watch and the headset — keeps open for as long as its app is running, so the server can tell it
 * things as they happen and it can keep the server told of what sir points at.
 *
 * **Apart from the conversation.** The conversation runs between the device and ElevenLabs, as it
 * always has, and the line knows nothing of it: it is opened when the app has a server address,
 * stays open across conversations and between them, and is closed only when the app lets it go. The
 * server's end is `verticals/api/live-socket.ts` in `mcp`: a socket says `hello` with which device
 * it is, and is then sent every live event.
 *
 * **Optional, like the server address it needs.** A device with no address talks to Jarvis exactly
 * as before, and a line that cannot be opened costs it nothing: it is tried again, a little later
 * each time, until the server answers or refuses for good.
 *
 * Nothing here reaches for a platform but the global `WebSocket`, which a browser, React Native and
 * Bun all have, and that is handed in where a spec wants a fake one.
 */

/** Where the server serves the socket, after its address. Spelled as the server spells it. */
export const JARVIS_SERVER_SOCKET_PATH = '/api/live';

/**
 * Where a device paired with the server opens its socket instead (`PAIRED_LIVE_SOCKET_PATH` in
 * `mcp`): a path Cloudflare Access lets through, where the server itself checks the device's token,
 * sent in the hello. So a paired device needs no Access JWT and no cookie, which expire.
 */
export const JARVIS_SERVER_PAIRED_SOCKET_PATH = '/api/paired/live';

/** Which device a line is from, as the server's log names it. */
export type JarvisDevice = 'phone' | 'watch' | 'vr';

/**
 * The close codes after which the line is never tried again: a hello the server could not read,
 * which it would only refuse again. Every other close — a dropped connection, a server restarting —
 * is tried again.
 */
export const FINAL_SERVER_SOCKET_CLOSE_CODES: ReadonlySet<number> = new Set([4400, 4401]);

/** How long the first retry waits; each one after waits twice as long as the last. */
export const FIRST_RETRY_MS = 1_000;

/** The longest a retry waits. */
export const LONGEST_RETRY_MS = 30_000;

/**
 * What the server sends a device: `ready` once it has read the hello, `affectedEntities` whenever a
 * tool in a request reports what it touched, and `agentActivity` as each agent a request uses starts,
 * calls a tool and finishes — sent to every device that has said hello. A device that shows nothing of
 * them (the watch) simply ignores them; the headset lights the entities up where they stand, and the
 * headset and the phone draw the agents as satellites round him.
 *
 * And `glance`, right after `ready` when the server has a current one and whenever it makes a new
 * one (`glance.ts`), which the phone shows when it is opened rather than summoned; and
 * `glanceActionResult`, the answer to a `glanceAction` this device sent
 * ({@link ServerLink.requestGlanceAction}).
 */
export type JarvisServerMessage =
  | { type: 'ready' }
  | { type: 'affectedEntities'; entities: readonly AffectedEntity[] }
  | ({ type: 'agentActivity' } & AgentActivity)
  | { type: 'glance'; glance: Glance }
  | ({ type: 'glanceActionResult' } & GlanceActionAnswer);

/** As much of a `WebSocket` as a line uses, which a browser's, React Native's and Bun's all are. */
export interface ServerSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

/** What a line needs from outside itself, so a spec can hand it a fake socket and a clock. */
export interface ServerLinkPlatform {
  /** Opens a socket to `url`, with `headers` on its upgrade request where the platform can send them. */
  openSocket(url: string, headers: Readonly<Record<string, string>>): ServerSocket;
  /** Calls `callback` once `milliseconds` have passed, unless the function it returns is called first. */
  after(milliseconds: number, callback: () => void): () => void;
}

/**
 * React Native's `WebSocket`, which takes the upgrade request's headers as a third argument. A
 * browser's has no such argument and ignores it: a page cannot set a header on a WebSocket at all.
 * The global is assignable to this as it is, since a constructor that takes fewer arguments may
 * stand in for one that is handed more.
 */
interface WebSocketWithHeaders {
  new (url: string, protocols: undefined, options: { headers: Readonly<Record<string, string>> }): WebSocket;
}

/**
 * The global `WebSocket`, as a {@link ServerSocket}: its handlers are called with no more than a line
 * reads, and `headers` go on the upgrade request on a phone and a watch (React Native) and are
 * dropped by a browser.
 */
function openWebSocket(url: string, headers: Readonly<Record<string, string>>): ServerSocket {
  const HeaderedWebSocket: WebSocketWithHeaders = WebSocket;
  const webSocket = new HeaderedWebSocket(url, undefined, { headers });
  const socket: ServerSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: (data) => webSocket.send(data),
    close: () => webSocket.close(),
  };
  webSocket.onopen = () => socket.onopen?.();
  webSocket.onmessage = (event) => socket.onmessage?.({ data: event.data });
  webSocket.onclose = (event) => socket.onclose?.({ code: event.code });
  return socket;
}

const DEFAULT_PLATFORM: ServerLinkPlatform = {
  openSocket: openWebSocket,
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

export interface ServerLinkOptions {
  /** The server's origin, as `parseJarvisServerAddress` gives it, or `undefined` for none: then there is never a line. */
  address: string | undefined;
  device: JarvisDevice;
  /**
   * The JWT the Cloudflare Zero Trust application in front of the server accepts, as
   * `parseJarvisServerToken` gives it, or `undefined` for a server with nothing in front of it. See
   * {@link serverAuthorizationHeaders} for how it is sent.
   */
  token?: string;
  /**
   * The token this device was paired with, when it is paired: the line then opens on
   * {@link JARVIS_SERVER_PAIRED_SOCKET_PATH} and says it in the hello. A server that no longer knows
   * it closes the socket with 4401, after which the line is not tried again.
   */
  deviceToken?: string;
}

/**
 * The headers a token travels in on the socket's upgrade request: `Authorization: Bearer`, and
 * `cf-access-token`, the header Cloudflare Access reads an Access JWT from. Both, so the token gets
 * through whichever way the application in front of the server is set to read it.
 *
 * Only a phone and a watch can send them: a browser cannot set a header on a WebSocket, so the
 * headset's page and the phone's web build connect without them.
 */
export function serverAuthorizationHeaders(token: string | undefined): Readonly<Record<string, string>> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}`, 'cf-access-token': token };
}

/** A line that is open, or trying to be. */
export interface ServerLink {
  /**
   * Tells the server what sir is pointing at — an entity, or `undefined` for nothing — in a
   * `pointing` frame. Only the latest is kept: it is sent once the server has said `ready`, at once
   * if it already has, and again after every reconnect's `ready`, since the server keeps the latest
   * per socket and a new socket starts with none. An entity is held to the limits of
   * `affected-entities.ts`, and one without a usable id is sent as nothing.
   */
  point(entity: AffectedEntity | undefined): void;
  /**
   * Calls `listener` with every message the server sends from now on, once it is known to be one,
   * until the function it returns is called. A device that cares about none of them subscribes to
   * nothing, and the line stays open all the same.
   */
  subscribe(listener: (message: JarvisServerMessage) => void): () => void;
  /**
   * Calls `listener` with whether the line is connected — the server has said `ready` on the socket
   * open now — at once, and again every time that changes, until the function it returns is called.
   * A browser cannot tell a socket Cloudflare Access turned away from one that never reached the
   * server, so not connected is all a page learns; it is what tells the headset's page to offer
   * signing in.
   */
  onConnectionChange(listener: (connected: boolean) => void): () => void;
  /**
   * Calls `listener` with the latest glance the server has sent on this line — at once, with
   * `undefined` while there has been none — and again with every new one, until the function it
   * returns is called. A glance is kept across a reconnect, since the server sends its current one
   * again after the new socket's `ready`.
   */
  onGlance(listener: (glance: Glance | undefined) => void): () => void;
  /**
   * Asks the server to run the action `actionId` of the glance `glanceId`, in a `glanceAction` frame,
   * and resolves with what it answered. Never rejects: a line that is not connected answers at once
   * that nothing was done, and one that drops or is closed first, or a server that has not answered
   * within {@link GLANCE_ACTION_TIMEOUT_MS}, answers that it is not known whether it was.
   *
   * Confirming it with sir is the caller's: this sends whatever it is asked to.
   */
  requestGlanceAction(glanceId: string, actionId: string): Promise<GlanceActionResult>;
  /** Closes it, and stops trying. */
  close(): void;
}

/**
 * The socket's URL for a server at `address`: `wss` for `https`, `ws` for this computer's `http`; on
 * the paired path for a paired device.
 */
export function serverSocketUrl(address: string, paired = false): string {
  return `${address.replace(/^http/, 'ws')}${paired ? JARVIS_SERVER_PAIRED_SOCKET_PATH : JARVIS_SERVER_SOCKET_PATH}`;
}

/** The `pointing` frame for `entity`: `null` for nothing, and for an entity without a usable id. */
function pointingFrame(entity: AffectedEntity | undefined): string {
  const pointed = entity === undefined ? undefined : affectedEntityOf(entity);
  return JSON.stringify({ type: 'pointing', entity: pointed ?? null });
}

/** The frame's JSON, or `undefined` for a frame that is not JSON text. */
function parsedFrame(data: unknown): unknown {
  if (typeof data !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/**
 * A message the server sent, or `undefined` for one this device does not know — and for an
 * `affectedEntities` message that names nothing usable (see `affected-entities.ts`), which would
 * only tell a device that nothing happened, and an `agentActivity` one that is not usable
 * (`agent-activity.ts`).
 */
function readServerMessage(data: unknown): JarvisServerMessage | undefined {
  const parsed = parsedFrame(data);
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || typeof parsed.type !== 'string') {
    return undefined;
  }
  return MESSAGE_READERS.get(parsed.type)?.(parsed);
}

/** How one kind of message is read: `undefined` for one that is not usable. */
type MessageReader = (parsed: object) => JarvisServerMessage | undefined;

/** How each message the server sends is read, by its `type`. */
const MESSAGE_READERS: ReadonlyMap<string, MessageReader> = new Map<string, MessageReader>([
  ['ready', () => ({ type: 'ready' })],
  [
    'affectedEntities',
    (parsed) => {
      const entities = affectedEntitiesOf(parsed);
      return entities.length > 0 ? { type: 'affectedEntities', entities } : undefined;
    },
  ],
  [
    'agentActivity',
    (parsed) => {
      const activity = agentActivityOf(parsed);
      return activity === undefined ? undefined : { type: 'agentActivity', ...activity };
    },
  ],
  [
    'glance',
    (parsed) => {
      const glance = glanceOf('glance' in parsed ? parsed.glance : undefined);
      return glance === undefined ? undefined : { type: 'glance', glance };
    },
  ],
  [
    'glanceActionResult',
    (parsed) => {
      const answer = glanceActionAnswerOf(parsed);
      return answer === undefined ? undefined : { type: 'glanceActionResult', ...answer };
    },
  ],
]);

/**
 * A request id no other request on this line has had: a count, and the moment the line was opened in
 * base 36, so a server that outlives a line never hears the same id from the same device twice. Well
 * inside {@link GLANCE_REQUEST_ID_MAX_LENGTH}.
 */
function requestIds(): () => string {
  const opened = Date.now().toString(36);
  let count = 0;
  return () => {
    count += 1;
    return `glance-${opened}-${count}`.slice(0, GLANCE_REQUEST_ID_MAX_LENGTH);
  };
}

/** The line of a device with no server address: it points at nothing, hears nothing and has nothing to close. */
const NO_LINE: ServerLink = {
  point: () => undefined,
  subscribe: () => () => undefined,
  onConnectionChange: (listener) => {
    listener(false);
    return () => undefined;
  },
  onGlance: (listener) => {
    listener(undefined);
    return () => undefined;
  },
  requestGlanceAction: async () => NOT_CONNECTED_RESULT,
  close: () => undefined,
};

/**
 * Opens the device's line to the server, and keeps it open — trying again after a drop, from
 * {@link FIRST_RETRY_MS} up to {@link LONGEST_RETRY_MS} — until it is closed or the server refuses it
 * for good ({@link FINAL_SERVER_SOCKET_CLOSE_CODES}). With no address, there is no line.
 */
export function connectToServer(
  options: ServerLinkOptions,
  platform: ServerLinkPlatform = DEFAULT_PLATFORM,
): ServerLink {
  if (options.address === undefined) {
    return NO_LINE;
  }
  const { deviceToken } = options;
  const url = serverSocketUrl(options.address, deviceToken !== undefined);
  const headers = serverAuthorizationHeaders(options.token);
  const hello = JSON.stringify({
    type: 'hello',
    device: options.device,
    ...(deviceToken === undefined ? {} : { token: deviceToken }),
  });
  let socket: ServerSocket | undefined;
  /** The socket the server has said `ready` on, while it is still the one open. */
  let ready: ServerSocket | undefined;
  /** The latest `pointing` frame, once there has been one. */
  let pointing: string | undefined;
  let cancelRetry: (() => void) | undefined;
  let failedAttempts = 0;
  let closed = false;
  const listeners = new Set<(message: JarvisServerMessage) => void>();
  const connectionListeners = new Set<(connected: boolean) => void>();
  let connected = false;
  let glance: Glance | undefined;
  const glanceListeners = new Set<(glance: Glance | undefined) => void>();
  const nextRequestId = requestIds();
  /** The glance actions sent and not yet answered, by request id. */
  const pending = new Map<string, { answer: (result: GlanceActionResult) => void }>();
  /** Answers every action still waiting with `result`: the line they were sent on is gone. */
  const answerEveryPending = (result: GlanceActionResult) => {
    for (const request of [...pending.values()]) {
      request.answer(result);
    }
  };
  const setConnected = (now: boolean) => {
    if (now === connected) {
      return;
    }
    connected = now;
    for (const listener of connectionListeners) {
      listener(now);
    }
  };

  const sendPointing = () => {
    if (pointing === undefined || ready === undefined) {
      return;
    }
    try {
      ready.send(pointing);
    } catch {
      // A socket that cannot take a frame is one that is going; the next one's `ready` sends it.
    }
  };

  /** What the line does with a message the server sent on `opened`, before every listener hears it. */
  const hear = (opened: ServerSocket, message: JarvisServerMessage) => {
    if (message.type === 'ready') {
      failedAttempts = 0;
      ready = opened;
      setConnected(true);
      sendPointing();
    }
    if (message.type === 'glance') {
      glance = message.glance;
      for (const listener of glanceListeners) {
        listener(glance);
      }
    }
    if (message.type === 'glanceActionResult') {
      pending.get(message.requestId)?.answer({ ok: message.ok, message: message.message });
    }
    for (const listener of listeners) {
      listener(message);
    }
  };

  const connect = () => {
    cancelRetry = undefined;
    let opened: ServerSocket;
    try {
      opened = platform.openSocket(url, headers);
    } catch {
      tryAgainLater();
      return;
    }
    socket = opened;
    opened.onopen = () => opened.send(hello);
    opened.onmessage = (event) => {
      const message = readServerMessage(event.data);
      if (message) {
        hear(opened, message);
      }
    };
    opened.onclose = (event) => {
      if (socket !== opened) {
        return;
      }
      socket = undefined;
      ready = undefined;
      setConnected(false);
      answerEveryPending(DROPPED_RESULT);
      if (!closed && !FINAL_SERVER_SOCKET_CLOSE_CODES.has(event.code)) {
        tryAgainLater();
      }
    };
  };

  const tryAgainLater = () => {
    if (closed) {
      return;
    }
    const delay = Math.min(FIRST_RETRY_MS * 2 ** failedAttempts, LONGEST_RETRY_MS);
    failedAttempts += 1;
    cancelRetry = platform.after(delay, connect);
  };

  connect();

  return {
    point: (entity) => {
      pointing = pointingFrame(entity);
      sendPointing();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onConnectionChange: (listener) => {
      connectionListeners.add(listener);
      listener(connected);
      return () => {
        connectionListeners.delete(listener);
      };
    },
    onGlance: (listener) => {
      glanceListeners.add(listener);
      listener(glance);
      return () => {
        glanceListeners.delete(listener);
      };
    },
    requestGlanceAction: (glanceId, actionId) => {
      const line = ready;
      if (line === undefined) {
        return Promise.resolve(NOT_CONNECTED_RESULT);
      }
      const requestId = nextRequestId();
      return new Promise<GlanceActionResult>((resolve) => {
        const stopWaiting = platform.after(GLANCE_ACTION_TIMEOUT_MS, () => answer(TIMED_OUT_RESULT));
        const answer = (result: GlanceActionResult) => {
          pending.delete(requestId);
          stopWaiting();
          resolve(result);
        };
        pending.set(requestId, { answer });
        try {
          line.send(glanceActionFrame(requestId, glanceId, actionId));
        } catch {
          // A socket that cannot take a frame is one that is going: nothing was sent.
          answer(NOT_CONNECTED_RESULT);
        }
      });
    },
    close: () => {
      closed = true;
      cancelRetry?.();
      cancelRetry = undefined;
      const open = socket;
      socket = undefined;
      ready = undefined;
      setConnected(false);
      answerEveryPending(DROPPED_RESULT);
      try {
        open?.close();
      } catch {
        // A socket that cannot be closed is one that is already going.
      }
    },
  };
}
