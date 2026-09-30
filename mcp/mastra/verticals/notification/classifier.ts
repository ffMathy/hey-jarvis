import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { createLazyClassifier } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';

/**
 * A second opinion on whether a notification is urgent.
 *
 * Urgency picks the channel (`routing.ts`): an urgent message rings a phone or talks over the
 * house, and a routine one waits quietly as a push notification. The notification agent decides
 * it, on a small local Qwen model chosen for cost, and it gets it wrong often enough to matter --
 * a water leak left as a push notification, or a laundry reminder spoken over dinner.
 *
 * Whether a message is urgent is a yes-or-no question about it, which is what an evaluation model
 * (Jev, see `utils/providers/typesafe-provider.ts`) answers in one short call. So every message the
 * agent sends is also put to it, and when it is all but certain the agent got it the wrong way
 * round, its answer is the one that is used. Anything short of that keeps the agent's decision,
 * exactly as before: the classifier corrects the agent's clear mistakes, not its judgement calls.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const NOTIFICATION_URGENCY_CLASSIFIER_ID = 'notificationUrgencyClassifier';

/**
 * How sure the classifier must be, in the direction the agent did not choose, before its answer
 * replaces the agent's: at or above this to make a message urgent, at or below `1 - this` to make
 * one routine.
 */
export const URGENCY_OVERRIDE_CONFIDENCE = 0.9;

/** What makes a message urgent. The notification agent is told the same, word for word. */
export const URGENT_MESSAGES =
  'security alerts, intruders, fire or smoke, water leaks, medical situations, anything where a delay causes damage, and anything the requester explicitly calls urgent';

/** What leaves a message routine. The notification agent is told the same, word for word. */
export const ROUTINE_MESSAGES =
  'weather updates, shopping and delivery news, calendar reminders, routine status changes, anything informational';

export function urgencyQuestions() {
  return {
    urgent: {
      type: 'boolean' as const,
      instructions:
        'This is a notification about to be sent to a person. Is it urgent -- does it need their attention right ' +
        'now, so that waiting would actually cost something?',
      criteria: {
        true: `Urgent: ${URGENT_MESSAGES}`,
        false: `Not urgent: ${ROUTINE_MESSAGES}`,
      },
    },
  };
}

export type UrgencyAnswers = ClassifierAnswers<ReturnType<typeof urgencyQuestions>>;

/**
 * Reads the classifier's answer into the urgency to use instead of the agent's, or into nothing
 * when the agent's stands.
 *
 * Pure, so the bar can be tested without a model.
 */
export function urgencyOverrideFrom(answers: UrgencyAnswers, agentIsUrgent: boolean): boolean | undefined {
  const { probability } = answers.urgent;
  if (!agentIsUrgent && probability >= URGENCY_OVERRIDE_CONFIDENCE) {
    return true;
  }
  if (agentIsUrgent && probability <= 1 - URGENCY_OVERRIDE_CONFIDENCE) {
    return false;
  }
  return undefined;
}

/**
 * The classifier notification urgency is checked with, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one notifications use.
 */
export const getNotificationUrgencyClassifier = createLazyClassifier(NOTIFICATION_URGENCY_CLASSIFIER_ID);

/**
 * Checks the urgency an agent gave a message, and says which to use.
 *
 * No classifier, a classifier that fails, and one that is not sure enough all keep the agent's
 * decision. An override is logged, since it changes how the message reaches somebody.
 */
export async function reviewAgentUrgency(
  classifier: Classifier | undefined,
  { message, title, isUrgent }: { message: string; title?: string; isUrgent: boolean },
): Promise<boolean> {
  if (!classifier) {
    return isUrgent;
  }

  try {
    const { answers } = await classifier.evaluate({
      state: title ? `${title}\n\n${message}` : message,
      questions: urgencyQuestions(),
    });

    const override = urgencyOverrideFrom(answers, isUrgent);
    if (override === undefined) {
      return isUrgent;
    }

    logger.info('Notification urgency classifier overrode the agent', {
      message,
      agentIsUrgent: isUrgent,
      isUrgent: override,
      probability: answers.urgent.probability,
    });
    return override;
  } catch (error) {
    logger.warn("Notification urgency classifier failed; keeping the agent's urgency", { error });
    return isUrgent;
  }
}
