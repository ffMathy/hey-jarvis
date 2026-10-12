import { describe, expect, it } from 'bun:test';
import type { KeyValueStorage } from '../page/settings';
import {
  createEntityStore,
  drawerEntries,
  ENTITY_REGISTRY_KEY,
  parseEntityRegistry,
  placeEntity,
  serialiseEntityRegistry,
} from './registry';
import { SAMPLE_ENTITIES, SAMPLE_ENTITY_REGISTRY_KEY, sampleEntityStorage } from './sample-entities';

function memoryStorage(): KeyValueStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const now = () => 1_700_000_000_000;

describe('sampleEntityStorage', () => {
  it('offers every sample in the drawer the first time, under their names', () => {
    const store = createEntityStore(sampleEntityStorage(memoryStorage(), now), () => () => undefined);
    const entries = drawerEntries(store.registry);
    expect(entries.map((entry) => entry.id).sort()).toEqual(SAMPLE_ENTITIES.map((sample) => sample.id).sort());
    expect(entries.find((entry) => entry.id === 'sample:light.kitchen')?.label).toBe('Kitchen light');
  });

  it('keeps the samples under their own key, never touching the real registry', () => {
    const storage = memoryStorage();
    const real = serialiseEntityRegistry(parseEntityRegistry(null));
    storage.setItem(ENTITY_REGISTRY_KEY, real);
    const samples = sampleEntityStorage(storage, now);
    samples.setItem(ENTITY_REGISTRY_KEY, 'written');
    expect(storage.items.get(SAMPLE_ENTITY_REGISTRY_KEY)).toBe('written');
    expect(storage.items.get(ENTITY_REGISTRY_KEY)).toBe(real);
  });

  it('leaves the samples already there, placed ones included, as they are', () => {
    const storage = memoryStorage();
    const first = parseEntityRegistry(sampleEntityStorage(storage, now).getItem(ENTITY_REGISTRY_KEY));
    const placed = placeEntity(first, 'sample:media_player.tv', 'anchor-1', [0.1, 0, 0], 5);
    storage.setItem(SAMPLE_ENTITY_REGISTRY_KEY, serialiseEntityRegistry(placed));
    const again = sampleEntityStorage(storage, now).getItem(ENTITY_REGISTRY_KEY);
    expect(again).toBe(serialiseEntityRegistry(placed));
  });

  it('passes every other key straight through', () => {
    const storage = memoryStorage();
    storage.setItem('other', 'value');
    expect(sampleEntityStorage(storage, now).getItem('other')).toBe('value');
  });
});
