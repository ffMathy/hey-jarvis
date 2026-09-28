import { truncate } from 'lodash-es';
import { executeTool } from '../../utils/tool-factory.js';
import { askQuestion, sendNotification } from '../notification/tools.js';
import type { RoutingProgress } from './controller.js';

/**
 * What a request the user asked to be notified about came to, sent to him once it is done.
 *
 * Slow work is offered this instead of a held line (see `utils/slow-tasks.ts`), so the notice has
 * to carry whatever the closing report would have: the answers, what failed, and above all any
 * question the work stopped to ask. A notice with a question in it is asked rather than sent, over
 * a channel his answer can come back on (see `askQuestion`); whatever he answers, then or the next
 * time he talks to Jarvis, finds the question, because it stays open until then (see
 * ./questions.ts).
 */

/** Longest notice sent. It may be read aloud, so it stays a few sentences. */
const MAXIMUM_NOTICE_LENGTH = 600;

export interface CompletionNotice {
  title: string;
  message: string;
  /** Whether the notice asks him something, and so has to go out where he can answer it. */
  expectsAnswer: boolean;
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
      expectsAnswer: true,
    };
  }

  if (progress.error) {
    return {
      title: 'Your request could not be completed',
      message: truncate([`Your request could not be completed: ${progress.error}.`, ...answers].join(' '), {
        length: MAXIMUM_NOTICE_LENGTH,
      }),
      expectsAnswer: false,
    };
  }

  return {
    title: 'Your request is done',
    message: truncate([...answers, ...failures].join(' ') || 'Your request is done.', {
      length: MAXIMUM_NOTICE_LENGTH,
    }),
    expectsAnswer: false,
  };
}

/** How a notice reaches the user. Swapped out in tests. */
export type CompletionNotifier = (notice: CompletionNotice) => Promise<void>;

const notifyUser: CompletionNotifier = async ({ title, message, expectsAnswer }) => {
  if (expectsAnswer) {
    await executeTool(askQuestion, { question: message });
    return;
  }

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
