import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { createClassifier } from '../../utils/index.js';
import { type HomeCommand, homeCommandFrom, homeCommandQuestions } from '../internet-of-things/home-commands.js';
import type { HomeArea } from '../internet-of-things/tools.js';
import type { OpenQuestion } from './questions.js';
import { RESPONSE_STYLE_DESCRIPTIONS, type ResponseStyle } from './response-styles.js';

/**
 * The fast path in front of the routing planner.
 *
 * The planner is a language model writing a plan, and every request waits on it before any work
 * starts. Most requests do not need a plan written, though: "turn off the lights" goes to one agent,
 * as it was said, and the only decision in it is which agent. That is a choice from a list, which is
 * exactly what an evaluation model (Jev, see `utils/providers/typesafe-provider.ts`) answers -- in
 * one short call that returns a probability per agent instead of a generated plan.
 *
 * So both run at once. When the classifier is sure that a single agent can carry the whole request
 * as it was said, the planner is cancelled and the request goes to that agent with the user's own
 * words as its prompt. Anything else -- several agents, one that needs another's answer first, an
 * answer to a waiting question, or simply a classifier that is not sure -- is left to the planner,
 * which is exactly as good as it was before any of this existed. Being wrong here costs a
 * wrong answer and being unsure costs nothing, so the bar is set high.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const ROUTING_CLASSIFIER_ID = 'routingClassifier';

/**
 * How sure the classifier must be before the planner is skipped.
 *
 * High on purpose: below it the planner answers anyway, so the only cost of a high bar is the
 * requests that could have been faster, while the cost of a low one is a request sent to the wrong
 * agent, or a two-part request answered in half.
 */
export const FAST_PATH_CONFIDENCE = 0.85;

/** The choice for a request that needs more than one agent, or one agent more than once. */
const SEVERAL = 'several';
/** The choice for a request no agent can handle. */
const NONE = 'none';

/**
 * The agent a smart home command goes to, and the one whose simplest commands are carried out
 * without it (see `internet-of-things/home-commands.ts`).
 */
const HOME_AGENT_ID = 'internetOfThings';

/** What the classifier is told about one agent it may pick. */
export interface RoutableAgentSummary {
  id: string;
  description: string;
}

/**
 * Built per call, because the waiting questions change between requests.
 *
 * The home command questions are asked of every request rather than in a second call once it is
 * known to be one, because a second call would be a second round trip on exactly the requests
 * this is meant to speed up. They are left out when the areas are not known, since a command
 * cannot then be aimed at a room anyway.
 */
export function routingQuestions(agents: RoutableAgentSummary[], openQuestions: OpenQuestion[], areas: HomeArea[]) {
  // Keyed by whatever the agents are called, so the choice is any string and is checked against
  // the routable ids when it is read (see `fastRouteFrom`).
  const routeCriteria: Record<string, string | null> = {
    ...Object.fromEntries(agents.map((agent) => [agent.id, agent.description || null])),
    [SEVERAL]: 'More than one agent is needed, or one agent needs another agent to answer first',
    [NONE]: 'No agent covers this request',
  };

  return {
    route: {
      type: 'choice' as const,
      instructions:
        'This is a request the user made to a voice assistant. Choose the one agent that can carry out ALL of it, ' +
        'exactly as it was said, knowing nothing else. Choose several when it asks for more than one thing that ' +
        'different agents cover, or when carrying it out needs something another agent would first have to look up ' +
        '-- "the weather where I am" needs the location before the weather. Choose none when no agent covers it.',
      criteria: routeCriteria,
    },
    responseStyle: {
      type: 'choice' as const,
      instructions:
        'How should the answer to this request sound? Ask where the value of the request lands. When it mixes ' +
        'kinds, pick the one that needs the most words.',
      criteria: RESPONSE_STYLE_DESCRIPTIONS,
    },
    ...(areas.length > 0 && agents.some((agent) => agent.id === HOME_AGENT_ID) && homeCommandQuestions(areas)),
    ...(openQuestions.length > 0 && {
      answersWaitingQuestion: {
        type: 'boolean' as const,
        instructions: `The assistant earlier asked the user these questions, which are still waiting for an answer:\n${openQuestions
          .map((question) => `- ${question.question}`)
          .join('\n')}\nIs this request, in whole or in part, the user's answer to one of them?`,
      },
    }),
  };
}

export type RoutingAnswers = ClassifierAnswers<ReturnType<typeof routingQuestions>>;

/** A request the classifier is sure of: the agent that takes it whole, and how to speak the answer. */
export interface FastRoute {
  agentId: string;
  responseStyle: ResponseStyle;
  /** Set when the request is a smart home command plain enough to carry out without the agent. */
  homeCommand?: HomeCommand;
}

/**
 * Reads the classifier's answers into a route, or into nothing when the planner should decide.
 *
 * Pure, so every way of declining the fast path can be tested without a model.
 */
export function fastRouteFrom(
  answers: RoutingAnswers,
  routableAgentIds: ReadonlySet<string>,
  areas: HomeArea[],
): FastRoute | undefined {
  const { choice, probabilities } = answers.route;
  if (!routableAgentIds.has(choice)) {
    return undefined;
  }

  // No distribution means no way of knowing how sure it is, which is the same as not being sure.
  if ((probabilities?.[choice] ?? 0) < FAST_PATH_CONFIDENCE) {
    return undefined;
  }

  // Only the planner can pull an answer out of a request and hand it back to the work that asked,
  // so a request that might be one goes to the planner.
  if (answers.answersWaitingQuestion && answers.answersWaitingQuestion.probability > 1 - FAST_PATH_CONFIDENCE) {
    return undefined;
  }

  const responseStyle = answers.responseStyle.choice;
  const homeCommand =
    choice === HOME_AGENT_ID && responseStyle === 'command' && answers.homeAction && answers.homeArea
      ? homeCommandFrom({ homeAction: answers.homeAction, homeArea: answers.homeArea }, areas, FAST_PATH_CONFIDENCE)
      : undefined;

  return { agentId: choice, responseStyle, ...(homeCommand && { homeCommand }) };
}

let routingClassifier: Classifier | undefined;
let routingClassifierBuilt = false;

/**
 * The classifier routing runs on, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one requests use.
 */
export function getRoutingClassifier(): Classifier | undefined {
  if (!routingClassifierBuilt) {
    routingClassifier = createClassifier(ROUTING_CLASSIFIER_ID);
    routingClassifierBuilt = true;
  }
  return routingClassifier;
}

/** Asks the classifier whether one agent can take a request whole. */
export async function classifyRequest(
  classifier: Classifier,
  userQuery: string,
  agents: RoutableAgentSummary[],
  openQuestions: OpenQuestion[],
  areas: HomeArea[],
  abortSignal?: AbortSignal,
): Promise<FastRoute | undefined> {
  const { answers } = await classifier.evaluate({
    state: userQuery,
    questions: routingQuestions(agents, openQuestions, areas),
    abortSignal,
  });

  return fastRouteFrom(answers, new Set(agents.map((agent) => agent.id)), areas);
}
