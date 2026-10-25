import type { SessionEnding } from './session-contract';

/** What the SDK says when the agent's participant leaves the room — or seems to. */
const AGENT_LEFT = 'agent disconnected';

/** A WebSocket that closed with no closing handshake: the network went, not the server. */
const ABNORMAL_CLOSURE = 1006;

/**
 * Whether an open conversation ended because the line to it went, rather than because the call is
 * over — the difference between redialling and letting him go.
 *
 * On a phone the line goes all the time: a lift, a tunnel, Wi-Fi handing over to mobile data. LiveKit
 * rides out a short gap itself, resuming the room under the SDK without it noticing. What it cannot
 * ride out reaches the SDK in one of three shapes, and each one used to end the conversation:
 *
 * - **LiveKit gave up on the room** (`connection_state_changed`), after its own retries.
 * - **The agent seemed to leave** (`close`, `agent disconnected`). A change of network makes LiveKit
 *   rejoin the room from scratch rather than resume it, and it unwinds every other participant as it
 *   starts — so the SDK sees the agent leave, ends the conversation as the agent's doing, and LiveKit
 *   rejoins a room nobody is listening to any more.
 * - **The socket of a written conversation failed** (`error`) or closed abnormally (code 1006).
 *
 * Everything else is the call being over and is left alone: the agent's `end_call`, the room closed or
 * deleted on purpose, a socket closed normally, the conversation's maximum duration, the server
 * refusing to go on.
 */
export function isDroppedLine(ending: SessionEnding): boolean {
  const context = ending.context;
  if (!context) {
    return false;
  }
  if (ending.reason === 'error') {
    return (
      context.type === 'connection_state_changed' ||
      context.type === 'error' ||
      (context.type === 'close' && context.code === ABNORMAL_CLOSURE)
    );
  }
  return ending.reason === 'agent' && context.type === 'close' && context.reason === AGENT_LEFT;
}
