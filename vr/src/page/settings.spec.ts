import { describe, expect, it } from 'bun:test';
import { JARVIS_SERVER_ADDRESS_STORAGE_KEY } from 'hologram';
import { type KeyValueStorage, loadServerAddress } from './settings';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('loadServerAddress', () => {
  it('reads the address where the phone’s web build keeps it', () => {
    const storage = new MemoryStorage();
    storage.setItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY, 'https://jarvis.example.com');
    expect(loadServerAddress(storage)).toBe('https://jarvis.example.com');
  });

  it('finds nothing on a first visit, in something that is not an address, or in storage that throws', () => {
    const storage = new MemoryStorage();
    expect(loadServerAddress(storage)).toBeUndefined();
    storage.setItem(JARVIS_SERVER_ADDRESS_STORAGE_KEY, 'https://jarvis.example.com/some/path');
    expect(loadServerAddress(storage)).toBeUndefined();
    const brokenStorage: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(loadServerAddress(brokenStorage)).toBeUndefined();
  });
});
