import type { Mastra } from '@mastra/core';
import { logger } from '../../utils/logger.js';
import { getRoutingRuntime, type RoutingSnapshot, rememberMastraRegistry } from './controller.js';

/**
 * Runs one request to completion with nobody on the line, and says how it went in a sentence.
 *
 * For a request that comes from a button rather than a voice — the glance's "Unlock the front door"
 * (`visualize/glance.ts`) — routed exactly as the same words spoken would be: planned, delegated and
 * carried out by the same agents. What differs is the reporting. There is no voice model to poll
 * and phrase the results, so the closing results themselves are the answer; and nothing is said
 * between, so no important change is claimed for an aside, and none is lost to a button press.
 *
 * Its own routing session, so it never supersedes what sir is saying to Jarvis meanwhile.
 */

/** How long a request is waited for before the button is told it is still going. */
export const REQUEST_COMPLETION_DEADLINE_MS = 120_000;

/** The longest answer handed back: it is shown on a button, not read out. */
const MAX_MESSAGE_LENGTH = 280;

export interface RequestOutcome {
  ok: boolean;
  /** A short sentence to show sir: what came of it, or why it did not happen. */
  message: string;
}

function shortened(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_MESSAGE_LENGTH ? `${trimmed.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : trimmed;
}

/** What a finished request came to, as one outcome. */
export function outcomeOf(snapshot: RoutingSnapshot): RequestOutcome {
  if (snapshot.error) {
    return { ok: false, message: shortened(`That could not be done: ${snapshot.error}`) };
  }
  if (snapshot.conversationControl) {
    return { ok: false, message: 'That is not something Jarvis can do from here.' };
  }
  const [question] = snapshot.questions;
  if (question) {
    return { ok: false, message: shortened(`Jarvis needs to ask you first: ${question.question}`) };
  }

  const failed = snapshot.all.filter((outcome) => outcome.failed);
  const answers = snapshot.all.map((outcome) => outcome.result.trim()).filter((result) => result.length > 0);
  return { ok: failed.length === 0, message: shortened(answers.join(' ')) || 'Done.' };
}

export async function runRequestToCompletion(
  mastra: Mastra,
  request: string,
  { sessionId, deadlineMs = REQUEST_COMPLETION_DEADLINE_MS }: { sessionId: string; deadlineMs?: number },
): Promise<RequestOutcome> {
  rememberMastraRegistry(mastra);
  const runtime = getRoutingRuntime();

  await runtime.start(sessionId, request);
  if (!(await runtime.finishesWithin(sessionId, deadlineMs))) {
    logger.warn('A request run to completion was still running at its deadline', { sessionId, deadlineMs });
    return { ok: false, message: 'This is taking longer than expected; Jarvis is still working on it.' };
  }

  return outcomeOf(await runtime.poll(sessionId));
}
