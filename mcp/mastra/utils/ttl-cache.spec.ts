import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { createTtlCache } from './ttl-cache.js';

afterEach(() => {
  setSystemTime();
});

describe('createTtlCache', () => {
  it('loads once and reuses the value until it is stale', async () => {
    setSystemTime(new Date('2026-09-26T08:00:00Z'));
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 1 });
    let loads = 0;

    expect(await cache.get('calendars', async () => ++loads)).toBe(1);
    expect(await cache.get('calendars', async () => ++loads)).toBe(1);

    setSystemTime(new Date('2026-09-26T08:01:00Z'));
    expect(await cache.get('calendars', async () => ++loads)).toBe(2);
  });

  it('shares one load between concurrent callers', async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });
    let loads = 0;
    const load = async () => {
      await Bun.sleep(5);
      return ++loads;
    };

    expect(await Promise.all([cache.get('a', load), cache.get('a', load)])).toEqual([1, 1]);
    expect(loads).toBe(1);
  });

  it('forgets a failed load, so the next caller tries again', async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });

    await expect(
      cache.get('b', async () => {
        throw new Error('Service Unavailable');
      }),
    ).rejects.toThrow('Service Unavailable');
    expect(await cache.get('b', async () => 42)).toBe(42);
  });

  it('drops the oldest entry past its size', async () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000, maxEntries: 2 });
    await cache.get('a', async () => 'first');
    await cache.get('b', async () => 'second');
    await cache.get('c', async () => 'third');

    expect(await cache.get('a', async () => 'reloaded')).toBe('reloaded');
    expect(await cache.get('c', async () => 'reloaded')).toBe('third');
  });

  it('forgets everything when cleared', async () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000, maxEntries: 2 });
    await cache.get('a', async () => 'first');

    cache.clear();

    expect(await cache.get('a', async () => 'reloaded')).toBe('reloaded');
  });
});
