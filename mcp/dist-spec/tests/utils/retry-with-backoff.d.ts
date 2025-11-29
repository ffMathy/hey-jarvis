/**
 * Configuration options for retry with exponential backoff
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Optional callback for logging retry attempts */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** Optional predicate to determine if error should trigger retry (default: retry all errors) */
  shouldRetry?: (error: Error) => boolean;
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
export declare function retryWithBackoff<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
//# sourceMappingURL=retry-with-backoff.d.ts.map
