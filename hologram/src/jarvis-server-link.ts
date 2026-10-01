import type { JarvisSession } from './session-contract';

/**
 * A device's line to the Jarvis server: a WebSocket each device that is Jarvis — the phone, the
 * watch and the headset — keeps open for as long as a conversation on it is live, so the server can
 * tell it things about that conversation as they happen.
 *
 * **Beside the conversation, not part of it.** The conversation itself runs between the device and
 * ElevenLabs, as it always has. The server's end is `verticals/api/live-socket.ts` in `mcp`, which
 * says what the socket is for and how it is kept from strangers: a socket says `hello` with the
 * ElevenLabs id of the conversation it is in, and hears nothing until ElevenLabs confirms that
 * conversation is live on Jarvis's agent. So a line is only ever opened for a connected
 * conversation ({@link JarvisSession.liveConversationId}), and closed when it ends.
 *
 * **Optional, like the server address it needs.** A device with no address talks to Jarvis exactly
 * as before, and a line that cannot be opened costs the conversation nothing: it is tried again, a
 * little later each time, until the server answers or refuses for good.
 *
 * Nothing here reaches for a platform but the global `WebSocket`, which a browser, React Native and
 * Bun all have, and that is handed in where a spec wants a fake one.
 */

/** Where the server serves the socket, after its address. Spelled as the server spells it. */
export const JARVIS_SERVER_SOCKET_PATH = '/api/live';

/** Which device a line is from, as the server's log names it. */
export type JarvisDevice = 'phone' | 'watch' | 'vr';

/**
 * The close codes after which the same conversation is never tried again, since the server would
 * only answer the same: a hello it could not read, a conversation that is not live on Jarvis's
 * agent, and a server with no way to check. Every other close — a dropped connection, ElevenLabs not
 * answering the server, too many sockets — is tried again.
 */
export const FINAL_SERVER_SOCKET_CLOSE_CODES: ReadonlySet<number> = new Set([4400, 4403, 4503]);

/** How long the first retry waits; each one after waits twice as long as the last. */
export const FIRST_RETRY_MS = 1_000;

/** The longest a retry waits. */
export const LONGEST_RETRY_MS = 30_000;

/** What the server sends a device. */
export type JarvisServerMessage = { type: 'ready' };

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

const DEFAULT_PLATFORM: ServerLinkPlatform = {
  openSocket: (url) => new WebSocket(url),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

export interface ServerLinkOptions {
  /** The server's origin, as `parseJarvisServerAddress` gives it. */
  address: string;
  /** The ElevenLabs id of the live conversation the line is for. */
  conversationId: string;
  device: JarvisDevice;
  /** Every message the server sends, once it is known to be one. */
  onMessage?(message: JarvisServerMessage): void;
}

/** A line that is open, or trying to be. */
export interface ServerLink {
  /** Closes it, and stops trying. */
  close(): void;
}

/** The socket's URL for a server at `address`: `wss` for `https`, `ws` for this computer's `http`. */
export function serverSocketUrl(address: string): string {
  return `${address.replace(/^http/, 'ws')}${JARVIS_SERVER_SOCKET_PATH}`;
}

/** A message the server sent, or `undefined` for one this device does not know. */
function readServerMessage(data: unknown): JarvisServerMessage | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && 'type' in parsed && parsed.type === 'ready'
      ? { type: 'ready' }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opens a line for one conversation, and keeps it open — trying again after a drop, from
 * {@link FIRST_RETRY_MS} up to {@link LONGEST_RETRY_MS} — until it is closed or the server refuses
 * the conversation for good ({@link FINAL_SERVER_SOCKET_CLOSE_CODES}).
 */
export function openServerLink(
  options: ServerLinkOptions,
  platform: ServerLinkPlatform = DEFAULT_PLATFORM,
): ServerLink {
  const url = serverSocketUrl(options.address);
  const hello = JSON.stringify({ type: 'hello', conversationId: options.conversationId, device: options.device });
  let socket: ServerSocket | undefined;
  let cancelRetry: (() => void) | undefined;
  let failedAttempts = 0;
  let closed = false;

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
      }
      options.onMessage?.(message);
    };
    opened.onclose = (event) => {
      if (socket !== opened) {
        return;
      }
      socket = undefined;
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
    close: () => {
      closed = true;
      cancelRetry?.();
      cancelRetry = undefined;
      const open = socket;
      socket = undefined;
      try {
        open?.close();
      } catch {
        // A socket that cannot be closed is one that is already going.
      }
    },
  };
}

/** What a device hands {@link followConversationOnServer}: where the server is, and who it is. */
export interface FollowOptions {
  /** The server's origin, or `undefined` for a device that has none: then there is never a line. */
  address: string | undefined;
  device: JarvisDevice;
  onMessage?(message: JarvisServerMessage): void;
}

/**
 * Keeps a line open to the server for whichever conversation `session` has live, and none while it
 * has none: opened when a conversation connects, closed when it ends, and a new one for the next.
 * Returns how to stop, which closes any line still open.
 */
export function followConversationOnServer(
  session: Pick<JarvisSession, 'liveConversationId' | 'subscribe'>,
  options: FollowOptions,
  platform: ServerLinkPlatform = DEFAULT_PLATFORM,
): () => void {
  const { address } = options;
  if (address === undefined) {
    return () => undefined;
  }

  let following: { conversationId: string; link: ServerLink } | undefined;
  const follow = () => {
    const conversationId = session.liveConversationId();
    if (conversationId === following?.conversationId) {
      return;
    }
    following?.link.close();
    following =
      conversationId === undefined
        ? undefined
        : {
            conversationId,
            link: openServerLink(
              { address, conversationId, device: options.device, onMessage: options.onMessage },
              platform,
            ),
          };
  };

  const unsubscribe = session.subscribe(follow);
  follow();
  return () => {
    unsubscribe();
    following?.link.close();
    following = undefined;
  };
}
