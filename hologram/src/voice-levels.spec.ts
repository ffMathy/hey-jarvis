import { describe, expect, it } from 'bun:test';
import {
  AGITATION_RELEASE_SECONDS,
  AGITATION_RISE_SECONDS,
  ATTACK_SECONDS,
  advanceVoiceActivity,
  BURST_REST_SECONDS,
  BURSTS_PER_FLURRY,
  bandEdges,
  CHANGE_WINDOW_SECONDS,
  createVoiceActivityState,
  easeBands,
  easeLevel,
  FULL_BURST_CHANGE,
  foldSpectrum,
  MINIMUM_BURST_SPACING_SECONDS,
  NO_BURST_AGE_SECONDS,
  ONSET_RISE,
  perceivedLevel,
  QUIETEST_LOUD_VOICE,
  QUIETEST_SPEECH,
  RELEASE_SECONDS,
  SPEECH_LEVEL,
  VOICE_BAND_COUNT,
  voiceDrive,
} from './voice-levels';

/** A spectrum the size the SDK hands back, with `fill` for every bin. */
function spectrum(fill: (bin: number) => number, length = 1024): Uint8Array {
  return Uint8Array.from({ length }, (_, bin) => fill(bin));
}

describe('bandEdges', () => {
  it('covers the whole spectrum, in order, with no empty band', () => {
    const edges = bandEdges(1024);

    expect(edges).toHaveLength(VOICE_BAND_COUNT + 1);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(1024);
    for (let band = 0; band < VOICE_BAND_COUNT; band++) {
      expect(edges[band + 1]).toBeGreaterThan(edges[band] ?? 0);
    }
  });

  it('gives the low frequencies narrow bands and the high ones wide bands, as speech needs', () => {
    const edges = bandEdges(1024);
    const firstWidth = (edges[1] ?? 0) - (edges[0] ?? 0);
    const lastWidth = (edges[VOICE_BAND_COUNT] ?? 0) - (edges[VOICE_BAND_COUNT - 1] ?? 0);

    expect(lastWidth).toBeGreaterThan(firstWidth * 10);
  });

  it('still gives every band a bin when the spectrum is barely bigger than the band count', () => {
    const edges = bandEdges(VOICE_BAND_COUNT);

    expect(edges).toEqual(Array.from({ length: VOICE_BAND_COUNT + 1 }, (_, index) => index));
  });
});

describe('foldSpectrum', () => {
  it('folds silence to silence', () => {
    expect(foldSpectrum(spectrum(() => 0))).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
  });

  it('folds a full-scale spectrum to full-scale bands', () => {
    for (const band of foldSpectrum(spectrum(() => 255))) {
      expect(band).toBeCloseTo(1, 5);
    }
  });

  it('folds an empty or undersized spectrum to silence rather than guessing', () => {
    // Before a conversation starts, or before the first native reading, the SDK
    // has nothing — and the hologram should sit idle, not flash.
    expect(foldSpectrum(new Uint8Array(0))).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
    expect(foldSpectrum(new Uint8Array(8))).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
  });

  it('puts a low voice in the low bands and leaves the high bands dark', () => {
    // Energy only in the bottom 40 bins: roughly 100–400 Hz, a voice's fundamental.
    const bands = foldSpectrum(spectrum((bin) => (bin < 40 ? 200 : 0)));

    expect(bands[0]).toBeGreaterThan(0.5);
    expect(bands.at(-1)).toBe(0);
    // Log spacing spreads those 40 bins across many bands, not one or two.
    expect(bands.filter((band) => band > 0.5).length).toBeGreaterThan(VOICE_BAND_COUNT / 4);
  });

  it('lifts quiet energy so a spoken vowel visibly moves the hologram', () => {
    const [band] = foldSpectrum(spectrum(() => 64));

    // 64/255 is a quarter of full scale; the square root makes it half.
    expect(band).toBeCloseTo(Math.sqrt(64 / 255), 5);
    expect(band).toBeGreaterThan(64 / 255);
  });
});

describe('perceivedLevel', () => {
  it('is silent for silence and for readings that are not numbers', () => {
    expect(perceivedLevel(0)).toBe(0);
    expect(perceivedLevel(-0.2)).toBe(0);
    expect(perceivedLevel(Number.NaN)).toBe(0);
  });

  it('spreads ordinary speech volume across the range instead of leaving it near zero', () => {
    expect(perceivedLevel(0.05)).toBeGreaterThan(0.35);
    expect(perceivedLevel(0.15)).toBeGreaterThan(0.65);
  });

  it('never exceeds full scale', () => {
    expect(perceivedLevel(1)).toBe(1);
    expect(perceivedLevel(40)).toBe(1);
  });
});

