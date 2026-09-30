import { describe, expect, it } from 'bun:test';
import {
  advanceFrameClock,
  createFrameClockState,
  type FrameClockState,
  frameStepSeconds,
  hologramFrameOf,
  restartArrival,
} from './frame-clock';
import { LEAVING_SECONDS, MINIMUM_FRAME_SECONDS, READ_INTERVAL_MS, THOUGHT_FADE_SECONDS } from './frame-timing';
import { easeHearing, easeHearingLevel, hearingFromPresence, hearingLevelFromVolume } from './hearing';
import { type HologramFrame, MATERIALISE_SECONDS } from './hologram-drawing';
import { createSimulatedSpectrum, fillSimulatedSpectrum, type SimulatedMood, simulatedUserAt } from './simulated-voice';
import { simulatedVolume } from './voice-analysis';
import {
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
  /** What the picture hands `drawHologram`. */
  picture(density: number): HologramFrame;
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
      current.time += deltaSeconds;
      current.level = easeLevel(current.level, inputs.targetLevel, deltaSeconds);
      current.bands = easeBands(current.bands, inputs.targetBands, deltaSeconds);
      current.speaking = inputs.speaking;
      const towardThought = (inputs.thinking ? 1 : -1) * (deltaSeconds / THOUGHT_FADE_SECONDS);
      current.thinking = Math.min(1, Math.max(0, current.thinking + towardThought));
      const towardGone = (inputs.leaving ? -1 : 1) * (deltaSeconds / LEAVING_SECONDS);
      current.presence = Math.min(1, Math.max(0, current.presence + towardGone));
      current.hearing = easeHearing(current.hearing, inputs.targetHearing, deltaSeconds);
      current.hearingLevel = easeHearingLevel(current.hearingLevel, inputs.targetHearingLevel, deltaSeconds);
      advanceVoiceActivity(current.activity, inputs.targetLevel, deltaSeconds);
      return true;
    },
    backInFront() {
      frame.time = 0;
      frame.presence = 1;
    },
    picture(density) {
      const current = frame;
      const activity = current.activity;
      return {
        time: current.time,
        level: voiceDrive(current.level, activity.loudest),
        bands: current.bands,
        speaking: current.speaking,
        agitation: activity.agitation,
        burstAge: activity.burstAge,
        burstStrength: activity.burstStrength,
        burstCount: activity.burstCount,
        appearance: Math.min(1, current.time / MATERIALISE_SECONDS),
        thinking: current.thinking,
        hearing: current.hearing,
        hearingLevel: current.hearingLevel,
        presence: current.presence,
        density,
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
    picture(density) {
      return hologramFrameOf(state, density);
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

    const density = random();
    expect({ frame: index, picture: shared.picture(density), state: shared.state }).toEqual({
      frame: index,
      picture: reference.picture(density),
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
    restartArrival(state);
    expect(state.time).toBe(0);
    expect(state.presence).toBe(1);
    expect(state.level).toBe(level);
    expect(state.thinking).toBe(thinking);
    expect(state.hearing).toBe(hearing);
    expect(hologramFrameOf(state, 1).appearance).toBe(0);
  });
});
