import { describe, expect, it } from 'bun:test';
import {
  advanceFrameClock,
  createFrameClockState,
  type FrameClockState,
  frameStepSeconds,
  hologramFrameOf,
  restartArrival,
} from './frame-clock';
import {
  LEAVING_SECONDS,
  MATERIALISE_SECONDS,
  MINIMUM_FRAME_SECONDS,
  READ_INTERVAL_MS,
  THOUGHT_FADE_SECONDS,
} from './frame-timing';
import {
  easeHearing,
  easeHearingLevel,
  HEARD_WAVE_ONSET_SCALE,
  HEARING_LEVEL_RISE_SECONDS,
  heardRise,
  hearingFromPresence,
  hearingLevelFromVolume,
} from './hearing';
import type { HologramFrame } from './hologram-drawing';
import { createSimulatedSpectrum, fillSimulatedSpectrum, type SimulatedMood, simulatedUserAt } from './simulated-voice';
import { simulatedVolume } from './voice-analysis';
import {
  ATTACK_SECONDS,
  advanceVoiceActivity,
  createVoiceActivityState,
  easeBands,
  easeLevel,
  foldSpectrum,
  perceivedLevel,
  QUIETEST_SPEECH,
  VOICE_BAND_COUNT,
  voiceDrive,
} from './voice-levels';
import {
  advanceVoiceWave,
  createVoiceWaveState,
  HOLD_DECAY,
  syllableRise,
  VOICE_WAVE_ONSET_SCALE,
  voiceWavePhaseOf,
} from './voice-wave';

/** The view's step for a frame with no previous one to measure from, as `hologram-view.tsx` has it. */
const DEFAULT_FRAME_MS = 16;

/** What the view's shared values hold when a frame runs: the JS thread's latest readings and props. */
interface ViewInputs {
  targetLevel: number;
  targetBands: number[];
  targetHearing: number;
  targetHearingLevel: number;
  speaking: boolean;
  thinking: boolean;
  leaving: boolean;
}

/** One way of running the view's frame loop, so the old one and the shared one can be stepped alike. */
interface FrameLoop {
  readonly state: FrameClockState;
  /** The frame callback: whether a picture was asked for. */
  onFrame(timeSincePreviousFrame: number | null, inputs: ViewInputs): boolean;
  /** What the view does when the app comes back to the foreground. */
  backInFront(): void;
  /** What the frame of him is drawn from. */
  picture(): HologramFrame;
}

/**
 * The view's frame loop as it was before the clock was shared, copied line for line from
 * `hologram-view.tsx` — the frame callback's gate and `frame.modify` body, the foreground restart,
 * and the object the picture handed the drawing — as the reference the shared clock is held to.
 * It is frozen on purpose: the phone's frames must not change because the code moved.
 */
