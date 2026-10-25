import type { ClassifierQuestions } from '@mastra/core/classifier';
import type { ClassifierAnswerSet } from './classifier-answers.js';
import type { DirectAnswerOutcome, DirectCommand, DirectLookup } from './direct-lookup-factory.js';

/**
 * The contract between routing and every vertical that can answer a request without its agent.
 *
 * Routing decides which agent a request is for, and whether that agent is needed at all. What an
 * agent can do without its language model is the vertical's own business: routing only ever sees
 * what is declared here -- lookups and commands by their description, and sources that bring their
 * own classifier questions -- and hands the request back to the vertical to carry out. So a vertical
 * gains or changes a direct answer without routing changing at all (see `.claude/rules/mastra.md`).
 */

/** A request routed to one agent that can be answered without it, ready to be carried out. */
export interface DirectAnswer {
  /** What it is, for the logs: "lookup calendar.today", "home command on light". */
  description: string;
  /**
   * Answers the request, or resolves to `undefined` when the agent should after all.
   *
   * May throw; either way the request runs through the agent it was routed to, exactly as it
   * would have without a direct answer.
   */
  answer: (request: string) => Promise<DirectAnswerOutcome | undefined>;
}

/**
 * What a request asks for, as far as a direct answer cares: a change to the world, or a question.
 * A request that is neither -- a conversation -- is never answered directly.
 */
export type RequestKind = 'command' | 'question';

/** What a source is told when routing has answered its questions about one request. */
export interface DirectAnswerChoiceContext {
  requestKind: RequestKind;
  /** How sure an answer must be before the source acts on it. */
  minimumConfidence: number;
}

/** A source's questions for one request, and how it reads routing's answers to them. */
export interface PreparedDirectAnswers {
  /** Asked on routing's own classifier call, so they cost no extra round trip. */
  questions: ClassifierQuestions;
  /**
   * Reads the answers into a direct answer, or into nothing when the agent should take the request.
   * Only called for a request routed to the source's own agent.
   */
  choose: (answers: ClassifierAnswerSet, context: DirectAnswerChoiceContext) => DirectAnswer | undefined;
}

/**
 * Direct answers whose options come from live data, so their questions are built per request --
 * the Home Assistant services and devices there are right now, say.
 */
export interface DirectAnswerSource {
  /** Unique across every vertical: `<agentId>.<what>`, e.g. `internetOfThings.home`. */
  id: string;
  /** The agent the source answers for. Its questions are only asked while that agent is routable. */
  agentId: string;
  /**
   * The questions for the next request, or `undefined` when there is nothing to ask.
   *
   * Never rejects and never waits long: routing waits on it before classifying, and without it the
   * request simply goes to the agent.
   */
  prepare: () => Promise<PreparedDirectAnswers | undefined>;
}

/** Declares a source, checking its id is namespaced by its agent. */
export function createDirectAnswerSource(source: DirectAnswerSource): DirectAnswerSource {
  if (!source.id.startsWith(`${source.agentId}.`)) {
    throw new Error(`Direct answer source "${source.id}" must be named "${source.agentId}.<what>"`);
  }
  return source;
}

/** Everything every vertical can answer without its agent, as routing is handed it. */
export interface DirectAnswerCatalog {
  lookups: readonly DirectLookup[];
  commands: readonly DirectCommand[];
  sources: readonly DirectAnswerSource[];
}
