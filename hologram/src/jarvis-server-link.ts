import { type AffectedEntity, affectedEntitiesOf, affectedEntityOf } from './affected-entities';

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

/** Which device a line is from, as the server's log names it. */
export type JarvisDevice = 'phone' | 'watch' | 'vr';

/**
 * The close codes after which the line is never tried again: a hello the server could not read,
 * which it would only refuse again. Every other close — a dropped connection, a server restarting —
 * is tried again.
 */
export const FINAL_SERVER_SOCKET_CLOSE_CODES: ReadonlySet<number> = new Set([4400]);

/** How long the first retry waits; each one after waits twice as long as the last. */
export const FIRST_RETRY_MS = 1_000;

/** The longest a retry waits. */
export const LONGEST_RETRY_MS = 30_000;

/**
 * What the server sends a device: `ready` once it has read the hello, and `affectedEntities`
 * whenever a tool in a request reports what it touched — sent to every device that has said hello. A device that shows nothing of it (the phone, the
 * watch) simply ignores it; the headset lights the entities up where they stand.
 */
export type JarvisServerMessage = { type: 'ready' } | { type: 'affectedEntities'; entities: readonly AffectedEntity[] };

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
  openSocket(url: string): ServerSocket;
  /** Calls `callback` once `milliseconds` have passed, unless the function it returns is called first. */
  after(milliseconds: number, callback: () => void): () => void;
}

/** The global `WebSocket`, as a {@link ServerSocket}: its handlers are called with no more than a line reads. */
function openWebSocket(url: string): ServerSocket {
  const webSocket = new WebSocket(url);
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
  /** Closes it, and stops trying. */
  close(): void;
}

/** The socket's URL for a server at `address`: `wss` for `https`, `ws` for this computer's `http`. */
export function serverSocketUrl(address: string): string {
  return `${address.replace(/^http/, 'ws')}${JARVIS_SERVER_SOCKET_PATH}`;
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
 * only tell a device that nothing happened.
 */
function readServerMessage(data: unknown): JarvisServerMessage | undefined {
  const parsed = parsedFrame(data);
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
    return undefined;
  }
  if (parsed.type === 'ready') {
    return { type: 'ready' };
  }
  if (parsed.type === 'affectedEntities') {
    const entities = affectedEntitiesOf(parsed);
    return entities.length > 0 ? { type: 'affectedEntities', entities } : undefined;
  }
  return undefined;
}

/** The line of a device with no server address: it points at nothing, hears nothing and has nothing to close. */
const NO_LINE: ServerLink = { point: () => undefined, subscribe: () => () => undefined, close: () => undefined };

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
  const url = serverSocketUrl(options.address);
  const hello = JSON.stringify({ type: 'hello', device: options.device });
  let socket: ServerSocket | undefined;
  /** The socket the server has said `ready` on, while it is still the one open. */
  let ready: ServerSocket | undefined;
  /** The latest `pointing` frame, once there has been one. */
  let pointing: string | undefined;
  let cancelRetry: (() => void) | undefined;
  let failedAttempts = 0;
  let closed = false;
  const listeners = new Set<(message: JarvisServerMessage) => void>();

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

  const connect = () => {
    cancelRetry = undefined;
    let opened: ServerSocket;
    try {
      opened = platform.openSocket(url);
    } catch {
      tryAgainLater();
      return;
    }
    socket = opened;
    opened.onopen = () => opened.send(hello);
    opened.onmessage = (event) => {
      const message = readServerMessage(event.data);
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        failedAttempts = 0;
        ready = opened;
        sendPointing();
      }
      for (const listener of listeners) {
        listener(message);
      }
    };
    opened.onclose = (event) => {
      if (socket !== opened) {
        return;
      }
      socket = undefined;
      ready = undefined;
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
    close: () => {
      closed = true;
      cancelRetry?.();
      cancelRetry = undefined;
      const open = socket;
      socket = undefined;
      ready = undefined;
      try {
        open?.close();
      } catch {
        // A socket that cannot be closed is one that is already going.
      }
    },
  };
}
