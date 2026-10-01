import { answerHomeQuestion, type HomeService, runHomeCommand } from '../internet-of-things/home-commands.js';
import { FAST_PATH_CONFIDENCE } from './classifier.js';
import { findDirectLookup } from './direct-lookups.js';

/**
 * Requests answered without the agent they were routed to.
 *
 * Routing's classifier already knows which agent a request is for. For some requests it can tell
 * more than that, from fixed lists alone -- which Home Assistant service, which kind of device --
 * and then nothing is left for the agent's language model to do: code makes the call, and the
 * result goes back as plain facts for the voice model to phrase, which it does for every result
 * anyway. That skips the agent's tool loop, which is the slowest part of a simple request.
 *
 * Every direct answer can decline, resolving to `undefined`, or throw. Either way the request runs
 * through the agent it was routed to, exactly as it would have without a direct answer.
 */
export type DirectAnswer =
  /** A smart home command, carried out with this service (see `internet-of-things/home-commands.ts`). */
  | { kind: 'homeCommand'; service: HomeService }
  /** A question about how things are in the house right now, about devices of this domain. */
  | { kind: 'homeQuestion'; domain: string }
  /** One of an agent's own read-only lookups (see `direct-lookups.ts`). */
  | { kind: 'lookup'; lookupId: string };

/** Answers a request directly, or resolves to `undefined` when the agent should after all. */
export async function answerDirectly(direct: DirectAnswer, userQuery: string): Promise<string | undefined> {
  switch (direct.kind) {
    case 'homeCommand':
      return await runHomeCommand(userQuery, direct.service, FAST_PATH_CONFIDENCE);
    case 'homeQuestion':
      return await answerHomeQuestion(userQuery, direct.domain, FAST_PATH_CONFIDENCE);
    case 'lookup':
      return await findDirectLookup(direct.lookupId)?.answer();
  }
}

/** What a direct answer is, for the logs. */
export function describeDirectAnswer(direct: DirectAnswer): string {
  switch (direct.kind) {
    case 'homeCommand':
      return `home command ${direct.service.id}`;
    case 'homeQuestion':
      return `home question about ${direct.domain}`;
    case 'lookup':
      return `lookup ${direct.lookupId}`;
  }
}
