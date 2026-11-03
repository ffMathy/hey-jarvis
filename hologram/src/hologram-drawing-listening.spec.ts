import { describe, expect, it } from 'bun:test';
import { advanceFrameClock, createFrameClockState, hologramFrameOf } from './frame-clock';
import { VOICE_WAVE_SLOTS } from './frame-timing';
import {
  analyseFrame,
  CORE_X,
  CORE_Y,
  HEARD_WAVE_FROM,
  HEARD_WAVE_GONE,
  type HologramFrame,
  type HologramFrameState,
  LATTICE_BREATH,
  LATTICE_SPACING,
  LATTICE_STROKE_SHRINK,
  LATTICE_TURN,
  latticeSpacing,
  latticeStrokeShare,
  latticeTarget,
  VOICE_WAVE_FULL_CROWDING,
  VOICE_WAVE_REACH,
} from './hologram-drawing';
import { VOICE_BAND_COUNT } from './voice-levels';

/**
 * How he listens, at the user's asking ("The listening animation doesn't move much with the voice.
 * Perhaps spice it up and make it better"): the lattice swells with how loud they are now, on no
 * clock of its own, and each syllable they say flows in through it from his edge to his core as a
 * ring of its knots, pulled in and crowded into a line that gets its strokes' length back. Driven
 * here through the real frame clock, as the phone's and the headset's frames are, and how it looks
 * is the headset's browser tests' to say.
 */

const SIZE = 256;

function frameAt(overrides: Partial<HologramFrame>): HologramFrame {
  return {
    time: 12.3,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0),
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: 1,
    presence: 1,
    thinking: 0,
    hearing: 1,
    hearingLevel: 0.6,
    ...overrides,
  };
}

function fraction(value: number) {
  return value - Math.floor(value);
}

/**
 * The knot of the slowly turning hexagonal lattice nearest (`x`, `y`), as the lattice has always
 * snapped it, at the spacing `latticeSpacing` gives: what a knot is before any ring of theirs moves it.
 */
function snappedKnot(x: number, y: number, id: number, state: HologramFrameState): [number, number] {
  const turn = state.time * LATTICE_TURN;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const spacing = LATTICE_SPACING * (1 + LATTICE_BREATH * state.hearingLevel);
  const localX = x * cos + y * sin;
  const localY = y * cos - x * sin;
  const rowHeight = spacing * 0.866;
  const row = Math.round(localY / rowHeight);
  const shift = row % 2 === 0 ? 0 : spacing / 2;
  const column = Math.round((localX - shift) / spacing);
  const jitter = (fraction(id * 7.7113) - 0.5) * 0.018;
  const snappedX = column * spacing + shift + jitter;
  const snappedY = row * rowHeight + jitter;
  return [snappedX * cos - snappedY * sin, snappedY * cos + snappedX * sin];
}

/** Points across the whole of him, a little closer together than the lattice's knots. */
const ACROSS_HIM: [number, number][] = [];
for (let x = -0.95; x <= 0.95; x += 0.017) {
  for (let y = -0.95; y <= 0.95; y += 0.017) {
    if (x * x + y * y <= 0.95 * 0.95) ACROSS_HIM.push([x, y]);
  }
}

/** One knot of the lattice, where it is snapped and where their rings have pulled it, and how crowded it is there. */
interface PulledKnot {
  knot: [number, number];
  pulled: [number, number];
  crowding: number;
}

/** Every knot the points across him snap to this frame, before and after their rings pull it. */
function knotsOf(state: HologramFrameState): PulledKnot[] {
  const out = [Number.NaN, Number.NaN, Number.NaN];
  return ACROSS_HIM.map(([x, y]) => {
    latticeTarget(x, y, 0.5, state, out);
    return {
      knot: snappedKnot(x, y, 0.5, state),
      pulled: [out[0] ?? Number.NaN, out[1] ?? Number.NaN],
      crowding: out[2] ?? Number.NaN,
    };
  });
}

const fromCore = ([x, y]: [number, number]) => Math.hypot(x - CORE_X, y - CORE_Y);

/**
 * The frames a frame clock hands the drawing at 60 a second while someone talks to him: the score
 * saying they speak from the start, their loudness at 0.1 and then, at `onset`, up to 0.7 — one
 * syllable — and held there. Each frame copied, since the clock's are only good until its next step.
 */
