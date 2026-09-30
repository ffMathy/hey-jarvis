/**
 * How far a conversation has got, as every device that holds one needs to know it.
 *
 * In the main entry because each of them asks the same questions of the SDK's status — the phone
 * and the watch through the React provider, the headset through the SDK's own client — and each
 * answering them for itself is how the answers drift apart. It imports nothing.
 */

/**
 * Whether a conversation is open, or on its way to being open.
 *
 * The two statuses that mean "do not start another one". Everything else — `disconnected`,
 * `error`, and the `disconnecting` the SDK reports as `disconnected` — means there is none.
 */
export function isLive(status: string): boolean {
  return status === 'connected' || status === 'connecting';
}

/** How far a conversation has got, as far as anything drawn from it needs to know. */
export interface ConversationLife {
  /** Whether a conversation has been open at any point on this screen. */
  open: boolean;
  /** Whether one was open and is not any more — which is when Jarvis goes. */
  ended: boolean;
}

/** Nothing has happened yet, which is where every screen starts. */
export const NOT_YET_OPEN: ConversationLife = { open: false, ended: false };

/**
 * What the next status makes of it.
 *
 * **Ending is not the same as never starting**, and the difference is the whole reason this is a
 * fold rather than a look at the current status. A conversation that dropped after being open is
 * over, and Jarvis leaves; one that never opened has failed, and he stays under the line saying
 * why — see the notes in `mobile/src/conversation-screen.tsx`. Both of them read `disconnected`.
 *
 * Applying the same status twice changes nothing, so a screen can hand this every status it sees
 * without having to know which of them it has already seen.
 */
export function afterStatus(life: ConversationLife, status: string): ConversationLife {
  if (status === 'connected') {
    return life.open && !life.ended ? life : { open: true, ended: false };
  }
  if (!life.open || isLive(status)) {
    return life;
  }
  return life.ended ? life : { open: true, ended: true };
}

/**
 * How long a device waits for a conversation to open before saying it has not.
 *
 * **Nothing below the screen has a deadline.** The ElevenLabs SDK reports `connecting`, then
 * either `connected` or an error — except when it reports neither, which is what a session that
 * cannot finish coming up does: it waits on a room event that never arrives, with no timeout of
 * its own, for ever. A screen whose only signal is the SDK eventually saying something therefore
 * has a state in which it says nothing at all, which is precisely how the phone looked with the
 * microphone switched off: "Connecting…" and no more, indefinitely. On a watch the Bluetooth proxy
 * produces the same thing, and a sphere turning in silence is indistinguishable from one listening.
 *
 * So the wait is bounded by the session every device holds its conversation in (`jarvis-session.ts`),
 * and by this — and a conversation that only opens after it has given up is ended, since nobody is
 * waiting for it any more. Twenty seconds is far longer than a session takes — a token, a socket and
 * a handshake are a second or two on a bad connection — and long enough that a slow network is never
 * mistaken for a failure.
 */
export const GIVE_UP_CONNECTING_AFTER_MS = 20_000;
