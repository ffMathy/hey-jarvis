/**
 * Voices that are not there: what Jarvis looks like when nobody is talking to him.
 *
 * Sample mode can show the sphere answering a real microphone, which is the point of it — but a
 * microphone only ever shows one of the things he does, and only if you talk. These are the
 * others, generated from the clock alone: a voice speaking, and the hum of a mind working. Both are
 * written as *spectra*, the same 1024 bytes across 100–8000 Hz that a microphone or the ElevenLabs SDK
 * hands over, so they go through every step a real voice does — the fold into bands, the easing,
 * the agitation envelope, the bursts — and nothing downstream knows the difference.
 *
 * Everything here is a function of time alone. No state, no random number generator: the same
 * second always produces the same spectrum, which is what lets the tests pin these and what keeps
 * two hologram views on one screen in step.
 *
 * No `'worklet'` directives, unlike the rest of this package. These run where a voice is read —
 * the JS thread, every 40 ms — and never on the UI thread.
 */

import { SPECTRUM_BIN_COUNT } from './voice-analysis';

/** What the sphere is being asked to look like. `idle` needs no spectrum: it is silence. */
export type SimulatedMood = 'speaking' | 'thinking';

/** One syllable's worth of time. Speech is a string of these, some of them silent. */
const SYLLABLE_SECONDS = 0.26;

/** How many syllables before the speaker takes a breath, and how long that breath is. */
const SYLLABLES_PER_PHRASE = 11;
const BREATH_SECONDS = 0.75;

/**
 * How loud thinking hums between ticks, and how loud a tick is — as means of the spectrum.
 *
 * How loud thinking hums, as a mean of the spectrum.
 *
 * It looks absurdly small, and that is the curve between here and the tracker: `perceivedLevel`
 * takes the square root and multiplies by 1.8, so a mean of 0.0022 arrives as 0.08. The gates are
 * 0.1 on a phone and 0.2 in a browser, so it is under both and the sphere stays calm. Anything set
 * by eye in raw terms here lands in the wrong place — the first version was 0.075, which arrives
 * as 0.49 and left the sphere fully agitated the whole time it was supposed to be quietly
 * thinking.
 */
const THINKING_HUM = 0.0022;

/**
 * The loudest a syllable gets, again as a mean of the spectrum: 0.25, which arrives as 0.9.
 *
 * Not 1. A voice that saturates on every syllable gives the drawing nothing to tell a loud one
 * from a quiet one with, and the glow is meant to breathe over a sentence.
 */
const SPEAKING_LOUDEST = 0.25;

/**
 * A repeatable number in 0–1 for a whole number.
 *
 * Not a random generator: the same input always gives the same output, for ever. That is what
 * makes a simulated voice a function of the clock rather than of how long the page has been open.
 */
function hash(value: number): number {
  let mixed = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 0x100000000;
}

/** A hump centred on `middle` and `width` wide, in normalised spectrum position. */
function hump(position: number, middle: number, width: number): number {
  const offset = (position - middle) / width;
  return Math.exp(-offset * offset);
}

/**
 * How loud this moment of speech is, 0–1, and which syllable it belongs to.
 *
 * Time is cut into syllable-length slots. Each slot is either sounded or silent, and how loud it
 * is and how it is coloured come from its number — so the rhythm is irregular, as speech is, and
 * the same every time. Every eleventh slot is a breath, which is what keeps it from sounding like
 * a metronome: without it the sphere pulsed on a beat and read as a machine rather than a voice.
 */
function syllableAt(seconds: number): { loudness: number; slot: number } {
  const slot = Math.floor(seconds / SYLLABLE_SECONDS);
  const into = seconds - slot * SYLLABLE_SECONDS;
  const place = slot % (SYLLABLES_PER_PHRASE + Math.round(BREATH_SECONDS / SYLLABLE_SECONDS));

  if (place >= SYLLABLES_PER_PHRASE) {
    return { loudness: 0, slot };
  }

  const roll = hash(slot);
  // Three syllables in ten are a gap between words rather than a sound.
  if (roll < 0.3) {
    return { loudness: 0, slot };
  }

  // Quick on, slower off, and never quite the same twice.
  const length = SYLLABLE_SECONDS * (0.55 + 0.4 * hash(slot + 977));
  const share = into / length;
  const envelope = share >= 1 ? 0 : share < 0.18 ? share / 0.18 : 1 - (share - 0.18) / 0.82;
  return { loudness: (0.45 + 0.55 * hash(slot + 313)) * envelope, slot };
}

