/**
 * What routing takes from the classifier, and every way it declines to take it.
 *
 * Declining is always safe -- routing then decides as it did before there was a classifier -- so
 * what is pinned here is mostly that it declines whenever it is not sure. What Jev actually answers
 * for real requests is for the routing LLM eval to judge, by hand.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import type { HomeService } from '../internet-of-things/home-commands.js';
import {
  classifyRequest,
  FAST_PATH_CONFIDENCE,
  type RoutableAgentSummary,
  type RoutingAnswers,
  type RoutingContext,
  readClassification,
  routingQuestions,
} from './classifier.js';
import type { OpenQuestion } from './questions.js';
import { RESPONSE_STYLES, type ResponseStyle } from './response-styles.js';

const AGENTS: RoutableAgentSummary[] = [
  { id: 'internetOfThings', description: 'Controls the lights, blinds and devices in the house' },
  { id: 'weather', description: 'Current conditions and forecasts' },
];

const WAITING_QUESTION: OpenQuestion = {
  id: 'q1',
  taskId: 'coding',
  agentId: 'coding',
  question: 'Email, or a push notification?',
  deliverAnswer: async () => 'Done',
};

const LIGHT_TURN_OFF: HomeService = {
  id: 'light.turn_off',
  domain: 'light',
  service: 'turn_off',
  description: 'Turn off lights',
  requiredFields: [],
  entityDomains: ['light'],
};

const NOTHING_ELSE: RoutingContext = { agents: AGENTS, openQuestions: [], services: [] };

/** A distribution with the given confidence on `choice`, which is all the policy reads. */
function sure(choice: string, confidence = 0.97) {
  return { type: 'choice' as const, choice, probabilities: { [choice]: confidence } };
}

function answers(route: string, overrides: Partial<RoutingAnswers> = {}, style: ResponseStyle = 'command') {
  return { route: sure(route), responseStyle: { type: 'choice' as const, choice: style }, ...overrides };
}

describe('routingQuestions', () => {
  it('offers every routable agent, plus several, none and ending the call', () => {
    const { route } = routingQuestions(NOTHING_ELSE);

    expect(Object.keys(route.criteria)).toEqual(['internetOfThings', 'weather', 'several', 'none', 'endCall']);
  });

  it('offers the same response styles the planner does', () => {
    expect(Object.keys(routingQuestions(NOTHING_ELSE).responseStyle.criteria)).toEqual([...RESPONSE_STYLES]);
  });

  it('asks about waiting questions, the running request and services only when there are some', () => {
    const plain = routingQuestions(NOTHING_ELSE);
    expect(plain).not.toHaveProperty('answeredQuestion');
    expect(plain).not.toHaveProperty('relationToRunningRequest');
    expect(plain).not.toHaveProperty('homeService');

    const full = routingQuestions({
      agents: AGENTS,
      openQuestions: [WAITING_QUESTION],
      services: [LIGHT_TURN_OFF],
      runningRequest: 'what is the weather',
    });
    expect(full.answeredQuestion?.criteria).toEqual({ q1: 'Email, or a push notification?', none: expect.any(String) });
    expect(full.relationToRunningRequest?.instructions).toContain('what is the weather');
    expect(full.homeService?.criteria).toHaveProperty(['light.turn_off'], 'Turn off lights');
  });

  it('does not offer services when there is no smart home agent to fall back to', () => {
    expect(routingQuestions({ ...NOTHING_ELSE, agents: [AGENTS[1]], services: [LIGHT_TURN_OFF] })).not.toHaveProperty(
      'homeService',
    );
  });
});

