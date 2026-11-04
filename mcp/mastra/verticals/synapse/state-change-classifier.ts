import type { BooleanQuestion, Classifier, ClassifierAnswers, ClassifierQuestions } from '@mastra/core/classifier';
import { confidentScoreLevel } from '../../utils/classifier-answers.js';
import { createLazyClassifier } from '../../utils/classifier-factory.js';
import type { StateChange } from './state-change.js';
import type { SubscriptionMatch } from './subscription-matcher.js';

/**
 * The gate in front of the State Change Reactor.
 *
 * The reactor is a hosted model running a supervisor loop of up to ten steps, so every time it
 * is woken costs money. It used to be woken for every state change in the house -- about 3,000
 * a day from Home Assistant alone, phone wattage and air quality and who is nearest the parking
 * space -- rolled up into a summary about once a minute. On Flash-Lite that was estimated at
 * well over a hundred dollars a month, for a reactor whose only standing work is subscriptions
 * and rules.
 *
 * So a change is filed only when something can come of it:
 *
 * - the caller marked it high, or the classifier is sure it needs attention now (filed high,
 *   which the delivery policy delivers at once instead of rolling it up);
 * - a rule applies to it, since a rule is a deliberate instruction about exactly that change;
 * - a subscription the vector recall shortlisted might fire for it;
 * - the classifier is sure it should reach someone soon.
 *
 * Everything else is saved to memory, where the other agents recall it, and never reaches the
 * reactor. That is the whole policy without a classifier too: the classifier can only add to
 * what is filed (an escalation, a "soon") or take away a candidate subscription it is sure will
 * not fire. So no key, an error, or an answer it is not sure of only ever cost it those, and
 * never wake the reactor for something the policy alone would not. That matters, because Jev is
 * rarely sure of an attention level: of one day's 3,100 changes, five got one.
 *
 * One call per change asks how much attention it deserves and, for every shortlisted
 * subscription, whether this change really fires it; the answers are written next to the
 * candidates so the reactor has them as a second opinion.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const STATE_CHANGE_CLASSIFIER_ID = 'stateChangeClassifier';

/**
 * How sure the classifier must be of an attention level before it is acted on.
 *
 * High because acting on one wakes the reactor, or wakes it at once: below it, the change is
 * decided by its priority, rules and subscriptions alone.
 */
export const STATE_CHANGE_CONFIDENCE = 0.85;

/**
 * How likely a candidate subscription has to be to fire before it wakes the reactor.
 *
 * Deliberately low: a subscription is something the user asked for in so many words, so a
 * maybe is worth the reactor's time. A candidate the classifier did not answer for counts as
 * one that might fire.
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
 * Pure, so the whole policy is pinned by a test. The caller's own priority is a floor the
 * classifier can raise but never lower, and a change the caller marked high is never held back:
 * whoever filed it already knew it mattered.
 */
export function triageStateChange(input: {
  assessment: StateChangeAssessment | undefined;
  matches: SubscriptionMatch[];
  ruleCount: number;
  requestedPriority: StateChangePriority;
}): StateChangeTriage {
  const { assessment, matches, ruleCount, requestedPriority } = input;

  if (requestedPriority === 'high') {
    return { file: true, priority: 'high', escalated: false };
  }

  if (assessment?.attention === 'now') {
    return { file: true, priority: 'high', escalated: true };
  }

  const subscriptionMightFire = matches.some(
    ({ subscription }) => (assessment?.fireProbabilities.get(subscription.id) ?? 1) >= SUBSCRIPTION_FIRE_FLOOR,
  );
  if (ruleCount > 0 || subscriptionMightFire || assessment?.attention === 'soon') {
    return { file: true, priority: 'low', escalated: false };
  }

  return {
    file: false,
    reason:
      matches.length === 0
        ? 'no rule or subscription wants it, and nothing says it needs attention soon'
        : `none of ${matches.length} candidate subscriptions fires, no rule wants it, and nothing says it needs attention soon`,
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
