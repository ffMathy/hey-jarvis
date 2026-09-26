/**
 * The Microsoft access token is what every email tool waits on before Graph is asked anything,
 * so it is acquired once and reused until shortly before it expires. These pin that reuse, and
 * that a failure or a token without an expiry is never what gets reused.
 */

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { createAccessTokenCache, type IssuedAccessToken } from './access-token-cache.js';

const NOW = new Date('2026-09-26T08:00:00Z');

function inMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** An acquirer that hands out `token-1`, `token-2`, ... each lasting an hour, and counts its calls. */
function countingAcquirer(expiresOn: () => Date | null = () => inMinutes(60)) {
  let calls = 0;
  const acquire = async (): Promise<IssuedAccessToken> => {
    calls++;
    return { accessToken: `token-${calls}`, expiresOn: expiresOn() };
  };

  return { acquire, calls: () => calls };
}

afterEach(() => {
  setSystemTime();
});

describe('createAccessTokenCache', () => {
  it('reuses a token until shortly before it expires', async () => {
    setSystemTime(NOW);
    const acquirer = countingAcquirer();
    const tokens = createAccessTokenCache(acquirer.acquire);

    expect(await tokens.get()).toBe('token-1');
    setSystemTime(new Date(NOW.getTime() + 50 * 60_000));
    expect(await tokens.get()).toBe('token-1');
    expect(acquirer.calls()).toBe(1);

    // Within five minutes of expiry the token is replaced rather than handed to a tool call.
    setSystemTime(new Date(NOW.getTime() + 56 * 60_000));
    expect(await tokens.get()).toBe('token-2');
    expect(acquirer.calls()).toBe(2);
  });

  it('shares one acquisition between concurrent callers', async () => {
    const acquirer = countingAcquirer();
    const tokens = createAccessTokenCache(acquirer.acquire);

    const concurrent = await Promise.all([tokens.get(), tokens.get(), tokens.get()]);

    expect(concurrent).toEqual(['token-1', 'token-1', 'token-1']);
    expect(acquirer.calls()).toBe(1);
  });

  it('does not remember a failed acquisition', async () => {
    let attempts = 0;
    const tokens = createAccessTokenCache(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('invalid_grant');
      }
      return { accessToken: 'recovered', expiresOn: inMinutes(60) };
    });

    await expect(tokens.get()).rejects.toThrow('invalid_grant');
    expect(await tokens.get()).toBe('recovered');
  });

  it('does not keep a token that has no expiry', async () => {
    const acquirer = countingAcquirer(() => null);
    const tokens = createAccessTokenCache(acquirer.acquire);

    expect(await tokens.get()).toBe('token-1');
    expect(await tokens.get()).toBe('token-2');
  });
});
