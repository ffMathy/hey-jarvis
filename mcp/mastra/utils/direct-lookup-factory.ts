import { type AffectedEntity, cleanAffectedEntities, readAffectedEntities } from './affected-entities.js';
import { type ExecutableTool, executeTool } from './tool-factory.js';

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
 *
 * What a lookup reads is reported for sir's headset to light up, exactly as the agent's call of the
 * same tool would have reported it: a lookup calls its tools through the `callTool` it is handed,
 * which reads each call with the tool's own reader (see `affected-entities.ts`). So "what is on my
 * to-do list" lights up the list whichever way it is answered, and what a tool touches is decided
 * in one place, on the tool.
 */

/**
 * Calls one of an agent's tools for a lookup, as the agent would, and returns what it returned.
 *
 * The tool's id is required, since that is what its reader is found by.
 */
export type LookupToolCaller = <TInput, TOutput>(
  tool: ExecutableTool<TInput, TOutput> & { id: string },
  inputData: TInput,
) => Promise<TOutput>;

export interface DirectLookup {
  /** Unique across every vertical: `<agentId>.<what>`, e.g. `calendar.today`. */
  id: string;
  /** The agent the lookup answers for, which a request must be routed to before it is offered. */
  agentId: string;
  /** What the lookup answers, as a request would ask it. This is what Jev is shown. */
  description: string;
  /**
   * Looks the answer up, calling every tool through `callTool` so that what it reads is reported.
   *
   * Resolves to `undefined` to decline -- nothing to go on, say -- and may throw; either way the
   * request goes to the agent as it would have without the lookup.
   */
  answer: (callTool: LookupToolCaller) => Promise<string | undefined>;
}

/**
 * What a request answered without its agent came to: the facts, and what answering read or changed.
 *
 * No agent streams a tool result for routing to read the things touched off (see
 * `verticals/routing/controller.ts`), so every direct answer -- a lookup, a smart home command, a
 * question about the house -- says itself what it touched, as the agent's tool calls would have.
 */
export interface DirectAnswerOutcome {
  /** The facts, for the voice model to phrase. */
  text: string;
  /** What the answer read or changed, for sir's headset to light up. */
  entities: AffectedEntity[];
}

/** Declares a lookup, checking its id is namespaced by its agent. */
export function createDirectLookup(lookup: DirectLookup): DirectLookup {
  if (!lookup.id.startsWith(`${lookup.agentId}.`)) {
    throw new Error(`Direct lookup "${lookup.id}" must be named "${lookup.agentId}.<what>"`);
  }
  return lookup;
}

/**
 * Answers a lookup, with what its tool calls touched, or resolves to `undefined` when it declines.
 *
 * What the calls touched is only handed over with the answer. A lookup that declines or throws
 * part way sends the request to the agent, which reports what it touches itself -- a glow for an
 * answer this never gave would only point sir at the wrong thing.
 */
export async function answerLookup(lookup: DirectLookup): Promise<DirectAnswerOutcome | undefined> {
  return await answerWithTools((callTool) => lookup.answer(callTool));
}

/** Runs a direct answer, collecting what its tool calls touched, and hands both back together. */
async function answerWithTools(
  answer: (callTool: LookupToolCaller) => Promise<string | undefined>,
): Promise<DirectAnswerOutcome | undefined> {
  const touched: AffectedEntity[] = [];
  const text = await answer(async (tool, inputData) => {
    const result = await executeTool(tool, inputData);
    touched.push(...readAffectedEntities(tool.id, inputData, result));
    return result;
  });
  return text === undefined ? undefined : { text, entities: cleanAffectedEntities(touched) };
}

/*
 * Commands an agent's request can be carried out with, without the agent.
 *
 * The counterpart of a lookup for requests that change something: "wake me at 6:30". Routing's
 * classifier only matches a request against a command's description; everything about carrying it
 * out -- further Jev questions, the tool it calls -- stays inside the vertical that declares it, so
 * routing never learns what any vertical can do.
 */

/** What a command is handed to carry a request out with. */
export interface DirectCommandContext {
  /** The request, in the user's own words. */
  request: string;
  /** How sure any further classifier answer must be before the command acts on it. */
  minimumConfidence: number;
  /** Calls a tool as the agent would, so what it touches is reported. */
  callTool: LookupToolCaller;
}

export interface DirectCommand {
  /** Unique across every vertical: `<agentId>.<what>`, e.g. `internetOfThings.phoneAlarm`. */
  id: string;
  /** The agent the command acts for, which a request must be routed to before it is offered. */
  agentId: string;
  /** What the command does, as a request would ask for it. This is what Jev is shown. */
  description: string;
  /**
   * Carries the request out, and says what came of it in facts for the voice model to phrase.
   *
   * Resolves to `undefined` to decline -- unsure of some detail, say -- and may throw; either way
   * the request goes to the agent as it would have without the command.
   */
  answer: (context: DirectCommandContext) => Promise<string | undefined>;
}

/** Declares a command, checking its id is namespaced by its agent. */
export function createDirectCommand(command: DirectCommand): DirectCommand {
  if (!command.id.startsWith(`${command.agentId}.`)) {
    throw new Error(`Direct command "${command.id}" must be named "${command.agentId}.<what>"`);
  }
  return command;
}

/** Carries a command out, with what its tool calls touched, or resolves to `undefined` when it declines. */
export async function answerCommand(
  command: DirectCommand,
  request: string,
  minimumConfidence: number,
): Promise<DirectAnswerOutcome | undefined> {
  return await answerWithTools((callTool) => command.answer({ request, minimumConfidence, callTool }));
}

/** Facts in the compact form a lookup answers with. */
export function asFacts(value: unknown): string {
  return JSON.stringify(value);
}