function createReferenceLoop(quietestSpeech: number | undefined, speaking: boolean): FrameLoop {
  const frame = {
    time: 0,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0) as number[],
    speaking,
    thinking: 0,
    presence: 1,
    hearing: 0,
    hearingLevel: 0,
    activity: createVoiceActivityState(quietestSpeech),
    // Added on purpose, after the clock was shared: his recent syllables, for the rings his voice
    // sends out of his core. The frames change because the drawing asked for more, not because code
    // moved; each of the lines below that reads it says so too.
    wave: createVoiceWaveState(),
    // Added on purpose, likewise: their recent syllables, for the rings they send into him through
    // the listening lattice. Each line below that reads it says so too.
    heard: createVoiceWaveState(),
  };
  let waiting = 0;
  return {
    state: frame,
    onFrame(timeSincePreviousFrame, inputs) {
      waiting += (timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
      if (waiting < MINIMUM_FRAME_SECONDS) {
        return false;
      }
      const deltaSeconds = waiting;
      waiting = 0;
      const current = frame;
      // Added on purpose: his recent syllables (see `wave` above).
      const rise = syllableRise(current.bands, inputs.targetBands, inputs.targetLevel, current.activity, deltaSeconds);
      current.time += deltaSeconds;
      current.level = easeLevel(current.level, inputs.targetLevel, deltaSeconds);
      current.bands = easeBands(current.bands, inputs.targetBands, deltaSeconds);
      current.speaking = inputs.speaking;
      const towardThought = (inputs.thinking ? 1 : -1) * (deltaSeconds / THOUGHT_FADE_SECONDS);
      current.thinking = Math.min(1, Math.max(0, current.thinking + towardThought));
      const towardGone = (inputs.leaving ? -1 : 1) * (deltaSeconds / LEAVING_SECONDS);
      current.presence = Math.min(1, Math.max(0, current.presence + towardGone));
      current.hearing = easeHearing(current.hearing, inputs.targetHearing, deltaSeconds);
      // Added on purpose: their recent syllables (see `heard` above), from the rise of their loudness.
      const heardBefore = current.hearingLevel;
      current.hearingLevel = easeHearingLevel(current.hearingLevel, inputs.targetHearingLevel, deltaSeconds);
      advanceVoiceActivity(current.activity, inputs.targetLevel, deltaSeconds);
      // Added on purpose: his recent syllables (see `wave` above).
      advanceVoiceWave(current.wave, rise, deltaSeconds, ATTACK_SECONDS, VOICE_WAVE_ONSET_SCALE);
      // Added on purpose: their recent syllables (see `heard` above).
      advanceVoiceWave(
        current.heard,
        heardRise(heardBefore, current.hearingLevel, inputs.targetHearing),
        deltaSeconds,
        HEARING_LEVEL_RISE_SECONDS,
        HEARD_WAVE_ONSET_SCALE,
      );
      return true;
    },
    backInFront() {
      frame.time = 0;
      frame.presence = 1;
    },
    picture() {
      const current = frame;
      const activity = current.activity;
      return {
        time: current.time,
        level: voiceDrive(current.level, activity.loudest),
        bands: current.bands,
        speaking: current.speaking,
        agitation: activity.agitation,
        // Added on purpose, after the clock was shared: the talk envelope the arcs, the fray and the
        // embers follow. The frames change because the drawing asked for more, not because code moved.
        talk: activity.talk,
        burstAge: activity.burstAge,
        burstStrength: activity.burstStrength,
        burstCount: activity.burstCount,
        appearance: Math.min(1, current.time / MATERIALISE_SECONDS),
        thinking: current.thinking,
        hearing: current.hearing,
        hearingLevel: current.hearingLevel,
        presence: current.presence,
        // Added on purpose: his recent syllables (see `wave` above).
        voiceWave: current.wave.slots,
        voiceWavePhase: voiceWavePhaseOf(current.wave),
        // Added on purpose: their recent syllables (see `heard` above).
        heardWave: current.heard.slots,
        heardWavePhase: voiceWavePhaseOf(current.heard),
      };
    },
  };
}

