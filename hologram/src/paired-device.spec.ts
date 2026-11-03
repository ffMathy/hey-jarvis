import { describe, expect, it } from 'bun:test';
import { HEADSET_PARTICIPANT_NAME } from './conversation-token';
import {
  DEVICE_PAIRING_PATH,
  NO_LONGER_PAIRED_PROBLEM,
  PAIRED_CONVERSATION_PATH,
  pairedCredentials,
  pairWithServer,
  parseStoredDeviceToken,
  SERVER_UNREACHABLE_PROBLEM,
  SIGN_IN_FIRST,
  serverSignInUrl,
} from './paired-device';

const TOKEN = 'p'.repeat(43);
const PAIRING = { address: 'https://jarvis.example.com', deviceToken: TOKEN };

/** A fake of `fetch`: Bun's carries `preconnect` beside its call signature, so a bare function is not one. */
function fakeFetch(answer: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(answer, { preconnect: fetch.preconnect });
}

describe('signing in to the server', () => {
  it('goes through the line’s own path, which Access covers', () => {
    expect(serverSignInUrl('https://jarvis.example.com')).toBe('https://jarvis.example.com/api/live');
  });
});

describe('a stored device token', () => {
  it('is read back only when it looks like one', () => {
    expect(parseStoredDeviceToken(TOKEN)).toBe(TOKEN);
    expect(parseStoredDeviceToken('')).toBeUndefined();
    expect(parseStoredDeviceToken(null)).toBeUndefined();
    expect(parseStoredDeviceToken('not a token')).toBeUndefined();
  });
});

describe('pairing a browser', () => {
  it('posts a simple request with the cookies, and keeps the token it is answered with', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const result = await pairWithServer(
      ' jarvis.example.com/ ',
      'Meta Quest headset',
      fakeFetch(async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ success: true, data: { id: 'device-1', token: TOKEN } }, { status: 201 });
      }),
    );

    expect(result).toEqual({ pairing: { address: 'https://jarvis.example.com', deviceToken: TOKEN } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`https://jarvis.example.com${DEVICE_PAIRING_PATH}`);
    expect(requests[0]?.init).toEqual({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: 'Meta Quest headset',
    });
  });

  it('offers signing in when no answer could be read, as Access’s login looks from a page', async () => {
    const result = await pairWithServer(
      'https://jarvis.example.com',
      'Meta Quest headset',
      fakeFetch(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(result).toEqual({ problem: SIGN_IN_FIRST, signIn: 'https://jarvis.example.com' });
  });

  it('says the server refused, with its status', async () => {
    const result = await pairWithServer(
      'https://jarvis.example.com',
      'Meta Quest headset',
      fakeFetch(async () => new Response('', { status: 403 })),
    );

    expect(result).toEqual({ problem: 'Your Jarvis server would not pair this browser (HTTP 403).' });
  });

  it('refuses an answer without a token', async () => {
    const result = await pairWithServer(
      'https://jarvis.example.com',
      'Meta Quest headset',
      fakeFetch(async () => Response.json({ data: {} })),
    );

    expect(result).toEqual({ problem: 'Your Jarvis server answered without a token for this browser.' });
  });

  it('asks nothing of an address that is not one', async () => {
    const result = await pairWithServer(
      'ftp://jarvis',
      'Meta Quest headset',
      fakeFetch(async () => {
        throw new Error('nothing should be asked');
      }),
    );

    expect('problem' in result).toBe(true);
  });

  it('asks for an address when none is typed', async () => {
    const result = await pairWithServer(
      '  ',
      'Meta Quest headset',
      fakeFetch(async () => {
        throw new Error('nothing should be asked');
      }),
    );

    expect(result).toEqual({ problem: "Enter your Jarvis server's address." });
  });
});

describe('a paired browser’s conversation credentials', () => {
  it('asks the server for a spoken conversation’s token with its own token', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const token = await pairedCredentials(PAIRING).token(
      HEADSET_PARTICIPANT_NAME,
      fakeFetch(async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ success: true, data: { token: 'livekit-token' } });
      }),
    );

    expect(token).toBe('livekit-token');
    expect(requests).toEqual([
      {
        url: `https://jarvis.example.com${PAIRED_CONVERSATION_PATH}`,
        init: {
          method: 'POST',
          headers: { Authorization: `Bearer ${PAIRING.deviceToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ transport: 'webrtc', participantName: HEADSET_PARTICIPANT_NAME }),
        },
      },
    ]);
  });

  it('asks for a signed URL for a typed conversation, and takes only a wss:// one', async () => {
    const credentials = pairedCredentials(PAIRING);

    expect(
      await credentials.signedUrl(
        fakeFetch(async () => Response.json({ data: { signedUrl: 'wss://example/signed' } })),
      ),
    ).toBe('wss://example/signed');
    await expect(
      credentials.signedUrl(fakeFetch(async () => Response.json({ data: { signedUrl: 'ws://plain' } }))),
    ).rejects.toThrow('not wss://');
  });

  it('says it is no longer paired when the server does not know its token', async () => {
    await expect(
      pairedCredentials(PAIRING).token(
        HEADSET_PARTICIPANT_NAME,
        fakeFetch(async () => new Response('', { status: 401 })),
      ),
    ).rejects.toThrow(NO_LONGER_PAIRED_PROBLEM);
  });

  it('passes on the server’s own words for why there is no conversation', async () => {
    await expect(
      pairedCredentials(PAIRING).token(
        HEADSET_PARTICIPANT_NAME,
        fakeFetch(async () =>
          Response.json(
            { success: false, message: 'ElevenLabs could not start a conversation (HTTP 402).' },
            { status: 502 },
          ),
        ),
      ),
    ).rejects.toThrow('ElevenLabs could not start a conversation (HTTP 402).');
  });

  it('says the server could not be reached when no answer came', async () => {
    await expect(
      pairedCredentials(PAIRING).token(
        HEADSET_PARTICIPANT_NAME,
        fakeFetch(async () => {
          throw new TypeError('Failed to fetch');
        }),
      ),
    ).rejects.toThrow(SERVER_UNREACHABLE_PROBLEM);
  });
});
