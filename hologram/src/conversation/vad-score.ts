/**
 * The latest of ElevenLabs' voice-activity scores, kept where a reader polling every 40 ms can
 * find it — and deaf while Jarvis is the one talking.
 *
 * ElevenLabs sends a `vad_score` event many times a second while the microphone is open — the
 * agent lists it in its `clientEvents` — and each one says how sure the listener is, from 0 to 1,
 * that someone is speaking. It is the *only* thing that says the user is speaking: the listening
 * animation is gated on it, and the microphone's level only sets how strongly it pulses. The raw
 * score is kept; the threshold it is judged against is the drawing's (`HEARING_THRESHOLD` in
 * `hearing.ts`, the firmware's 0.25).
 *
 * **Scores that arrive while Jarvis is speaking are thrown away**, and the score reads as nobody
 * speaking until he stops. His own voice comes out of the speaker a few centimetres from the
 * microphone, and ElevenLabs scores it as the user speaking — which is why the voice firmware does
 * the same thing (`if (this->speaker_is_active_) return;` in
 * `home-assistant-voice-firmware/components/elevenlabs_stream/elevenlabs_stream.cpp`). Here that
 * means both his live answers and the recorded greeting.
 *
 * A box rather than state: only the latest score matters, and it is read on the drawing's own
 * clock, so putting every score through React would render the screen dozens of times a second for
 * a number only the drawing reads.
 */
export interface VadScoreKeeper {
  /** A score as it arrived; ignored while Jarvis speaks. Kept inside 0–1, and 0 if not a number. */
  heard: (score: number) => void;
  /** The last score heard, or 0 before any has been, while Jarvis speaks, and after `forget`. */
  latest: () => number;
  /** Whether Jarvis is speaking now. Starting to forgets the score, which is his from then on. */
  jarvisSpeaking: (speaking: boolean) => void;
  /** Back to nobody speaking, for when there is no microphone to be listening to. */
  forget: () => void;
}

export function createVadScoreKeeper(): VadScoreKeeper {
  let score = 0;
  let deaf = false;
  return {
    heard: (incoming) => {
      if (deaf) {
        return;
      }
      score = Number.isFinite(incoming) ? Math.min(1, Math.max(0, incoming)) : 0;
    },
    latest: () => (deaf ? 0 : score),
    jarvisSpeaking: (speaking) => {
      deaf = speaking;
      if (speaking) {
        score = 0;
      }
    },
    forget: () => {
      score = 0;
    },
  };
}