describe('easeLevel', () => {
  it('rises toward a louder reading faster than it falls back from one', () => {
    const rising = easeLevel(0, 1, 0.05);
    const falling = 1 - easeLevel(1, 0, 0.05);

    expect(rising).toBeGreaterThan(falling);
    expect(ATTACK_SECONDS).toBeLessThan(RELEASE_SECONDS);
  });

  it('lands in the same place however the time is sliced, so frame rate does not change the pulse', () => {
    const oneStep = easeLevel(0.1, 0.9, 1 / 30);
    const twoSteps = easeLevel(easeLevel(0.1, 0.9, 1 / 60), 0.9, 1 / 60);

    expect(twoSteps).toBeCloseTo(oneStep, 10);
  });

  it('never overshoots its target', () => {
    expect(easeLevel(0, 1, 10)).toBeLessThanOrEqual(1);
    expect(easeLevel(1, 0, 10)).toBeGreaterThanOrEqual(0);
  });

  it('does not move when no time has passed, or when the clock hands back nonsense', () => {
    expect(easeLevel(0.4, 1, 0)).toBe(0.4);
    expect(easeLevel(0.4, 1, -1)).toBe(0.4);
    expect(easeLevel(0.4, 1, Number.NaN)).toBe(0.4);
  });
});

describe('easeBands', () => {
  it('eases every band in place and returns the same array', () => {
    const current = [0, 1, 0.5];
    const result = easeBands(current, [1, 0, 0.5], 0.05);

    expect(result).toBe(current);
    expect(current[0]).toBeGreaterThan(0);
    expect(current[1]).toBeLessThan(1);
    expect(current[2]).toBe(0.5);
  });
});

/**
 * Seven seconds of real speech as the app reads it: the perceived level of each
 * 40 ms reading of the line the hologram preview replays, to two decimals —
 * syllables, the dips between them, three pauses, and the silence after.
 */
const SPOKEN_LEVELS = [
  0.28, 0.72, 0.81, 0.6, 0.24, 0.33, 0.55, 0.65, 0.53, 0.41, 0.23, 0.27, 0.35, 0.36, 0.64, 0.59, 0.45, 0.4, 0.34, 0, 0,
  0, 0, 0, 0.32, 0.42, 0.45, 0.59, 0.66, 0.69, 0.59, 0.56, 0.54, 0.35, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.62, 0.6, 0, 0.28,
  0.65, 0.6, 0.29, 0.21, 0.17, 0.22, 0.48, 0.87, 0.81, 0.53, 0.37, 0.17, 0.35, 0.61, 0.52, 0.41, 0.43, 0.34, 0.27, 0.67,
  0.72, 0.3, 0.39, 0.66, 0.68, 0.59, 0.36, 0.33, 0.45, 0.73, 0.48, 0.41, 0.31, 0.24, 0.3, 0.68, 0.72, 0.52, 0.37, 0.19,
  0.36, 0.63, 0.42, 0.32, 0.28, 0.51, 0.63, 0.55, 0.5, 0.42, 0.3, 0.28, 0.57, 0.67, 0.47, 0.42, 0.33, 0, 0, 0, 0, 0.23,
  0.48, 0.64, 0.64, 0.31, 0.29, 0.46, 0.8, 0.86, 0.59, 0.49, 0, 0.24, 0.39, 0.64, 0.69, 0.59, 0.53, 0.38, 0.61, 0.44,
  0.17, 0.19, 0.29, 0.26, 0.28, 0.73, 0.63, 0.09, 0.21, 0.12, 0.19, 0.35, 0.61, 0.47, 0.28, 0.61, 0.82, 0.71, 0.42, 0.2,
  0.2, 0.24, 0.44, 0.62, 0.4, 0.4, 0.39, 0.59, 0.79, 0.77, 0.63, 0.49, 0.49, 0.42, 0.39, 0.4, 0.26, 0, 0, 0, 0, 0, 0, 0,
  0, 0,
];

/** How often the SDK's readers refresh, and so how long each raw level holds. */
const READING_SECONDS = 0.04;

/** When each frame lands, in seconds since the first: frame 1 is the first frame drawn. */
type Clock = (frame: number) => number;

/** Frames `rate` times a second, optionally offset by a fraction of a frame. */
function evenClock(rate: number, phase = 0): Clock {
  return (frame) => (frame + phase) / rate;
}

/** Frames that land unevenly, 5 to 35 ms apart, in the same pattern every run. */
function unevenClock(): Clock {
  const times = [0];
  let seed = 2024;
  return (frame) => {
    while (times.length <= frame) {
      seed = (seed * 16807) % 2147483647;
      times.push((times.at(-1) ?? 0) + 0.005 + (seed / 2147483647) * 0.03);
    }
    return times[frame] ?? 0;
  };
}

