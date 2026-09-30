/**
 * The coding session question classifier: when a turn without the question block is asked as a
 * question anyway, and every way it is left to be published as before.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  classifyProseQuestion,
  createProseQuestionReader,
  endsOnProseQuestion,
  PROSE_QUESTION_CONFIDENCE,
  sessionQuestionQuestions,
} from './classifier.js';

/** A classifier on a fake Jev that answers with `probability`, or fails with it. */
function fakeClassifier(probability: number | Error) {
  const evaluated: { state: unknown; questionIds: string[] }[] = [];
  const classifier = new Classifier({
    id: 'codingSessionQuestionClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['boolean'],
      doEvaluate: async ({ state, questions }) => {
        evaluated.push({ state, questionIds: Object.keys(questions) });
        if (probability instanceof Error) {
          throw probability;
        }
        return { answers: { asksForDecision: { type: 'boolean', probability } }, warnings: [] };
      },
    },
  });
  return { classifier, evaluated };
}

const FINAL_MESSAGE =
  'I read the notification code.\n\nShould the reminder go out by email, or as a push notification?';

describe('sessionQuestionQuestions', () => {
  it('asks whether the message waits on a decision from the user', () => {
    expect(sessionQuestionQuestions().asksForDecision.instructions).toContain(
      'end by asking the user to make a decision before the work can continue',
    );
  });
});

describe('endsOnProseQuestion', () => {
  it('reads a message as a question only above the bar', () => {
    expect(endsOnProseQuestion({ asksForDecision: { type: 'boolean', probability: 0.95 } })).toBe(true);
    expect(endsOnProseQuestion({ asksForDecision: { type: 'boolean', probability: PROSE_QUESTION_CONFIDENCE } })).toBe(
      false,
    );
    expect(endsOnProseQuestion({ asksForDecision: { type: 'boolean', probability: 0.5 } })).toBe(false);
  });
});

describe('classifyProseQuestion', () => {
  it('evaluates the whole message and asks its last paragraph when sure', async () => {
    const { classifier, evaluated } = fakeClassifier(0.93);

    expect(await classifyProseQuestion(classifier, FINAL_MESSAGE)).toBe(
      'Should the reminder go out by email, or as a push notification?',
    );
    expect(evaluated).toEqual([{ state: FINAL_MESSAGE, questionIds: ['asksForDecision'] }]);
  });

  it('asks nothing when it is not sure', async () => {
    const { classifier } = fakeClassifier(0.6);

    expect(await classifyProseQuestion(classifier, FINAL_MESSAGE)).toBeUndefined();
  });

  it('never asks the classifier about an empty message', async () => {
    const { classifier, evaluated } = fakeClassifier(0.99);

    expect(await classifyProseQuestion(classifier, '')).toBeUndefined();
    expect(evaluated).toEqual([]);
  });
});

describe('createProseQuestionReader', () => {
  it('reads a question through the classifier it is given', async () => {
    const { classifier } = fakeClassifier(0.93);

    expect(await createProseQuestionReader(() => classifier)('sess_1', FINAL_MESSAGE)).toBe(
      'Should the reminder go out by email, or as a push notification?',
    );
  });

  it('reads no question without a classifier', async () => {
    expect(await createProseQuestionReader(() => undefined)('sess_1', FINAL_MESSAGE)).toBeUndefined();
  });

  it('reads no question when the classifier fails', async () => {
    const { classifier } = fakeClassifier(new Error('Jev is down'));

    expect(await createProseQuestionReader(() => classifier)('sess_1', FINAL_MESSAGE)).toBeUndefined();
  });
});
