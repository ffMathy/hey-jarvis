import { describe, expect, it, jest } from 'bun:test';
import {
  MIN_UPLINK_BYTES_PER_MS,
  openPhotoSlot,
  PHOTO_SLOT_WAIT_MS,
  PHOTO_UPLOAD_WAIT_MS,
  sendPhoto,
} from './photo-upload';

/** The Jarvis server as sir typed it into the settings screen. */
const SERVER = 'https://jarvis.example.com';

const CONVERSATION_ID = 'conv_01jz8k3b4c5d6e7f';

/** A slot's path as the server hands it back: the upload route and 22 characters of token. */
const UPLOAD_PATH = '/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';

const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

/** A server that answers every request the same way, and remembers what it was sent. */
function createServer(respond: (init: RequestInit) => Promise<Response>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const send = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return respond(init);
  };
  return { send, requests };
}

/**
 * No answer at all: the request is left open until whoever sent it gives up on it, and then fails the
 * way `fetch` does when it is aborted. What a half-open connection looks like from the phone.
 */
function neverAnswer(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

/** An answer in the Jarvis server's own JSON envelope. */
function serverAnswer(body: unknown, status = 201): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

/** A page from something in front of the server — Cloudflare Access, or the tunnel. */
function pageAnswer(status: number): Promise<Response> {
  return Promise.resolve(new Response('<html>Cloudflare Access</html>', { status }));
}

/** The server opening a slot, as it answers one. */
const SLOT_OPENED = {
  success: true,
  message: 'Photo slot opened',
  data: { uploadToken: 'Q2hhbmdlIG1lIHBsZWFzZQ', uploadPath: UPLOAD_PATH, expiresAt: '2026-09-30T12:05:00.000Z' },
};

function askForASlot(server: { send: (url: string, init: RequestInit) => Promise<Response> }) {
  return openPhotoSlot({ serverAddress: SERVER, conversationId: CONVERSATION_ID, fetchImplementation: server.send });
}

function sendTo(
  server: { send: (url: string, init: RequestInit) => Promise<Response> },
  uploadPath: string = UPLOAD_PATH,
  photo: Blob = PHOTO,
) {
  return sendPhoto({ serverAddress: SERVER, uploadPath, photo, fetchImplementation: server.send });
}

describe('asking the Jarvis server for somewhere to send a photo', () => {
  it('posts the conversation’s id to the slot route of the server sir named, and nothing else', async () => {
    const server = createServer(() => serverAnswer(SLOT_OPENED));

    await askForASlot(server);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe('https://jarvis.example.com/api/photos/slots');
    expect(server.requests[0]?.init.method).toBe('POST');
    expect(server.requests[0]?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(server.requests[0]?.init.body))).toEqual({ conversationId: CONVERSATION_ID });
  });

  it('hands back the path the server opened the slot at', async () => {
    const server = createServer(() => serverAnswer(SLOT_OPENED));

    expect(await askForASlot(server)).toEqual({ uploadPath: UPLOAD_PATH });
  });

  it('takes no path but the upload route’s, however the server words it', async () => {
    // The path decides where sir's photo goes, so anything that is not a slot on this server is not one.
    for (const uploadPath of [
      'https://elsewhere.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ',
      '//elsewhere.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ',
      '/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ/../../mcp',
      '/api/photos/slots',
      '/api/photos/short',
      '/api/mcp/Q2hhbmdlIG1lIHBsZWFzZQ',
    ]) {
      const server = createServer(() => serverAnswer({ ...SLOT_OPENED, data: { ...SLOT_OPENED.data, uploadPath } }));

      expect(await askForASlot(server), uploadPath).toEqual({
        problem: 'unreachable',
        description: 'The server answered with something that was not the Jarvis server.',
      });
    }
  });

  it('says the conversation could not be confirmed when the server says so', async () => {
    const server = createServer(() =>
      serverAnswer({ success: false, message: 'That is not a conversation in progress with Jarvis.' }, 403),
    );

    expect(await askForASlot(server)).toEqual({
      problem: 'notLive',
      description: 'The server could not confirm the conversation as live on Jarvis’s agent.',
    });
  });

  it('does not blame the conversation for a 403 that is not the server’s', async () => {
    // Cloudflare Access turns requests away with a page of its own. Telling sir his conversation was
    // not live would send him looking for a problem he does not have.
    const server = createServer(() => pageAnswer(403));

    expect(await askForASlot(server)).toEqual({
      problem: 'unreachable',
      description:
        'Something in front of the Jarvis server answered 403. Cloudflare Access may need a bypass for /api/photos/*.',
    });
  });

  it('says photo uploads are switched off when the server says so', async () => {
    const server = createServer(() =>
      serverAnswer({ success: false, message: 'Photo uploads are switched off on this server.' }, 503),
    );

    expect(await askForASlot(server)).toMatchObject({ problem: 'switchedOff' });
  });

  it('does not take a 503 from the tunnel for the server switching photos off', async () => {
    // What a tunnel says when the server behind it is down.
    const server = createServer(() => pageAnswer(503));

    expect(await askForASlot(server)).toMatchObject({ problem: 'unreachable' });
  });

  it('counts every other refusal as a server that could not be reached', async () => {
    for (const status of [400, 429, 500, 502]) {
      const server = createServer(() => serverAnswer({ success: false, message: 'no' }, status));

      expect(await askForASlot(server), String(status)).toEqual({
        problem: 'unreachable',
        description: `The Jarvis server answered ${status}.`,
      });
    }
  });

  it('does not take a sign-in page for a slot, however much it says 200', async () => {
    const server = createServer(() => pageAnswer(200));

    expect(await askForASlot(server)).toMatchObject({ problem: 'unreachable' });
  });

  it('answers rather than throws when the network is not there', async () => {
    const server = createServer(() => Promise.reject(new TypeError('Network request failed')));

    expect(await askForASlot(server)).toEqual({
      problem: 'unreachable',
      description: 'The Jarvis server could not be reached.',
    });
  });

  it('gives up on a server that never answers, as one that could not be reached', async () => {
    // React Native's fetch on Android never gives up by itself, so without this the camera button
    // would stay busy, and Jarvis waiting on the photo, for the rest of the call.
    jest.useFakeTimers();
    try {
      const server = createServer(neverAnswer);

      const slot = askForASlot(server);
      jest.advanceTimersByTime(PHOTO_SLOT_WAIT_MS - 1);
      expect(server.requests[0]?.init.signal?.aborted).toBe(false);
      jest.advanceTimersByTime(1);

      expect(await slot).toEqual({
        problem: 'unreachable',
        description: 'The Jarvis server did not answer within 20 s.',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('sending the photo to the slot', () => {
  it('puts the JPEG at the slot’s path on the server sir named, with no key of any kind', async () => {
    const server = createServer(() =>
      serverAnswer({ success: true, message: 'Photo received', data: { photoId: 'photo3' } }),
    );

    await sendTo(server);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe(`${SERVER}${UPLOAD_PATH}`);
    expect(server.requests[0]?.init.method).toBe('PUT');
    // The slot's name in the path is all the upload asks for: no Authorization header, nothing else.
    expect(server.requests[0]?.init.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(server.requests[0]?.init.body).toBe(PHOTO);
  });

  it('hands back the id the server filed it under', async () => {
    const server = createServer(() => serverAnswer({ success: true, message: 'ok', data: { photoId: 'photo3' } }));

    expect(await sendTo(server)).toEqual({ photoId: 'photo3' });
  });

  it('sends nothing to a path that is not a slot’s', async () => {
    const server = createServer(() => serverAnswer({ success: true, message: 'ok', data: { photoId: 'photo3' } }));

    expect(await sendTo(server, 'https://elsewhere.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ')).toMatchObject({
      problem: 'unreachable',
    });
    expect(server.requests).toHaveLength(0);
  });

  it('says a photo too large for the server was too large', async () => {
    const server = createServer(() => pageAnswer(413));

    expect(await sendTo(server)).toEqual({
      problem: 'tooLarge',
      description: 'The photo was too large for the server.',
    });
  });

  it('says a slot was spent or stale, which is what a 404 from the upload path means', async () => {
    const server = createServer(() => serverAnswer({ success: false, message: 'expired' }, 404));

    expect(await sendTo(server)).toEqual({
      problem: 'unreachable',
      description: 'The upload slot had expired or been used already.',
    });
  });

  it('never calls a 403 from the upload path the conversation’s fault', async () => {
    // The upload route checks only the slot, so a 403 is something in front of it, whatever it says.
    const server = createServer(() => serverAnswer({ success: false, message: 'Forbidden' }, 403));

    expect(await sendTo(server)).toMatchObject({ problem: 'unreachable' });
  });

  it('names Cloudflare Access when the tunnel turns the photo away', async () => {
    const server = createServer(() => pageAnswer(403));

    expect(await sendTo(server)).toEqual({
      problem: 'unreachable',
      description:
        'Something in front of the Jarvis server answered 403. Cloudflare Access may need a bypass for /api/photos/*.',
    });
  });

  it('does not take a sign-in page for a delivery, however much it says 200', async () => {
    // Cloudflare Access answers a request it will not let through with a login page, as a 200.
    const server = createServer(() => pageAnswer(200));

    expect(await sendTo(server)).toEqual({
      problem: 'unreachable',
      description: 'The server answered with something that was not the Jarvis server.',
    });
  });

  it('does not take any JSON with a 200 for a delivery either', async () => {
    const server = createServer(() => serverAnswer({ success: true, data: { photoId: '../../etc/passwd' } }, 200));

    expect(await sendTo(server)).toMatchObject({ problem: 'unreachable' });
  });

  it('answers rather than throws when the network is not there', async () => {
    const server = createServer(() => Promise.reject(new TypeError('Network request failed')));

    expect(await sendTo(server)).toEqual({
      problem: 'unreachable',
      description: 'The Jarvis server could not be reached.',
    });
  });

  it('gives up on an upload that is never answered, as a server that could not be reached', async () => {
    jest.useFakeTimers();
    try {
      const server = createServer(neverAnswer);

      // Four bytes: 30 s for the answer, and a millisecond for the bytes.
      const delivery = sendTo(server);
      jest.advanceTimersByTime(PHOTO_UPLOAD_WAIT_MS);
      expect(server.requests[0]?.init.signal?.aborted).toBe(false);
      jest.advanceTimersByTime(1);

      expect(await delivery).toEqual({
        problem: 'unreachable',
        description: 'The Jarvis server did not answer within 30 s.',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  describe('a large photo, on a slow uplink', () => {
    /** A megabyte: a busy scene at the phone's size and quality, well inside the server's 3 MB. */
    const LARGE_PHOTO = new Blob([new Uint8Array(1_048_576)], { type: 'image/jpeg' });

    /** Its deadline: the answer's 30 s, and its bytes at 64 kbit/s. */
    const LARGE_PHOTO_WAIT_MS = PHOTO_UPLOAD_WAIT_MS + 1_048_576 / MIN_UPLINK_BYTES_PER_MS;

    it('is still delivered when it takes 45 s, past the 30 s a small one is given', async () => {
      // A megabyte at about 190 kbit/s: slow, and getting through.
      jest.useFakeTimers();
      try {
        const server = createServer(
          (init) =>
            new Promise((resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')),
              );
              setTimeout(
                () => resolve(serverAnswer({ success: true, message: 'Photo received', data: { photoId: 'photo3' } })),
                45_000,
              );
            }),
        );

        const delivery = sendTo(server, UPLOAD_PATH, LARGE_PHOTO);
        jest.advanceTimersByTime(45_000);

        expect(await delivery).toEqual({ photoId: 'photo3' });
        expect(server.requests[0]?.init.signal?.aborted).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is given up on too, once its bytes have had all the time they are given', async () => {
      jest.useFakeTimers();
      try {
        const server = createServer(neverAnswer);

        const delivery = sendTo(server, UPLOAD_PATH, LARGE_PHOTO);
        jest.advanceTimersByTime(LARGE_PHOTO_WAIT_MS - 1);
        expect(server.requests[0]?.init.signal?.aborted).toBe(false);
        jest.advanceTimersByTime(1);

        // 161 s: 30 s for the answer, and 131 s for a megabyte at 64 kbit/s.
        expect(await delivery).toEqual({
          problem: 'unreachable',
          description: 'The Jarvis server did not answer within 161 s.',
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('never repeats what the server said in what it says went wrong', async () => {
    // The description is logged on the phone, and the problem is told to the agent: neither is the
    // place for whatever a response happened to carry.
    for (const status of [400, 403, 404, 413, 429, 500, 502, 503]) {
      const said = `server-said-${status}`;
      const server = createServer(() => serverAnswer({ success: false, message: said }, status));

      for (const failure of [await askForASlot(server), await sendTo(server)]) {
        expect(JSON.stringify(failure)).not.toContain(said);
      }
    }
  });
});
