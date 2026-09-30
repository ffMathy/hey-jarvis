import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { createLazyClassifier } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { readProseQuestion } from './session-questions.js';

/**
 * Catches the questions a Claude Code session asks in prose.
 *
 * A session is told to end its turn on a fenced `jarvis-question` block when it needs the user to
 * decide something (`session-questions.ts`), and that block is what the watcher looks for. A
 * session that asks in a plain paragraph instead looks, to the watcher, like one that has finished:
 * its half-done work is published, and the question never reaches anybody.
 *
 * Whether a message ends by waiting on a decision is a yes-or-no question about it, which is what
 * an evaluation model (Jev, see `utils/providers/typesafe-provider.ts`) answers in one short call.
 * So a turn that ends without the block is put to it, and one it is sure is waiting on the user is
 * asked the way a fenced question is. Anything it is not sure of is treated as finished, exactly as
 * before -- which costs no more than a question asked in the wrong format always did.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const CODING_SESSION_QUESTION_CLASSIFIER_ID = 'codingSessionQuestionClassifier';

/**
 * How sure the classifier must be that a message waits on the user before it is asked as a question.
 *
 * Asking a question nobody needed to answer holds a session's work back until the user replies,
 * while missing one publishes what was there, as every turn without the block always has been.
 */
export const PROSE_QUESTION_CONFIDENCE = 0.85;

export function sessionQuestionQuestions() {
  return {
    asksForDecision: {
      type: 'boolean' as const,
      instructions:
        'This is the last message of a coding session that is implementing a change for a user. Does the ' +
        'message end by asking the user to make a decision before the work can continue?',
    },
  };
}

export type SessionQuestionAnswers = ClassifierAnswers<ReturnType<typeof sessionQuestionQuestions>>;

/**
 * Reads the classifier's answer into whether the message waits on the user.
 *
 * Pure, so the bar can be tested without a model.
 */
export function endsOnProseQuestion(answers: SessionQuestionAnswers): boolean {
  return answers.asksForDecision.probability > PROSE_QUESTION_CONFIDENCE;
}

/**
 * The classifier session messages are read with, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one the watcher uses.
 */
export const getCodingSessionQuestionClassifier = createLazyClassifier(CODING_SESSION_QUESTION_CLASSIFIER_ID);

/**
 * Asks the classifier whether a session's last message waits on the user.
 *
 * @returns The question to put to the user, or `undefined` when the turn reads as finished
 */
export async function classifyProseQuestion(classifier: Classifier, finalMessage: string): Promise<string | undefined> {
  const question = readProseQuestion(finalMessage);
  if (!question) {
    return undefined;
  }

  const { answers } = await classifier.evaluate({ state: finalMessage, questions: sessionQuestionQuestions() });

  return endsOnProseQuestion(answers) ? question : undefined;
}

/** Reads a question a session asked in prose, if it asked one; swapped out in tests. */
export type SessionProseQuestionReader = (sessionId: string, finalMessage: string) => Promise<string | undefined>;

/**
 * Builds the reader every watched session's unfenced turns go through.
 *
 * No classifier, and a classifier that fails, both read as "no question": the turn is finished, as
 * every unfenced turn was before this existed.
 *
 * @param getClassifier - Called on each turn, so the classifier is built only once one is needed
 */
export function createProseQuestionReader(
  getClassifier: () => Classifier | undefined = getCodingSessionQuestionClassifier,
): SessionProseQuestionReader {
  return async (sessionId, finalMessage) => {
    const classifier = getClassifier();
    if (!classifier) {
      return undefined;
    }

    try {
      const question = await classifyProseQuestion(classifier, finalMessage);
      if (question) {
        logger.info('[CLAUDE SESSION] Classifier found a question asked in prose', { sessionId, question });
      }
      return question;
    } catch (error) {
      logger.warn('[CLAUDE SESSION] Session question classifier failed; treating the turn as finished', {
        sessionId,
        error,
      });
      return undefined;
    }
  };
}
