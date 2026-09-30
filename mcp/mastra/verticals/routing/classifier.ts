import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { confidentChoice, createLazyClassifier } from '../../utils/index.js';
import { type HomeService, homeServiceFrom, homeServiceQuestions } from '../internet-of-things/home-commands.js';
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
 * words as its prompt. The same call settles the other decisions routing used to leave to the
 * planner or to a rule of thumb: whether the request is only the answer to a question the user was
 * asked, whether it is only a goodbye, and whether it replaces, cancels or adds to a request still
 * running. Anything the classifier is not sure of is decided as it was before any of this existed.
 * Being wrong here costs a wrong answer and being unsure costs nothing, so the bar is set high.
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

/** The choice for a request that is about the call itself: goodbye, that will be all, hang up. */
const END_CALL = 'endCall';
/** The choice for a request that answers none of the questions waiting on the user. */
const NO_QUESTION = 'none';

/**
 * How a request relates to the one still running when it arrives.
 *
 * - `replaces`: a correction or a change of mind about it ("no, the kitchen").
 * - `cancels`: stop it, and do nothing else ("never mind").
 * - `adds`: a separate errand, which should not cost the running one its answer.
 */
export const RELATIONS_TO_RUNNING_REQUEST = ['replaces', 'cancels', 'adds'] as const;

export type RelationToRunningRequest = (typeof RELATIONS_TO_RUNNING_REQUEST)[number];

/** What the classifier is given besides the request itself. */
export interface RoutingContext {
  agents: RoutableAgentSummary[];
  openQuestions: OpenQuestion[];
  services: HomeService[];
  /** The request still running in this session, if there is one. */
  runningRequest?: string;
}

/**
 * The questions put to Jev about one request, built per call because what they offer changes:
 * the questions waiting on the user, the request still running, Home Assistant's services.
 *
 * Everything routing might want to know is asked in the one call, rather than in a second call
 * once the first has answered, because a second call would be a second round trip on exactly the
 * requests this is meant to speed up. The questions a request does not need -- no question waiting,
 * nothing running, services unknown -- are left out.
 */
export function routingQuestions({ agents, openQuestions, services, runningRequest }: RoutingContext) {
  // Keyed by whatever the agents are called, so the choice is any string and is checked against
  // the routable ids when it is read (see `readClassification`).
  const routeCriteria: Record<string, string | null> = {
    ...Object.fromEntries(agents.map((agent) => [agent.id, agent.description || null])),
    [SEVERAL]: 'More than one agent is needed, or one agent needs another agent to answer first',
    [NONE]: 'No agent covers this request',
    [END_CALL]:
      'The user is saying goodbye, says that will be all or that they are done, or asks to hang up or end the call',
  };
  const questionCriteria: Record<string, string> = {
    ...Object.fromEntries(openQuestions.map((question) => [question.id, question.question])),
    [NO_QUESTION]: 'It answers none of these questions',
  };

  return {
    route: {
      type: 'choice' as const,
      instructions:
        'This is a request the user made to a voice assistant. Choose the one agent that can carry out ALL of it, ' +
        'exactly as it was said, knowing nothing else. Choose several when it asks for more than one thing that ' +
        'different agents cover, or when carrying it out needs something another agent would first have to look up ' +
        '-- "the weather where I am" needs the location before the weather. Choose none when no agent covers it, ' +
        'and endCall when it is only about ending the conversation.',
      criteria: routeCriteria,
    },
    responseStyle: {
      type: 'choice' as const,
      instructions:
        'How should the answer to this request sound? Ask where the value of the request lands. When it mixes ' +
        'kinds, pick the one that needs the most words.',
      criteria: RESPONSE_STYLE_DESCRIPTIONS,
    },
    ...(services.length > 0 && agents.some((agent) => agent.id === HOME_AGENT_ID) && homeServiceQuestions(services)),
    ...(openQuestions.length > 0 && {
      answeredQuestion: {
        type: 'choice' as const,
        instructions:
          'The assistant earlier asked the user these questions, which are still waiting for an answer. Which one, ' +
          'if any, does this request answer?',
        criteria: questionCriteria,
      },
      onlyAnAnswer: {
        type: 'boolean' as const,
        instructions:
          'Is this request nothing but the reply to a question the assistant asked, with no new errand in it?',
      },
    }),
    ...(runningRequest !== undefined && {
      relationToRunningRequest: {
        type: 'choice' as const,
        instructions: `The assistant is still working on an earlier request: "${runningRequest}". How does this new request relate to it?`,
        criteria: {
          replaces: 'It corrects or changes the earlier request, or moves on from it so it is no longer wanted',
          cancels: 'It only asks to stop or forget the earlier request, and asks for nothing new',
          adds: 'It is a separate errand, and the earlier request is still wanted',
        } satisfies Record<RelationToRunningRequest, string>,
      },
    }),
  };
}

