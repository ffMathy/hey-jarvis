/**
 * How a Claude Code session implementing a change asks the user something, at any point in its work.
 *
 * A session runs unattended, so it cannot ask in its terminal. It ends its turn on a fenced
 * `jarvis-question` block instead, and the watcher (`session-watcher.ts`) reads it, puts the
 * question to the user over a channel his answer can come back on, and resumes the session with
 * that answer — which may take minutes or hours, and costs the session nothing: its transcript
 * waits in the sandbox.
 *
 * Asking is the session's decision, and asking nothing is the usual one: a request the codebase
 * settles is implemented straight away.
 */

import { truncate } from 'lodash-es';

/** The info string of the fenced block a session ends its turn on to ask the user something. */
export const SESSION_QUESTION_FENCE = 'jarvis-question';

/** Longest question passed on. It is read aloud or rung through, so it stays a sentence or two. */
const MAXIMUM_QUESTION_LENGTH = 300;

/** The part of an implementing session's task that says when and how it may ask the user something. */
export function buildSessionQuestionInstructions(): string {
  return `Before changing anything, study the parts of the codebase this request touches: where the change belongs, what it builds on, and how it should behave. Anything the code, its documentation or its conventions settle is not a question — decide it yourself. When nothing is left that only the user can decide, which is the usual case, go straight on and implement the change without asking anything.

When there is a choice only the user can make — what he wants, not how the codebase works — ask him, now or at any later point in the work. End your turn with this block and nothing after it, holding the one question:

\`\`\`${SESSION_QUESTION_FENCE}
Should the reminder go out by email, or as a push notification?
\`\`\`

Jarvis asks him out loud, on a call or on the house speakers, and resumes this session with his answer, in his own words. It can take a while. Ask one question at a time, as a single short spoken sentence about one thing: no markdown, code, file paths or identifiers. Where there are a few sensible options, name them in the question. The repository is settled, so never ask which one is meant.`;
}

/**
 * Reads the question a session ended its turn on, if it ended on one.
 *
 * The block is the last thing in the message, so it is looked for from the end — the message may
 * well have mentioned the block before writing it.
 *
 * @returns The question, or `undefined` when the turn did not end on one
 */
export function readSessionQuestion(finalMessage: string): string | undefined {
  const opening = `\`\`\`${SESSION_QUESTION_FENCE}`;
  const start = finalMessage.lastIndexOf(opening);
  if (start === -1) {
    return undefined;
  }

  const body = finalMessage.slice(start + opening.length);
  const closing = body.indexOf('```');
  const question = (closing === -1 ? body : body.slice(0, closing)).trim();
  if (question.length === 0) {
    return undefined;
  }

  return truncate(question, { length: MAXIMUM_QUESTION_LENGTH });
}
