/**
 * His recent syllables, as the clock keeps them for the rings his voice sends out of his core.
 *
 * Each syllable leaves his core as a ring of his own specks, pushed outward and crowded together,
 * that travels out through his body and melts into his shell (`voiceWavePush` in the drawing). A ring
 * is where his voice was a moment ago: the one at a given distance from the core left it that
 * distance over `VOICE_WAVE_SPEED` seconds back. So the clock keeps the last VOICE_WAVE_SLOTS slots
 * of what his voice did, one reading's worth each, newest first, and the drawing reads each ring's
 * strength out of the slot it left in.
 *
 * **What a slot holds is how sharply a syllable started in it, not how loud he was.** A ring has to
 * mark a syllable: the loudness of a held vowel would push out a standing band, and the eased level
 * fills the dips between syllables in. What starts a syllable is energy arriving across his
 * spectrum, so a slot holds the summed rise of his bands as the clock eases them toward each reading
 * — the positive half of what `easeBands` adds, gated on speech as the voice tracker's agitation is —
 * squashed into 0–1 by {@link VOICE_WAVE_ONSET_SCALE}, held for {@link VOICE_WAVE_HOLD_SECONDS} so a
 * syllable's ring has a body, limited in how fast it may rise from one slot to the next
 * (`VOICE_WAVE_SLEW`), which bounds how steeply a ring's front pushes his specks together, and let go
 * entirely below {@link VOICE_WAVE_FLOOR}, so a ring that has died out is gone rather than nearly
 * gone. A held vowel adds nothing: its bands have arrived. Neither does a thought's voice, which
 * never passes the speech gate.
 *
 * **The same at any frame rate.** Slots are cut on the clock's own time, with the voice tracker's
 * slack, never once a frame. Every rising band eases on the same exponential, so the rise a step
 * adds arrives within it on a known curve, and a slot boundary inside a step takes exactly the share
 * of it that arrived before the boundary. A step long enough to cut more than VOICE_WAVE_SLOTS slots
 * — a stall — keeps only the newest, as the change window keeps only its four slices.
 *
 * **Theirs too.** The clock keeps a second train the same way for whoever is talking to him, whose
 * syllables flow into him through the listening lattice: the rise of their loudness as it eases
 * (`heardRise` in `hearing.ts`), at its own scale and on its own easing, which is why
 * {@link advanceVoiceWave} is handed both.
 *
 * Every function here is a worklet that allocates nothing: the clock steps it on the phone's UI
 * thread, under Hermes, every frame (see `frame-clock.ts`).
 */
import { VOICE_WAVE_SLEW, VOICE_WAVE_SLOT_SECONDS, VOICE_WAVE_SLOTS } from './frame-timing';
import { ATTACK_SECONDS, speakingThreshold, type VoiceActivityState } from './voice-levels';

/**
 * How much summed rise of his bands makes a syllable: a slot holds `1 − e^(−rise / this)`, so a rise
 * this large fills 63% of it and a sharper one comes up to, but never past, 1. Measured on the
 * greeting sample mode speaks, its onsets rise by about 1 to 4 across the 24 bands.
 */
export const VOICE_WAVE_ONSET_SCALE = 1.5;
/**
 * How long a syllable's slot is held, falling back by `e^(−slot / this)` from one slot to the next
 * unless a sharper onset fills it: a tenth of a second, so a ring has a body rather than being one
 * slot thin, and lets go well before the next syllable.
 */
export const VOICE_WAVE_HOLD_SECONDS = 0.1;
/** What a slot keeps of the one before it: `e^(−slot / hold)`. */
export const HOLD_DECAY = Math.exp(-VOICE_WAVE_SLOT_SECONDS / VOICE_WAVE_HOLD_SECONDS);
/**
 * The least a slot holds before it is let go: a thousandth of a syllable, a ring of a sixth of a
 * thousandth of his radius. Without it the hold only ever halves a slot, never empties it, so the
 * last syllable's ring lingered for over a minute at sizes no screen can show, and every speck was
 * pushed on the GPU all that while; with it a ring has gone about 1.3 s after his last syllable, and
 * in silence nothing is pushed at all.
 */
