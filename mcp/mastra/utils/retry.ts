/**
 * Retrying transient upstream failures.
 *
 * Hosted model APIs fail intermittently for reasons that have nothing to do with the
 * request: a 500 from the provider, a 429 when a burst lands, a connection reset. These
 * were previously fatal everywhere in this codebase — a single blip took down whatever
 * workflow happened to be running, and in the case of the Synapse batcher it silently
 * discarded a batch of state changes.
 *
 * Observed in practice: `AI_APICallError: Internal error encountered` from
 * gemini-flash-latest, twice inside ten minutes, HTTP 500, and the error object itself
 * carried `isRetryable: true` — the SDK knew, and nothing acted on it.
 */

import { logger } from './logger.js';

/** Status codes worth trying again: rate limits, timeouts, and server-side faults. */
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Node/undici network failures that are transient by nature. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export interface RetryOptions {
  /** Total attempts including the first. Defaults to 3. */
  attempts?: number;
  /** Delay before the second attempt, doubled each time after. Defaults to 500ms. */
  initialDelayMs?: number;
  /** Ceiling for the backoff delay. Defaults to 8000ms. */
  maxDelayMs?: number;
  /** Included in log lines so a retry can be traced back to what was retrying. */
  label?: string;
}

/**
 * Whether an error is worth trying again.
 *
 * The AI SDK already classifies its own errors and exposes `isRetryable`, so that is
 * trusted first. Everything else is a fallback for errors that never reach the SDK's
 * classification — raw fetch failures, and providers that surface a bare status code.
 *
 * Deliberately conservative: an unrecognised error is treated as permanent. Retrying a
 * genuine 400 wastes time and tokens and delays a failure the caller needs to see.
 */
export function isRetryableError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    isRetryable?: unknown;
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    cause?: unknown;
  };

  if (candidate.isRetryable === true) {
    return true;
  }

  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : candidate.status;
  if (typeof status === 'number' && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  if (typeof candidate.code === 'string' && RETRYABLE_NETWORK_CODES.has(candidate.code)) {
    return true;
  }

  // `fetch` rejects with a bare TypeError whose detail lives on `cause`, so unwrap one
  // level rather than treating every wrapped failure as permanent.
  if (candidate.cause != null && candidate.cause !== error) {
    return isRetryableError(candidate.cause);
  }

  return false;
}

/** Describes an error briefly enough for a log line. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : JSON.stringify(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs an operation, retrying it while it fails for a transient reason.
 *
 * Backoff is exponential with full jitter. The jitter matters more than the exponent
 * here: several agents in a workflow wave hit the same provider at the same moment, so
 * without it a provider-wide blip produces a synchronised retry that looks exactly like
 * the burst that caused the rate limit.
 *
 * A non-retryable error is rethrown immediately, and so is the last attempt's error, so
 * callers see the real failure rather than a wrapper.
 *
 * @param operation - The work to attempt; called once per attempt
 * @param options - Attempt count, backoff bounds, and a label for logging
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, initialDelayMs = 500, maxDelayMs = 8000, label = 'operation' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === attempts) {
        throw error;
      }

      const backoff = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = Math.round(Math.random() * backoff);

      logger.warn('Retrying after a transient failure', {
        label,
        attempt,
        attempts,
        delayMs: delay,
        error: describeError(error),
      });

      await sleep(delay);
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has a
  // definite return type without an assertion.
  throw lastError;
}
