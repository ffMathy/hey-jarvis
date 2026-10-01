import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * The store is the one thing here that needs a device: on a phone it is the Android keystore, by way
 * of `expo-secure-store`, which cannot even be imported without React Native. So it is replaced with
 * a map before the module under test is loaded — which is why that is a dynamic import below the
 * mock rather than an import at the top.
 */
const stored = new Map<string, string>();
let storeWorks = true;

mock.module('./key-value-store', () => ({
  readStoredValue: async (key: string) => {
    if (!storeWorks) {
      throw new Error('The keystore key was invalidated');
    }
    return stored.get(key);
  },
  writeStoredValue: async (key: string, value: string) => {
    stored.set(key, value);
  },
}));

const { loadJarvisServerAddress, saveJarvisServerAddress } = await import('./jarvis-server');

const ADDRESS = 'https://jarvis.example.com';

describe('keeping the address', () => {
  beforeEach(() => {
    stored.clear();
    storeWorks = true;
  });

  it('reads back what was saved', async () => {
    await saveJarvisServerAddress(ADDRESS);

    expect(await loadJarvisServerAddress()).toEqual({ kind: 'address', address: ADDRESS });
  });

  it('forgets it when saved as none, and reads that back as none', async () => {
    await saveJarvisServerAddress(ADDRESS);
    await saveJarvisServerAddress(undefined);

    expect(stored.get('jarvis.server-address')).toBe('');
    expect(await loadJarvisServerAddress()).toEqual({ kind: 'nothing' });
  });

  it('has none on a phone that was never given one', async () => {
    expect(await loadJarvisServerAddress()).toEqual({ kind: 'nothing' });
  });

  it('tells a store that cannot be read apart from one with no address, so the read can be tried again', async () => {
    // Folded into "none", one throw in a window still coming up would take the camera away for good.
    await saveJarvisServerAddress(ADDRESS);
    storeWorks = false;

    expect(await loadJarvisServerAddress()).toEqual({ kind: 'unreadable' });
  });

  it('never hands back a stored value that could not have been saved', async () => {
    stored.set('jarvis.server-address', 'https://jarvis.example.com/somewhere/else');

    expect(await loadJarvisServerAddress()).toEqual({ kind: 'nothing' });
  });

  it('is kept apart from the ElevenLabs settings, which are what the watch is sent', async () => {
    await saveJarvisServerAddress(ADDRESS);

    expect([...stored.keys()]).toEqual(['jarvis.server-address']);
  });
});