function oneSyllableHeard(onset: number, seconds: number): { time: number; frame: HologramFrame }[] {
  const clock = createFrameClockState();
  const silent = new Array<number>(VOICE_BAND_COUNT).fill(0);
  const frames: { time: number; frame: HologramFrame }[] = [];
  for (let step = 1; step <= Math.round(seconds * 60); step++) {
    const time = step / 60;
    advanceFrameClock(clock, 1 / 60, 0, silent, false, false, false, 1, time < onset - 1e-9 ? 0.1 : 0.7);
    const frame = hologramFrameOf(clock);
    frames.push({
      time,
      frame: { ...frame, bands: [...frame.bands], voiceWave: [], heardWave: [...(frame.heardWave ?? [])] },
    });
  }
  return frames;
}

describe('the listening lattice', () => {
  it('swells with how loud they are now, and with nothing else: no clock of its own', () => {
    const spacings = [0, 0.3, 0.6, 1].map((hearingLevel) => {
      const atEveryMoment = [0, 1.3, 7.77, 12.3, 40.2].map((time) =>
        latticeSpacing(analyseFrame(frameAt({ time, hearingLevel }), SIZE)),
      );
      // The same at every moment for the same loudness, where it once breathed on a sine of its own.
      for (const spacing of atEveryMoment) expect(spacing).toBe(atEveryMoment[0] ?? Number.NaN);
      expect(atEveryMoment[0]).toBeCloseTo(LATTICE_SPACING * (1 + LATTICE_BREATH * hearingLevel), 15);
      return atEveryMoment[0] ?? Number.NaN;
    });
    // Louder, wider; and in silence, LATTICE_SPACING itself.
    expect(spacings[0]).toBe(LATTICE_SPACING);
    for (let louder = 1; louder < spacings.length; louder++) {
      expect(spacings[louder]).toBeGreaterThan(spacings[louder - 1] ?? Number.NaN);
    }
  });

  it('leaves every knot where the lattice snaps it while none of their syllables is in flight', () => {
    const fullSlots = new Array<number>(VOICE_WAVE_SLOTS).fill(1);
    for (const frame of [
      frameAt({}),
      frameAt({ heardWave: new Array<number>(VOICE_WAVE_SLOTS).fill(0), heardWavePhase: 0.4 }),
      // Their syllables, but nobody heard: the lattice is not up.
      frameAt({ hearing: 0, heardWave: fullSlots, heardWavePhase: 0.4 }),
      // Their syllables, while he is still forming: held back, as his are.
      frameAt({ appearance: 0.6, heardWave: fullSlots, heardWavePhase: 0.4 }),
    ]) {
      const state = analyseFrame(frame, SIZE);
      expect(state.heardWaveLargest).toBe(0);
      for (const { knot, pulled, crowding } of knotsOf(state)) {
        expect(pulled).toEqual(knot);
        expect(crowding).toBe(0);
      }
    }
  });

  it('sends each of their syllables in through it, from his edge toward his core', () => {
    const onset = 1;
    const frames = oneSyllableHeard(onset, 1.5);
    // Where the ring is: how far from the core the knots it pulls lie, weighted by how far it pulls them.
    const crestOf = (frame: HologramFrame) => {
      let weighted = 0;
      let pulledBy = 0;
      let strongest = 0;
      for (const { knot, pulled } of knotsOf(analyseFrame(frame, SIZE))) {
        const pull = fromCore(knot) - fromCore(pulled);
        weighted += fromCore(knot) * pull;
        pulledBy += pull;
        strongest = Math.max(strongest, pull);
      }
      return { crest: weighted / pulledBy, strongest };
    };
    const crests = [1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45].map((time) => {
      const at = frames.find((candidate) => Math.abs(candidate.time - time) < 1e-9);
      if (!at) throw new Error(`no frame at ${time} s`);
      return crestOf(at.frame);
    });
    // A real ring all the way, pulling knots a visible way in, and over 0.06R at its height.
    for (const { strongest } of crests) expect(strongest).toBeGreaterThan(0.01);
    expect(Math.max(...crests.map(({ strongest }) => strongest))).toBeGreaterThan(0.06);
    // Born near his edge, it travels in, frame on frame...
    expect(crests[0]?.crest).toBeGreaterThan(0.7);
    expect(crests[0]?.crest).toBeLessThan(HEARD_WAVE_FROM);
    for (let later = 1; later < crests.length; later++) {
      expect(crests[later]?.crest).toBeLessThan(crests[later - 1]?.crest ?? Number.NaN);
    }
    // ...a good way toward his core in a third of a second.
    expect((crests[0]?.crest ?? Number.NaN) - (crests.at(-1)?.crest ?? Number.NaN)).toBeGreaterThan(0.25);
    expect(crests.at(-1)?.crest).toBeGreaterThan(HEARD_WAVE_GONE);
  });

  it('pulls a knot only in toward the core along its line, and never past HEARD_WAVE_GONE', () => {
    // Every slot a full syllable, at every phase, and the real ring of one syllable frame by frame.
    const fullSlots = new Array<number>(VOICE_WAVE_SLOTS).fill(1);
    const frames = [
      ...Array.from({ length: 11 }, (_, step) => frameAt({ heardWave: fullSlots, heardWavePhase: step / 10 })),
      ...oneSyllableHeard(1, 1.8)
        .filter((_, index) => index % 4 === 0)
        .map(({ frame }) => frame),
    ];
    let pulledFar = 0;
    for (const frame of frames) {
      const state = analyseFrame(frame, SIZE);
      expect(state.heardWaveLargest).toBeLessThanOrEqual(VOICE_WAVE_REACH);
      for (const { knot, pulled } of knotsOf(state)) {
        const before = fromCore(knot);
        const after = fromCore(pulled);
        if (before <= HEARD_WAVE_GONE || before >= HEARD_WAVE_FROM) {
          // Outside where their rings travel, nothing moves.
          expect(pulled).toEqual(knot);
          continue;
        }
        expect(after).toBeLessThanOrEqual(before + 1e-12);
        expect(after).toBeGreaterThan(HEARD_WAVE_GONE);
        // Along the line from the core: the same way from it, only nearer.
        const across = (knot[0] - CORE_X) * (pulled[1] - CORE_Y) - (knot[1] - CORE_Y) * (pulled[0] - CORE_X);
        expect(Math.abs(across)).toBeLessThan(1e-12);
        if (before - after > 0.05) pulledFar++;
      }
    }
    expect(pulledFar).toBeGreaterThan(100);
  });

  it('gives the knots a ring of theirs crowds together their strokes’ length back', () => {
    // The lattice shrinks a stroke so a knot reads as a point, and a crest crowded to
    // VOICE_WAVE_FULL_CROWDING or more gets all of it back, so each ring is a line of light.
    for (const hearing of [0, 0.4, 1]) {
      expect(latticeStrokeShare(hearing, 0)).toBeCloseTo(1 - LATTICE_STROKE_SHRINK * hearing, 15);
      expect(latticeStrokeShare(hearing, -0.3)).toBe(latticeStrokeShare(hearing, 0));
      expect(latticeStrokeShare(hearing, VOICE_WAVE_FULL_CROWDING)).toBe(1);
      expect(latticeStrokeShare(hearing, 0.9)).toBe(1);
      for (let crowding = 0.01; crowding <= VOICE_WAVE_FULL_CROWDING; crowding += 0.01) {
        expect(latticeStrokeShare(hearing, crowding)).toBeGreaterThanOrEqual(
          latticeStrokeShare(hearing, crowding - 0.01),
        );
      }
    }

    // And a real syllable's ring does crowd its crest that far: some knots get all their length back.
    const crowdest = Math.max(
      ...oneSyllableHeard(1, 1.5)
        .filter(({ time }) => time > 1.1 && time < 1.45)
        .flatMap(({ frame }) => knotsOf(analyseFrame(frame, SIZE)).map(({ crowding }) => crowding)),
    );
    expect(crowdest).toBeGreaterThan(VOICE_WAVE_FULL_CROWDING);
  });

  it('holds their rings back until he has formed, as far as the lattice is up, and leaves his own alone', () => {
    const fullSlots = new Array<number>(VOICE_WAVE_SLOTS).fill(1);
    expect(analyseFrame(frameAt({ heardWave: fullSlots }), SIZE).heardWaveLargest).toBeCloseTo(VOICE_WAVE_REACH, 15);
    expect(analyseFrame(frameAt({ heardWave: fullSlots, hearing: 0.5 }), SIZE).heardWaveLargest).toBeCloseTo(
      VOICE_WAVE_REACH / 2,
      15,
    );
    expect(analyseFrame(frameAt({ heardWave: fullSlots, appearance: 0.5 }), SIZE).heardWaveLargest).toBe(0);
    // His own rings are his: theirs change none of them. Half heard, so both trains are in flight.
    const his = {
      hearing: 0.5,
      voiceWave: Array.from({ length: VOICE_WAVE_SLOTS }, (_, slot) => (slot === 3 ? 1 : 0)),
      voiceWavePhase: 0.3,
    };
    const withTheirs = analyseFrame(frameAt({ ...his, heardWave: fullSlots }), SIZE);
    const without = analyseFrame(frameAt(his), SIZE);
    expect(withTheirs.heardWaveLargest).toBeGreaterThan(0);
    expect(without.voiceWaveLargest).toBeGreaterThan(0);
    expect(withTheirs.voiceWave).toEqual(without.voiceWave);
    expect(withTheirs.voiceWaveLargest).toBe(without.voiceWaveLargest);
    expect(withTheirs.coreRing).toBe(without.coreRing);
  });
});