/** A raw level that holds each of `levels` for `seconds`, then silence. */
function readings(levels: number[], seconds: number): (time: number) => number {
  // The small nudge keeps a frame that lands exactly on a boundary, like 9/30 of a
  // second, from reading the level before it because 0.3 / 0.1 is 2.9999999999999996.
  return (time) => levels[Math.floor(time / seconds + 1e-9)] ?? 0;
}

/** What the tracker reported after one frame, copied so later frames cannot overwrite it. */
interface ActivityFrame {
  time: number;
  agitation: number;
  burstAge: number;
  burstStrength: number;
  burstCount: number;
}

/** Plays the raw level `levelAt` through a fresh tracker for `seconds`, and keeps every frame. */
function play(levelAt: (time: number) => number, seconds: number, clock: Clock = evenClock(60)): ActivityFrame[] {
  const state = createVoiceActivityState();
  const frames: ActivityFrame[] = [];
  let previousTime = 0;
  for (let frame = 1; clock(frame) <= seconds + 1e-9; frame++) {
    const time = clock(frame);
    advanceVoiceActivity(state, levelAt(time), time - previousTime);
    previousTime = time;
    const { agitation, burstAge, burstStrength, burstCount } = state;
    frames.push({ time, agitation, burstAge, burstStrength, burstCount });
  }
  return frames;
}

/** The frames on which a burst began. */
function burstsIn(frames: ActivityFrame[]): ActivityFrame[] {
  return frames.filter((frame, index) => frame.burstCount > (frames[index - 1]?.burstCount ?? 0));
}

/** The frame that landed at `time`. */
function frameAt(frames: ActivityFrame[], time: number): ActivityFrame {
  const frame = frames.find((candidate) => Math.abs(candidate.time - time) < 1e-6);
  if (!frame) {
    throw new Error(`No frame landed at ${time} s`);
  }
  return frame;
}

/** A level that climbs from silence to `level` over a second — too slowly for an onset — and then holds. */
function swellTo(level: number): (time: number) => number {
  return (time) => level * Math.min(1, time);
}

/** Seconds between each burst and the one before it. */
function spacingsOf(bursts: ActivityFrame[]): number[] {
  return bursts.slice(1).map((burst, index) => burst.time - (bursts[index]?.time ?? 0));
}

/** The mean of `values`. */
function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/** Agitation averaged over time rather than over frames, so an uneven clock is weighed fairly. */
function meanAgitation(frames: ActivityFrame[]): number {
  let weighted = 0;
  frames.forEach((frame, index) => {
    weighted += frame.agitation * (frame.time - (frames[index - 1]?.time ?? 0));
  });
  return weighted / (frames.at(-1)?.time ?? 1);
}

