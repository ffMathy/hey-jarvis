import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, type FrameClockState, hologramFrameOf } from './frame-clock';
import { READ_INTERVAL_MS, VOICE_WAVE_SLEW, VOICE_WAVE_SLOT_SECONDS, VOICE_WAVE_SLOTS } from './frame-timing';
import { createSimulatedSpectrum, fillSimulatedSpectrum, type SimulatedMood } from './simulated-voice';
import { simulatedVolume } from './voice-analysis';
import {
  ATTACK_SECONDS,
  advanceVoiceActivity,
  createVoiceActivityState,
  easeBands,
  foldSpectrum,
  perceivedLevel,
  QUIETEST_SPEECH,
  speakingThreshold,
  VOICE_BAND_COUNT,
} from './voice-levels';
import {
  advanceVoiceWave,
  syllableRise,
  VOICE_WAVE_HOLD_SECONDS,
  VOICE_WAVE_ONSET_SCALE,
  voiceWavePhaseOf,
} from './voice-wave';

/** How often the voice is read: the phone's timer and the headset's clock both read it this often. */
const READING_SECONDS = READ_INTERVAL_MS / 1000;

/** What a slot keeps of the one before it, at the most it may fall: `e^(−slot / hold)`. */
const HOLD_DECAY = Math.exp(-VOICE_WAVE_SLOT_SECONDS / VOICE_WAVE_HOLD_SECONDS);

/**
 * How often the slot series below are sampled: a fifth of a second lands on a frame at 30, 60 and
 * 120 Hz alike, and on a slot boundary, so every rate is read at the very same moments.
 */
const SAMPLE_SECONDS = 0.2;
/** How many slots are cut between two samples. */
const SLOTS_PER_SAMPLE = Math.round(SAMPLE_SECONDS / VOICE_WAVE_SLOT_SECONDS);

/** A floor far under every voice and hiss here, for showing what the speech gate keeps out. */
const FLOOR_UNDER_EVERYTHING = 0.02;

/** What one reading of his voice hands the clock: its level and its bands, as the app works them out. */
interface VoiceReading {
  level: number;
  bands: number[];
}

/** A voice: what a reading taken at `seconds` says. */
type Voice = (seconds: number) => VoiceReading;

/** No voice at all. Nothing writes it: the clock eases its own bands toward a target, never the target. */
const SILENCE: VoiceReading = { level: 0, bands: new Array<number>(VOICE_BAND_COUNT).fill(0) };

/** A spectrum read as the app reads one: its mean as the volume, through perceivedLevel, and folded into bands. */
function readSpectrum(spectrum: Uint8Array): VoiceReading {
  return { level: perceivedLevel(simulatedVolume(spectrum)), bands: foldSpectrum(spectrum) };
}

/** One of sample mode's made-up voices, spectrum and all, so it goes through every step a real voice does. */
function simulatedVoice(mood: SimulatedMood): Voice {
  const spectrum = createSimulatedSpectrum();
  return (seconds) => readSpectrum(fillSimulatedSpectrum(mood, seconds, spectrum));
}

/** When the made-up speech is loudest in its first seconds: a vowel well inside a syllable. */
const LOUD_VOWEL_SECONDS = 1.08;

/** One loud moment of the made-up speech, to be held as a vowel. */
function loudVowel(): VoiceReading {
  return simulatedVoice('speaking')(LOUD_VOWEL_SECONDS);
}

/** Silence until `stepSeconds`, then `vowel` held for good: one step up, onto speech. */
function stepOnto(vowel: VoiceReading, stepSeconds: number): Voice {
  return (seconds) => (seconds < stepSeconds - 1e-9 ? SILENCE : vowel);
}