describe('readClassification', () => {
  it('takes a single agent it is sure of, with the style it chose', () => {
    expect(readClassification(answers('weather', {}, 'lookup'), NOTHING_ELSE)).toEqual({
      responseStyle: 'lookup',
      fastRoute: { agentId: 'weather', responseStyle: 'lookup' },
    });
  });

  it('leaves the route to the planner when it is not sure, or has no distribution to be sure by', () => {
    expect(
      readClassification(answers('weather', { route: sure('weather', FAST_PATH_CONFIDENCE - 0.01) }), NOTHING_ELSE),
    ).not.toHaveProperty('fastRoute');
    expect(
      readClassification(answers('weather', { route: { type: 'choice', choice: 'weather' } }), NOTHING_ELSE),
    ).not.toHaveProperty('fastRoute');
  });

  it('leaves requests needing several agents, none, or an unknown one to the planner', () => {
    for (const route of ['several', 'none', 'coding']) {
      expect(readClassification(answers(route), NOTHING_ELSE)).not.toHaveProperty('fastRoute');
    }
  });

  it('recognises a goodbye', () => {
    expect(readClassification(answers('endCall'), NOTHING_ELSE)).toEqual({ responseStyle: 'command', endsCall: true });
  });

  describe('with a question waiting', () => {
    const withQuestion = { ...NOTHING_ELSE, openQuestions: [WAITING_QUESTION] };

    it('carries an answer straight back when it is sure the request is only that', () => {
      const classification = readClassification(
        answers('coding', { answeredQuestion: sure('q1'), onlyAnAnswer: { type: 'boolean', probability: 0.95 } }),
        withQuestion,
      );

      expect(classification).toEqual({ responseStyle: 'command', answeredQuestionId: 'q1' });
    });

    it('leaves an answer that comes with another errand to the planner', () => {
      const classification = readClassification(
        answers('weather', { answeredQuestion: sure('q1'), onlyAnAnswer: { type: 'boolean', probability: 0.3 } }),
        withQuestion,
      );

      expect(classification).toEqual({ responseStyle: 'command' });
    });

    it('fast-routes only when it is sure the request answers nothing', () => {
      expect(readClassification(answers('weather', { answeredQuestion: sure('none') }), withQuestion)).toHaveProperty(
        'fastRoute',
      );
      expect(
        readClassification(answers('weather', { answeredQuestion: sure('none', 0.6) }), withQuestion),
      ).not.toHaveProperty('fastRoute');
    });

    it('never answers a question that is not open', () => {
      const classification = readClassification(
        answers('coding', { answeredQuestion: sure('q9'), onlyAnAnswer: { type: 'boolean', probability: 0.99 } }),
        withQuestion,
      );

      expect(classification).not.toHaveProperty('answeredQuestionId');
    });
  });

  it('reads how the request relates to the running one, when it is sure', () => {
    function adds(confidence: number) {
      const rest = (1 - confidence) / 2;
      return {
        type: 'choice' as const,
        choice: 'adds' as const,
        probabilities: { adds: confidence, replaces: rest, cancels: rest },
      };
    }

    expect(
      readClassification(answers('weather', { relationToRunningRequest: adds(0.95) }), NOTHING_ELSE),
    ).toHaveProperty('relationToRunningRequest', 'adds');
    expect(
      readClassification(answers('weather', { relationToRunningRequest: adds(0.5) }), NOTHING_ELSE),
    ).not.toHaveProperty('relationToRunningRequest');
  });

  it('picks the Home Assistant service for a smart home command it is sure of', () => {
    const classification = readClassification(
      answers('internetOfThings', {
        homeService: sure('light.turn_off'),
        homeCommandGivesSetting: { type: 'boolean', probability: 0.02 },
      }),
      { ...NOTHING_ELSE, services: [LIGHT_TURN_OFF] },
    );

    expect(classification.fastRoute).toEqual({
      agentId: 'internetOfThings',
      responseStyle: 'command',
      homeService: LIGHT_TURN_OFF,
    });
  });

  it('never picks a service for anything that is not a command', () => {
    const classification = readClassification(
      answers(
        'internetOfThings',
        { homeService: sure('light.turn_off'), homeCommandGivesSetting: { type: 'boolean', probability: 0.02 } },
        'lookup',
      ),
      { ...NOTHING_ELSE, services: [LIGHT_TURN_OFF] },
    );

    expect(classification.fastRoute).toEqual({ agentId: 'internetOfThings', responseStyle: 'lookup' });
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
                probabilities: { internetOfThings: 0.94, weather: 0.02, several: 0.02, none: 0.01, endCall: 0.01 },
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

    const classification = await classifyRequest(classifier, 'Turn off the living room lights', NOTHING_ELSE);

    expect(classification.fastRoute).toEqual({ agentId: 'internetOfThings', responseStyle: 'command' });
    expect(evaluated).toEqual([{ state: 'Turn off the living room lights', questionIds: ['route', 'responseStyle'] }]);
  });
});
