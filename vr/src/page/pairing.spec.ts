import { describe, expect, it } from 'bun:test';
import { JARVIS_DEVICE_TOKEN_STORAGE_KEY, JARVIS_SERVER_ADDRESS_STORAGE_KEY } from 'hologram';
import { loadPairing, savePairing } from './pairing';

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

describe('the kept pairing', () => {
  it('is the address where the phone keeps it, and the token beside it', () => {
    const storage = mapStorage();

    expect(savePairing(storage, { address: 'https://jarvis.example.com', deviceToken: TOKEN })).toBeUndefined();

    expect(storage.map.get(JARVIS_SERVER_ADDRESS_STORAGE_KEY)).toBe('https://jarvis.example.com');
    expect(storage.map.get(JARVIS_DEVICE_TOKEN_STORAGE_KEY)).toBe(TOKEN);
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
