import { AudioSession } from '@livekit/react-native';
import { useEffect } from 'react';
import type { UsePreferredHeadset } from './platform-contracts';

/**
 * Which routes are worth moving to, best first.
 *
 * Bluetooth over wired is deliberate: if both are connected, the one that was connected on purpose
 * a moment ago is almost always the wireless one. Neither `speaker` nor `earpiece` is in the list —
 * they are what Android falls back to on its own, and forcing one would be this code overriding a
 * choice rather than making one.
 */
const WORTH_MOVING_TO = ['bluetooth', 'headset'];

/**
 * How long to keep looking, and how often.
 *
 * A Bluetooth headset does not appear in the list the instant the call starts. Android has to move
 * it from A2DP — the profile it plays music on — to the headset profile that carries a microphone,
 * and that takes a moment. Asking once at the start of the call finds `speaker` and stops, which is
 * exactly the bug this exists to fix: the phone's own microphone, while AirPods were in.
 */
const KEEP_LOOKING_FOR_MS = 4000;
const LOOK_EVERY_MS = 400;

/**
 * Puts the conversation on a headset whenever one is there to put it on.
 *
 * `AudioSession.startAudioSession` has to have happened first — the list is empty before it — which
 * is why this waits for the call to be up rather than running when the screen opens. LiveKit starts
 * the session itself when the room connects (`autoConfigureAudioSession`), so being connected is
 * the signal.
 *
 * Every failure here is swallowed on purpose. Not being able to move the audio is a worse call, not
 * a broken one, and an assistant that refuses to talk because it could not find your earbuds is
 * worse than one talking out of the phone.
 */
export const usePreferredHeadset: UsePreferredHeadset = (inCall) => {
  useEffect(() => {
    if (!inCall) {
      return;
    }

    let wanted = true;
    let moved = false;
    const startedAt = Date.now();

    const look = async () => {
      try {
        const available = await AudioSession.getAudioOutputs();
        const wants = WORTH_MOVING_TO.find((route) => available.includes(route));
        if (wants) {
          await AudioSession.selectAudioOutput(wants);
          moved = true;
        }
      } catch {
        // Then the phone's own route it is.
      }
    };

    const timer = setInterval(() => {
      if (!wanted || moved || Date.now() - startedAt > KEEP_LOOKING_FOR_MS) {
        clearInterval(timer);
        return;
      }
      void look();
    }, LOOK_EVERY_MS);
    void look();

    return () => {
      wanted = false;
      clearInterval(timer);
    };
  }, [inCall]);
};
