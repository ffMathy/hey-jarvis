import { describe, expect, it, mock } from 'bun:test';
import { retryWithBackoff } from '../../../mcp/tests/utils/retry-with-backoff.js';

describe('retryWithBackoff', () => {
  it('should succeed on first attempt if function succeeds', async () => {
    const mockFn = mock(() => Promise.resolve('success'));
    const result = await retryWithBackoff(mockFn, { maxRetries: 3 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
  it('should retry on failure and eventually succeed', async () => {
    let callCount = 0;
    const mockFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Attempt 1 failed'));
      if (callCount === 2) return Promise.reject(new Error('Attempt 2 failed'));
      return Promise.resolve('success on attempt 3');
    });
    const result = await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 10,
    });
    expect(result).toBe('success on attempt 3');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });
  it('should throw error after exhausting all retries', async () => {
    const mockFn = mock(() => Promise.reject(new Error('Always fails')));
    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 10,
      }),
    ).rejects.toThrow('Operation failed after 3 attempts');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });
  it('should call onRetry callback with correct arguments', async () => {
    let callCount = 0;
    const mockFn = mock(() => {
      callCount++;
      if (callCount <= 1) return Promise.reject(new Error(`Attempt ${callCount} failed`));
      return Promise.resolve('success');
    });
    const onRetryMock = mock(() => {});
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 100,
      onRetry: onRetryMock,
    });
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });
  it('should use exponential backoff for delays', async () => {
    let callCount = 0;
    const mockFn = mock(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('Failed'));
      return Promise.resolve('success');
    });
    const startTime = Date.now();
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 10,
      backoffMultiplier: 2,
    });
    const endTime = Date.now();
    expect(endTime - startTime).toBeGreaterThanOrEqual(25);
  });
  it('should respect maxDelay cap', async () => {
    let callCount = 0;
    const mockFn = mock(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error(`Attempt ${callCount}`));
      return Promise.resolve('success');
    });
    const onRetryMock = mock(() => {});
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 1000,
      backoffMultiplier: 10,
      maxDelay: 500,
      onRetry: onRetryMock,
    });
    expect(mockFn).toHaveBeenCalledTimes(3);
  });
  it('should respect shouldRetry predicate', async () => {
    const mockFn = mock(() => Promise.reject(new Error('Non-retryable error')));
    const shouldRetry = mock(() => false);
    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry,
      }),
    ).rejects.toThrow('Non-retryable error');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
  it('should only retry on retryable errors', async () => {
    let callCount = 0;
    const mockFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Retryable'));
      return Promise.reject(new Error('Non-retryable'));
    });
    const shouldRetry = (error) => error.message === 'Retryable';
    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry,
      }),
    ).rejects.toThrow('Non-retryable');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
//# sourceMappingURL=retry-with-backoff.spec.js.map
