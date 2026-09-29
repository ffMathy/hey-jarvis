import type { GreetingPlayer } from './session-contract';

/**
 * "Hello sir, how can I help?" — the voice firmware's own recording, played the moment he is
 * summoned, while the session is fetched and dialled behind it.
 *
 * A plain `HTMLAudioElement`. The phone needed call audio and a native player to be heard at all
 * (see "Summoned, he greets you before he is connected" in `hologram/AGENTS.md`); a browser has
 * neither and needs neither, and the phone's web build plays it through expo-audio's element for
 * the same reason. Its envelope is what the sphere follows while it plays, read at this player's
 * own position (`createGreetingReaders`), so he says the words as they are heard.
 *
 * **It can be refused**, and the session has to know: a greeting nobody hears must not also take
 * the agent's own first message away. So {@link GreetingPlayer.playFromStart} waits for the
 * browser's answer to `play()` — which rejects when autoplay is refused — and reports whether the
 * element really is playing afterwards.
 */

/** As much of a media element as the greeting uses. `HTMLAudioElement` has it all. */
export interface GreetingElement {
  src: string;
  preload: string;
  currentTime: number;
  muted: boolean;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
}

/** A greeting player that can also be unlocked ahead of time. */
export interface PrimableGreetingPlayer extends GreetingPlayer {
  /**
   * Plays the recording silently for an instant and stops, inside a user gesture — the Enter tap.
   *
   * Autoplay is decided per page and, in some browsers, per element: an element that has played
   * once inside a gesture may play again outside one. The greeting is always started by a wake
   * word or a select, long after the tap, so it is unlocked while the tap still counts. Harmless
   * where nothing needed unlocking; a refusal here is not a failure of anything.
   */
  prime(): Promise<void>;
}

/**
 * The greeting, played from `url`.
 *
 * @param createElement - Where the element comes from; a test hands in a fake.
 */
export function createGreetingPlayer(
  url: URL,
  createElement: () => GreetingElement = () => new Audio(),
): PrimableGreetingPlayer {
  const element = createElement();
  element.preload = 'auto';
  element.src = url.href;

  const rewind = () => {
    try {
      element.currentTime = 0;
    } catch {
      // Not seekable until its metadata has loaded, and then it starts from the beginning anyway.
    }
  };

  return {
    playFromStart: async () => {
      // Summoned before, the element is parked at the end of the last greeting.
      rewind();
      try {
        await element.play();
      } catch {
        return false;
      }
      return !element.paused;
    },
    stop: () => {
      element.pause();
    },
    position: () => (element.paused || element.ended ? -1 : element.currentTime),
    get duration() {
      return Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
    },
    prime: async () => {
      element.muted = true;
      try {
        await element.play();
        element.pause();
      } catch {
        // Nothing unlocked, and nothing lost: the greeting says so for itself when it is refused.
      } finally {
        element.muted = false;
        rewind();
      }
    },
  };
}