/** The view's frame loop as it is now, over the shared clock. */
function createSharedLoop(quietestSpeech: number | undefined, speaking: boolean): FrameLoop {
  const state = createFrameClockState(quietestSpeech, speaking);
  let waiting = 0;
  return {
    state,
    onFrame(timeSincePreviousFrame, inputs) {
      waiting += (timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
      const deltaSeconds = frameStepSeconds(waiting);
      if (deltaSeconds === 0) {
        return false;
      }
      waiting = 0;
      advanceFrameClock(
        state,
        deltaSeconds,
        inputs.targetLevel,
        inputs.targetBands,
        inputs.speaking,
        inputs.thinking,
        inputs.leaving,
        inputs.targetHearing,
        inputs.targetHearingLevel,
      );
      return true;
    },
    backInFront() {
      restartArrival(state);
    },
    picture() {
      return hologramFrameOf(state);
    },
  };
}

/** A small seeded generator (mulberry32), so every run of the scenario is the same run. */
function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What the screen offers between frames, in milliseconds: nothing measured (the first frame), a
 * sliver far under the gate, just under and exactly on a hundred-and-twenty-eighth of a second,
 * the refresh intervals of real screens, and stalls from a dropped frame to a frozen app.
 */
const OFFERED_MS: readonly (number | null)[] = [
  null,
  0.4,
  1,
  2.2,
  3.9,
  6.94,
  7.8,
  1000 / 128,
  8.33,
  11.1,
  16.67,
  16.7,
  33.3,
  50,
  120,
  250,
  1000,
  2500,
];

const MOODS: readonly SimulatedMood[] = ['speaking', 'thinking', 'greeting'];

/** What the scenario covered, so a scenario that stopped exercising something fails loudly. */
interface Coverage {
  pictures: number;
  heldFrames: number;
  longSteps: number;
  restarts: number;
  readings: number;
  maximumBursts: number;
  maximumHearing: number;
  maximumSyllable: number;
  maximumHeardSyllable: number;
  maximumTalk: number;
  gone: boolean;
  fullyThinking: boolean;
}

/**
 * One of the view's reading effects: a `read` as soon as it starts and then on an interval timer
 * every READ_INTERVAL_MS, and silence once it stops.
 */
function createTimedReading(read: (atMs: number) => void, silence: () => void) {
  let nextMs = Number.POSITIVE_INFINITY;
  return {
    start(atMs: number) {
      read(atMs);
      nextMs = atMs + READ_INTERVAL_MS;
    },
    stop() {
      silence();
      nextMs = Number.POSITIVE_INFINITY;
    },
    /** Every timer that came due while a frame was waiting, in order. */
    catchUp(wallMs: number) {
      while (nextMs <= wallMs) {
        read(nextMs);
        nextMs += READ_INTERVAL_MS;
      }
    },
  };
}

/**
 * What the view lives through between frames: its voice starting and stopping and changing mood,
 * someone starting and stopping talking to him, and the speaking, thinking and leaving props
 * flipping, each read or written into the view's shared values as the JS thread would.
 */
function createSession(random: () => number, speaking: boolean, coverage: Coverage) {
  const spectrum = createSimulatedSpectrum();
  const inputs: ViewInputs = {
    targetLevel: 0,
    targetBands: new Array(VOICE_BAND_COUNT).fill(0),
    targetHearing: 0,
    targetHearingLevel: 0,
    speaking,
    thinking: false,
    leaving: false,
  };
  let mood: SimulatedMood = 'speaking';
  let voiceStartedMs = 0;
  let userStartedMs = 0;
  let listening = false;
  let userPresent = false;

  const voice = createTimedReading(
    (atMs) => {
      fillSimulatedSpectrum(mood, (atMs - voiceStartedMs) / 1000, spectrum);
      inputs.targetLevel = perceivedLevel(simulatedVolume(spectrum));
      inputs.targetBands = foldSpectrum(spectrum);
      coverage.readings += 1;
    },
    // Silence, not a reset, exactly as the effect's clean-up leaves it.
    () => {
      inputs.targetLevel = 0;
      inputs.targetBands = new Array(VOICE_BAND_COUNT).fill(0);
    },
  );
  const user = createTimedReading(
    (atMs) => {
      const heard = simulatedUserAt((atMs - userStartedMs) / 1000);
      inputs.targetHearing = hearingFromPresence(heard.presence);
      inputs.targetHearingLevel = hearingLevelFromVolume(heard.volume);
    },
    () => {
      inputs.targetHearing = 0;
      inputs.targetHearingLevel = 0;
    },
  );

  function toggleVoice(wallMs: number) {
    listening = !listening;
    if (!listening) {
      voice.stop();
      return;
    }
    mood = MOODS[Math.floor(random() * MOODS.length)] ?? 'speaking';
    voiceStartedMs = wallMs;
    voice.start(wallMs);
  }

  function toggleUser(wallMs: number) {
    userPresent = !userPresent;
    if (!userPresent) {
      user.stop();
      return;
    }
    userStartedMs = wallMs;
    user.start(wallMs);
  }

  return {
    inputs,
    /** The props and the voices changing before a frame, as React commits them. */
    change(wallMs: number) {
      if (random() < 0.02) toggleVoice(wallMs);
      if (random() < 0.015) toggleUser(wallMs);
      if (random() < 0.02) inputs.speaking = !inputs.speaking;
      if (random() < 0.01) inputs.thinking = !inputs.thinking;
      if (random() < 0.008) inputs.leaving = !inputs.leaving;
    },
    catchUp(wallMs: number) {
      voice.catchUp(wallMs);
      user.catchUp(wallMs);
    },
  };
}

/** Notes what a drawn frame reached, from the reference's state. */
function noteCoverage(coverage: Coverage, state: FrameClockState) {
  coverage.pictures += 1;
  coverage.maximumBursts = Math.max(coverage.maximumBursts, state.activity.burstCount);
  coverage.maximumHearing = Math.max(coverage.maximumHearing, state.hearing);
  coverage.maximumSyllable = Math.max(coverage.maximumSyllable, ...state.wave.slots);
  coverage.maximumHeardSyllable = Math.max(coverage.maximumHeardSyllable, ...state.heard.slots);
  coverage.maximumTalk = Math.max(coverage.maximumTalk, state.activity.talk);
  coverage.gone ||= state.presence === 0;
  coverage.fullyThinking ||= state.thinking === 1;
}

/**
 * Runs the old loop and the shared one side by side for `frames` frames of a made-up session, and
 * expects the same picture and the same state from both after every one of them: the JS thread
 * reading the voice and the person every READ_INTERVAL_MS while each is there, the props flipping,
 * the app coming back to the foreground, and frames offered at every interval above.
 */
function runSideBySide(seed: number, frames: number, quietestSpeech: number | undefined, speaking: boolean): Coverage {
  const random = seededRandom(seed);
  const reference = createReferenceLoop(quietestSpeech, speaking);
  const shared = createSharedLoop(quietestSpeech, speaking);
  const coverage: Coverage = {
    pictures: 0,
    heldFrames: 0,
    longSteps: 0,
    restarts: 0,
    readings: 0,
    maximumBursts: 0,
    maximumHearing: 0,
    maximumSyllable: 0,
    maximumHeardSyllable: 0,
    maximumTalk: 0,
    gone: false,
    fullyThinking: false,
  };
  const session = createSession(random, speaking, coverage);
  let wallMs = 0;
  let sinceLastPictureMs = 0;

  for (let index = 0; index < frames; index++) {
    session.change(wallMs);
    if (random() < 0.004) {
      reference.backInFront();
      shared.backInFront();
      coverage.restarts += 1;
    }
    const offered = OFFERED_MS[Math.floor(random() * OFFERED_MS.length)] ?? null;
    wallMs += offered ?? DEFAULT_FRAME_MS;
    sinceLastPictureMs += offered ?? DEFAULT_FRAME_MS;
    session.catchUp(wallMs);

    const referenceDrew = reference.onFrame(offered, session.inputs);
    const sharedDrew = shared.onFrame(offered, session.inputs);
    expect({ frame: index, drew: sharedDrew }).toEqual({ frame: index, drew: referenceDrew });
    if (!referenceDrew) {
      coverage.heldFrames += 1;
      continue;
    }
    if (sinceLastPictureMs > 1000) coverage.longSteps += 1;
    sinceLastPictureMs = 0;

    expect({ frame: index, picture: shared.picture(), state: shared.state }).toEqual({
      frame: index,
      picture: reference.picture(),
      state: reference.state,
    });
    noteCoverage(coverage, reference.state);
  }
  return coverage;
}

describe('the frame clock, against the view’s frame loop before it was shared', () => {
  const cases: { name: string; seed: number; quietestSpeech: number | undefined; speaking: boolean }[] = [
    { name: 'the tracker’s default floor', seed: 1, quietestSpeech: undefined, speaking: false },
    {
      name: 'QUIETEST_SPEECH passed in, speaking from the start',
      seed: 2,
      quietestSpeech: QUIETEST_SPEECH,
      speaking: true,
    },
    { name: 'a much quieter voice’s floor', seed: 3, quietestSpeech: 0.02, speaking: false },
  ];

  for (const { name, seed, quietestSpeech, speaking } of cases) {
    it(`draws the same frames, with ${name}`, () => {
      const coverage = runSideBySide(seed, 6000, quietestSpeech, speaking);
      // The scenario has to have reached everything it is there to reach, or its agreement means little.
      expect(coverage.pictures).toBeGreaterThan(3000);
      expect(coverage.heldFrames).toBeGreaterThan(100);
      expect(coverage.longSteps).toBeGreaterThan(10);
      expect(coverage.restarts).toBeGreaterThan(5);
      expect(coverage.readings).toBeGreaterThan(1000);
      expect(coverage.maximumBursts).toBeGreaterThan(10);
      expect(coverage.maximumHearing).toBeGreaterThan(0.5);
      expect(coverage.maximumSyllable).toBeGreaterThan(0.3);
      expect(coverage.maximumHeardSyllable).toBeGreaterThan(0.3);
      expect(coverage.maximumTalk).toBe(1);
      expect(coverage.gone).toBe(true);
      expect(coverage.fullyThinking).toBe(true);
    });
  }
});

describe('frameStepSeconds', () => {
  it('holds back anything under a hundred-and-twenty-eighth of a second', () => {
    expect(frameStepSeconds(0)).toBe(0);
    expect(frameStepSeconds(0.005)).toBe(0);
    expect(frameStepSeconds(MINIMUM_FRAME_SECONDS - 1e-9)).toBe(0);
  });

  it('hands over the whole of what has waited once it is enough', () => {
    expect(frameStepSeconds(MINIMUM_FRAME_SECONDS)).toBe(MINIMUM_FRAME_SECONDS);
    expect(frameStepSeconds(0.0166)).toBe(0.0166);
    expect(frameStepSeconds(2.5)).toBe(2.5);
  });
});

describe('advanceFrameClock', () => {
  it('eases the bands in the clock’s own array rather than a new one', () => {
    const state = createFrameClockState();
    const bands = state.bands;
    advanceFrameClock(state, 0.02, 0.5, new Array(VOICE_BAND_COUNT).fill(0.5), true, false, false, 0, 0);
    expect(state.bands).toBe(bands);
    expect(bands[0]).toBeGreaterThan(0);
  });

  it('falls into a thought and leaves at their fixed rates, and no further than the ends', () => {
    const state = createFrameClockState();
    const silence = new Array(VOICE_BAND_COUNT).fill(0);
    advanceFrameClock(state, THOUGHT_FADE_SECONDS / 2, 0, silence, false, true, true, 0, 0);
    expect(state.thinking).toBeCloseTo(0.5, 12);
    expect(state.presence).toBeCloseTo(1 - THOUGHT_FADE_SECONDS / 2 / LEAVING_SECONDS, 12);
    advanceFrameClock(state, 10, 0, silence, false, true, true, 0, 0);
    expect(state.thinking).toBe(1);
    expect(state.presence).toBe(0);
  });
});

describe('restartArrival', () => {
  it('winds the arrival back and leaves everything else as it was', () => {
    const state = createFrameClockState();
    const loud = new Array(VOICE_BAND_COUNT).fill(0.8);
    for (let frame = 0; frame < 60; frame++) advanceFrameClock(state, 1 / 60, 0.9, loud, true, true, true, 1, 1);
    const level = state.level;
    const thinking = state.thinking;
    const hearing = state.hearing;
    const heard = structuredClone(state.heard);
    // Their syllables are in flight, so carrying them on means something.
    expect(Math.max(...heard.slots)).toBeGreaterThan(0);
    restartArrival(state);
    expect(state.time).toBe(0);
    expect(state.presence).toBe(1);
    expect(state.level).toBe(level);
    expect(state.thinking).toBe(thinking);
    expect(state.hearing).toBe(hearing);
    expect(state.heard).toEqual(heard);
    expect(hologramFrameOf(state).appearance).toBe(0);
  });
});

/** What a clock keeps of their syllables after a frame, copied so later frames cannot overwrite it. */
interface HeardFrame {
  time: number;
  slots: number[];
  rise: number;
  /** Whether a slot was cut this frame. */
  cut: boolean;
  /** Whether this frame lifted their eased loudness while the score said they spoke: what makes a syllable. */
  rose: boolean;
}

/**
 * Steps a fresh clock at 60 frames a second for `seconds`, with nothing of his voice and the person
 * talking to him as `heard` says at each frame's moment: the voice-activity score's target and their
 * loudness's, as `hearingFromPresence` and `hearingLevelFromVolume` give them.
 */
function listen(
  seconds: number,
  heard: (time: number) => { targetHearing: number; targetHearingLevel: number },
  state: FrameClockState = createFrameClockState(),
): HeardFrame[] {
  const silence = new Array<number>(VOICE_BAND_COUNT).fill(0);
  const frames: HeardFrame[] = [];
  for (let step = 1; step <= Math.round(seconds * 60); step++) {
    const time = step / 60;
    const { targetHearing, targetHearingLevel } = heard(time);
    const loudnessBefore = state.hearingLevel;
    const filledBefore = state.heard.sinceNewest;
    advanceFrameClock(state, 1 / 60, 0, silence, false, false, false, targetHearing, targetHearingLevel);
    frames.push({
      time,
      slots: [...state.heard.slots],
      rise: state.heard.rise,
      cut: state.heard.sinceNewest < filledBefore + 1 / 60 - 1e-9,
      rose: targetHearing > 0 && state.hearingLevel > loudnessBefore,
    });
  }
  return frames;
}

/** Their loudness stepping from `quiet` up to `loud` at `onset` seconds and staying there, with the score saying `targetHearing` throughout. */
function stepUp(onset: number, quiet: number, loud: number, targetHearing: number) {
  return (time: number) => ({ targetHearing, targetHearingLevel: time < onset - 1e-9 ? quiet : loud });
}

const largestOf = (frames: HeardFrame[]) => Math.max(...frames.flatMap((frame) => frame.slots));

describe('their recent syllables, as the frame clock keeps them', () => {
  it('hands the drawing their slots as it hands his: the clock’s own array, and how far the newest has got', () => {
    const state = createFrameClockState();
    listen(0.73, stepUp(0.5, 0, 0.7, 1), state);
    const frame = hologramFrameOf(state);
    expect(frame.heardWave).toBe(state.heard.slots);
    expect(frame.heardWavePhase).toBe(voiceWavePhaseOf(state.heard));
    expect(Math.max(...(frame.heardWave ?? []))).toBeGreaterThan(0.3);
    // Theirs are theirs: nothing of his voice was heard, and his slots stay empty.
    expect(state.wave.slots.every((slot) => slot === 0)).toBe(true);
  });

  it('cuts a ring for a rise of their loudness while the score says they speak, and none for the same rise while it says nobody does', () => {
    const speaking = listen(1.5, stepUp(0.5, 0.1, 0.7, 1));
    expect(largestOf(speaking)).toBeGreaterThan(0.3);
    // A cough, a door, the room: as loud, but the score never said anyone spoke.
    const nobody = listen(1.5, stepUp(0.5, 0.1, 0.7, 0));
    expect(largestOf(nobody)).toBe(0);
    expect(nobody.every((frame) => frame.rise === 0)).toBe(true);
  });

  it('cuts nothing new while their loudness holds or falls, and lets the ring go', () => {
    // Up for a tenth of a second — a syllable — then down to a murmur, which it eases toward from
    // above and so never rises to again, with the score saying they speak throughout.
    const frames = listen(3, (time) => ({
      targetHearing: 1,
      targetHearingLevel: time < 0.5 - 1e-9 ? 0 : time < 0.6 - 1e-9 ? 0.8 : 0.3,
    }));
    expect(largestOf(frames)).toBeGreaterThan(0.3);
    const lastRise = frames.findLast((frame) => frame.rose)?.time ?? Number.NaN;
    expect(lastRise).toBeLessThan(0.6 + 1e-9);
    // Every slot cut once the rise has all arrived holds no more than the hold keeps of the one before.
    const afterIt = frames.filter((frame) => frame.cut && frame.time > lastRise + 0.1);
    expect(afterIt.length).toBeGreaterThan(50);
    for (const { slots } of afterIt) {
      expect(slots[0]).toBeLessThanOrEqual((slots[1] ?? Number.NaN) * HOLD_DECAY + 1e-15);
    }
    // And two seconds on, every one of them has let go.
    expect(frames.at(-1)?.slots.every((slot) => slot === 0)).toBe(true);
  });

  it('keeps the syllables of someone really talking to him, and only theirs, phrase after phrase', () => {
    // Sample mode's person talking to him, read every READ_INTERVAL_MS as a session reads them:
    // phrases with pauses between, the score dropping under the threshold in each pause.
    const readingSeconds = READ_INTERVAL_MS / 1000;
    const frames = listen(12, (time) => {
      const heard = simulatedUserAt(Math.floor(time / readingSeconds + 1e-9) * readingSeconds);
      return {
        targetHearing: hearingFromPresence(heard.presence),
        targetHearingLevel: hearingLevelFromVolume(heard.volume),
      };
    });
    // Rings while they speak, a good share of a syllable each...
    expect(largestOf(frames)).toBeGreaterThan(0.3);
    expect(frames.filter((frame) => frame.rose).length).toBeGreaterThan(100);
    // ...and whenever a tenth of a second has passed with no rise while they spoke — between their
    // syllables and through every pause — no slot cut is more than the hold keeps of the one before.
    let lastRise = Number.NEGATIVE_INFINITY;
    let quietCuts = 0;
    for (const frame of frames) {
      if (frame.rose) lastRise = frame.time;
      if (!frame.cut || frame.time - lastRise <= 0.1) continue;
      quietCuts++;
      expect(frame.slots[0]).toBeLessThanOrEqual((frame.slots[1] ?? Number.NaN) * HOLD_DECAY + 1e-15);
    }
    expect(quietCuts).toBeGreaterThan(100);
  });
});
