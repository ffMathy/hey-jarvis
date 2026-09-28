import { describe, expect, it } from 'bun:test';
import { sendPhoto } from './photo-upload';

const UPLOAD_URL = 'https://jarvis.example.com/api/photos/abcdefghijklmnopqrstuv';

/** A server that answers every request the same way, and remembers what it was sent. */
function createServer(respond: () => Promise<Response>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const send = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return respond();
  };
  return { send, requests };
}

function mastraAnswer(body: unknown, status = 201): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

describe('sending a photo to Mastra', () => {
  it('puts the JPEG at the upload URL, and nothing else', async () => {
    const server = createServer(() =>
      mastraAnswer({ success: true, message: 'Photo received', data: { photoId: 'photo3' } }),
    );

    await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe(UPLOAD_URL);
    expect(server.requests[0]?.init.method).toBe('PUT');
    expect(server.requests[0]?.init.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(server.requests[0]?.init.body).toBe(PHOTO);
  });

  it('hands back the id Mastra filed it under', async () => {
    const server = createServer(() => mastraAnswer({ success: true, message: 'ok', data: { photoId: 'photo3' } }));

    expect(await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send })).toEqual({
      photoId: 'photo3',
    });
  });

  it('does not take a sign-in page for a delivery, however much it says 200', async () => {
    // Cloudflare Access answers a request it will not let through with a login page, as a 200.
    const server = createServer(() =>
      Promise.resolve(new Response('<html>Sign in with Cloudflare Access</html>', { status: 200 })),
    );

    const delivery = await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send });

    expect(delivery).toEqual({ problem: 'The server answered with something that was not Mastra.' });
  });

  it('does not take any JSON with a 200 for a delivery either', async () => {
    const server = createServer(() => mastraAnswer({ success: true, data: { photoId: '../../etc/passwd' } }, 200));

    const delivery = await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send });

    expect(delivery).toEqual({ problem: 'The server answered with something that was not Mastra.' });
  });

  it('says an upload link was spent or stale, which is what a 404 from the upload path means', async () => {
    const server = createServer(() => mastraAnswer({ success: false, message: 'expired' }, 404));

    expect(await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send })).toEqual({
      problem: 'The upload link had expired or been used already.',
    });
  });

  it('names Cloudflare Access when the tunnel turns the photo away', async () => {
    const server = createServer(() => Promise.resolve(new Response('Forbidden', { status: 403 })));

    const delivery = await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send });

    expect(delivery).toEqual({
      problem: 'The server turned the photo away. Cloudflare Access may need a bypass for /api/photos.',
    });
  });

  it('answers rather than throws when the network is not there', async () => {
    const server = createServer(() => Promise.reject(new TypeError('Network request failed')));

    expect(await sendPhoto({ photo: PHOTO, uploadUrl: UPLOAD_URL, fetchImplementation: server.send })).toEqual({
      problem: 'The server could not be reached.',
    });
  });
});
