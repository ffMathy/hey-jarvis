/**
 * What Jarvis last said, when he said it in writing rather than out loud.
 *
 * **Only a text-only conversation has anything to keep here.** In an ordinary session his answer
 * is his voice, the sphere follows it, and there is nothing to read — which is the screen working
 * as designed. In the one a browser falls back to when the microphone is refused there is no
 * voice at all: the reply arrives as an `agent_response` over the socket, and until this existed
 * nothing in the app rendered it. So typing into that session sent the line, got an answer, and
 * showed nothing whatsoever — a conversation you could talk into and never hear back from.
 *
 * It is the last thing he said and not a transcript. A screen whose whole argument is that there
 * is nothing on it does not get a scrollback; what you want after asking something is the answer,
 * and the one before it has already been read.
 */

/** A line of the conversation, as the SDK reports it. */
export interface ConversationMessage {
  /** What was said. */
  message: string;
  /** Who said it. `ai` is Jarvis; `user` is the line you typed. */
  role: string;
}

/**
 * What the next message makes of what is on screen.
 *
 * Two rules, and both are about not leaving a stale answer under a fresh question:
 *
 * - **His line replaces it.** That is the whole point.
 * - **Yours clears it.** The moment you send something, his previous answer stops being the answer
 *   to what is on screen. Leaving it there would read as a reply to the line you just typed, which
 *   is worse than showing nothing while he thinks.
 *
 * A blank line from him is not an answer and leaves what is there alone — the SDK reports
 * corrections and partial turns through this same callback, and an empty one clearing the screen
 * would make his reply flicker away for no reason the user can see.
 */
export function afterMessage(shown: string | undefined, incoming: ConversationMessage): string | undefined {
  if (incoming.role === 'user') {
    return undefined;
  }
  const said = incoming.message.trim();
  return said ? said : shown;
}