/** A number in 0–1 that is the same for the same whole number every run, as voice-levels.spec.ts's hiss scatters. */
function scatter(seed: number): number {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

/** How many bins a quiet room lights in each reading, among how many of the lowest, and how brightly. */
const HISS_SPECKS = 4;
const HISS_LOWEST_BINS = 48;
const HISS_DIMMEST = 60;
const HISS_SPREAD = 100;

/**
 * A quiet room through the microphone: a few of the lowest bins lit at random, afresh every reading.
 * The narrow bands at the bottom of the spectrum jump about as sharply as a syllable's do, but four
 * specks of at most 160 are a mean of at most 0.63 of a byte, which perceivedLevel takes to under
 * 0.09 — under QUIETEST_SPEECH, whatever the scatter does.
 */
function roomHiss(): Voice {
  const spectrum = createSimulatedSpectrum();
  return (seconds) => {
    const reading = Math.round(seconds / READING_SECONDS);
    spectrum.fill(0);
    for (let speck = 0; speck < HISS_SPECKS; speck++) {
      const seed = reading * HISS_SPECKS + speck;
      spectrum[Math.floor(scatter(seed) * HISS_LOWEST_BINS)] =
        HISS_DIMMEST + Math.round(HISS_SPREAD * scatter(seed + 0.5));
    }
    return readSpectrum(spectrum);
  };
}

/** When each frame lands, in seconds since the first: frame 1 is the first frame drawn. */
type Clock = (frame: number) => number;

/** Frames `rate` times a second. */
function evenClock(rate: number): Clock {
  return (frame) => frame / rate;
}

/** The same numbers in 0–1 for the same seed, every run (Park and Miller's generator). */
function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

/** Frames that land unevenly, 5 to 35 ms apart, in the same pattern every run. */
function unevenClock(): Clock {
  const random = seededRandom(2024);
  const times = [0];
  return (frame) => {
    while (times.length <= frame) {
      times.push((times.at(-1) ?? 0) + 0.005 + random() * 0.03);
    }
    return times[frame] ?? 0;
  };
}

/** How a voice is played through the clock, beyond what is played and how fast. */
interface Playing {
  /** The clock to step; a fresh one, at the tracker's default floor, unless given. */
  state?: FrameClockState;
  /** The moment whose reading a frame at `time` holds; the frame's own moment unless given. */
  readingHeldAt?: (time: number) => number;
  /** Called after every frame, with the clock as it now stands. */
  onFrame?: (state: FrameClockState) => void;
}

/** What his recent syllables were after one frame, copied so later frames cannot overwrite it. */
interface WaveFrame {
  time: number;
  slots: number[];
  phase: number;
  rise: number;
}

/**
 * Plays `voice` through the real frame clock for `seconds`, as the app does: a reading every
 * READING_SECONDS of the clock's time, each frame easing toward the latest one, and keeps every frame.
 */
function play(voice: Voice, seconds: number, clock: Clock, playing: Playing = {}): WaveFrame[] {
  const state = playing.state ?? createFrameClockState();
  const readingHeldAt = playing.readingHeldAt ?? ((time: number) => time);
  const frames: WaveFrame[] = [];
  let previousTime = 0;
  let readingNumber = -1;
  let reading = SILENCE;
  for (let frame = 1; clock(frame) <= seconds + 1e-9; frame++) {
    const time = clock(frame);
    // The nudge keeps a frame that lands exactly on a reading, like 0.12 s, from holding the one
    // before it because 0.12 / 0.04 is 2.9999999999999996.
    const heldReading = Math.floor(readingHeldAt(time) / READING_SECONDS + 1e-9);
    if (heldReading !== readingNumber) {
      readingNumber = heldReading;
      reading = voice(heldReading * READING_SECONDS);
    }
    advanceFrameClock(state, time - previousTime, reading.level, reading.bands, true, false, false, 0, 0);
    previousTime = time;
    playing.onFrame?.(state);
    frames.push({ time, slots: [...state.wave.slots], phase: voiceWavePhaseOf(state.wave), rise: state.wave.rise });
  }
  return frames;
}

/** The frame that landed at `time`. */
function frameAt(frames: WaveFrame[], time: number): WaveFrame {
  const frame = frames.find((candidate) => Math.abs(candidate.time - time) < 1e-9);
  if (!frame) {
    throw new Error(`No frame landed at ${time} s`);
  }
  return frame;
}

/** The largest slot any of `frames` held. */
function largestSlotIn(frames: WaveFrame[]): number {
  return frames.reduce((largest, frame) => Math.max(largest, ...frame.slots), 0);
}

/** Where in the ring the largest slot is, counted from the front. */
function largestSlotOf(slots: number[]): number {
  return slots.indexOf(Math.max(...slots));
}

/** Whether the ring holds one pulse: it climbs to its largest slot from either end and never dips on the way. */
function isOnePulse(slots: number[]): boolean {
  const peak = largestSlotOf(slots);
  return slots.every((value, slot) => {
    if (slot < peak) {
      return value <= (slots[slot + 1] ?? Number.NaN);
    }
    if (slot > peak) {
      return value <= (slots[slot - 1] ?? Number.NaN);
    }
    return true;
  });
}

/**
 * Every slot the clock cut, oldest first: at each sample the slots cut since the one before are the
 * newest SLOTS_PER_SAMPLE in the ring.
 */
function everySlotCut(frames: WaveFrame[]): number[] {
  const series: number[] = [];
  for (const frame of frames) {
    const sample = Math.round(frame.time / SAMPLE_SECONDS);
    if (Math.abs(frame.time - sample * SAMPLE_SECONDS) > 1e-9) {
      continue;
    }
    // A sample lands on a slot boundary, so the slot being filled has only just begun. If it has
    // not, the series would skip or repeat a slot, and every comparison of it would mean nothing.
    if (frame.phase > 1e-4) {
      throw new Error(`No slot was cut at ${frame.time} s; the phase there is ${frame.phase}`);
    }
    series.push(...frame.slots.slice(0, SLOTS_PER_SAMPLE).reverse());
  }
  return series;
}

/** Every two neighbouring slots any of `frames` held, the newer of them first. */
function neighboursIn(frames: WaveFrame[]): { newer: number; older: number }[] {
  return frames.flatMap((frame) =>
    frame.slots.slice(1).map((older, slot) => ({ newer: frame.slots[slot] ?? Number.NaN, older })),
  );
}

/** How far `later`'s bands rose above `earlier`'s, summed: what a syllable's start is made of. */
function summedRiseBetween(earlier: number[], later: number[]): number {
  return totalOf(later.map((band, index) => Math.max(0, band - (earlier[index] ?? 0))));
}

/** The sum of `values`. */
function totalOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

/** The lag-0 correlation of two series of the same length (Pearson's). */
function correlationOf(first: number[], second: number[]): number {
  if (first.length !== second.length) {
    throw new Error(`Series of ${first.length} and ${second.length} values cannot be correlated`);
  }
  const firstMean = totalOf(first) / first.length;
  const secondMean = totalOf(second) / second.length;
  let together = 0;
  let firstSpread = 0;
  let secondSpread = 0;
  first.forEach((value, index) => {
    const firstOffset = value - firstMean;
    const secondOffset = (second[index] ?? Number.NaN) - secondMean;
    together += firstOffset * secondOffset;
    firstSpread += firstOffset * firstOffset;
    secondSpread += secondOffset * secondOffset;
  });
  return together / Math.sqrt(firstSpread * secondSpread);
}

describe('his recent syllables, as the frame clock keeps them', () => {
  it('writes nothing but zeros for silence, or for a hiss that never reaches speech, however long it lasts', () => {
    const silence = play(() => SILENCE, 10, evenClock(60));

    expect(largestSlotIn(silence)).toBe(0);
    expect(silence.every((frame) => frame.rise === 0)).toBe(true);

    const hiss = roomHiss();
    const readings = Array.from({ length: 10 / READING_SECONDS }, (_, reading) => hiss(reading * READING_SECONDS));
    // Under the floor at every reading, as voice-levels.spec.ts's hiss is...
    expect(Math.max(...readings.map((reading) => reading.level))).toBeLessThan(QUIETEST_SPEECH);
    // ...yet its bands jump from one reading to the next by more than half of what makes a syllable,
    // so it is the speech gate that keeps it out of the ring, not the hiss being too gentle to register.
    const largestJump = Math.max(
      ...readings.slice(1).map((reading, index) => summedRiseBetween(readings[index]?.bands ?? [], reading.bands)),
    );
    expect(largestJump).toBeGreaterThan(VOICE_WAVE_ONSET_SCALE / 2);

    const hissed = play(hiss, 10, evenClock(60));
    expect(largestSlotIn(hissed)).toBe(0);
    expect(hissed.every((frame) => frame.rise === 0)).toBe(true);

    // The same hiss against a floor under it does send rings out: the gate is the whole difference.
    const ungated = play(hiss, 10, evenClock(60), { state: createFrameClockState(FLOOR_UNDER_EVERYTHING) });
    expect(largestSlotIn(ungated)).toBeGreaterThan(0.2);
  });

  it('writes one pulse for a step up onto a held vowel, which travels one slot further out every VOICE_WAVE_SLOT_SECONDS at 30, 60 and 120 Hz, and adds nothing more while the vowel holds', () => {
    const vowel = loudVowel();
    // A loud vowel, well past the floor, whose bands arrive out of silence as a sharp onset.
    expect(vowel.level).toBeGreaterThan(QUIETEST_SPEECH * 5);
    expect(totalOf(vowel.bands)).toBeGreaterThan(VOICE_WAVE_ONSET_SCALE * 5);
    // The step lands on a frame at every rate, and on a reading.
    const stepSeconds = 1;
    const sampleTimes = [1.2, 1.4, 1.6];
    const largestAt120 = sampleTimes.map((time) =>
      largestSlotOf(frameAt(play(stepOnto(vowel, stepSeconds), 1.6, evenClock(120)), time).slots),
    );

    for (const rate of [30, 60, 120]) {
      const frames = play(stepOnto(vowel, stepSeconds), 4, evenClock(rate));
      const largest = sampleTimes.map((time) => largestSlotOf(frameAt(frames, time).slots));

      // One slot further out every VOICE_WAVE_SLOT_SECONDS: SLOTS_PER_SAMPLE between samples...
      expect(largest.slice(1).map((slot, index) => slot - (largest[index] ?? Number.NaN))).toEqual([
        SLOTS_PER_SAMPLE,
        SLOTS_PER_SAMPLE,
      ]);
      // ...and frame by frame in between, where the phase carries it from one slot to the next: the
      // pulse's distance from the front, in slots, grows by exactly one per VOICE_WAVE_SLOT_SECONDS.
      const travelling = frames.filter((frame) => frame.time >= 1.2 - 1e-9 && frame.time <= 1.6 + 1e-9);
      const behindTheClock = (frame: WaveFrame) =>
        largestSlotOf(frame.slots) + frame.phase - frame.time / VOICE_WAVE_SLOT_SECONDS;
      for (const frame of travelling) {
        expect(behindTheClock(frame)).toBeCloseTo(behindTheClock(travelling[0] ?? frame), 4);
      }
      // A clock eases toward a reading over the whole step that ends at the frame first holding it, so
      // a change can land up to a frame — under a slot even at 30 Hz — earlier at one rate than another.
      largest.forEach((slot, index) => {
        expect(Math.abs(slot - (largestAt120[index] ?? Number.NaN))).toBeLessThanOrEqual(1);
      });

      // One pulse, and a full one, at every frame of it: the ring climbs to its crest and falls away.
      expect(frames.every((frame) => isOnePulse(frame.slots))).toBe(true);
      expect(Math.max(...frameAt(frames, 1.4).slots)).toBeGreaterThan(0.5);
      // Once the crest is cut, the vowel adds nothing: no new slot is ever larger than the one before it...
      const afterTheCrest = frames.filter((frame) => frame.time >= 1.2 - 1e-9);
      expect(afterTheCrest.every((frame) => (frame.slots[0] ?? Number.NaN) <= (frame.slots[1] ?? Number.NaN))).toBe(
        true,
      );
      // ...and three seconds into it the bands have arrived, and the pulse has left the ring.
      const last = frames.at(-1);
      expect(last?.rise).toBeLessThan(1e-12);
      expect(Math.max(...(last?.slots ?? [Number.NaN]))).toBeLessThan(1e-9);
    }
  });

  it('cuts the greeting into the same slots at 30, 60 and 120 Hz, but for the frame of lateness every reading has', () => {
    const seconds = 8;
    const greeting = simulatedVoice('greeting');
    const at120 = everySlotCut(play(greeting, seconds, evenClock(120)));
    // A greeting's worth of syllables, so the comparisons below are of rings, not of near silence.
    expect(at120).toHaveLength((seconds / SAMPLE_SECONDS) * SLOTS_PER_SAMPLE);
    expect(Math.max(...at120)).toBeGreaterThan(0.5);
    expect(at120.filter((slot) => slot > 0.05).length).toBeGreaterThan(at120.length / 3);

    for (const rate of [30, 60]) {
      const atRate = everySlotCut(play(greeting, seconds, evenClock(rate)));

      // The slots themselves do not depend on the frame rate at all. A 120 Hz clock that picks each
      // reading up when this rate's does — so its bands ease along the very same curve — cuts the
      // very same slots, to the last few bits: the rise is shared out on the clock's own time.
      const pickedUpAtThisRate = everySlotCut(
        play(greeting, seconds, evenClock(120), { readingHeldAt: (time) => Math.ceil(time * rate - 1e-9) / rate }),
      );
      atRate.forEach((slot, index) => {
        expect(slot).toBeCloseTo(pickedUpAtThisRate[index] ?? Number.NaN, 12);
      });

      // What does differ is the input: a clock eases toward a reading over the whole step that ends at
      // the frame first holding it, so at a slower rate each syllable's bands start rising up to a
      // frame sooner — at 30 Hz up to 0.83 of a slot. The slots stay within what that explains: as
      // much like 120 Hz's as a 120 Hz clock handed every reading a whole frame of this rate early...
      const aWholeFrameEarly = everySlotCut(
        play(greeting, seconds, evenClock(120), { readingHeldAt: (time) => time + 1 / rate - 1 / 120 }),
      );
      expect(correlationOf(atRate, at120)).toBeGreaterThan(correlationOf(aWholeFrameEarly, at120));
      // ...and as strong overall, within 15%.
      expect(Math.abs(totalOf(atRate) / totalOf(at120) - 1)).toBeLessThan(0.15);
    }

    // At 60 Hz a frame is under half a slot, and its series correlates with 120 Hz's above 0.98 outright.
    expect(correlationOf(everySlotCut(play(greeting, seconds, evenClock(60))), at120)).toBeGreaterThan(0.98);
  });

  it('keeps only the newest VOICE_WAVE_SLOTS slots across a 2.5 s stall, so an onset at its very start is gone, and leaves the phase inside 0 to 1', () => {
    const vowel = loudVowel();
    // Stepped smoothly, the same onset writes a crest well up the ring...
    const smooth = createFrameClockState();
    const smoothFrames = play(stepOnto(vowel, 1), 3.5, evenClock(120), { state: smooth });
    expect(largestSlotIn(smoothFrames)).toBeGreaterThan(0.5);

    // ...but as the first moment of a stall — the app in the background, the next frame 2.5 s on —
    // it is sixty-two slots old by the end of the step, and only the newest VOICE_WAVE_SLOTS are kept.
    const stalled = createFrameClockState();
    play(() => SILENCE, 1, evenClock(60), { state: stalled });
    const slots = stalled.wave.slots;
    advanceFrameClock(stalled, 2.5, vowel.level, vowel.bands, true, false, false, 0, 0);

    expect(stalled.wave.slots).toBe(slots);
    expect(slots).toHaveLength(VOICE_WAVE_SLOTS);
    expect(Math.max(...slots)).toBeLessThan(1e-6);
    // What it keeps is what a smoothly stepped clock holds at the same moment: the newest slots.
    slots.forEach((slot, index) => {
      expect(slot).toBeCloseTo(smooth.wave.slots[index] ?? Number.NaN, 6);
    });
    // 3.5 s is 87.5 slots: half the way through the slot being filled, as it is for the smooth clock.
    const phase = voiceWavePhaseOf(stalled.wave);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(phase).toBeCloseTo(0.5, 6);
    expect(phase).toBeCloseTo(voiceWavePhaseOf(smooth.wave), 6);
  });

  it('never lets a slot rise more than VOICE_WAVE_SLEW above the one before it, or fall faster than the hold lets it, in the greeting and in speech', () => {
    const clocks = [evenClock(30), evenClock(60), evenClock(120), unevenClock()];
    const neighbours = (['greeting', 'speaking'] as const).flatMap((mood) =>
      clocks.flatMap((clock) => neighboursIn(play(simulatedVoice(mood), 6, clock))),
    );
    const steepestRise = neighbours.reduce(
      (steepest, { newer, older }) => Math.max(steepest, newer - older),
      Number.NEGATIVE_INFINITY,
    );
    const closestToTheHold = neighbours.reduce(
      (closest, { newer, older }) => Math.min(closest, newer - older * HOLD_DECAY),
      Number.POSITIVE_INFINITY,
    );
    // Measured only where there is something to fall from, since nought over nought says nothing.
    const fastestFall = neighbours
      .filter(({ older }) => older > 0.01)
      .reduce((fastest, { newer, older }) => Math.min(fastest, newer / older), Number.POSITIVE_INFINITY);

    // Newer minus older: the steps a ring's specks are pushed in, which is what keeps them from passing each other.
    expect(steepestRise).toBeLessThanOrEqual(VOICE_WAVE_SLEW + 1e-12);
    expect(closestToTheHold).toBeGreaterThanOrEqual(-1e-12);
    // Both limits are reached, so neither holds only because these voices happened to be gentle.
    expect(steepestRise).toBeCloseTo(VOICE_WAVE_SLEW, 9);
    expect(fastestFall).toBeCloseTo(HOLD_DECAY, 9);
  });

  it('writes its slots in place, in the array the frame hands the drawing, and keeps every field a finite number and every slot within 0 to 1', () => {
    const state = createFrameClockState();
    const wave = state.wave;
    const slots = wave.slots;
    const fields = Object.keys(wave);
    let framesChecked = 0;
    const inspect = (stepped: FrameClockState) => {
      // A frame allocates nothing on the UI thread: the drawing is handed the clock's own array.
      expect(stepped.wave).toBe(wave);
      expect(stepped.wave.slots).toBe(slots);
      expect(hologramFrameOf(stepped).voiceWave).toBe(slots);
      expect(Object.keys(stepped.wave)).toEqual(fields);
      expect(slots).toHaveLength(VOICE_WAVE_SLOTS);
      // A shared value copies plain finite numbers between runtimes and nothing else survives the trip.
      expect(Number.isFinite(stepped.wave.sinceNewest)).toBe(true);
      expect(Number.isFinite(stepped.wave.rise)).toBe(true);
      expect(slots.every((slot) => Number.isFinite(slot) && slot >= 0 && slot <= 1)).toBe(true);
      const phase = voiceWavePhaseOf(stepped.wave);
      expect(phase >= 0 && phase <= 1).toBe(true);
      framesChecked += 1;
    };

    play(simulatedVoice('greeting'), 4, unevenClock(), { state, onFrame: inspect });
    const vowel = loudVowel();
    advanceFrameClock(state, 2.5, vowel.level, vowel.bands, true, false, false, 0, 0);
    inspect(state);
    play(simulatedVoice('speaking'), 4, evenClock(144), { state, onFrame: inspect });
    expect(advanceVoiceWave(wave, 0.5, 0.01)).toBe(wave);
    inspect(state);

    expect(framesChecked).toBeGreaterThan(700);
    expect(Math.max(...slots)).toBeGreaterThan(0);
  });

  it('writes nothing for the thinking voice, which never passes the speech gate', () => {
    const thinking = simulatedVoice('thinking');
    const hum = thinking(1);
    // A hum under the floor, that still reaches his bands: out of silence its first reading is a rise
    // the gate has to keep out.
    expect(hum.level).toBeLessThan(QUIETEST_SPEECH);
    expect(totalOf(hum.bands)).toBeGreaterThan(1);

    const frames = play(thinking, 10, evenClock(60));
    expect(largestSlotIn(frames)).toBe(0);
    expect(frames.every((frame) => frame.rise === 0)).toBe(true);

    // Against a floor under the hum, the same voice does send a ring out: the gate is the whole difference.
    const ungated = play(thinking, 10, evenClock(60), { state: createFrameClockState(FLOOR_UNDER_EVERYTHING) });
    expect(largestSlotIn(ungated)).toBeGreaterThan(0);
  });
});

describe('advanceVoiceWave and syllableRise, given a step that is not one', () => {
  it('changes nothing for a step that is not a positive, finite number of seconds, and finds no rise in one', () => {
    const state = createFrameClockState();
    // Fourteen frames into the greeting at 60 Hz, as its second syllable comes up.
    play(simulatedVoice('greeting'), 14 / 60, evenClock(60), { state });
    const wave = state.wave;
    // Mid-slot, mid-rise and with rings in the ring, so there is something for a bad step to spoil.
    expect(wave.sinceNewest).toBeGreaterThan(0);
    expect(wave.rise).toBeGreaterThan(0);
    expect(Math.max(...wave.slots)).toBeGreaterThan(0);
    const before = { ...wave, slots: [...wave.slots] };
    const vowel = loudVowel();
    const silentBands = new Array<number>(VOICE_BAND_COUNT).fill(0);

    for (const step of [0, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(advanceVoiceWave(wave, 2, step)).toBe(wave);
      expect(wave).toEqual(before);
      expect(syllableRise(silentBands, vowel.bands, vowel.level, createVoiceActivityState(), step)).toBe(0);
    }
    // The same rise over a real frame is plainly there.
    expect(syllableRise(silentBands, vowel.bands, vowel.level, createVoiceActivityState(), 1 / 60)).toBeGreaterThan(0);
  });
});

describe('syllableRise', () => {
  it('is the positive half of what easeBands adds on speech, and nothing below the speech threshold', () => {
    const random = seededRandom(7);
    const randomBands = () => Array.from({ length: VOICE_BAND_COUNT }, () => random());
    const activity = createVoiceActivityState();
    const threshold = speakingThreshold(activity.loudest, activity.quietestSpeech);

    for (let trial = 0; trial < 200; trial++) {
      const bands = randomBands();
      const targets = randomBands();
      const level = threshold + (1 - threshold) * random();
      const deltaSeconds = 0.001 + 0.1 * random();
      const untouched = [...bands];

      const rise = syllableRise(bands, targets, level, activity, deltaSeconds);

      // Taken before the bands are eased, and without touching them.
      expect(bands).toEqual(untouched);
      const gap = totalOf(bands.map((band, index) => Math.max(0, (targets[index] ?? 0) - band)));
      expect(rise).toBeCloseTo(gap * (1 - Math.exp(-deltaSeconds / ATTACK_SECONDS)), 12);
      // The same thing, as what easeBands actually adds: every band it raises, by how much.
      const eased = easeBands([...bands], targets, deltaSeconds);
      expect(rise).toBeCloseTo(totalOf(eased.map((band, index) => Math.max(0, band - (bands[index] ?? 0)))), 12);
    }

    // Judged as the voice tracker judges speech: after half a second of a loud voice, the threshold is
    // a share of how loud it got, well above the floor.
    const rememberingALoudVoice = createVoiceActivityState();
    for (let frame = 0; frame < 30; frame++) {
      advanceVoiceActivity(rememberingALoudVoice, 0.8, 1 / 60);
    }
    const loudThreshold = speakingThreshold(rememberingALoudVoice.loudest, rememberingALoudVoice.quietestSpeech);
    expect(loudThreshold).toBeGreaterThan(QUIETEST_SPEECH * 1.5);
    const silentBands = new Array<number>(VOICE_BAND_COUNT).fill(0);
    const fullBands = new Array<number>(VOICE_BAND_COUNT).fill(1);
    for (let trial = 0; trial < 50; trial++) {
      const belowIt = loudThreshold * 0.999 * random();
      expect(syllableRise(silentBands, fullBands, belowIt, rememberingALoudVoice, 1 / 60)).toBe(0);
    }
    // Above the floor but under a quarter of that voice is still not speech for it...
    expect(syllableRise(silentBands, fullBands, QUIETEST_SPEECH * 1.2, rememberingALoudVoice, 1 / 60)).toBe(0);
    // ...the threshold itself is, as it is for the tracker...
    expect(syllableRise(silentBands, fullBands, loudThreshold, rememberingALoudVoice, 1 / 60)).toBeGreaterThan(0);
    // ...and with no voice remembered, the floor alone decides.
    expect(syllableRise(silentBands, fullBands, QUIETEST_SPEECH * 0.99, createVoiceActivityState(), 1 / 60)).toBe(0);
    expect(syllableRise(silentBands, fullBands, QUIETEST_SPEECH, createVoiceActivityState(), 1 / 60)).toBeGreaterThan(
      0,
    );
  });
});
