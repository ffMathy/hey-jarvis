import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { confidentScoreLevel } from '../../utils/classifier-answers.js';
import { createLazyClassifier } from '../../utils/classifier-factory.js';
import { logger } from '../../utils/logger.js';

/**
 * Whether an hourly weather update is worth filing at all.
 *
 * The weather monitor files the current weather as a state change every hour, and nearly every
 * hour it is the same weather as the hour before, a degree either way. Each one is still a record
 * the State Change Reactor has to read and dismiss. What separates the few worth its time -- rain
 * starting, a front coming through, a storm -- is an ordered scale with its levels known in
 * advance, which an evaluation model (Jev, see `utils/providers/typesafe-provider.ts`) places a
 * change on in one short call.
 *
 * So each update is compared with the last one filed:
 *
 * - routine, when the classifier is sure of it, is not filed;
 * - a warning is filed at high priority, so it is delivered at once instead of rolled up;
 * - anything else -- a notable change, an unsure answer, no key, an error -- is filed as before.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const WEATHER_NOTABILITY_CLASSIFIER_ID = 'weatherNotabilityClassifier';

/**
 * How sure the classifier must be before an update is dropped or escalated.
 *
 * High because being wrong about routine drops an update the user wanted, while being unsure
 * only costs the reactor one more record to read, which is what every hour cost before.
 */
export const WEATHER_NOTABILITY_CONFIDENCE = 0.85;

/** How much an update matters, in the order the score question asks it. */
export const WEATHER_NOTABILITY_LEVELS = ['routine', 'notable_change', 'warning'] as const;
export type WeatherNotability = (typeof WEATHER_NOTABILITY_LEVELS)[number];

const WEATHER_NOTABILITY_CRITERIA: Record<WeatherNotability, string> = {
  routine: 'Much the same weather as before: small drifts in temperature, cloud, humidity or wind',
  notable_change:
    'The weather changed in a way someone would notice: rain or snow starting or stopping, a big temperature swing, ' +
    'or the wind picking up',
  warning: 'Weather someone should act on: a storm or thunder, frost or ice, heavy rain, or strong gusts',
};

export function weatherNotabilityQuestions() {
  return {
    weatherNotability: {
      type: 'score' as const,
      instructions:
        'These are two hourly weather observations for the same place, the previous one and the one just taken. ' +
        'How much does the new one matter to someone living there?',
      criteria: WEATHER_NOTABILITY_LEVELS.map((level) => WEATHER_NOTABILITY_CRITERIA[level]),
    },
  };
}

export type WeatherNotabilityAnswers = ClassifierAnswers<ReturnType<typeof weatherNotabilityQuestions>>;

/** What to do with one weather update. */
export type WeatherFiling = { file: false } | { file: true; priority: 'low' | 'high' };

/**
 * Reads the classifier's answer into what to do with the update.
 *
 * Pure, so every way of filing as before is tested without a model. An update with nothing to
 * compare it with -- the first one after a restart -- is never dropped as routine, because
 * routine means "the same as before" and there is no before to be the same as. It can still be a
 * warning, which the current weather alone can show.
 */
export function weatherFilingFrom(
  answers: WeatherNotabilityAnswers | undefined,
  hasPreviousObservation: boolean,
): WeatherFiling {
  const notability = answers
    ? confidentScoreLevel(answers.weatherNotability, WEATHER_NOTABILITY_LEVELS, WEATHER_NOTABILITY_CONFIDENCE)
    : undefined;

  if (notability === 'warning') {
    return { file: true, priority: 'high' };
  }

  if (notability === 'routine' && hasPreviousObservation) {
    return { file: false };
  }

  return { file: true, priority: 'low' };
}

/** The state the classifier is asked about: the two observations, one per line. */
export function describeWeatherComparison(previous: string | undefined, current: string): string {
  return `Previous: ${previous ?? 'not known'}\nNow: ${current}`;
}

/** Asks the classifier how much an update matters compared with the previous one. */
export async function classifyWeatherUpdate(
  classifier: Classifier,
  previous: string | undefined,
  current: string,
): Promise<WeatherNotabilityAnswers> {
  const { answers } = await classifier.evaluate({
    state: describeWeatherComparison(previous, current),
    questions: weatherNotabilityQuestions(),
  });
  return answers;
}

/**
 * What to do with one update: the classifier's call when it has one to make, and filing it as
 * before when there is no classifier or it failed.
 */
export async function judgeWeatherUpdate(
  classifier: Classifier | undefined,
  previous: string | undefined,
  current: string,
): Promise<WeatherFiling> {
  if (!classifier) {
    return weatherFilingFrom(undefined, previous !== undefined);
  }

  try {
    return weatherFilingFrom(await classifyWeatherUpdate(classifier, previous, current), previous !== undefined);
  } catch (error) {
    logger.warn('Weather notability classifier failed; filing the update as before', {
      error: error instanceof Error ? error.message : String(error),
    });
    return weatherFilingFrom(undefined, previous !== undefined);
  }
}

/**
 * The classifier weather updates are judged by, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one updates go through.
 */
export const getWeatherNotabilityClassifier = createLazyClassifier(WEATHER_NOTABILITY_CLASSIFIER_ID);
