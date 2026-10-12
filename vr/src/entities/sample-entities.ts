import type { KeyValueStorage } from '../page/settings';
import {
  ENTITY_REGISTRY_KEY,
  type EntityReport,
  knownEntity,
  parseEntityRegistry,
  recordEntities,
  serialiseEntityRegistry,
} from './registry';

/**
 * Made-up entities to try placing things with, before Jarvis has worked on anything real.
 *
 * The drawer only ever offers what an agent has marked in a conversation, so a new headset or phone
 * opens it empty. **Try with sample entities** on the page fills it with these instead. They are
 * kept apart from the real ones, in a registry of their own under
 * {@link SAMPLE_ENTITY_REGISTRY_KEY}, and only ever shown in sample mode, which has no conversation:
 * so they are never mixed into the real drawer, never lit by a real mark, and pointing at one never
 * tells the Jarvis server about an id that does not exist. Where they are put is remembered like
 * anything else's, so they are still standing there the next time.
 */

/** Where the samples and their placements are kept: never the real registry's key. */
export const SAMPLE_ENTITY_REGISTRY_KEY = 'jarvis.horizon.sample-entities';

/** The samples: a few things of the kinds Jarvis works on, named as a home would name them. */
export const SAMPLE_ENTITIES: readonly EntityReport[] = [
  { id: 'sample:light.kitchen', name: 'Kitchen light' },
  { id: 'sample:light.living_room', name: 'Living room lamp' },
  { id: 'sample:media_player.tv', name: 'TV' },
  { id: 'sample:climate.thermostat', name: 'Thermostat' },
  { id: 'sample:inbox', name: 'Inbox' },
  { id: 'sample:calendar', name: 'Calendar' },
];

/**
 * `storage` with the entity registry read from and written to the samples' own key, and every
 * sample in it: one missing — the first time, or after the registry was cleared — is added again,
 * and the ones already there, placed or not, are left as they are.
 */
export function sampleEntityStorage(storage: KeyValueStorage, now: () => number): KeyValueStorage {
  const keyFor = (key: string) => (key === ENTITY_REGISTRY_KEY ? SAMPLE_ENTITY_REGISTRY_KEY : key);
  return {
    getItem(key) {
      const stored = storage.getItem(keyFor(key));
      if (key !== ENTITY_REGISTRY_KEY) return stored;
      const registry = parseEntityRegistry(stored);
      const missing = SAMPLE_ENTITIES.filter((sample) => knownEntity(registry, sample.id) === undefined);
      return missing.length === 0 ? stored : serialiseEntityRegistry(recordEntities(registry, missing, now()));
    },
    setItem(key, value) {
      storage.setItem(keyFor(key), value);
    },
  };
}
