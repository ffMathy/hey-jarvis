/**
 * Which hourly weather updates are filed, and at what priority.
 *
 * Dropping an update is the decision that can lose something, so what is pinned is mostly that
 * an update is filed as before whenever the classifier is unsure, missing, failing, or has
 * nothing to compare with.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  describeWeatherComparison,
  judgeWeatherUpdate,
  type WeatherNotabilityAnswers,
  weatherFilingFrom,
  weatherNotabilityQuestions,
} from './classifier.js';

/** A sure answer for one level: routine is 0, a notable change 1 and a warning 2. */
function sure(level: 0 | 1 | 2): WeatherNotabilityAnswers {
  const probabilities = { '0': 0, '1': 0, '2': 0, [String(level)]: 1 };
  return { weatherNotability: { type: 'score', score: level, probabilities } };
}

const torn: WeatherNotabilityAnswers = {
  weatherNotability: { type: 'score', score: 0.5, probabilities: { '0': 0.5, '1': 0.5, '2': 0 } },
};

function fakeClassifier(answers: WeatherNotabilityAnswers | Error, evaluatedStates: unknown[] = []) {
  return new Classifier({
    id: 'weatherNotabilityClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['score'],
      doEvaluate: async ({ state }) => {
        evaluatedStates.push(state);
        if (answers instanceof Error) {
          throw answers;
        }
        return { answers, warnings: [] };
      },
    },
  });
}

describe('weatherNotabilityQuestions', () => {
  it('asks one score question, from routine up to a warning', () => {
    const { weatherNotability } = weatherNotabilityQuestions();

    expect(weatherNotability.type).toBe('score');
    expect(weatherNotability.criteria).toHaveLength(3);
    expect(weatherNotability.criteria[2]).toContain('storm');
  });
});

describe('describeWeatherComparison', () => {
  it('puts the previous observation above the new one', () => {
    expect(describeWeatherComparison('Aarhus: 12°C', 'Aarhus: 11°C')).toBe('Previous: Aarhus: 12°C\nNow: Aarhus: 11°C');
  });

  it('says so when there is no previous observation', () => {
    expect(describeWeatherComparison(undefined, 'Aarhus: 11°C')).toBe('Previous: not known\nNow: Aarhus: 11°C');
  });
});

describe('weatherFilingFrom', () => {
  it('drops an update it is sure is routine', () => {
    expect(weatherFilingFrom(sure(0), true)).toEqual({ file: false });
  });

  it('files a warning at high priority', () => {
    expect(weatherFilingFrom(sure(2), true)).toEqual({ file: true, priority: 'high' });
    expect(weatherFilingFrom(sure(2), false)).toEqual({ file: true, priority: 'high' });
  });

  it('files a notable change as before', () => {
    expect(weatherFilingFrom(sure(1), true)).toEqual({ file: true, priority: 'low' });
  });

  it('files as before when it is torn between levels', () => {
    expect(weatherFilingFrom(torn, true)).toEqual({ file: true, priority: 'low' });
  });

  it('files as before when there is no answer', () => {
    expect(weatherFilingFrom(undefined, true)).toEqual({ file: true, priority: 'low' });
  });

  it('never drops the first update, which has nothing to be routine against', () => {
    expect(weatherFilingFrom(sure(0), false)).toEqual({ file: true, priority: 'low' });
  });
});

describe('judgeWeatherUpdate', () => {
  it('asks the classifier about both observations and follows a sure answer', async () => {
    const evaluatedStates: unknown[] = [];

    const filing = await judgeWeatherUpdate(fakeClassifier(sure(0), evaluatedStates), 'Aarhus: 12°C', 'Aarhus: 12°C');

    expect(filing).toEqual({ file: false });
    expect(evaluatedStates).toEqual(['Previous: Aarhus: 12°C\nNow: Aarhus: 12°C']);
  });

  it('files as before without a classifier', async () => {
    expect(await judgeWeatherUpdate(undefined, 'Aarhus: 12°C', 'Aarhus: 12°C')).toEqual({
      file: true,
      priority: 'low',
    });
  });

  it('files as before when the classifier fails', async () => {
    const filing = await judgeWeatherUpdate(fakeClassifier(new Error('offline')), 'Aarhus: 12°C', 'Aarhus: 12°C');

    expect(filing).toEqual({ file: true, priority: 'low' });
  });
});
