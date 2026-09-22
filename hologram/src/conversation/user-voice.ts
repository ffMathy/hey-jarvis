import {
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from '@elevenlabs/react-native';
import { useEffect, useMemo, useState } from 'react';
import type { UserVoice } from '../voice-contract';
import { createVadScoreKeeper } from './vad-score';

/** Nobody speaking: what the sphere is told whenever there is no open microphone to listen to. */
const NOBODY: UserVoice = { getPresence: () => 0, getVolume: () => 0 };

/**
 * The person talking to Jarvis, as the conversation hears them — for the sphere's listening
 * animation.
 *
 * Two readings, both from the ElevenLabs SDK, and they are not equals. **Presence** is the latest
 * `vad_score` ElevenLabs sent — its own listener's certainty that someone is speaking — and it is
 * the only thing that turns the animation on: a microphone level cannot tell a voice from a door
 * closing. **Volume** is the SDK's input level, which only sets how strongly the animation pulses
 * once presence has turned it on.
 *
 * Presence is deaf whenever Jarvis is the one talking — his answers, and the recorded greeting,
 * which is why a screen passes `greeting` — because the microphone hears him through the speaker
 * and ElevenLabs scores that as the user. The firmware ignores the score for the same reason; see
 * `vad-score.ts`.
 *
 * Both read as nobody speaking unless the microphone is genuinely being listened to: the session
 * has to be connected, and the microphone not muted — which it is while the recorded greeting
 * plays, so that the agent does not hear it either (see `greeting.ts`).
 *
 * The handlers go to `startSession`, beside the tool handlers, which take them for the life of
 * the session.
 */
export function useUserVoice({ greeting }: { greeting: boolean }) {
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  const { isMuted } = useConversationInput();
  const { getInputVolume } = useConversationControls();
  const [vadScore] = useState(createVadScoreKeeper);

  const listening = status === 'connected' && !isMuted;
  const jarvisSpeaking = greeting || mode === 'speaking';

  useEffect(() => {
    vadScore.jarvisSpeaking(jarvisSpeaking);
  }, [jarvisSpeaking, vadScore]);

  // A score that arrived just before the microphone closed must not outlive it: the next time it
  // opens, the sphere would start out believing someone was already speaking.
  useEffect(() => {
    if (!listening) {
      vadScore.forget();
    }
  }, [listening, vadScore]);

  const user = useMemo<UserVoice>(
    () =>
      listening
        ? {
            getPresence: vadScore.latest,
            // Before a session exists the SDK's reader may throw rather than return; that is
            // silence, not a crash on the screen the sphere is drawn on.
            getVolume: () => {
              try {
                return getInputVolume();
              } catch {
                return 0;
              }
            },
          }
        : NOBODY,
    [listening, vadScore, getInputVolume],
  );

  const userVoiceHandlers = useMemo(
    () => ({ onVadScore: ({ vadScore: score }: { vadScore: number }) => vadScore.heard(score) }),
    [vadScore],
  );

  return { user, userVoiceHandlers };
}
