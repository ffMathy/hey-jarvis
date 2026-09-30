/**
 * The routing classifier's fast path: when it may skip the planner, and every way it declines to.
 *
 * Declining is always safe -- the planner answers instead -- so what is pinned here is mostly that
 * it declines whenever it is not sure. What Jev actually answers for real requests is for the
 * routing LLM eval to judge, by hand.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  classifyRequest,
  FAST_PATH_CONFIDENCE,
  fastRouteFrom,
  type RoutableAgentSummary,
  type RoutingAnswers,
  routingQuestions,
} from './classifier.js';
import type { OpenQuestion } from './questions.js';
import { RESPONSE_STYLES } from './response-styles.js';

const AGENTS: RoutableAgentSummary[] = [
  { id: 'internetOfThings', description: 'Controls the lights, blinds and devices in the house' },
  { id: 'weather', description: 'Current conditions and forecasts' },
];
const AGENT_IDS = new Set(AGENTS.map((agent) => agent.id));

const WAITING_QUESTION: OpenQuestion = {
  id: 'q1',
  taskId: 'coding',
  agentId: 'coding',
  question: 'Email, or a push notification?',
  deliverAnswer: async () => 'Done',
};

function answers(overrides: {
  route?: string;
  confidence?: number;
  style?: string;
  answersWaitingQuestion?: number;
}): RoutingAnswers {
  const route = overrides.route ?? 'internetOfThings';
  const confidence = overrides.confidence ?? 0.97;
  return {
    route: { type: 'choice', choice: route, probabilities: { [route]: confidence } },
    responseStyle: { type: 'choice', choice: overrides.style ?? 'command' },
    ...(overrides.answersWaitingQuestion !== undefined && {
      answersWaitingQuestion: { type: 'boolean', probability: overrides.answersWaitingQuestion },
    }),
  };
}

describe('routingQuestions', () => {
  it('offers every routable agent, plus several and none', () => {
    const { route } = routingQuestions(AGENTS, []);

    expect(Object.keys(route.criteria)).toEqual(['internetOfThings', 'weather', 'several', 'none']);
    expect(route.criteria.weather).toBe('Current conditions and forecasts');
  });

  it('offers the same response styles the planner does', () => {
    expect(Object.keys(routingQuestions(AGENTS, []).responseStyle.criteria)).toEqual([...RESPONSE_STYLES]);
  });

  it('asks about waiting questions only when there are some, and names them', () => {
    expect(routingQuestions(AGENTS, [])).not.toHaveProperty('answersWaitingQuestion');

    const { answersWaitingQuestion } = routingQuestions(AGENTS, [WAITING_QUESTION]);
    expect(answersWaitingQuestion?.instructions).toContain('Email, or a push notification?');
  });
});

describe('fastRouteFrom', () => {
  it('takes a single agent it is sure of, with the style it chose', () => {
    expect(fastRouteFrom(answers({ style: 'lookup' }), AGENT_IDS)).toEqual({
      agentId: 'internetOfThings',
      responseStyle: 'lookup',
    });
  });

  it('leaves the request to the planner when it is not sure enough', () => {
    expect(fastRouteFrom(answers({ confidence: FAST_PATH_CONFIDENCE - 0.01 }), AGENT_IDS)).toBeUndefined();
  });

  it('leaves the request to the planner when it gives no distribution to be sure by', () => {
    const withoutProbabilities = answers({});
    withoutProbabilities.route = { type: 'choice', choice: 'internetOfThings' };

    expect(fastRouteFrom(withoutProbabilities, AGENT_IDS)).toBeUndefined();
  });

  it('leaves requests needing several agents, or none, to the planner however sure it is', () => {
    expect(fastRouteFrom(answers({ route: 'several', confidence: 1 }), AGENT_IDS)).toBeUndefined();
    expect(fastRouteFrom(answers({ route: 'none', confidence: 1 }), AGENT_IDS)).toBeUndefined();
  });

  it('never routes to an agent the planner could not', () => {
    expect(fastRouteFrom(answers({ route: 'coding', confidence: 1 }), AGENT_IDS)).toBeUndefined();
  });

  it('leaves a request that might answer a waiting question to the planner', () => {
    expect(fastRouteFrom(answers({ answersWaitingQuestion: 0.5 }), AGENT_IDS)).toBeUndefined();
    expect(fastRouteFrom(answers({ answersWaitingQuestion: 0.02 }), AGENT_IDS)).toEqual({
      agentId: 'internetOfThings',
      responseStyle: 'command',
    });
  });
});

describe('classifyRequest', () => {
  it('evaluates the request against the routing questions and reads the answers', async () => {
    const evaluated: { state: unknown; questionIds: string[] }[] = [];
    const classifier = new Classifier({
      id: 'routingClassifier',
      model: {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId: 'jev-fake',
        supportedQuestionTypes: ['choice', 'boolean'],
        doEvaluate: async ({ state, questions }) => {
          evaluated.push({ state, questionIds: Object.keys(questions) });
          return {
            answers: {
              route: {
                type: 'choice',
                choice: 'internetOfThings',
                probabilities: { internetOfThings: 0.94, weather: 0.02, several: 0.03, none: 0.01 },
              },
              responseStyle: {
                type: 'choice',
                choice: 'command',
                probabilities: { command: 0.9, lookup: 0.05, briefing: 0.03, conversation: 0.02 },
              },
            },
            warnings: [],
          };
        },
      },
    });

    const route = await classifyRequest(classifier, 'Turn off the living room lights', AGENTS, []);

    expect(route).toEqual({ agentId: 'internetOfThings', responseStyle: 'command' });
    expect(evaluated).toEqual([{ state: 'Turn off the living room lights', questionIds: ['route', 'responseStyle'] }]);
  });
});
