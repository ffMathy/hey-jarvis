import type { BooleanQuestion, Classifier, ClassifierAnswers, ClassifierQuestions } from '@mastra/core/classifier';
import { confidentScoreLevel } from '../../utils/classifier-answers.js';
import { createLazyClassifier } from '../../utils/classifier-factory.js';
import type { StateChange } from './state-change.js';
import type { SubscriptionMatch } from './subscription-matcher.js';

/**
 * The gate in front of the State Change Reactor.
 *
 * Every state change in the house -- a door, a weather update, a phone notification -- is filed
 * for the reactor, which runs on a local Qwen3 as a supervisor loop of up to ten steps. Most of
 * what it is woken for, it decides to do nothing about: the shortlist of subscriptions it is
 * handed is vector recall, generous on purpose, so it is mostly subscriptions on the same topic
 * whose WHEN did not actually happen. And changes that cannot wait are filed at the same low
 * priority as everything else, so a smoke alarm waits for the next rollup like a light switch.
 *
 * Both decisions are questions with their answers known in advance, which is what an evaluation
 * model (Jev, see `utils/providers/typesafe-provider.ts`) answers in one short call. So one call
 * per change asks, for every shortlisted subscription, whether this change really fires it, and
 * how much attention the change deserves. With those answers:
 *
 * - A change it is sure needs attention now is filed at high priority, which the delivery policy
 *   delivers at once instead of rolling it up.
 * - A change it is sure deserves none, which no subscription could plausibly fire and no rule
 *   applies to, is not filed at all. The reactor would have read it and dismissed it.
 * - Everything else is filed exactly as before, with the classifier's per-subscription answers
 *   written next to the candidates so the reactor has them as a second opinion.
 *
 * No key, an error, or an answer it is not sure of all mean the path that existed before this.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const STATE_CHANGE_CLASSIFIER_ID = 'stateChangeClassifier';

/**
 * How sure the classifier must be of an attention level before it is acted on.
 *
 * High for the same reason as the routing fast path's: below it, the change is filed exactly as
 * it always was, so the only cost of a high bar is a change the reactor reads for nothing, while
 * the cost of a low one is a change the user wanted and never heard about.
 */
export const STATE_CHANGE_CONFIDENCE = 0.85;

/**
 * How likely a subscription may be to fire before the change has to reach the reactor anyway.
 *
 * Deliberately low, which makes it the hard part to pass: a change is only held back when every
 * candidate is this unlikely to fire. A subscription is something the user asked for in so many
 * words, so a maybe is worth the reactor's time.
 */
export const SUBSCRIPTION_FIRE_FLOOR = 0.15;

/** How much attention a state change deserves, in the order the score question asks it. */
export const ATTENTION_LEVELS = ['ignore', 'fyi', 'soon', 'now'] as const;
export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

const ATTENTION_CRITERIA: Record<AttentionLevel, string> = {
  ignore: 'Routine, expected or purely technical; nobody in the house would want to hear about it',
  fyi: 'Worth knowing about, whenever it is convenient',
  soon: 'Should reach someone within the hour',
  now:
    'Needs someone right away: a security alarm or intruder, fire or smoke, a water leak, a medical emergency, ' +
    'or someone at the door',
};

/** The id the question about one subscription is asked under. */
function subscriptionQuestionId(subscriptionId: string): string {
  return `fires:${subscriptionId}`;
}

/**
 * Built per call, because the shortlist is different for every change.
 *
 * Typed as plain questions because the ids are the subscriptions', which are only known at run
 * time; the answers are read back by id and narrowed by their type.
 */
export function stateChangeQuestions(matches: SubscriptionMatch[]): ClassifierQuestions {
  return {
    attention: {
      type: 'score',
      instructions:
        'This is something that just happened in or around a smart home, reported to its voice assistant. ' +
        'How much attention does it deserve from the people who live there?',
      criteria: ATTENTION_LEVELS.map((level) => ATTENTION_CRITERIA[level]),
    },
    ...Object.fromEntries(
      matches.map(({ subscription }) => [subscriptionQuestionId(subscription.id), subscriptionQuestion(subscription)]),
    ),
  };
}

