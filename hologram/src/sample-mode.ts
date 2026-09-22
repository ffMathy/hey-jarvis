import type { SimulatedMood } from './simulated-voice';
import type { JarvisVoice } from './voice-contract';

/**
 * What sample mode is showing, and the order tapping Jarvis walks through.
 *
 * Four things he does, on a screen with next to no words on it: speaking, listening, working, and waiting.
 * There are no buttons because there is no text to hang them off, so the sphere itself is the
 * control, and each mood has to be told from the others by how he looks, which is the point of
 * having them side by side at all.
 *
 * Here rather than in an app because both devices have a sample mode now — the phone's, offered
 * before there is an account, and the watch's, shown while it waits for the phone to hand the
 * credentials over — and the two should walk the same moods in the same order.
 *
 * **There was a fourth, `microphone`, which listened to you and drove the sphere from your own
 * voice.** It is gone, and with it every line that existed to serve it. Sample mode is a thing to
 * look at, and opening a microphone to show it was a large amount of machinery, a permission prompt
 * and a recording indicator in aid of something the simulated voices show just as well. All three
 * remaining moods come from the clock.
 */
export const SAMPLE_MODES = ['speaking', 'listening', 'thinking', 'idle'] as const;

export type SampleMode = (typeof SAMPLE_MODES)[number];

/** The next mood along, wrapping round. */
export function nextSampleMode(mode: SampleMode): SampleMode {
  const at = SAMPLE_MODES.indexOf(mode);
  return SAMPLE_MODES[(at + 1) % SAMPLE_MODES.length] ?? SAMPLE_MODES[0];
}

/**
 * Which simulated mood a sample mode asks for, if any. Idle asks for none: it is silence. Nor does
 * listening: there Jarvis is silent and it is the person talking to him who is simulated — see
 * {@link hearsSomeone}.
 */
export function moodOf(mode: SampleMode): SimulatedMood | undefined {
  // Speaking is the greeting, repeated: he speaks here exactly as he does when he is summoned.
  if (mode === 'speaking') {
    return 'greeting';
  }
  return mode === 'thinking' ? mode : undefined;
}

/** Whether a sample mode has someone talking to him, which the sphere shows as a quiet listening ring. */
export function hearsSomeone(mode: SampleMode): boolean {
  return mode === 'listening';
}

/** What each mood is called, for the one moment its name is on screen after a tap. */
export const SAMPLE_MODE_NAMES: Record<SampleMode, string> = {
  speaking: 'Speaking',
  listening: 'Listening',
  thinking: 'Thinking',
  idle: 'Idle',
};

/** What a screen reader is told Jarvis is doing, since nothing on screen says it for long. */
export const SAMPLE_MODE_LABELS: Record<SampleMode, string> = {
  speaking: 'Jarvis, speaking. Tap to see him listen.',
  listening: 'Jarvis, listening to someone talk. Tap to see him think.',
  thinking: 'Jarvis, working through something. Tap to see him at rest.',
  idle: 'Jarvis, at rest. Tap to hear him speak again.',
};

/** Nothing to hear, so nothing to report. Shared: the sphere never writes to it. */
const NOTHING: readonly number[] = [];

/**
 * Jarvis with nobody talking to him and nothing to do: the sphere turning, and that is all.
 *
 * Given this the sphere idles — turning, arriving once, never brightening. It is what sample mode's
 * `idle` hands the drawing, and a plain object rather than a hook so that it is one value for the
 * life of the app and a screen switching to it rebuilds nothing.
 */
export const SILENT_VOICE: JarvisVoice = {
  listening: false,
  speaking: false,
  getVolume: () => 0,
  getSpectrum: () => NOTHING,
};

/** What the drawing last reported about itself, as the sample screens' readout shows it. */
export interface FrameRateReading {
  /** Frames drawn per second, as achieved rather than as asked for. */
  rate: number;
  /** How long building one picture took, in milliseconds: the half of a frame that is JavaScript. */
  buildMilliseconds: number;
  /** The share of the scene's particles being drawn, 0–1. */
  share: number;
}

/**
 * The readout's one line of text.
 *
 * `particles` is how many there are when none are held back, so the share can be said as a count.
 * Build time is optional because it is the first thing to go where there is no room for it: on a
 * round watch face the line has to fit the chord of a circle.
 */
export function describeFrameRate(
  reading: FrameRateReading,
  particles: number,
  { withBuildTime = true }: { withBuildTime?: boolean } = {},
): string {
  const rate = `${Math.round(reading.rate)} fps`;
  const sparks = `${Math.round(reading.share * particles)} sparks`;
  return withBuildTime
    ? `${rate} · build ${reading.buildMilliseconds.toFixed(1)} ms · ${sparks}`
    : `${rate} · ${sparks}`;
}
