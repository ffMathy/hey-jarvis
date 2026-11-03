/**
 * How the sphere follows the person talking to him: their voice-activity score and loudness, turned
 * into the two eased numbers the drawing's listening lattice reads (`hearing` and `hearingLevel`), and
 * the rise of their loudness that marks each syllable they say, which the clock keeps so the
 * syllables can flow into him through the lattice (`heardRise`).
 *
 * Worklets, like the rest of what the frame loop calls: they run on the UI thread once a frame,
 * and take everything they need as arguments.
 */

/**
 * The voice-activity score below which nobody is talking — the firmware's own LED threshold, so
 * the phone, the watch and the Voice preview on the shelf agree on when someone is speaking.
 */
export const HEARING_THRESHOLD = 0.25;
/**
 * How far above the threshold a score has to be before the lattice is fully there. Narrow, because
 * ElevenLabs' score climbs over a few hundred milliseconds as someone starts talking: a wide span
 * waits for that whole climb before the lattice shows, so speech read as late.
 */
const HEARING_SPAN = 0.15;
/**
 * How long the lattice takes to come up once someone speaks, and to go once they stop. The rise is
 * short so it answers the first syllable; the fall stays long so it does not flicker between words.
 */
const HEARING_RISE_SECONDS = 0.06;
const HEARING_FALL_SECONDS = 0.6;
/**
 * The same for how loud they are, as time constants of an exponential ({@link easeHearingLevel}):
 * quicker, so it follows syllables rather than sentences. The rise is also how their syllables'
 * onsets arrive, which the clock shares out between its slots by (`advanceVoiceWave`).
 */
export const HEARING_LEVEL_RISE_SECONDS = 0.05;
const LEVEL_FALL_SECONDS = 0.25;
/**
 * How much rise of their loudness makes a syllable: a slot holds `1 − e^(−rise / this)`, as his do
 * (`VOICE_WAVE_ONSET_SCALE`). On sample mode's voice someone's syllables lift their eased loudness by
 * about 0.3 to 0.5, and a voice at arm's length from a phone by about 0.2 to 0.3, so a quarter fills
 * most of a slot on either without a louder voice needing to shout.
 */
export const HEARD_WAVE_ONSET_SCALE = 0.25;

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

/**
 * How much someone is talking, 0–1, from a voice-activity score: nothing below the threshold. Eased
 * out rather than smoothstepped, so a score just over the threshold already shows — the moment the
 * listener is sure enough is the moment the lattice should start to appear.
 */
export function hearingFromPresence(score: number) {
  'worklet';
  const under = 1 - clamp01((score - HEARING_THRESHOLD) / HEARING_SPAN);
  return 1 - under * under;
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

/**
 * One frame's step of how loud the lattice takes them to be toward how loud they now are.
 *
 * Exponential, as `easeLevel` is for his voice, so where it lands does not depend on the frame rate:
 * two 8 ms steps land where one 16 ms step does. It matters more here than for the lattice's swell:
 * its rises are the syllables the frame clock keeps for their rings (`heardRise`), and the clock shares
 * a step's rise out between its slots on exactly this curve (`advanceVoiceWave`). Eased in a straight
 * line, a step at a time, as `easeHearing` still eases the score, their rings came out up to 0.057 of
 * a slot apart between 25 and 200 frames a second.
 */
export function easeHearingLevel(current: number, target: number, deltaSeconds: number) {
  'worklet';
  if (!(deltaSeconds > 0)) {
    return current;
  }
  const seconds = target > current ? HEARING_LEVEL_RISE_SECONDS : LEVEL_FALL_SECONDS;
  return current + (target - current) * (1 - Math.exp(-deltaSeconds / seconds));
}

/**
 * How much a step lifted their eased loudness, from `previous` to `eased`: what marks a syllable's
 * onset in their voice, as the rise of his bands marks his (`syllableRise`). Nothing while it fell,
 * and nothing while the voice-activity score says nobody is talking (`targetHearing` nought), so a
 * hiss or a room's noise between their phrases sends nothing in.
 */
export function heardRise(previous: number, eased: number, targetHearing: number) {
  'worklet';
  return targetHearing > 0 && eased > previous ? eased - previous : 0;
}
