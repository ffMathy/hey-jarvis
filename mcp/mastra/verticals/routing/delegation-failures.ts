/**
 * Why a delegation failed, carried from the hook that sees it to the poll that reports it.
 *
 * Mastra wraps a failed delegation in a `MastraError` whose text is
 * `[Agent:X] - Failed agent tool execution for Y`, and the reason underneath it does not
 * survive the trip: by the time the failure reaches the session as a `tool_end` event it is
 * that headline and nothing else — no `cause`, no `details`. A live call reported eight
 * failed delegations and could not say why any of them failed.
 *
 * `onDelegationComplete` is handed the real `Error` before the wrapping happens, so it is
 * recorded here under the tool call id the event will arrive with, and the two are rejoined
 * when the poll builds its report.
 */

import { logger } from '../../utils/logger.js';

/**
 * How many unclaimed failures to keep.
 *
 * Every record is normally claimed by the `tool_end` that follows it. A delegation that
 * fails in a way that never produces one would otherwise leave its record here for the life
 * of the process, so the oldest is dropped once this many are outstanding.
 */
const MAX_UNCLAIMED_FAILURES = 64;

const failureByToolCallId = new Map<string, string>();

/** Everything an error says about itself, its `cause` chain included. */
export function describeErrorChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  // Bounded rather than `while (current)`: a cause chain that loops back on itself would
  // otherwise hang the poll that is trying to report the failure.
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    const message = current.message.trim();
    if (message && !messages.includes(message)) {
      messages.push(message);
    }
    current = current.cause;
  }

  if (messages.length > 0) {
    return messages.join(': ');
  }

  return typeof error === 'string' ? error : JSON.stringify(error ?? null);
}

/** Remembers why one delegation failed, and logs it where an operator will see it. */
export function recordDelegationFailure(toolCallId: string, agentId: string, error: unknown): void {
  const description = describeErrorChain(error);

  logger.error('Delegation failed', {
    agentId,
    toolCallId,
    error: description,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (failureByToolCallId.size >= MAX_UNCLAIMED_FAILURES) {
    const oldest = failureByToolCallId.keys().next();
    if (!oldest.done) {
      failureByToolCallId.delete(oldest.value);
    }
  }

  failureByToolCallId.set(toolCallId, description);
}

/** Claims the recorded reason for a failed delegation, if one was recorded. */
export function takeDelegationFailure(toolCallId: string): string | undefined {
  const description = failureByToolCallId.get(toolCallId);
  failureByToolCallId.delete(toolCallId);
  return description;
}

/** Forgets every unclaimed failure. Used by tests and when a request is superseded. */
export function clearDelegationFailures(): void {
  failureByToolCallId.clear();
}