describe('createVoiceActivityState', () => {
  it('starts calm, with no burst yet, and holds nothing but numbers', () => {
    const state = createVoiceActivityState();

    expect(state.agitation).toBe(0);
    expect(state.burstAge).toBeGreaterThanOrEqual(10);
    expect(state.burstAge).toBe(NO_BURST_AGE_SECONDS);
    expect(state.burstStrength).toBe(0);
    expect(state.burstCount).toBe(0);
    // A shared value copies its contents between runtimes; plain finite numbers
    // are the one shape that always survives the trip.
    for (const value of Object.values(state)) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('hands out a fresh state each time, so two holograms never share one', () => {
    expect(createVoiceActivityState()).not.toBe(createVoiceActivityState());
  });
});

describe('voiceDrive', () => {
  it('fills the range for a quiet voice and for a loud one alike', () => {
    // The point of it: a microphone that never gets past a fifth of full scale should still
    // drive the sphere as hard as one that reaches the top, because the user's evidently does
    // not, and the sphere answering the absolute number is why they saw almost no change.
    expect(voiceDrive(0.12, 0.12)).toBeCloseTo(1, 9);
    expect(voiceDrive(0.8, 0.8)).toBeCloseTo(1, 9);
    // and half as loud as this voice gets is half the answer, either way
    expect(voiceDrive(0.06, 0.12)).toBeCloseTo(0.5, 9);
    expect(voiceDrive(0.4, 0.8)).toBeCloseTo(0.5, 9);
  });

  it('will not amplify a hiss into a voice', () => {
    // A silent room's hiss is the loudest thing in a silent room. Without a floor under what
    // counts as loud, it would drive the sphere as hard as shouting does.
    expect(voiceDrive(0.02, 0.02)).toBeLessThan(0.2);
    expect(voiceDrive(0.04, 0.04)).toBeLessThanOrEqual(QUIETEST_LOUD_VOICE * 3);
  });

  it('never reports more than full, whatever it is given', () => {
    expect(voiceDrive(1, 0.1)).toBe(1);
    expect(voiceDrive(0.5, 0)).toBe(1);
    expect(voiceDrive(0, 0.5)).toBe(0);
    expect(voiceDrive(Number.NaN, 0.5)).toBe(0);
  });
});

describe('advanceVoiceActivity', () => {
  describe('in silence', () => {
    it('stays calm: no agitation and no bursts, however long it lasts', () => {
      const frames = play(() => 0, 10);

      expect(frames.every((frame) => frame.agitation === 0 && frame.burstCount === 0)).toBe(true);
      expect(frames.at(-1)?.burstStrength).toBe(0);
      expect(frames.at(-1)?.burstAge).toBeCloseTo(NO_BURST_AGE_SECONDS + 10, 6);
    });

    it('is not stirred by a quiet room flickering below speech level', () => {
      // Sample mode listens through the microphone, and a room is never silent:
      // a hiss that jumps to a new, scattered level every reading, but stays
      // under QUIETEST_SPEECH — the floor below which nothing counts as a voice
      // however quiet the voice it is being compared with. It used to be pinned
      // under SPEECH_LEVEL, which a quiet microphone's speech now sits below.
      const hiss = (time: number) => {
        const reading = Math.floor(time / READING_SECONDS);
        const scatter = Math.abs(Math.sin(reading * 12.9898) * 43758.5453) % 1;
        return 0.005 + (QUIETEST_SPEECH - 0.01) * scatter;
      };
      const frames = play(hiss, 10);

      expect(Math.max(...frames.map((frame) => frame.agitation))).toBe(0);
      expect(frames.at(-1)?.burstCount).toBe(0);
    });
  });

  describe('agitation', () => {
    it('builds over AGITATION_RISE_SECONDS once speech starts, and goes no higher than 1', () => {
      const frames = play((time) => (time < 1 ? 0 : 0.5), 2, evenClock(120));

      expect(frameAt(frames, 1).agitation).toBe(0);
      expect(frameAt(frames, 1 + AGITATION_RISE_SECONDS / 2).agitation).toBeCloseTo(0.5, 9);
      expect(frameAt(frames, 1 + AGITATION_RISE_SECONDS).agitation).toBeCloseTo(1, 9);
      expect(Math.max(...frames.map((frame) => frame.agitation))).toBe(1);
    });

    it('settles over AGITATION_RELEASE_SECONDS once speech stops, and goes no lower than 0', () => {
      const frames = play((time) => (time < 1 ? 0.5 : 0), 3, evenClock(120));

      expect(frameAt(frames, 1).agitation).toBe(1);
      expect(frameAt(frames, 1 + AGITATION_RELEASE_SECONDS / 2).agitation).toBeCloseTo(0.5, 9);
      expect(frameAt(frames, 1 + AGITATION_RELEASE_SECONDS).agitation).toBeCloseTo(0, 9);
      expect(Math.min(...frames.map((frame) => frame.agitation))).toBe(0);
    });

    it('is the same for a whisper as for a shout, because the film shows no loudness meter', () => {
      const whisper = play(() => SPEECH_LEVEL, 2).map((frame) => frame.agitation);
      const shout = play(() => 0.95, 2).map((frame) => frame.agitation);

      expect(shout).toEqual(whisper);
    });

    it('rides through the short pauses between words instead of calming at each one', () => {
      // Words of 220 ms with 80 ms of silence between them.
      const frames = play((time) => (time % 0.3 < 0.22 ? 0.5 : 0), 3);
      const afterFirstWord = frames.filter((frame) => frame.time >= 0.3);

      expect(Math.min(...afterFirstWord.map((frame) => frame.agitation))).toBeGreaterThanOrEqual(
        1 - 0.1 / AGITATION_RELEASE_SECONDS,
      );
    });
  });

  describe('onsets', () => {
    it('throw one burst the frame the rise is seen, as strong as the rise', () => {
      const frames = play((time) => (time < 1 ? 0 : 0.45), 2);
      const bursts = burstsIn(frames);

      expect(bursts).toHaveLength(1);
      expect(bursts[0]?.time).toBeCloseTo(1, 9);
      expect(bursts[0]?.burstAge).toBe(0);
      expect(bursts[0]?.burstStrength).toBeCloseTo(0.45 / FULL_BURST_CHANGE, 9);
      expect(frames.at(-1)?.burstAge).toBeCloseTo(1, 6);
    });

    it('need a rise of at least ONSET_RISE', () => {
      const level = 0.3;
      const tooSmall = play((time) => (time < 2 ? swellTo(level)(time) : level + ONSET_RISE - 0.02), 3);
      const bigEnough = play((time) => (time < 2 ? swellTo(level)(time) : level + ONSET_RISE + 0.02), 3);

      expect(burstsIn(tooSmall)).toHaveLength(0);
      expect(burstsIn(bigEnough)).toHaveLength(1);
      expect(burstsIn(bigEnough)[0]?.burstStrength).toBeCloseTo((ONSET_RISE + 0.02) / FULL_BURST_CHANGE, 9);
    });

    it('count a syllable that rises over two readings, wherever the frames fall at 30 Hz or faster', () => {
      // 0.2 → 0.34 → 0.48: each step is too small alone, the two together are not.
      const level = (time: number) => (time < 2 ? swellTo(0.2)(time) : time < 2 + READING_SECONDS ? 0.34 : 0.48);
      const phases = [0, 0.2, 0.4, 0.6, 0.8, 0.99];
      const clocks = [30, 60, 120].flatMap((rate) => phases.map((phase) => evenClock(rate, phase)));
      for (const clock of clocks) {
        const bursts = burstsIn(play(level, 3, clock));

        expect(bursts).toHaveLength(1);
        expect(bursts[0]?.time).toBeGreaterThanOrEqual(2 + READING_SECONDS);
        expect(bursts[0]?.time).toBeLessThan(2 + READING_SECONDS + 1 / 30);
      }
    });

    it('forget a quiet moment once it is older than CHANGE_WINDOW_SECONDS', () => {
      // A climb in two steps, neither an onset on its own, together well past one.
      // Held for one reading, the silence is still in view when the second step
      // comes; held for longer than the window and a frame, it is not.
      const step = ONSET_RISE * 0.6;
      const twoSteps = (holdSeconds: number) => (time: number) =>
        time < 1 ? 0 : time < 1 + holdSeconds ? step : step * 2;
      for (const clock of [evenClock(30), evenClock(60, 0.5), evenClock(120)]) {
        expect(burstsIn(play(twoSteps(READING_SECONDS), 2, clock))).toHaveLength(1);
        expect(burstsIn(play(twoSteps(CHANGE_WINDOW_SECONDS + 1 / 30), 2, clock))).toHaveLength(0);
      }
    });

    it('are not thrown by a slow swell, however far it climbs', () => {
      expect(burstsIn(play(swellTo(0.9), 3))).toHaveLength(0);
    });
  });

  describe('gaps', () => {
    /** Speech that swells to `level`, holds it, and at two seconds falls by `decibels` in one reading. */
    const fallAfterSpeech = (level: number, decibels: number) => (time: number) =>
      time < 2 ? swellTo(level)(time) : level * 10 ** (-decibels / 40);

    it('throw a burst when the voice falls by more than 10 dB straight after speech', () => {
      const bursts = burstsIn(play(fallAfterSpeech(0.6, 11), 3));

      expect(bursts).toHaveLength(1);
      expect(bursts[0]?.time).toBeCloseTo(2, 9);
      expect(bursts[0]?.burstStrength).toBeCloseTo((0.6 - 0.6 * 10 ** (-11 / 40)) / FULL_BURST_CHANGE, 9);
    });

    it('are not thrown by a fall of less than 10 dB', () => {
      expect(burstsIn(play(fallAfterSpeech(0.6, 9), 3))).toHaveLength(0);
    });

    it('throw a full-strength burst when speech stops dead, like the one after "Doc-"', () => {
      const bursts = burstsIn(play((time) => (time < 2 ? swellTo(0.6)(time) : 0), 3));

      expect(bursts).toHaveLength(1);
      expect(bursts[0]?.burstStrength).toBe(1);
    });

    it('need speech before them: a sound too quiet to be a voice, stopping, throws nothing', () => {
      // Below QUIETEST_SPEECH rather than below SPEECH_LEVEL. What counts as speech is judged
      // against how loud this voice gets, since the user's microphone hands over an ordinary
      // speaking voice at 0.08 — so a steady 0.14 is no longer "a murmur", it is the loudest
      // thing in the room and therefore whoever is talking. What stays true at any input level
      // is that something under the floor is the room, not a person.
      const tooQuiet = QUIETEST_SPEECH - 0.01;

      expect(burstsIn(play((time) => (time < 2 ? tooQuiet : 0), 3))).toHaveLength(0);
    });

    it('are not thrown by a slow fade to silence', () => {
      const fade = (time: number) => (time < 2 ? swellTo(0.6)(time) : Math.max(0, 0.6 * (1 - (time - 2) / 2)));

      expect(burstsIn(play(fade, 5))).toHaveLength(0);
    });
  });

  describe('spacing', () => {
    it('throws a flurry a spacing apart and then rests, however fast the syllables come', () => {
      // A change every 60 ms, alternately an onset and a gap.
      const frames = play((time) => (Math.floor(time / 0.06) % 2 === 0 ? 0.1 : 0.8), 6);
      const bursts = burstsIn(frames);
      const spacings = spacingsOf(bursts);

      expect(spacings.length).toBeGreaterThan(5);
      expect(Math.min(...spacings)).toBeGreaterThanOrEqual(MINIMUM_BURST_SPACING_SECONDS - 1e-9);
      // Never more than a flurry's worth in a rest's length, wherever the rest is measured from.
      for (const burst of bursts) {
        const together = bursts.filter(
          (other) => other.time >= burst.time && other.time < burst.time + BURST_REST_SECONDS,
        );
        expect(together.length).toBeLessThanOrEqual(BURSTS_PER_FLURRY);
      }
      // The first change once the rest is up throws the next flurry: no more than
      // one change interval later, plus a frame of lateness at each end.
      expect(Math.max(...spacings)).toBeLessThanOrEqual(BURST_REST_SECONDS + 0.06 + 2 / 60 + 1e-9);
    });

    it('lets a change that comes too soon go, rather than throwing it late', () => {
      // An onset at 1 s bursts. The gap 200 ms later is too soon — and it must not
      // burst at 1.25 s either, when the spacing is up but the gap is still recent.
      const frames = play((time) => (time >= 1 && time < 1.2 ? 0.6 : 0), 3, evenClock(120));
      const bursts = burstsIn(frames);

      expect(bursts).toHaveLength(1);
      expect(bursts[0]?.time).toBeCloseTo(1, 9);
    });

    it('bursts on syllables until the flurry is full, then waits out the rest', () => {
      // Ten syllables of 150 ms, each followed by 150 ms of silence. Every gap,
      // 150 ms after its onset, comes too soon; the onsets are far enough apart.
      const frames = play(
        readings(
          Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? 0.6 : 0)),
          0.15,
        ),
        3.2,
      );
      const bursts = burstsIn(frames);
      const spacings = spacingsOf(bursts);

      // Four syllables fill a flurry, and the 0.6 s rest that follows swallows the
      // next two: syllables one to four burst, five and six are lost to the rest,
      // seven to ten burst, and the line ends inside the second rest.
      expect(bursts).toHaveLength(BURSTS_PER_FLURRY * 2);
      expect(bursts.every((burst) => burst.burstStrength === 1)).toBe(true);
      // Every burst but the first lands on a syllable, and flurries alternate with rests.
      bursts.slice(1).forEach((burst) => {
        expect(burst.time / 0.3).toBeCloseTo(Math.round(burst.time / 0.3), 9);
      });
      spacings.forEach((spacing, index) => {
        if (index % BURSTS_PER_FLURRY === BURSTS_PER_FLURRY - 1) {
          expect(spacing).toBeGreaterThanOrEqual(BURST_REST_SECONDS - 1e-9);
        } else {
          expect(spacing).toBeLessThan(BURST_REST_SECONDS);
        }
      });
    });
  });

  describe('burst strength, age and count', () => {
    it('grows with the size of the change, up to full strength', () => {
      const strengths = [0.3, 0.45, 0.6, 0.9].map(
        (peak) => burstsIn(play((time) => (time < 0.5 ? 0 : peak), 1))[0]?.burstStrength ?? Number.NaN,
      );

      expect(strengths[0]).toBeCloseTo(0.3 / FULL_BURST_CHANGE, 9);
      expect(strengths[1]).toBeCloseTo(0.45 / FULL_BURST_CHANGE, 9);
      expect(strengths[2]).toBe(1);
      expect(strengths[3]).toBe(1);
    });

    it('keeps the latest strength as the burst ages, and ages it by exactly the time that passed', () => {
      const frames = play((time) => (time < 0.5 ? 0 : 0.45), 1.5);
      const burstIndex = frames.findIndex((frame) => frame.burstCount === 1);
      const after = frames.slice(burstIndex);

      after.forEach((frame, framesSince) => {
        expect(frame.burstStrength).toBeCloseTo(0.45 / FULL_BURST_CHANGE, 9);
        expect(frame.burstAge).toBeCloseTo(framesSince / 60, 9);
        expect(frame.burstCount).toBe(1);
      });
    });

    it('counts every burst, one at a time', () => {
      const frames = play(readings(SPOKEN_LEVELS, READING_SECONDS), 8);

      frames.forEach((frame, index) => {
        expect([0, 1]).toContain(frame.burstCount - (frames[index - 1]?.burstCount ?? 0));
      });
      expect(frames.at(-1)?.burstCount).toBe(burstsIn(frames).length);
    });
  });

  describe('real speech', () => {
    it('bursts in flurries while he talks and stops once he is silent', () => {
      const frames = play(readings(SPOKEN_LEVELS, READING_SECONDS), 9);
      const bursts = burstsIn(frames);
      const speechEnds = (SPOKEN_LEVELS.findLastIndex((level) => level > 0) + 1) * READING_SECONDS;
      // A flurry, then a rest: at most BURSTS_PER_FLURRY every rest plus the
      // spacings inside the flurry, which is about one and a third a second.
      const flurryPeriod = BURST_REST_SECONDS + (BURSTS_PER_FLURRY - 1) * MINIMUM_BURST_SPACING_SECONDS;

      expect(bursts.length / speechEnds).toBeGreaterThan(0.8);
      expect(bursts.length / speechEnds).toBeLessThanOrEqual(BURSTS_PER_FLURRY / flurryPeriod + 1e-9);
      // Nothing bursts after the frame that sees him stop, which may throw the
      // gap at the end of the line...
      expect(bursts.every((burst) => burst.time <= speechEnds + 1 / 60 + 1e-9)).toBe(true);
      // ...and the sphere is calm again one release, and a frame, later.
      const settled = frames.filter((frame) => frame.time >= speechEnds + AGITATION_RELEASE_SECONDS + 1 / 60);
      expect(settled.length).toBeGreaterThan(0);
      expect(settled.every((frame) => frame.agitation === 0)).toBe(true);
    });

    it('is agitated through most of the line, dips and all', () => {
      const speechEnds = (SPOKEN_LEVELS.findLastIndex((level) => level > 0) + 1) * READING_SECONDS;

      expect(meanAgitation(play(readings(SPOKEN_LEVELS, READING_SECONDS), speechEnds))).toBeGreaterThan(0.8);
    });
  });

  describe('frame rate', () => {
    it('gives the same agitation and bursts at 30, 60 and 120 Hz when every change lands on a frame', () => {
      // Readings of 100 ms start on a frame at all three rates, so each rate sees
      // every change at the same moment. Some changes burst; others come too soon.
      const tenthsOfASecond = [
        0, 0, 0.6, 0.6, 0.6, 0.2, 0.2, 0.2, 0.7, 0.7, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.15, 0.45, 0.45,
      ];
      const level = readings([...tenthsOfASecond, 0.45, 0.1, 0, 0, 0, 0.9, 0.3, 0.3, 0, 0], 0.1);
      const at30 = play(level, 3.5, evenClock(30));
      const at60 = play(level, 3.5, evenClock(60));
      const at120 = play(level, 3.5, evenClock(120));

      const bursts = burstsIn(at30);
      // A flurry at 0.2, 0.5, 0.8 and 1.4; the silence from 1.0 to 1.4 is four tenths long, which
      // ends that flurry, so 1.7 opens a new one rather than being swallowed by a rest. Then
      // 2.1, 2.5 and 2.8. The changes at 1.0, 2.2 and 2.6 come too soon after the one before.
      expect(bursts.map((burst) => Number(burst.time.toFixed(6)))).toEqual([0.2, 0.5, 0.8, 1.4, 1.7, 2.1, 2.5, 2.8]);
      expect(bursts.map((burst) => Number(burst.burstStrength.toFixed(6)))).toEqual(
        [0.6, 0.4, 0.5, 0.5, 0.35, 0.35, 0.6, 0.3].map((change) => Number((change / FULL_BURST_CHANGE).toFixed(6))),
      );
      at30.forEach((frame, index) => {
        for (const other of [at60[2 * index + 1], at120[4 * index + 3]]) {
          expect(other?.time).toBeCloseTo(frame.time, 9);
          expect(other?.agitation).toBeCloseTo(frame.agitation, 9);
          expect(other?.burstCount).toBe(frame.burstCount);
          expect(other?.burstStrength).toBeCloseTo(frame.burstStrength, 9);
          expect(other?.burstAge).toBeCloseTo(frame.burstAge, 9);
        }
      });
    });

    it('keeps agitation in real speech within what one 30 Hz frame of lateness can explain', () => {
      // Readings every 40 ms do not land on 30 Hz frames, so 30 Hz can see speech
      // start or stop up to a frame after 120 Hz does. For that frame one can be
      // rising while the other is still falling, and no longer.
      const level = readings(SPOKEN_LEVELS, READING_SECONDS);
      const at30 = play(level, 8, evenClock(30));
      const at120 = play(level, 8, evenClock(120));
      const oneFrameApart = (1 / 30) * (1 / AGITATION_RISE_SECONDS + 1 / AGITATION_RELEASE_SECONDS);

      at30.forEach((frame, index) => {
        const other = at120[4 * index + 3];
        expect(other?.time).toBeCloseTo(frame.time, 9);
        expect(Math.abs(frame.agitation - (other?.agitation ?? Number.NaN))).toBeLessThanOrEqual(oneFrameApart + 1e-9);
      });
    });

    it('keeps how often real speech bursts, how hard, and how agitated it leaves the sphere, at any frame rate', () => {
      const level = readings(SPOKEN_LEVELS, READING_SECONDS);
      const reference = play(level, 8, evenClock(120));
      const referenceBursts = burstsIn(reference);
      const referenceStrength = mean(referenceBursts.map((burst) => burst.burstStrength));
      const clocks = [30, 60, 90, 144].flatMap((rate) => [evenClock(rate), evenClock(rate, 0.5)]).concat(unevenClock());

      for (const clock of clocks) {
        const frames = play(level, 8, clock);
        const bursts = burstsIn(frames);

        // A frame of lateness can decide whether a change falls just inside the
        // spacing or just outside it, so which syllables burst may differ, but
        // not so that anyone could see it: the count stays within a few bursts
        // in twenty...
        expect(Math.abs(bursts.length - referenceBursts.length)).toBeLessThanOrEqual(referenceBursts.length * 0.15);
        expect(Math.min(...spacingsOf(bursts))).toBeGreaterThanOrEqual(MINIMUM_BURST_SPACING_SECONDS - 1e-9);
        // ...their average strength within a tenth, and the sphere's average agitation within a fiftieth.
        expect(Math.abs(mean(bursts.map((burst) => burst.burstStrength)) - referenceStrength)).toBeLessThan(0.1);
        expect(Math.abs(meanAgitation(frames) - meanAgitation(reference))).toBeLessThan(0.02);
      }
    });
  });

  describe('bad input', () => {
    it('treats a reading that is not a finite number, or is below zero, as silence', () => {
      const speechThen = (after: number) => (time: number) => (time < 1 ? swellTo(0.6)(time) : after);
      const silence = play(speechThen(0), 2);

      for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.5]) {
        expect(play(speechThen(nonsense), 2)).toEqual(silence);
      }
    });

    it('treats a reading above full scale as full scale', () => {
      expect(play(() => 7, 1)).toEqual(play(() => 1, 1));
    });

    it('does nothing for a step that is zero, negative or not a finite number of seconds', () => {
      const state = advanceVoiceActivity(createVoiceActivityState(), 0.6, 0.5);
      const before = { ...state };

      for (const step of [0, -0.016, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(advanceVoiceActivity(state, 0.9, step)).toBe(state);
        expect(state).toEqual(before);
      }
    });

    it('takes a long stall as one long frame: the voice before it held throughout, and the one after starts now', () => {
      // The app was in the background and the next frame came five seconds later.
      const speaking = () => {
        const state = createVoiceActivityState();
        for (let frame = 1; frame <= 90; frame++) {
          advanceVoiceActivity(state, swellTo(0.6)(frame / 60), 1 / 60);
        }
        return state;
      };

      // A voice that is still going afterwards throws nothing, and only ages the last burst.
      const stillSpeaking = speaking();
      const { burstCount, burstAge } = stillSpeaking;
      advanceVoiceActivity(stillSpeaking, 0.6, 5);
      expect(stillSpeaking.agitation).toBe(1);
      expect(stillSpeaking.burstCount).toBe(burstCount);
      expect(stillSpeaking.burstAge).toBeCloseTo(burstAge + 5, 9);

      // A voice that has stopped by then is a gap seen now, and it settles from now.
      const stopped = speaking();
      advanceVoiceActivity(stopped, 0, 5);
      expect(stopped.burstCount).toBe(burstCount + 1);
      expect(stopped.burstAge).toBe(0);
      expect(stopped.agitation).toBe(1);
      advanceVoiceActivity(stopped, 0, AGITATION_RELEASE_SECONDS);
      expect(stopped.agitation).toBe(0);
    });
  });

  it('changes the state in place, adds nothing to it, and keeps every value a finite number', () => {
    const state = createVoiceActivityState();
    const keys = Object.keys(state);
    const level = readings(SPOKEN_LEVELS, READING_SECONDS);

    for (let frame = 1; frame <= 600; frame++) {
      expect(advanceVoiceActivity(state, level(frame / 60), 1 / 60)).toBe(state);
    }
    expect(Object.keys(state)).toEqual(keys);
    expect(Object.values(state).every((value) => Number.isFinite(value))).toBe(true);
    expect(state.burstCount).toBeGreaterThan(0);
  });
});
