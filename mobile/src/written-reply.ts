/**
 * What Jarvis last said, when he said it in writing rather than out loud — and how long he looks
 * like he is saying it.
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
 *
 * **And he reads it.** There is no audio in this session, so the sphere has nothing to follow and
 * used to idle through the whole exchange — an assistant answering you while looking exactly like
 * one who has not heard you. `readingUntil` is how long he should look like he is speaking, and
 * the screen points the hologram at a simulated voice for that long. It is an honest fiction: the
 * words really are his, and the only thing invented is the delivery, because ElevenLabs was asked
 * not to speak in this session and there is nothing to play.
 */

/** A line of the conversation, as the SDK reports it. */
export interface ConversationMessage {
  /** What was said. */
  message: string;
  /** Who said it. `ai` is Jarvis; `user` is the line you typed. */
  role: string;
}

/** The last written answer, and whether Jarvis is still delivering it. */
export interface WrittenReply {
  /** What he said, or nothing yet. */
  shown?: string;
  /** The moment he should stop looking like he is saying it. 0 when he is not saying anything. */
  readingUntil: number;
}

/** Nothing said and nobody speaking, which is where every conversation starts. */
export const SAYING_NOTHING: WrittenReply = { readingUntil: 0 };

/**
 * How fast he reads, in characters a second.
 *
 * Ordinary speech is about 150 words a minute, and an English word with the space after it is
 * close to six characters, so fifteen a second is the usual conversational rate. Fourteen is a
 * shade under it, which is the right side to err on for someone whose whole manner is unhurried —
 * and erring long is also the safer mistake here, since the sphere settling before the answer has
 * been read reads as him losing interest in his own sentence.
 */
const CHARACTERS_A_SECOND = 14;

/**
 * The shortest and longest he ever looks like he is speaking.
 *
 * A floor because "Yes." is still him having said something, and a sphere that twitched for a
 * tenth of a second would read as a glitch rather than an answer. A ceiling because nothing is
 * actually being played: a long answer is on screen to be read at your own pace, and a sphere
 * miming for a minute over text you finished reading in ten seconds is a stage performance nobody
 * asked for. Twelve seconds is long enough to carry any answer worth watching him deliver.
 */
const SHORTEST_READING_MS = 900;
const LONGEST_READING_MS = 12_000;

/** How long Jarvis should look like he is saying this, in milliseconds. */
export function readingMilliseconds(reply: string): number {
  const spoken = (reply.trim().length / CHARACTERS_A_SECOND) * 1000;
  return Math.max(SHORTEST_READING_MS, Math.min(LONGEST_READING_MS, spoken));
}

/**
 * What the next message makes of what is on screen.
 *
 * Two rules, and both are about not leaving a stale answer under a fresh question:
 *
 * - **His line replaces it**, and starts him reading it. That is the whole point.
 * - **Yours clears it**, and stops him mid-sentence. The moment you send something, his previous
 *   answer stops being the answer to what is on screen — leaving it there would read as a reply to
 *   the line you just typed, which is worse than showing nothing while he thinks.
 *
 * A blank line from him is not an answer and leaves everything alone, reading included — the SDK
 * reports corrections and partial turns through this same callback, and an empty one clearing the
 * screen would make his reply flicker away for no reason the user can see.
 *
 * `now` is passed in rather than read here so that the whole thing stays a function of its
 * arguments, which is what lets the rate above be pinned by a test rather than waited out.
 */
export function afterMessage(reply: WrittenReply, incoming: ConversationMessage, now: number): WrittenReply {
  if (incoming.role === 'user') {
    return SAYING_NOTHING;
  }

  const said = incoming.message.trim();
  if (!said) {
    return reply;
  }

  return { shown: said, readingUntil: now + readingMilliseconds(said) };
}
