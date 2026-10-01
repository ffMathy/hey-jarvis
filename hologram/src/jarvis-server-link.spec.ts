import { describe, expect, it } from 'bun:test';
import { AFFECTED_ENTITY_ID_MAX_LENGTH, AFFECTED_ENTITY_NAME_MAX_LENGTH } from './affected-entities';
import {
  connectToServer,
  FIRST_RETRY_MS,
  type JarvisServerMessage,
  LONGEST_RETRY_MS,
  type ServerLinkPlatform,
  type ServerSocket,
  serverSocketUrl,
} from './jarvis-server-link';

const ADDRESS = 'https://jarvis.example.com';

/** A socket that records what it is sent, and is opened, answered and closed by hand. */
class FakeSocket implements ServerSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: string[] = [];
  closedByDevice = false;

  constructor(
    readonly url: string,
    readonly headers: Readonly<Record<string, string>>,
  ) {}

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
    openSocket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
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
  it('says hello with the device, and passes on what the server sends', () => {
    const { platform, latest } = fakePlatform();
    const received: JarvisServerMessage[] = [];
    connectToServer({ address: ADDRESS, device: 'vr' }, platform).subscribe((message) => received.push(message));

    const socket = latest();
    expect(socket.url).toBe('wss://jarvis.example.com/api/live');
    socket.open();
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([{ type: 'hello', device: 'vr' }]);

    socket.receive('{"type":"ready"}');
    socket.receive('{"type":"something-newer"}');
    socket.receive('not json');
    socket.receive(new ArrayBuffer(4));
    expect(received).toEqual([{ type: 'ready' }]);
  });

  it('passes on the entities a request touched, as the server names them', () => {
    const { platform, latest } = fakePlatform();
    const received: JarvisServerMessage[] = [];
    connectToServer({ address: ADDRESS, device: 'vr' }, platform).subscribe((message) => received.push(message));
    latest().open();

    latest().receive(
      JSON.stringify({
        type: 'affectedEntities',
        entities: [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }, { id: 'inbox:work' }],
      }),
    );

    expect(received).toEqual([
      {
        type: 'affectedEntities',
        entities: [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }, { id: 'inbox:work' }],
      },
    ]);
  });

  it('keeps only the usable entities of a frame, and drops a frame with none', () => {
    const { platform, latest } = fakePlatform();
    const received: JarvisServerMessage[] = [];
    connectToServer({ address: ADDRESS, device: 'vr' }, platform).subscribe((message) => received.push(message));
    latest().open();

    latest().receive(
      JSON.stringify({ type: 'affectedEntities', entities: [{ id: '  light.hall  ', name: 7 }, { id: '' }, 42] }),
    );
    latest().receive(JSON.stringify({ type: 'affectedEntities', entities: [{ id: '   ' }, { name: 'No id' }] }));
    latest().receive(JSON.stringify({ type: 'affectedEntities', entities: [] }));
    latest().receive(JSON.stringify({ type: 'affectedEntities' }));
    latest().receive(JSON.stringify({ type: 'affectedEntities', entities: 'light.hall' }));

    expect(received).toEqual([{ type: 'affectedEntities', entities: [{ id: 'light.hall' }] }]);
  });

  it('tries again after a drop, waiting twice as long each time up to a limit, and from the start once ready', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    connectToServer({ address: ADDRESS, device: 'phone' }, platform);

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

  it('never tries again after the server could not read its hello', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    connectToServer({ address: ADDRESS, device: 'watch' }, platform);
    latest().drop(4400);
    advance(LONGEST_RETRY_MS * 10);
    expect(sockets).toHaveLength(1);
  });

  it('tries again after the server gave up waiting for a hello, or went away', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    connectToServer({ address: ADDRESS, device: 'phone' }, platform);
    latest().drop(4408);
    advance(FIRST_RETRY_MS);
    latest().drop(1001);
    advance(FIRST_RETRY_MS * 2);
    expect(sockets).toHaveLength(3);
  });

  it('stops for good when closed, a retry it was waiting on included', () => {
    const { platform, sockets, advance, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'phone' }, platform);
    latest().drop(1006);
    link.close();
    advance(LONGEST_RETRY_MS);
    expect(sockets).toHaveLength(1);

    const second = connectToServer({ address: ADDRESS, device: 'phone' }, platform);
    const open = latest();
    second.close();
    expect(open.closedByDevice).toBe(true);
    advance(LONGEST_RETRY_MS);
    expect(sockets).toHaveLength(2);
  });
});