export const VOICE_WAVE_FLOOR = 1e-3;
/** The voice tracker's slack for comparing summed frame steps with a duration (see `voice-levels.ts`). */
const TIME_SLACK_SECONDS = 1e-6;

/**
 * What the clock keeps of one voice's recent syllables — his (`wave`) or theirs (`heard`). Plain
 * numbers and one array, written in place.
 */
export interface VoiceWaveState {
  /** VOICE_WAVE_SLOTS slots, 0–1, newest first: how sharply a syllable started in each. */
  slots: number[];
  /** How long ago the newest slot was cut, in seconds: the time the slot being filled has been filling. */
  sinceNewest: number;
  /**
   * The rise gathered so far in the slot being filled: his bands' summed rise (`syllableRise`), or
   * the rise of their eased loudness (`heardRise`).
   */
  rise: number;
}

/** No syllables yet: every slot empty. */
export function createVoiceWaveState(): VoiceWaveState {
  return {
    slots: new Array<number>(VOICE_WAVE_SLOTS).fill(0),
    sinceNewest: 0,
    rise: 0,
  };
}

/**
 * How much his bands rise this step, summed: the positive half of what `easeBands` is about to add
 * as it eases `bands` toward `targetBands` over `deltaSeconds` — so call it before the bands are
 * eased. Nothing while the reading is not speech, judged as the voice tracker judges it, so a hiss,
 * a codec's comfort noise or a thought's quiet voice sends no ring.
 */
export function syllableRise(
  bands: number[],
  targetBands: number[],
  targetLevel: number,
  activity: VoiceActivityState,
  deltaSeconds: number,
): number {
  'worklet';
  if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) {
    return 0;
  }
  const level = targetLevel > 0 && Number.isFinite(targetLevel) ? Math.min(1, targetLevel) : 0;
  if (level < speakingThreshold(activity.loudest, activity.quietestSpeech)) {
    return 0;
  }
  let gap = 0;
  for (let band = 0; band < bands.length; band++) {
    const toward = (targetBands[band] ?? 0) - (bands[band] ?? 0);
    if (toward > 0) {
      gap += toward;
    }
  }
  return gap * (1 - Math.exp(-deltaSeconds / ATTACK_SECONDS));
}

/** Shifts the slots one along, oldest out, and puts `value` in front as the newest. */
function pushSlot(slots: number[], value: number): void {
  'worklet';
  for (let slot = slots.length - 1; slot > 0; slot--) {
    slots[slot] = slots[slot - 1] ?? 0;
  }
  slots[0] = value;
}

/**
 * What a slot cut now holds, from the rise gathered in it and the slot before it: as sharp as its
 * onset — `1 − e^(−rise / onsetScale)` — or what the hold keeps of the one before, whichever is more,
 * but no more than VOICE_WAVE_SLEW above the one before, and nothing at all under
 * {@link VOICE_WAVE_FLOOR}.
 */
function slotAfter(previous: number, rise: number, onsetScale: number): number {
  'worklet';
  const onset = 1 - Math.exp(-rise / onsetScale);
  const held = Math.min(Math.max(onset, previous * HOLD_DECAY), previous + VOICE_WAVE_SLEW);
  return held < VOICE_WAVE_FLOOR ? 0 : held;
}

/**
 * The share of a step's rise that has arrived `into` seconds into a step `deltaSeconds` long, whose
 * whole rise arrives as `whole` = `1 − e^(−Δ/τ)` of the gap, for a voice that eases on an exponential
 * of `attackSeconds` (τ): `(1 − e^(−t/τ)) / whole`.
 */