export type RoutingAnswers = ClassifierAnswers<ReturnType<typeof routingQuestions>>;

/** A request the classifier is sure of: the agent that takes it whole, and how to speak the answer. */
export interface FastRoute {
  agentId: string;
  responseStyle: ResponseStyle;
  /**
   * Set when the request is a smart home command and Jev is sure which service carries it out. The
   * entities it acts on are chosen next (see `internet-of-things/home-commands.ts`).
   */
  homeService?: HomeService;
}

/**
 * Everything routing took from the classifier about one request. Any field left out is one the
 * classifier was not sure of, and routing decides it the way it did before there was a classifier.
 */
export interface RequestClassification {
  /** One agent takes the whole request. */
  fastRoute?: FastRoute;
  /** The request is only the answer to this waiting question, in the user's own words. */
  answeredQuestionId?: string;
  /** The request is only about ending the call. */
  endsCall?: boolean;
  /** How the request relates to the one still running, when one is. */
  relationToRunningRequest?: RelationToRunningRequest;
  /** How the answer should sound, whenever the classifier is sure of anything else. */
  responseStyle: ResponseStyle;
}

function isRelationToRunningRequest(value: string): value is RelationToRunningRequest {
  return (RELATIONS_TO_RUNNING_REQUEST as readonly string[]).includes(value);
}

/**
 * Reads the classifier's answers into what routing can act on, leaving out whatever it is unsure of.
 *
 * Pure, so every way of declining can be tested without a model. A request that answers a waiting
 * question is never also given a fast route: only the answer path or the planner can carry an
 * answer back to the work that asked, so a request that might be one does not go to a single agent.
 */
export function readClassification(
  answers: RoutingAnswers,
  { agents, openQuestions, services }: Omit<RoutingContext, 'runningRequest'>,
): RequestClassification {
  const responseStyle = answers.responseStyle.choice;
  const relation =
    answers.relationToRunningRequest && confidentChoice(answers.relationToRunningRequest, FAST_PATH_CONFIDENCE);
  const classification: RequestClassification = {
    responseStyle,
    ...(relation && isRelationToRunningRequest(relation) && { relationToRunningRequest: relation }),
  };

  const route = confidentChoice(answers.route, FAST_PATH_CONFIDENCE);
  if (route === END_CALL) {
    return { ...classification, endsCall: true };
  }

  const answered = answers.answeredQuestion && confidentChoice(answers.answeredQuestion, FAST_PATH_CONFIDENCE);
  const onlyAnAnswer = (answers.onlyAnAnswer?.probability ?? 0) >= FAST_PATH_CONFIDENCE;
  if (
    answered &&
    answered !== NO_QUESTION &&
    onlyAnAnswer &&
    openQuestions.some((question) => question.id === answered)
  ) {
    return { ...classification, answeredQuestionId: answered };
  }
  // Anything short of sure that it answers nothing leaves the answer to the planner.
  if (openQuestions.length > 0 && answered !== NO_QUESTION) {
    return classification;
  }

  if (!route || !agents.some((agent) => agent.id === route)) {
    return classification;
  }

  const homeService =
    route === HOME_AGENT_ID && responseStyle === 'command' && answers.homeService && answers.homeCommandGivesSetting
      ? homeServiceFrom(
          { homeService: answers.homeService, homeCommandGivesSetting: answers.homeCommandGivesSetting },
          services,
          FAST_PATH_CONFIDENCE,
        )
      : undefined;

  return { ...classification, fastRoute: { agentId: route, responseStyle, ...(homeService && { homeService }) } };
}

/**
 * The classifier routing runs on, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one requests use.
 */
export const getRoutingClassifier = createLazyClassifier(ROUTING_CLASSIFIER_ID);

/** Asks the classifier everything routing can use about one request. */
export async function classifyRequest(
  classifier: Classifier,
  userQuery: string,
  context: RoutingContext,
  abortSignal?: AbortSignal,
): Promise<RequestClassification> {
  const { answers } = await classifier.evaluate({
    state: userQuery,
    questions: routingQuestions(context),
    abortSignal,
    // A failed call falls back to the planner, which is already running. Retrying would only
    // hold back a request arriving while another runs, which waits for this answer.
    maxRetries: 0,
  });

  return readClassification(answers, context);
}
