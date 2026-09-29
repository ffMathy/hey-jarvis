/**
 * What the error panel in the room says, for every way a summoning can fail.
 *
 * The texts are the phone's wherever the phone has one, so the same failure reads the same on
 * every device: the token request's own messages (`describeFailure` in
 * `hologram/src/conversation-token.ts`, which reach the session as the rejection's message), the
 * deadline's (`mobile/src/conversation-screen.tsx`), the refused microphone's and the generic
 * ones. What is new here are the two raw texts the phone shows verbatim and should not — the
 * browser's own words for being offline, and LiveKit's for a room that closed — which on a headset
 * would be the only thing in front of you.
 */

/** When nothing has answered by `GIVE_UP_CONNECTING_AFTER_MS`. The phone's words, exactly. */
export const DEADLINE_PROBLEM = 'Jarvis did not answer. ElevenLabs may be unreachable, or the settings may be wrong.';

/** A `fetch` that never reached a server. */
export const OFFLINE_PROBLEM = 'ElevenLabs could not be reached. Check that the headset is connected to the internet.';

/** The room closing under an open conversation, without the agent having hung up. */
export const DROPPED_PROBLEM = 'The connection to Jarvis dropped.';

/** The phone's, for a microphone the browser refused. */
export const MICROPHONE_PROBLEM = 'Jarvis needs the microphone in order to listen.';

/** The phone's, for a start that failed with nothing to say about it. */
export const UNREACHABLE_PROBLEM = 'Jarvis could not be reached.';

/** The phone's, for a conversation that ended with an error and no message. */
export const ENDED_UNEXPECTEDLY_PROBLEM = 'The conversation with Jarvis ended unexpectedly.';

/**
 * What LiveKit's room closing reads as, through the SDK: `LiveKit connection state changed to
 * disconnected`. Matched loosely, since only its meaning is relied on.
 */
const LIVEKIT_ROOM_CLOSED = /livekit connection state changed to disconnected/i;

/**
 * Anything that looks like a credential. A message is never shown with one in it — the SDK's and
 * LiveKit's texts are not written for a screen, and the token and the key are both in the requests
 * they describe — for the same reason `conversation-token.ts` never reads an error body's text.
 */
const CREDENTIAL = /sk_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{10,}|access_token/;

/** The message an error carries, if it carries one. */
function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  return typeof error === 'string' ? error.trim() : '';
}

/** The message, unless it is empty or could be carrying a credential; then the fallback. */
function safely(message: string, fallback: string): string {
  return message && !CREDENTIAL.test(message) ? message : fallback;
}

/**
 * Whether `fetch` failed before any server answered. Browsers reject with a `TypeError` then, each
 * in its own words — "Failed to fetch", "NetworkError when attempting to fetch resource.", "Load
 * failed" — and a response of any status is not this.
 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/** Why the token request failed. Its own messages are already written for the user. */
export function describeTokenFailure(error: unknown): string {
  if (isNetworkFailure(error)) {
    return OFFLINE_PROBLEM;
  }
  return safely(messageOf(error), UNREACHABLE_PROBLEM);
}

/**
 * Why `startSession` rejected, or why the SDK reported an error before the conversation opened.
 *
 * A refused microphone is the one worth naming: the SDK asks for it again as it dials, and a
 * browser that says no rejects with `NotAllowedError`.
 */
export function describeStartFailure(error: unknown): string {
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return MICROPHONE_PROBLEM;
  }
  if (isNetworkFailure(error)) {
    return OFFLINE_PROBLEM;
  }
  return safely(messageOf(error), UNREACHABLE_PROBLEM);
}

/** Why an open conversation ended with `reason: 'error'`. */
export function describeDisconnect(message: string | undefined): string {
  const said = message?.trim() ?? '';
  if (LIVEKIT_ROOM_CLOSED.test(said)) {
    return DROPPED_PROBLEM;
  }
  return safely(said, ENDED_UNEXPECTEDLY_PROBLEM);
}