function arrivedShare(into: number, whole: number, attackSeconds: number): number {
  'worklet';
  return whole > 0 ? (1 - Math.exp(-into / attackSeconds)) / whole : 1;
}

/**
 * Moves recent syllables on by `deltaSeconds`, in place, and returns the same state, with `rise` the
 * step's rise — his summed band rise from {@link syllableRise}, eased over ATTACK_SECONDS and scaled
 * by VOICE_WAVE_ONSET_SCALE; or theirs, `heardRise` in `hearing.ts`, on its own easing and scale.
 * `attackSeconds` is how the voice eases, so a rise that crosses a slot is shared out as it arrived,
 * and `onsetScale` how much rise makes a syllable (see {@link VOICE_WAVE_ONSET_SCALE}).
 *
 * Every VOICE_WAVE_SLOT_SECONDS of the clock's time the slot being filled is cut and pushed to the
 * front. The rise is shared out between the slots a step crosses by the curve it arrives on: the
 * voice eases exponentially over `attackSeconds` (τ), so by `t` into a step `(1 − e^(−t/τ)) / (1 − e^(−Δ/τ))`
 * of its rise has arrived, whatever the step. A step that cuts more than VOICE_WAVE_SLOTS slots — a
 * stall — writes only the newest of them: the rise that arrived in the cuts before them, and any still
 * gathering in the slot being filled, is dropped, and the slot before them is taken to have decayed by
 * the hold through every one. So a stall never leaves a ring stronger than smooth steps would, and can
 * leave its oldest slots weaker: an 0.8 s stall just as a syllable comes up leaves the oldest at 0.068
 * of a syllable where smooth steps leave 0.092, on a ring about to melt into his shell, after a frame
 * late enough to be a hitch of its own.
 *
 * A step that is not a positive, finite number of seconds changes nothing.
 */
export function advanceVoiceWave(
  wave: VoiceWaveState,
  rise: number,
  deltaSeconds: number,
  attackSeconds: number,
  onsetScale: number,
): VoiceWaveState {
  'worklet';
  if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) {
    return wave;
  }
  const arriving = rise > 0 && Number.isFinite(rise) ? rise : 0;
  const filling = wave.sinceNewest;
  const cuts = Math.floor((filling + deltaSeconds + TIME_SLACK_SECONDS) / VOICE_WAVE_SLOT_SECONDS);
  const whole = 1 - Math.exp(-deltaSeconds / attackSeconds);
  let given = 0;
  let previous = wave.slots[0] ?? 0;
  const firstKept = Math.max(0, cuts - wave.slots.length);
  if (firstKept > 0) {
    // A stall: the cuts before the newest VOICE_WAVE_SLOTS are never seen, so their rise is dropped,
    // and what they would have held decays as the hold would have decayed it.
    given = arrivedShare(Math.min(deltaSeconds, firstKept * VOICE_WAVE_SLOT_SECONDS - filling), whole, attackSeconds);
    wave.rise = 0;
    previous *= HOLD_DECAY ** firstKept;
  }
  for (let cut = firstKept; cut < cuts; cut++) {
    const share = arrivedShare(
      Math.min(deltaSeconds, (cut + 1) * VOICE_WAVE_SLOT_SECONDS - filling),
      whole,
      attackSeconds,
    );
    wave.rise += arriving * (share - given);
    given = share;
    previous = slotAfter(previous, wave.rise, onsetScale);
    pushSlot(wave.slots, previous);
    wave.rise = 0;
  }
  wave.rise += arriving * (1 - given);
  wave.sinceNewest = Math.max(0, filling + deltaSeconds - cuts * VOICE_WAVE_SLOT_SECONDS);
  return wave;
}

/** How far the slot being filled has got, 0–1: how far the rings have travelled since the newest slot was cut. */
export function voiceWavePhaseOf(wave: VoiceWaveState): number {
  'worklet';
  return Math.min(1, Math.max(0, wave.sinceNewest / VOICE_WAVE_SLOT_SECONDS));
}
