import { beforeEach, describe, expect, it, mock } from 'bun:test';

/** The store, replaced with a map before the module is loaded: see `jarvis-server.spec.ts`. */
const stored = new Map<string, string>();
let storeWorks = true;

mock.module('./key-value-store', () => ({
  readStoredValue: async (key: string) => {
    if (!storeWorks) throw new Error('The keystore key was invalidated');
    return stored.get(key);
  },
  writeStoredValue: async (key: string, value: string) => {
    if (!storeWorks) throw new Error('The keystore key was invalidated');
    stored.set(key, value);
  },
}));

const { GLANCE_STORAGE_KEY, loadGlance, saveGlance } = await import('./glance-storage');

const GLANCE = {
  id: 'glance-1',
  url: 'https://jarvis.example.com/artifacts/1',
  title: 'A parcel is coming today',
  generatedAt: '2026-11-01T07:30:00.000Z',
  actions: [{ id: 'unlock', label: 'Unlock', prompt: 'Unlock the front door.' }],
};

describe('keeping the glance', () => {
  beforeEach(() => {
    stored.clear();
    storeWorks = true;
  });

  it('reads back what was kept', async () => {
    await saveGlance(GLANCE);
    expect(await loadGlance()).toEqual(GLANCE);
  });

  it('has none before one was kept, nor in a store that cannot be read or written', async () => {
    expect(await loadGlance()).toBeUndefined();
    storeWorks = false;
    await saveGlance(GLANCE);
    expect(await loadGlance()).toBeUndefined();
  });

  it('never hands back a kept value that is not a usable glance', async () => {
    stored.set(GLANCE_STORAGE_KEY, 'not json');
    expect(await loadGlance()).toBeUndefined();
    stored.set(GLANCE_STORAGE_KEY, JSON.stringify({ ...GLANCE, url: 'javascript:alert(1)' }));
    expect(await loadGlance()).toBeUndefined();
  });
});
