import type { SimulatedMood } from 'hologram';

/**
 * What sample mode is showing, and the order tapping Jarvis walks through.
 *
 * Three things he does, on one screen with no words on it: speaking, working, and waiting. There
 * are no buttons because there is no text — see `sample-screen.tsx` — so the sphere itself is the
 * control, and each mood has to be told from the others by how he looks, which is the point of
 * having them side by side at all.
 *
 * **There was a fourth, `microphone`, which listened to you and drove the sphere from your own
 * voice.** It is gone, and with it every line that existed to serve it. Sample mode is a thing to
 * look at — a way to see what Jarvis does before there is an ElevenLabs account to make him do it
 * — and opening a microphone to show it was a large amount of machinery, a permission prompt and a
 * recording indicator in aid of something the simulated voices show just as well. All three
 * remaining moods come from the clock.
 */
export const SAMPLE_MODES = ['speaking', 'thinking', 'idle'] as const;

export type SampleMode = (typeof SAMPLE_MODES)[number];

/** The next mood along, wrapping round. */
export function nextSampleMode(mode: SampleMode): SampleMode {
  const at = SAMPLE_MODES.indexOf(mode);
  return SAMPLE_MODES[(at + 1) % SAMPLE_MODES.length] ?? SAMPLE_MODES[0];
}

/** Which simulated mood a sample mode asks for, if any. Idle asks for none: it is silence. */
export function moodOf(mode: SampleMode): SimulatedMood | undefined {
  return mode === 'speaking' || mode === 'thinking' ? mode : undefined;
}
