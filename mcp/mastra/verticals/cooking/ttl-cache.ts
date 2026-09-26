/**
 * A small in-memory cache for data that changes rarely, such as published recipes.
 *
 * A value is kept for `ttlMs` after it was asked for, and callers that ask while it is still
 * loading share that load. A load that fails is forgotten at once, so the next caller tries
 * again rather than being handed the same failure. Past `maxEntries`, the oldest entry goes.
 */
export function createTtlCache<TValue>(options: { ttlMs: number; maxEntries: number }) {
  const entries = new Map<string, { value: Promise<TValue>; storedAt: number }>();

  return {
    async get(key: string, load: () => Promise<TValue>): Promise<TValue> {
      const cached = entries.get(key);
      if (cached && Date.now() - cached.storedAt < options.ttlMs) {
        return await cached.value;
      }

      const value = load();
      // Deleted first so a refreshed key moves to the back of the eviction order.
      entries.delete(key);
      entries.set(key, { value, storedAt: Date.now() });

      for (const oldestKey of entries.keys()) {
        if (entries.size <= options.maxEntries) {
          break;
        }
        entries.delete(oldestKey);
      }

      value.catch(() => {
        if (entries.get(key)?.value === value) {
          entries.delete(key);
        }
      });

      return await value;
    },

    clear(): void {
      entries.clear();
    },
  };
}
