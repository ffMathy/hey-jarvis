import { describe, expect, it } from 'bun:test';
import {
  FIRST_RETRY_MS,
  followConversationOnServer,
  type JarvisServerMessage,
  LONGEST_RETRY_MS,
  openServerLink,
  type ServerLinkPlatform,
  type ServerSocket,
  serverSocketUrl,
} from './jarvis-server-link';

const ADDRESS = 'https://jarvis.example.com';
const CONVERSATION_ID = 'conv_0123456789abcdef';

/** A socket that records what it is sent, and is opened, answered and closed by hand. */
class FakeSocket implements ServerSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: string[] = [];
  closedByDevice = false;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closedByDevice = true;
    this.onclose?.({ code: 1000 });
  }

  /** The server accepting the connection. */
  open() {
    this.onopen?.();
  }

  /** The server sending a frame. */
  receive(data: unknown) {
    this.onmessage?.({ data });
  }

  /** The server, or the network, closing it. */
  drop(code: number) {
    this.onclose?.({ code });
  }
}

/** Sockets opened in order, and a clock that runs only when told to. */
function fakePlatform() {
  const sockets: FakeSocket[] = [];
  const waiting: { at: number; callback: () => void; cancelled: boolean }[] = [];
  let now = 0;
  const platform: ServerLinkPlatform = {
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    after: (milliseconds, callback) => {
      const entry = { at: now + milliseconds, callback, cancelled: false };
      waiting.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const entry of waiting.splice(0)) {
      if (entry.cancelled) continue;
      if (entry.at <= now) entry.callback();
      else waiting.push(entry);
    }
  };
  const latest = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('No socket was opened');
    return socket;
  };
  return { platform, sockets, advance, latest };
}

describe('the socket address', () => {
  it('is wss for an https server, and ws for this computer', () => {
    expect(serverSocketUrl('https://jarvis.example.com')).toBe('wss://jarvis.example.com/api/live');
    expect(serverSocketUrl('http://localhost:4112')).toBe('ws://localhost:4112/api/live');
  });
});

describe('a line to the server', () => {
  it('says hello with the conversation and the device, and passes on what the server sends', () => {
    const { platform, latest } = fakePlatform();
    const received: JarvisServerMessage[] = [];
    openServerLink(
      {
        address: ADDRESS,
        conversationId: CONVERSATION_ID,
        device: 'vr',
        onMessage: (message) => received.push(message),
      },
      platform,
    );

    const socket = latest();
    expect(socket.url).toBe('wss://jarvis.example.com/api/live');
    socket.open();
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'hello', conversationId: CONVERSATION_ID, device: 'vr' },
    ]);

    socket.receive('{"type":"ready"}');
    socket.receive('{"type":"something-newer"}');
    socket.receive('not json');
    socket.receive(new ArrayBuffer(4));
    expect(received).toEqual([{ type: 'ready' }]);
  });

  it('tries again after a drop, waiting twice as long each time up to a limit, and from the start once ready', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    openServerLink({ address: ADDRESS, conversationId: CONVERSATION_ID, device: 'phone' }, platform);

    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      latest().drop(1006);
      const before = sockets.length;
      let waited = 0;
      while (sockets.length === before) {
        advance(FIRST_RETRY_MS / 2);
        waited += FIRST_RETRY_MS / 2;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, LONGEST_RETRY_MS, LONGEST_RETRY_MS]);

    latest().open();
    latest().receive('{"type":"ready"}');
    latest().drop(1006);
    advance(FIRST_RETRY_MS);
    expect(sockets).toHaveLength(9);
  });

  for (const code of [4400, 4403, 4503]) {
    it(`never tries the same conversation again after the server closes it with ${code}`, () => {
      const { platform, sockets, advance, latest } = fakePlatform();
      openServerLink({ address: ADDRESS, conversationId: CONVERSATION_ID, device: 'watch' }, platform);
      latest().drop(code);
      advance(LONGEST_RETRY_MS * 10);
      expect(sockets).toHaveLength(1);
    });
  }

  it('tries again when ElevenLabs could not be asked, or the server was full', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    openServerLink({ address: ADDRESS, conversationId: CONVERSATION_ID, device: 'phone' }, platform);
    latest().drop(4502);
    advance(FIRST_RETRY_MS);
    latest().drop(4429);
    advance(FIRST_RETRY_MS * 2);
    expect(sockets).toHaveLength(3);
  });

  it('stops for good when closed, a retry it was waiting on included', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    const link = openServerLink({ address: ADDRESS, conversationId: CONVERSATION_ID, device: 'phone' }, platform);
    latest().drop(1006);
    link.close();
    advance(LONGEST_RETRY_MS);
    expect(sockets).toHaveLength(1);

    const second = openServerLink({ address: ADDRESS, conversationId: CONVERSATION_ID, device: 'phone' }, platform);
    const open = latest();
    second.close();
    expect(open.closedByDevice).toBe(true);
    advance(LONGEST_RETRY_MS);
    expect(sockets).toHaveLength(2);
  });
});

describe('following the conversation', () => {
  /** A session whose live conversation is set by hand, telling its listeners each time. */
  function fakeSession() {
    let conversationId: string | undefined;
    const listeners = new Set<() => void>();
    return {
      session: {
        liveConversationId: () => conversationId,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      setConversation: (next: string | undefined) => {
        conversationId = next;
        for (const listener of listeners) listener();
      },
      listeners,
    };
  }

  it('opens a line when a conversation connects, keeps the one line while it lasts, and closes it when it ends', () => {
    const { platform, sockets } = fakePlatform();
    const { session, setConversation } = fakeSession();
    followConversationOnServer(session, { address: ADDRESS, device: 'phone' }, platform);
    expect(sockets).toHaveLength(0);

    setConversation(CONVERSATION_ID);
    setConversation(CONVERSATION_ID);
    expect(sockets).toHaveLength(1);

    setConversation(undefined);
    expect(sockets[0]?.closedByDevice).toBe(true);

    setConversation('conv_fedcba9876543210');
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    expect(JSON.parse(sockets[1]?.sent[0] ?? '{}').conversationId).toBe('conv_fedcba9876543210');
  });

  it('opens nothing on a device with no server address', () => {
    const { platform, sockets } = fakePlatform();
    const { session, setConversation, listeners } = fakeSession();
    followConversationOnServer(session, { address: undefined, device: 'watch' }, platform);
    setConversation(CONVERSATION_ID);
    expect(sockets).toHaveLength(0);
    expect(listeners.size).toBe(0);
  });

  it('closes the line and stops listening when stopped', () => {
    const { platform, sockets } = fakePlatform();
    const { session, setConversation, listeners } = fakeSession();
    setConversation(CONVERSATION_ID);
    const stop = followConversationOnServer(session, { address: ADDRESS, device: 'vr' }, platform);
    expect(sockets).toHaveLength(1);
    stop();
    expect(sockets[0]?.closedByDevice).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
