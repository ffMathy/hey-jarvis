import { useConversationMode, useConversationStatus } from '@elevenlabs/react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  afterQuietEvent,
  HANG_UP_WHEN_QUIET_TOOL,
  hangUpDueAt,
  NOT_WATCHING,
  QUIET_BEFORE_HANGING_UP_MS,
  type QuietEvent,
} from '../quiet-hang-up';

/**
 * Ends the conversation once a finished request is followed by {@link QUIET_BEFORE_HANGING_UP_MS}
 * of nobody saying anything — the agent's `hangUpWhenQuiet` client tool, answered on the device.
 *
 * The rules — the clock runs only while Jarvis is quiet, the user speaking calls it off, and what
 * is heard while he speaks is ignored — are `quiet-hang-up.ts`'s, where they are tested. This is
 * the part with a clock and an SDK in it: Jarvis's speaking comes from the conversation's own mode,
 * the user from the same `vad_score` the listening lattice reads and from anything they say or
 * type, and one timer is kept for the moment the call is due — cleared whenever that moment moves,
 * and on the way out.
 *
 * **A session that ends for any other reason disarms it**: anything but `connected` — a hang-up, an
 * error, the agent leaving, a new summoning dialling — puts it back to unarmed, so the quiet at the
 * end of one call can never end the next.
 *
 * `speaking` is for a delivery the SDK cannot see: a written answer the screen mimes out loud
 * (`written-reply.ts` in the phone app), which the reader has not finished reading either. The
 * SDK's mode says `listening` throughout one, and ending the call three seconds in would take the
 * answer off the screen with him.
 *
 * `hangUp` is the screen's own, so a quiet ending is the same ending as the user's: on a phone the
 * sheet and the assistant's window follow him down.
 *
 * The session options go to `startSession`, beside the other hooks' handlers — the client tool, and
 * two handlers that have to be combined with the ones already there (see `inTurn`).
 * `heardTheUser` is for what reaches the conversation without passing through the SDK's callbacks:
 * a line being typed.
 */
export function useHangUpWhenQuiet({ hangUp, speaking = false }: { hangUp: () => void; speaking?: boolean }) {
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  // A ref rather than state: scores arrive many times a second and change nothing almost every
  // time. Only the moment the call is due is state, since that is what the timer is set from.
  const watch = useRef(NOT_WATCHING);
  const [dueAt, setDueAt] = useState<number | undefined>(undefined);

  const hear = useCallback((event: QuietEvent) => {
    const next = afterQuietEvent(watch.current, event);
    if (next === watch.current) {
      return;
    }
    watch.current = next;
    setDueAt(hangUpDueAt(next));
  }, []);

  const connected = status === 'connected';
  const jarvisSpeaking = speaking || (connected && mode === 'speaking');
  useEffect(() => {
    hear({ type: 'jarvisSpeaking', speaking: jarvisSpeaking, at: Date.now() });
  }, [jarvisSpeaking, hear]);

  useEffect(() => {
    if (!connected) {
      hear({ type: 'sessionOver' });
    }
  }, [connected, hear]);

  useEffect(() => {
    if (dueAt === undefined) {
      return;
    }
    const quiet = setTimeout(
      () => {
        hear({ type: 'sessionOver' });
        console.info(`Nobody spoke for ${QUIET_BEFORE_HANGING_UP_MS} ms after Jarvis finished a request: hanging up.`);
        hangUp();
      },
      Math.max(0, dueAt - Date.now()),
    );
    return () => clearTimeout(quiet);
  }, [dueAt, hangUp, hear]);

  const quietSessionOptions = useMemo(
    () => ({
      clientTools: {
        // Nothing to answer with: the agent is configured not to wait for a result.
        [HANG_UP_WHEN_QUIET_TOOL]: () => hear({ type: 'hangUpRequested', at: Date.now() }),
      },
      onVadScore: ({ vadScore }: { vadScore: number }) => hear({ type: 'vadScore', score: vadScore }),
      // A transcript of the user is them having answered, however quietly the score read it.
      onMessage: ({ role }: { role: string }) => {
        if (role === 'user') {
          hear({ type: 'userSpoke' });
        }
      },
    }),
    [hear],
  );

  const heardTheUser = useCallback(() => hear({ type: 'userSpoke' }), [hear]);

  return { quietSessionOptions, heardTheUser };
}
