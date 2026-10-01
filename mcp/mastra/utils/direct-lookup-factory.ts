/**
 * Read-only lookups an agent's request can be answered with, without the agent.
 *
 * Many requests to an agent are one of a handful of questions whose every input is known in
 * advance -- "what is on my calendar today", "what is on my to-do list", "what is in the basket".
 * The agent answers them by reading its instructions and calling the one tool that answers them,
 * which is a language-model round trip spent on a choice routing's classifier can make from a list
 * (see `verticals/routing/direct-answers.ts`). A lookup is that list entry: what it answers, in
 * words Jev can match a request against, and the code that answers it.
 *
 * A lookup's answer is facts, not prose. The voice model phrases every result anyway, and it is
 * told never to read a raw response aloud, so the answer only has to be complete and compact.
 */
export interface DirectLookup {
  /** Unique across every vertical: `<agentId>.<what>`, e.g. `calendar.today`. */
  id: string;
  /** The agent the lookup answers for, which a request must be routed to before it is offered. */
  agentId: string;
  /** What the lookup answers, as a request would ask it. This is what Jev is shown. */
  description: string;
  /**
   * Looks the answer up. Resolves to `undefined` to decline -- nothing to go on, say -- and may
   * throw; either way the request goes to the agent as it would have without the lookup.
   */
  answer: () => Promise<string | undefined>;
}

/** Declares a lookup, checking its id is namespaced by its agent. */
export function createDirectLookup(lookup: DirectLookup): DirectLookup {
  if (!lookup.id.startsWith(`${lookup.agentId}.`)) {
    throw new Error(`Direct lookup "${lookup.id}" must be named "${lookup.agentId}.<what>"`);
  }
  return lookup;
}

/** Facts in the compact form a lookup answers with. */
export function asFacts(value: unknown): string {
  return JSON.stringify(value);
}
