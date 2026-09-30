import { useAudioPlayer } from 'expo-audio';
import { useMemo } from 'react';
import type { GreetingPlayer } from '../session-contract';
import { GREETING_SOUND } from './greeting-sound';

/**
 * The recording in a browser: an `HTMLAudioElement`, through expo-audio. A browser has no call audio
 * to play it in, and no need of one, and it routes its own audio, so there is no headset to wait for.
 *
 * **It can be refused.** A tab nobody has clicked since it loaded may refuse to play a sound, unless
 * the page is using the microphone, which the conversation screen makes sure it is — but a
 * greeting that cannot be heard must not also take the agent's own first message away. A refusal
 * is read straight after `play()`, because that is when a browser answers: a refused media element
 * never leaves `paused`, and one that is allowed leaves it at once.
 */
export function useGreetingPlayer(): GreetingPlayer {
  const player = useAudioPlayer(GREETING_SOUND);
  return useMemo(
    () => ({
      playFromStart: async () => {
        // Summoned before, the player is parked at the end of the last greeting.
        await player.seekTo(0).catch(() => undefined);
        player.play();
        return !player.paused;
      },
      stop: () => player.pause(),
      // Silence until the recording is actually playing, and after it stops: the sphere follows
      // what can be heard, not what was asked for.
      position: () => (player.playing ? player.currentTime : -1),
      get duration() {
        return player.duration;
      },
    }),
    [player],
  );
}