describe('telling the server what sir points at', () => {
  const KITCHEN = { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' };

  /** The pointing frames a socket was sent, parsed. */
  function pointingSent(socket: FakeSocket): unknown[] {
    return socket.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === 'pointing');
  }

  it('sends nothing before the server is ready, and the latest once it is', () => {
    const { platform, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'vr' }, platform);

    link.point({ id: 'light.hall' });
    latest().open();
    link.point(KITCHEN);
    expect(pointingSent(latest())).toEqual([]);

    latest().receive('{"type":"ready"}');
    expect(pointingSent(latest())).toEqual([{ type: 'pointing', entity: KITCHEN }]);
  });

  it('sends at once once ready, and null when sir points at nothing', () => {
    const { platform, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'vr' }, platform);
    latest().open();
    latest().receive('{"type":"ready"}');
    expect(pointingSent(latest())).toEqual([]);

    link.point(KITCHEN);
    link.point(undefined);

    expect(pointingSent(latest())).toEqual([
      { type: 'pointing', entity: KITCHEN },
      { type: 'pointing', entity: null },
    ]);
  });

  it('sends the latest again after a reconnect, once the new socket is ready', () => {
    const { platform, advance, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'vr' }, platform);
    latest().open();
    latest().receive('{"type":"ready"}');
    link.point(KITCHEN);

    latest().drop(1006);
    link.point({ id: 'inbox:work' });
    advance(FIRST_RETRY_MS);
    latest().open();
    expect(pointingSent(latest())).toEqual([]);
    latest().receive('{"type":"ready"}');

    expect(pointingSent(latest())).toEqual([{ type: 'pointing', entity: { id: 'inbox:work' } }]);
  });

  it('holds an entity to the limits of what a request touches', () => {
    const { platform, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'vr' }, platform);
    latest().open();
    latest().receive('{"type":"ready"}');

    link.point({ id: '  light.hall  ', name: 'x'.repeat(AFFECTED_ENTITY_NAME_MAX_LENGTH + 1) });
    link.point({ id: 'a'.repeat(AFFECTED_ENTITY_ID_MAX_LENGTH + 1), name: 'Too long' });

    expect(pointingSent(latest())).toEqual([
      { type: 'pointing', entity: { id: 'light.hall' } },
      { type: 'pointing', entity: null },
    ]);
  });

  it('tells the server nothing about pointing when nothing has been said', () => {
    const { platform, latest } = fakePlatform();
    connectToServer({ address: ADDRESS, device: 'vr' }, platform);
    latest().open();
    latest().receive('{"type":"ready"}');

    expect(pointingSent(latest())).toEqual([]);
  });
});

describe('the token for the server', () => {
  const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJqYXJ2aXMifQ.c2lnbmF0dXJl';

  it('goes on every upgrade request as a bearer token and as Cloudflare Access’s own header', () => {
    const { platform, advance, latest } = fakePlatform();
    connectToServer({ address: ADDRESS, device: 'phone', token: TOKEN }, platform);
    expect(latest().headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'cf-access-token': TOKEN });

    latest().drop(1006);
    advance(FIRST_RETRY_MS);
    expect(latest().headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'cf-access-token': TOKEN });
  });

  it('adds no header for a server with nothing in front of it', () => {
    const { platform, latest } = fakePlatform();
    connectToServer({ address: ADDRESS, device: 'phone' }, platform);
    expect(latest().headers).toEqual({});
  });
});

describe('listening to the line', () => {
  it('hands each message to every listener until it stops listening', () => {
    const { platform, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'vr' }, platform);
    const first: JarvisServerMessage[] = [];
    const second: JarvisServerMessage[] = [];
    const stopFirst = link.subscribe((message) => first.push(message));
    link.subscribe((message) => second.push(message));
    latest().open();

    latest().receive('{"type":"ready"}');
    stopFirst();
    latest().receive('{"type":"affectedEntities","entities":[{"id":"light.hall"}]}');

    expect(first).toEqual([{ type: 'ready' }]);
    expect(second).toEqual([{ type: 'ready' }, { type: 'affectedEntities', entities: [{ id: 'light.hall' }] }]);
  });
});

describe('whether the line is connected', () => {
  it('says so at once, once the server is ready, again when it drops, and not after it stops listening', () => {
    const { platform, advance, latest } = fakePlatform();
    const link = connectToServer({ address: ADDRESS, device: 'vr' }, platform);
    const told: boolean[] = [];
    const stop = link.onConnectionChange((connected) => told.push(connected));

    latest().open();
    latest().receive('{"type":"ready"}');
    latest().receive('{"type":"ready"}');
    latest().drop(1006);
    advance(FIRST_RETRY_MS);
    latest().open();
    latest().receive('{"type":"ready"}');
    stop();
    link.close();

    expect(told).toEqual([false, true, false, true]);
  });
});

describe('a device with no server address', () => {
  it('is never connected', () => {
    const told: boolean[] = [];
    connectToServer({ address: undefined, device: 'vr' }).onConnectionChange((connected) => told.push(connected));
    expect(told).toEqual([false]);
  });

  it('opens no line, and points at nothing', () => {
    const { platform, sockets } = fakePlatform();
    const link = connectToServer({ address: undefined, device: 'watch' }, platform);

    link.point({ id: 'light.hall' });
    link.close();

    expect(sockets).toHaveLength(0);
  });
});
