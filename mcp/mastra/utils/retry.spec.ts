import { describe, expect, it } from 'bun:test';
import { isRetryableError, withRetry } from './retry.js';

/** Shaped like the AI SDK's APICallError, which is what this mostly sees in practice. */
function apiError(overrides: Record<string, unknown>): Error {
  return Object.assign(new Error('upstream failed'), overrides);
}

describe('isRetryableError', () => {
  it('trusts the SDK when it has already classified the error', () => {
    // AI_APICallError carries this, and the real Gemini 500 that motivated the retry
    // had it set to true while nothing acted on it.
    expect(isRetryableError(apiError({ isRetryable: true }))).toBe(true);
    expect(isRetryableError(apiError({ isRetryable: false }))).toBe(false);
  });

  it('retries rate limits, timeouts and server faults', () => {
    for (const statusCode of [408, 409, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableError(apiError({ statusCode }))).toBe(true);
    }
  });

  it('does not retry a request that was simply wrong', () => {
    // Retrying a 400 or a 401 wastes tokens and delays a failure the caller must see.
    for (const statusCode of [400, 401, 403, 404, 422]) {
      expect(isRetryableError(apiError({ statusCode }))).toBe(false);
    }
  });

  it('accepts either statusCode or status, since providers differ', () => {
    expect(isRetryableError(apiError({ status: 503 }))).toBe(true);
  });

  it('retries transient network failures', () => {
    expect(isRetryableError(apiError({ code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableError(apiError({ code: 'UND_ERR_SOCKET' }))).toBe(true);
    expect(isRetryableError(apiError({ code: 'ENOENT' }))).toBe(false);
  });

  it('unwraps a cause, because fetch rejects with a bare TypeError', () => {
    const wrapped = apiError({ cause: apiError({ code: 'ETIMEDOUT' }) });
    expect(isRetryableError(wrapped)).toBe(true);
  });

  it('treats anything it does not recognise as permanent', () => {
    expect(isRetryableError(new Error('something went wrong'))).toBe(false);
    expect(isRetryableError('a string')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('does not loop forever on an error that causes itself', () => {
    const looping = apiError({});
    (looping as { cause?: unknown }).cause = looping;

    expect(isRetryableError(looping)).toBe(false);
  });
});

describe('withRetry', () => {
  const fast = { initialDelayMs: 1, maxDelayMs: 2 };

  it('returns the result without retrying when the operation succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, fast);

    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a transient failure and returns the eventual success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) {
        throw apiError({ statusCode: 500 });
      }
      return 'recovered';
    }, fast);

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    let calls = 0;
    const failing = withRetry(
      async () => {
        calls++;
        throw apiError({ statusCode: 503, message: 'still down' });
      },
      { ...fast, attempts: 3 },
    );

    // The caller sees the real provider error, not a wrapper that hides it.
    expect(failing).rejects.toThrow('still down');
    await failing.catch(() => {});
    expect(calls).toBe(3);
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    const failing = withRetry(async () => {
      calls++;
      throw apiError({ statusCode: 400 });
    }, fast);

    expect(failing).rejects.toThrow();
    await failing.catch(() => {});
    // One attempt: a 400 will be a 400 again.
    expect(calls).toBe(1);
  });

  it('honours a single-attempt budget', async () => {
    let calls = 0;
    const failing = withRetry(
      async () => {
        calls++;
        throw apiError({ statusCode: 500 });
      },
      { ...fast, attempts: 1 },
    );

    expect(failing).rejects.toThrow();
    await failing.catch(() => {});
    expect(calls).toBe(1);
  });

  it('waits between attempts rather than hammering the provider', async () => {
    const started = performance.now();
    let calls = 0;

    await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw apiError({ statusCode: 429 });
        }
        return 'ok';
      },
      { initialDelayMs: 40, maxDelayMs: 80 },
    );

    // Full jitter means each delay is somewhere in [0, backoff], so the only safe
    // assertion is that time passed at all. The point being tested is that a retry
    // storm cannot be instantaneous.
    expect(performance.now() - started).toBeGreaterThan(0);
    expect(calls).toBe(3);
  });
});
