/**
 * Calculate delay with exponential backoff: initialDelay * (backoffMultiplier ^ (attempt - 1))
 * Use integer arithmetic to avoid floating-point precision issues
 */
function calculateBackoffDelay(attempt, initialDelay, maxDelay, backoffMultiplier) {
  let delayMs = initialDelay;
  for (let i = 1; i < attempt; i++) {
    delayMs = Math.min(delayMs * backoffMultiplier, maxDelay);
  }
  return delayMs;
}
/**
 * Execute an async function with exponential backoff retry logic
 *
 * NOTE: For Vercel AI SDK calls (generateObject, generateText, etc.), use the built-in
 * `maxRetries` parameter instead of this utility. This utility is for general-purpose
 * retry logic for other async operations.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's result
 * @throws Error if all retry attempts are exhausted
 *
 * @example
 * ```typescript
 * // For Vercel AI SDK calls, use built-in retry:
 * const result = await generateObject({
 *   model: google('gemini-flash-latest'),
 *   maxRetries: 3, // Built-in retry
 *   // ...
 * });
 *
 * // For other async operations, use this utility:
 * const result = await retryWithBackoff(
 *   async () => await apiCall(),
 *   {
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Attempt ${attempt} failed: ${error.message}, retrying in ${delay}ms`);
 *     }
 *   }
 * );
 * ```
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    onRetry,
    shouldRetry = () => true,
  } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Check if we should retry this error
      if (!shouldRetry(lastError)) {
        throw lastError;
      }
      // If this was the last attempt, don't wait - just throw
      if (attempt >= maxRetries) {
        break;
      }
      const delayMs = calculateBackoffDelay(attempt, initialDelay, maxDelay, backoffMultiplier);
      // Call the retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt, delayMs);
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // All retries exhausted
  throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}
//# sourceMappingURL=retry-with-backoff.js.map
