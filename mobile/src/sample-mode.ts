import type { SimulatedMood } from 'hologram';

/**
 * What sample mode is showing, and the order tapping Jarvis walks through.
 *
 * Four things he does, on one screen with no words on it: hearing you, speaking, working, and
 * waiting. There are no buttons because there is no text — see `sample-screen.tsx` — so the sphere
 * itself is the control, and each mood has to be told from the others by how he looks, which is
 * the point of having them side by side at all.
 *
 * `microphone` is first because it is what sample mode is for: proving the hologram really follows
 * a voice.
 */
export const SAMPLE_MODES = ['microphone', 'speaking', 'thinking', 'idle'] as const;

export type SampleMode = (typeof SAMPLE_MODES)[number];

/** The next mood along, wrapping round. */
export function nextSampleMode(mode: SampleMode): SampleMode {
  const at = SAMPLE_MODES.indexOf(mode);
  return SAMPLE_MODES[(at + 1) % SAMPLE_MODES.length] ?? SAMPLE_MODES[0];
}

/** Which simulated mood a sample mode asks for, if any: the microphone is real, and idle is silence. */
export function moodOf(mode: SampleMode): SimulatedMood | undefined {
  return mode === 'speaking' || mode === 'thinking' ? mode : undefined;
}
