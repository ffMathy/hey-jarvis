import { retryWithBackoff } from './retry-with-backoff';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should succeed on first attempt if function succeeds', async () => {
    const mockFn = jest.fn().mockResolvedValue('success');
    
    const result = await retryWithBackoff(mockFn, { maxRetries: 3 });
    
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Attempt 1 failed'))
      .mockRejectedValueOnce(new Error('Attempt 2 failed'))
      .mockResolvedValue('success on attempt 3');
    
    const result = await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 10, // Use short delay for tests
    });
    
    expect(result).toBe('success on attempt 3');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should throw error after exhausting all retries', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Always fails'));
    
    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 10,
      })
    ).rejects.toThrow('Operation failed after 3 attempts');
    
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should call onRetry callback with correct arguments', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Attempt 1 failed'))
      .mockResolvedValue('success');
    
    const onRetry = jest.fn();
    
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 100,
      onRetry,
    });
    
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Attempt 1 failed' }),
      1,
      100
    );
  });

  it('should use exponential backoff for delays', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Attempt 1'))
      .mockRejectedValueOnce(new Error('Attempt 2'))
      .mockResolvedValue('success');
    
    const onRetry = jest.fn();
    
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffMultiplier: 2,
      onRetry,
    });
    
    // First retry: 100ms, second retry: 200ms
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 100);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 200);
  });

  it('should respect maxDelay cap', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Attempt 1'))
      .mockRejectedValueOnce(new Error('Attempt 2'))
      .mockResolvedValue('success');
    
    const onRetry = jest.fn();
    
    await retryWithBackoff(mockFn, {
      maxRetries: 3,
      initialDelay: 1000,
      backoffMultiplier: 10,
      maxDelay: 500, // Cap at 500ms
      onRetry,
    });
    
    // Second retry would be 10000ms but capped at 500ms
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 500);
  });

  it('should respect shouldRetry predicate', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Non-retryable error'));
    
    const shouldRetry = jest.fn().mockReturnValue(false);
    
    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry,
      })
    ).rejects.toThrow('Non-retryable error');
    
    expect(mockFn).toHaveBeenCalledTimes(1); // Should not retry
    expect(shouldRetry).toHaveBeenCalledWith(expect.objectContaining({ message: 'Non-retryable error' }));
  });

  it('should only retry on retryable errors', async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Retryable'))
      .mockRejectedValueOnce(new Error('Non-retryable'));
    
    const shouldRetry = (error: Error) => error.message === 'Retryable';
    
    await expect(
      retryWithBackoff(mockFn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry,
      })
    ).rejects.toThrow('Non-retryable');
    
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
