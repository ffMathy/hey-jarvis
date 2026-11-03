import { describe, expect, it } from 'bun:test';
import { JARVIS_SERVER_ADDRESS_STORAGE_KEY } from 'hologram';
import {
  DEVICE_PAIRING_PATH,
  DEVICE_TOKEN_STORAGE_KEY,
  HEADSET_DEVICE_NAME,
  loadPairing,
  pairWithServer,
  SIGN_IN_FIRST,
  savePairing,
} from './pairing';

const TOKEN = 'p'.repeat(43);

function mapStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('pairing the headset', () => {
  it('posts a simple request with the cookies, and keeps the token it is answered with', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const result = await pairWithServer(' jarvis.example.com/ ', async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ success: true, data: { id: 'device-1', token: TOKEN } }, { status: 201 });
    });

    expect(result).toEqual({ pairing: { address: 'https://jarvis.example.com', deviceToken: TOKEN } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`https://jarvis.example.com${DEVICE_PAIRING_PATH}`);
    expect(requests[0]?.init).toEqual({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: HEADSET_DEVICE_NAME,
    });
  });

  it('offers signing in when no answer could be read, as Access’s login looks from a page', async () => {
    const result = await pairWithServer('https://jarvis.example.com', async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(result).toEqual({ problem: SIGN_IN_FIRST, signIn: 'https://jarvis.example.com' });
  });

  it('says the server refused, with its status', async () => {
    const result = await pairWithServer('https://jarvis.example.com', async () => new Response('', { status: 403 }));

    expect(result).toEqual({ problem: 'Your Jarvis server would not pair this headset (HTTP 403).' });
  });

  it('refuses an answer without a token', async () => {
    const result = await pairWithServer('https://jarvis.example.com', async () => Response.json({ data: {} }));

    expect(result).toEqual({ problem: 'Your Jarvis server answered without a token for this headset.' });
  });

  it('asks nothing of an address that is not one', async () => {
    const result = await pairWithServer('ftp://jarvis', async () => {
      throw new Error('nothing should be asked');
    });

    expect('problem' in result).toBe(true);
  });

  it('asks for an address when none is typed', async () => {
    const result = await pairWithServer('  ', async () => {
      throw new Error('nothing should be asked');
    });

    expect(result).toEqual({ problem: "Enter your Jarvis server's address." });
  });
});

describe('the kept pairing', () => {
  it('is the address where the phone keeps it, and the token beside it', () => {
    const storage = mapStorage();

    expect(savePairing(storage, { address: 'https://jarvis.example.com', deviceToken: TOKEN })).toBeUndefined();

    expect(storage.map.get(JARVIS_SERVER_ADDRESS_STORAGE_KEY)).toBe('https://jarvis.example.com');
    expect(storage.map.get(DEVICE_TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(loadPairing(storage)).toEqual({ address: 'https://jarvis.example.com', deviceToken: TOKEN });
  });

  it('is nothing with an address but no token, as a phone that set the address leaves it', () => {
    expect(loadPairing(mapStorage({ [JARVIS_SERVER_ADDRESS_STORAGE_KEY]: 'https://jarvis.example.com' }))).toBe(
      undefined,
    );
  });

  it('is nothing when storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('storage is off');
      },
      setItem: () => {
        throw new Error('storage is off');
      },
    };

    expect(loadPairing(throwing)).toBeUndefined();
    expect(savePairing(throwing, { address: 'https://jarvis.example.com', deviceToken: TOKEN })).toBe(
      'This browser would not keep the pairing. Check that it allows this site to store data.',
    );
  });
});
