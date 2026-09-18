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
 * why — see the notes in `conversation-screen.tsx`. Both of them read `disconnected`.
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
