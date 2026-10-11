/**
 * What routing takes from the classifier, and every way it declines to take it.
 *
 * Declining is always safe -- routing then decides as it did before there was a classifier -- so
 * what is pinned here is mostly that it declines whenever it is not sure. What Jev actually answers
 * for real requests is for the routing LLM eval to judge, by hand.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import type { ClassifierAnswerSet } from '../../utils/classifier-answers.js';
import type { DirectAnswer, PreparedDirectAnswers } from '../../utils/direct-answer-source.js';
import {
  classifyRequest,
  FAST_PATH_CONFIDENCE,
  type RoutableAgentSummary,
  type RoutingAnswers,
  type RoutingContext,
  readClassification,
  routingQuestions,
  sourceQuestions,
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

const NOTHING_ELSE: RoutingContext = {
  agents: AGENTS,
  openQuestions: [],
  lookups: [],
  commands: [],
  sources: [],
};

/** A distribution with the given confidence on `choice`, which is all the policy reads. */
function sure(choice: string, confidence = 0.97) {
  return { type: 'choice' as const, choice, probabilities: { [choice]: confidence } };
}

function answers(
  route: string,
  overrides: Partial<RoutingAnswers> & ClassifierAnswerSet = {},
  style: ResponseStyle = 'command',
) {
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

  it('asks about waiting questions and the running request only when there are some', () => {
    const plain = routingQuestions(NOTHING_ELSE);
    expect(plain).not.toHaveProperty('answeredQuestion');
    expect(plain).not.toHaveProperty('relationToRunningRequest');

    const full = routingQuestions({
      ...NOTHING_ELSE,
      openQuestions: [WAITING_QUESTION],
      runningRequest: 'what is the weather',
    });
    expect(full.answeredQuestion?.criteria).toEqual({ q1: 'Email, or a push notification?', none: expect.any(String) });
    expect(full.relationToRunningRequest?.instructions).toContain('what is the weather');
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

  describe('lookups', () => {
    const weatherNow = {
      id: 'weather.now',
      agentId: 'weather',
      description: 'The weather right now',
      answer: async () => 'sunny',
    };
    const withLookups = { ...NOTHING_ELSE, lookups: [weatherNow] };

    it("answers a question one of the agent's own lookups covers", async () => {
      const classification = readClassification(
        answers('weather', { directLookup: sure('weather.now') }, 'lookup'),
        withLookups,
      );

      expect(classification.fastRoute?.direct?.description).toBe('lookup weather.now');
      expect(await classification.fastRoute?.direct?.answer('what is the weather')).toEqual({
        text: 'sunny',
        entities: [],
      });
    });

    it("never answers with another agent's lookup, an unsure one, or for a command", () => {
      const wrongAgent = readClassification(
        answers('internetOfThings', { directLookup: sure('weather.now') }, 'lookup'),
        withLookups,
      );
      const unsure = readClassification(
        answers('weather', { directLookup: sure('weather.now', 0.6) }, 'lookup'),
        withLookups,
      );
      const command = readClassification(answers('weather', { directLookup: sure('weather.now') }), withLookups);

      for (const classification of [wrongAgent, unsure, command]) {
        expect(classification.fastRoute).not.toHaveProperty('direct');
      }
    });

    it('offers every lookup by its description, with a way out', () => {
      expect(routingQuestions(withLookups).directLookup?.criteria).toEqual({
        'weather.now': 'The weather right now',
        none: expect.any(String),
      });
    });
  });

  describe('commands', () => {
    const fakeCommand = {
      id: 'weather.fakeCommand',
      agentId: 'weather',
      description: 'Do the one thing the weather agent can do',
      answer: async () => 'done',
    };
    const withCommands = { ...NOTHING_ELSE, commands: [fakeCommand] };

    it("carries out a command the agent's own vertical declares", async () => {
      const classification = readClassification(
        answers('weather', { directCommand: sure('weather.fakeCommand') }),
        withCommands,
      );

      expect(classification.fastRoute?.direct?.description).toBe('command weather.fakeCommand');
      expect(await classification.fastRoute?.direct?.answer('do it')).toEqual({ text: 'done', entities: [] });
    });

    it("never carries out another agent's command, an unsure one, or one for a question", () => {
      const wrongAgent = readClassification(
        answers('internetOfThings', { directCommand: sure('weather.fakeCommand') }),
        withCommands,
      );
      const unsure = readClassification(
        answers('weather', { directCommand: sure('weather.fakeCommand', 0.6) }),
        withCommands,
      );
      const question = readClassification(
        answers('weather', { directCommand: sure('weather.fakeCommand') }, 'lookup'),
        withCommands,
      );

      for (const classification of [wrongAgent, unsure, question]) {
        expect(classification.fastRoute).not.toHaveProperty('direct');
      }
    });

    it('offers every command by its description, with a way out', () => {
      expect(routingQuestions(withCommands).directCommand?.criteria).toEqual({
        'weather.fakeCommand': 'Do the one thing the weather agent can do',
        none: expect.any(String),
      });
    });
  });

  describe('sources', () => {
    /** A vertical's own question, which routing knows nothing about but asks and hands back. */
    const SURE_IT_CAN: DirectAnswer = { description: 'fake answer', answer: async () => undefined };
    const asked: { answers: ClassifierAnswerSet; requestKind: string }[] = [];
    const fakeSource: PreparedDirectAnswers = {
      questions: { fakeCanAnswer: { type: 'boolean', instructions: 'Can the fake answer this?' } },
      choose: (sourceAnswers, { requestKind, minimumConfidence }) => {
        asked.push({ answers: sourceAnswers, requestKind });
        const canAnswer = sourceAnswers.fakeCanAnswer;
        return canAnswer?.type === 'boolean' && canAnswer.probability >= minimumConfidence ? SURE_IT_CAN : undefined;
      },
    };
    const withSource = { ...NOTHING_ELSE, sources: [{ agentId: 'weather', prepared: fakeSource }] };

    it('asks a source its own questions only while its agent is routable', () => {
      expect(sourceQuestions(withSource)).toEqual(fakeSource.questions);
      expect(sourceQuestions({ ...withSource, agents: [AGENTS[0]] })).toEqual({});
    });

    it("hands a request routed to the source's agent back to the source, with how sure to be", () => {
      asked.length = 0;
      const classification = readClassification(
        answers('weather', { fakeCanAnswer: { type: 'boolean', probability: 0.97 } }, 'lookup'),
        withSource,
      );

      expect(classification.fastRoute?.direct).toBe(SURE_IT_CAN);
      expect(asked).toEqual([
        { answers: expect.objectContaining({ fakeCanAnswer: expect.anything() }), requestKind: 'question' },
      ]);
    });

    it('never asks a source about a request for another agent, or about a conversation', () => {
      asked.length = 0;
      const otherAgent = readClassification(
        answers('internetOfThings', { fakeCanAnswer: { type: 'boolean', probability: 0.97 } }),
        withSource,
      );
      const conversation = readClassification(
        answers('weather', { fakeCanAnswer: { type: 'boolean', probability: 0.97 } }, 'conversation'),
        withSource,
      );

      expect(otherAgent.fastRoute).not.toHaveProperty('direct');
      expect(conversation.fastRoute).not.toHaveProperty('direct');
      expect(asked).toEqual([]);
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
