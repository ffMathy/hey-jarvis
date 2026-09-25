import { truncate } from 'lodash-es';
import { executeTool } from '../../utils/tool-factory.js';
import { sendNotification } from '../notification/tools.js';
import type { RoutingProgress } from './controller.js';

/**
 * What a request the user asked to be notified about came to, sent to him once it is done.
 *
 * Slow work is offered this instead of a held line (see `utils/slow-tasks.ts`), so the notice has
 * to carry whatever the closing report would have: the answers, what failed, and above all any
 * question the work stopped to ask — which he answers the next time he talks to Jarvis, because
 * the question stays open until then (see ./questions.ts).
 */

/** Longest notice sent. It may be read aloud, so it stays a few sentences. */
const MAXIMUM_NOTICE_LENGTH = 600;

export interface CompletionNotice {
  title: string;
  message: string;
}

/** Writes the notice for a request that has finished. */
export function buildCompletionNotice(
  progress: Pick<RoutingProgress, 'all' | 'questions' | 'error'>,
): CompletionNotice {
  const answers = progress.all.filter((outcome) => !outcome.failed).map((outcome) => outcome.result);
  const failures = progress.all
    .filter((outcome) => outcome.failed)
    .map((outcome) => `The ${outcome.taskId} part ${outcome.result}.`);

  if (progress.questions.length > 0) {
    const questions = progress.questions.map((question) => question.question).join(' ');
    return {
      title: 'Jarvis has a question',
      message: truncate([...answers, `Before your request can go on, I need to know: ${questions}`].join(' '), {
        length: MAXIMUM_NOTICE_LENGTH,
      }),
    };
  }

  if (progress.error) {
    return {
      title: 'Your request could not be completed',
      message: truncate([`Your request could not be completed: ${progress.error}.`, ...answers].join(' '), {
        length: MAXIMUM_NOTICE_LENGTH,
      }),
    };
  }

  return {
    title: 'Your request is done',
    message: truncate([...answers, ...failures].join(' ') || 'Your request is done.', {
      length: MAXIMUM_NOTICE_LENGTH,
    }),
  };
}

/** How a notice reaches the user. Swapped out in tests. */
export type CompletionNotifier = (notice: CompletionNotice) => Promise<void>;

const notifyUser: CompletionNotifier = async ({ title, message }) => {
  await executeTool(sendNotification, { target: { type: 'user' }, title, message });
};

let notifier: CompletionNotifier = notifyUser;

/** Sends the user the notice for a request that has finished. */
export async function sendCompletionNotice(
  progress: Pick<RoutingProgress, 'all' | 'questions' | 'error'>,
): Promise<void> {
  await notifier(buildCompletionNotice(progress));
}

/** Replaces how notices are sent, for tests. */
export function setCompletionNotifierForTest(next: CompletionNotifier): void {
  notifier = next;
}

/** Restores the real notifier. */
export function resetCompletionNotifierForTest(): void {
  notifier = notifyUser;
}
