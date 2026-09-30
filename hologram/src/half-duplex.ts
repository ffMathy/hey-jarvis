/**
 * Deciding when the headset should stop listening while Jarvis talks.
 *
 * **Why there is a fallback at all.** His voice plays from the headset's own speakers, a few
 * centimetres from its microphones, and only echo cancellation keeps the agent from hearing him
 * as the user. The agent allows interruptions, so if cancellation on a Quest turns out weak, his
 * own voice barges in on him and he cuts himself off mid-sentence, over and over. Whether it is
 * weak cannot be known from here — it is the headset's audio stack, and it has only been read
 * about, not heard. So the session watches for the symptom, and once it has seen it, mutes the
 * microphone whenever he is speaking for the rest of that conversation. That costs barge-in,
 * which is why it is a fallback and shown on the HUD rather than simply always on.
 *
 * **The symptom has two shapes.** Interrupted within {@link INTERRUPTED_TOO_SOON_MS} of starting to
 * speak is faster than anyone draws breath to talk over him; it is his first syllables coming back
 * through the microphone. And {@link UNEXPLAINED_INTERRUPTIONS} interruptions with no transcript of
 * the user between them are interruptions nobody said anything in. A real barge-in has words in it,
 * and ElevenLabs sends their transcript after the interruption, so it resets the count.
 */

/** How soon after he starts speaking an interruption counts as his own voice coming back. */
export const INTERRUPTED_TOO_SOON_MS = 300;

/** How many interruptions in a row, with no words from the user between them, give it away. */
export const UNEXPLAINED_INTERRUPTIONS = 2;

export interface HalfDuplexDetector {
  /** His audio started: the mode went to `speaking`. */
  agentStartedSpeaking(): void;
  /** A transcript of the user arrived, so the interruptions before it had words in them. */
  userSpoke(): void;
  /**
   * An interruption. `agentSpeaking` is the mode at that moment — the SDK reports the
   * interruption before it switches the mode to `listening`, so it still reads `speaking` here.
   * Returns whether the fallback is on from now.
   */
  interrupted(agentSpeaking: boolean): boolean;
  /** Whether the fallback has been switched on. It stays on until {@link HalfDuplexDetector.reset}. */
  readonly on: boolean;
  /** A new conversation, which gets its own chance at full duplex. */
  reset(): void;
}

export function createHalfDuplexDetector(now: () => number): HalfDuplexDetector {
  let on = false;
  let unexplained = 0;
  let speakingSince: number | undefined;

  return {
    agentStartedSpeaking: () => {
      speakingSince = now();
    },
    userSpoke: () => {
      unexplained = 0;
    },
    interrupted: (agentSpeaking) => {
      unexplained++;
      const tooSoon = agentSpeaking && speakingSince !== undefined && now() - speakingSince <= INTERRUPTED_TOO_SOON_MS;
      if (tooSoon || unexplained >= UNEXPLAINED_INTERRUPTIONS) {
        on = true;
      }
      return on;
    },
    get on() {
      return on;
    },
    reset: () => {
      on = false;
      unexplained = 0;
      speakingSince = undefined;
    },
  };
}