/**
 * Fills `spectrum` with what this mood sounds like at `seconds`.
 *
 * `spectrum` must be {@link SPECTRUM_BIN_COUNT} long — the same array every time, written in
 * place, because this is read sixty times a second and a fresh kilobyte each frame is a kilobyte
 * for the collector to take back.
 */
export function fillSimulatedSpectrum(mood: SimulatedMood, seconds: number, spectrum: Uint8Array): Uint8Array {
  const last = spectrum.length - 1;
  const shape = mood === 'speaking' ? speakingShape(seconds) : thinkingShape();

  // Twice over the bins, because the loudness that matters is the *mean* of the spectrum — that is
  // what a browser reports as a volume, and what every gate in the tracker is calibrated against —
  // and a shape cannot be scaled to a mean without first knowing its own. Once to measure it, once
  // to write it. Nothing is kept between calls: a scratch buffer would make this stateful, and the
  // whole point of these is that the same second always gives the same spectrum.
  let total = 0;
  for (let index = 0; index <= last; index++) {
    total += shape.at(index / last);
  }
  const mean = total / spectrum.length;
  const scale = mean === 0 ? 0 : (255 * shape.loudness) / mean;

  for (let index = 0; index <= last; index++) {
    spectrum[index] = Math.min(255, Math.round(shape.at(index / last) * scale));
  }
  return spectrum;
}

/** A spectrum's colour, as a function of position across it, and how loud the whole should be. */
interface Shape {
  loudness: number;
  at: (position: number) => number;
}

/**
 * A voice: a broad tilted floor with two formants riding on it, moving from syllable to syllable.
 *
 * Broad, rather than two humps on nothing, because a byte spectrum is on a decibel scale and a
 * real voice fills it — and because the reading everything is judged by is the mean of all 1024
 * bins. A narrow hump normalised to a speaking mean would be scaled until it clipped flat.
 */
function speakingShape(seconds: number): Shape {
  const { loudness, slot } = syllableAt(seconds);
  // Where the two formants sit moves from syllable to syllable, which is what makes one sound like
  // a different vowel from the next: the bands light in a different place each time.
  const first = 0.09 + 0.07 * hash(slot + 41);
  const second = 0.26 + 0.16 * hash(slot + 7919);
  return {
    loudness: SPEAKING_LOUDEST * loudness,
    at: (position) =>
      0.55 * Math.exp(-position * 1.1) + hump(position, first, 0.08) + 0.72 * hump(position, second, 0.13),
  };
}

/**
 * A mind working, as far as a *voice* is concerned: almost nothing.
 *
 * Thinking is not a voice, and since the sphere gained a thinking state of its own — the plane
 * sweeping up through it, see `SCAN_SECONDS` — it does not need to pretend to be one. What is left
 * here is a hum well under every gate that decides what counts as speech, so the sphere neither
 * glows nor swells nor throws chips.
 *
 * It does not try to make the bands do anything either. At this loudness a byte spectrum has one
 * or two levels of resolution to play with, so any pattern put in it is quantisation noise dressed
 * up as a signal — and there is no need: what thinking looks like is drawn, not heard.
 *
 * It used to tick once a pass, loudly enough to make the tracker throw a chip burst. That was a
 * voice imitating a thought, and the user was right that it was not enough: bursts are what speech
 * does. The ring blooming out of the core at the end of each pass replaces it, and that is drawn
 * rather than heard.
 */
function thinkingShape(): Shape {
  return { loudness: THINKING_HUM, at: (position) => Math.exp(-position * 1.4) };
}

/**
 * The volume that goes with a spectrum: its mean, 0–1.
 *
 * The same quantity a browser reports — see `sample-voice.web.ts` — rather than the RMS a phone
 * measures, because a simulated voice has no waveform to take an RMS of. The moods above are
 * pitched so that it does not matter which gate they are judged against.
 */
export function simulatedVolume(spectrum: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < spectrum.length; index++) {
    sum += spectrum[index] ?? 0;
  }
  return spectrum.length === 0 ? 0 : sum / spectrum.length / 255;
}

/** A spectrum of the right size to hand {@link fillSimulatedSpectrum}. */
export function createSimulatedSpectrum(): Uint8Array {
  return new Uint8Array(SPECTRUM_BIN_COUNT);
}