function subscriptionQuestion(subscription: SubscriptionMatch['subscription']): BooleanQuestion {
  return {
    type: 'boolean',
    instructions:
      `The user asked to be told, or to have something done, WHEN ${subscription.whenEvent}` +
      `${subscription.givenCondition ? `, GIVEN ${subscription.givenCondition}` : ''}. ` +
      'Does this event actually trigger that? Only yes when the WHEN is what just happened -- not merely ' +
      'something on the same topic or from the same device -- and, when there is a GIVEN, the data shows it holds.',
  };
}

/** What the classifier made of one state change, read into the terms the policy decides in. */
export interface StateChangeAssessment {
  /** The attention level it is sure of, or nothing when it is not sure of any. */
  attention: AttentionLevel | undefined;
  /** How likely each shortlisted subscription is to fire, by subscription id. Missing means unknown. */
  fireProbabilities: Map<string, number>;
}

/** Reads the classifier's answers for a change into an assessment. Pure, so it is tested without a model. */
export function assessmentFrom(
  answers: ClassifierAnswers<ClassifierQuestions>,
  matches: SubscriptionMatch[],
): StateChangeAssessment {
  const attentionAnswer = answers.attention;
  const attention =
    attentionAnswer?.type === 'score'
      ? confidentScoreLevel(attentionAnswer, ATTENTION_LEVELS, STATE_CHANGE_CONFIDENCE)
      : undefined;

  const fireProbabilities = new Map<string, number>();
  for (const { subscription } of matches) {
    const answer = answers[subscriptionQuestionId(subscription.id)];
    if (answer?.type === 'boolean') {
      fireProbabilities.set(subscription.id, answer.probability);
    }
  }

  return { attention, fireProbabilities };
}

/** The priorities a state change is filed at. `high` is delivered at once rather than rolled up. */
export type StateChangePriority = 'low' | 'high';

/** What to do with a state change: file it at a priority, or hold it back from the reactor. */
export type StateChangeTriage =
  | { file: true; priority: StateChangePriority; escalated: boolean }
  | { file: false; reason: string };

/**
 * Decides whether a change reaches the reactor, and how urgently.
 *
 * Pure, so every way of keeping today's behaviour is pinned by a test. The caller's own priority
 * is a floor the classifier can raise but never lower, and a change the caller marked high is
 * never held back: whoever filed it already knew it mattered.
 */
export function triageStateChange(input: {
  assessment: StateChangeAssessment | undefined;
  matches: SubscriptionMatch[];
  ruleCount: number;
  requestedPriority: StateChangePriority;
}): StateChangeTriage {
  const { assessment, matches, ruleCount, requestedPriority } = input;
  const asRequested: StateChangeTriage = { file: true, priority: requestedPriority, escalated: false };

  if (!assessment) {
    return asRequested;
  }

  if (assessment.attention === 'now') {
    return { file: true, priority: 'high', escalated: requestedPriority !== 'high' };
  }

  // A rule was matched deliberately, so it applies whatever the classifier thinks of the change.
  if (ruleCount > 0 || requestedPriority === 'high' || assessment.attention !== 'ignore') {
    return asRequested;
  }

  // An unanswered subscription counts as one that might fire.
  const everySubscriptionUnlikely = matches.every(
    ({ subscription }) => (assessment.fireProbabilities.get(subscription.id) ?? 1) < SUBSCRIPTION_FIRE_FLOOR,
  );
  if (!everySubscriptionUnlikely) {
    return asRequested;
  }

  return {
    file: false,
    reason:
      matches.length === 0
        ? 'nothing it needs attention for, and no subscription or rule to check'
        : `nothing it needs attention for, and none of ${matches.length} candidate subscriptions fires`,
  };
}

/** Asks the classifier about one state change and its shortlisted subscriptions. */
export async function assessStateChange(
  classifier: Classifier,
  change: StateChange,
  matches: SubscriptionMatch[],
): Promise<StateChangeAssessment> {
  const { answers } = await classifier.evaluate({
    state: `${change.stateType} from ${change.source}: ${JSON.stringify(change.stateData)}`,
    questions: stateChangeQuestions(matches),
  });

  return assessmentFrom(answers, matches);
}

/**
 * The classifier the gate runs on, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one changes go through.
 */
export const getStateChangeClassifier = createLazyClassifier(STATE_CHANGE_CLASSIFIER_ID);
