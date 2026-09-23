/**
 * How the sphere follows the person talking to him: their voice-activity score and loudness, turned
 * into the two eased numbers the drawing's listening lattice reads (`hearing` and `hearingLevel`).
 *
 * Worklets, like the rest of what the frame loop calls: they run on the UI thread once a frame,
 * and take everything they need as arguments.
 */

/**
 * The voice-activity score below which nobody is talking — the firmware's own LED threshold, so
 * the phone, the watch and the Voice preview on the shelf agree on when someone is speaking.
 */
export const HEARING_THRESHOLD = 0.25;
/** How far above the threshold a score has to be before the lattice is fully there. */
const HEARING_SPAN = 0.35;
/** How long the lattice takes to come up once someone speaks, and to go once they stop. */
const HEARING_RISE_SECONDS = 0.15;
const HEARING_FALL_SECONDS = 0.6;
/** The same for how hard it breathes: quicker, so it follows syllables rather than sentences. */
const LEVEL_RISE_SECONDS = 0.05;
const LEVEL_FALL_SECONDS = 0.25;

function clamp01(value: number) {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Moves `current` toward `target` at a rate set by how long a full rise or fall should take. */
function easeToward(current: number, target: number, deltaSeconds: number, riseSeconds: number, fallSeconds: number) {
  'worklet';
  const seconds = target > current ? riseSeconds : fallSeconds;
  const step = Math.min(1, deltaSeconds / seconds);
  return current + (target - current) * step;
}

/** How much someone is talking, 0–1, from a voice-activity score: nothing below the threshold. */
export function hearingFromPresence(score: number) {
  'worklet';
  const over = clamp01((score - HEARING_THRESHOLD) / HEARING_SPAN);
  return over * over * (3 - 2 * over);
}

/**
 * How loud they are, 0–1, from a microphone's input volume. The square root, because a voice at a
 * normal distance reads as a small number and the lattice should not need shouting at.
 */
export function hearingLevelFromVolume(volume: number) {
  'worklet';
  return clamp01(Math.sqrt(clamp01(volume)) * 1.4);
}

/** One frame's step of the lattice's presence toward what the voice-activity score now says. */
export function easeHearing(current: number, target: number, deltaSeconds: number) {
  'worklet';
  return easeToward(current, target, deltaSeconds, HEARING_RISE_SECONDS, HEARING_FALL_SECONDS);
}

/** One frame's step of how hard the lattice breathes toward how loud they now are. */
export function easeHearingLevel(current: number, target: number, deltaSeconds: number) {
  'worklet';
  return easeToward(current, target, deltaSeconds, LEVEL_RISE_SECONDS, LEVEL_FALL_SECONDS);
}
