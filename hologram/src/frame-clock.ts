/**
 * Jarvis's frame clock: everything the drawing reads that moves with time, stepped once a frame
 * toward the latest reading of his voice.
 *
 * There is one of it, and every device that draws him steps it. The phone's and the watch's view
 * (`react/hologram-view.tsx`) calls it from a Reanimated frame callback on the UI thread, and the
 * headset (`horizon/src/hologram3d/frame-clock.ts`) from its XR frame loop, so a frame on the
 * headset is the frame the phone would draw at the same moment rather than a copy that can drift.
 * What the devices do differently is *when* they call these functions, never what the functions
 * do: the phone reads the voice on the JS thread every READ_INTERVAL_MS and restarts the arrival
 * when the app comes back to the foreground, while the headset reads the voice on the clock's own
 * time and restarts the arrival on every summon. Both restart it with {@link restartArrival}.
 *
 * **Built for the phone's UI thread.** Hermes runs a worklet there as bytecode with no JIT, every
 * frame, so the step is a worklet over one state object made once when the view mounts; the
 * readings come in as positional arguments rather than an object built for the call; and nothing
 * is allocated, because the bands are eased in place and the voice tracker advances its own state.
 * Every function here closes over nothing but module-level constants and other worklets, each
 * declared after the worklets it calls — see the package's AGENTS.md, "Worklets", for why a
 * mistake there fails only on a device or in the phone's web bundle.
 *
 * **Advanced inside `modify` on the phone**, for the reason `voice-levels.ts` gives: only `modify`
 * hands a worklet the object the UI runtime owns, and a write to any other copy of it is dropped in
 * silence in a development build.
 */
import { LEAVING_SECONDS, MINIMUM_FRAME_SECONDS, THOUGHT_FADE_SECONDS } from './frame-timing';
import { easeHearing, easeHearingLevel } from './hearing';
import { type HologramFrame, MATERIALISE_SECONDS } from './hologram-drawing';
import {
  advanceVoiceActivity,
  createVoiceActivityState,
  easeBands,
  easeLevel,
  QUIETEST_SPEECH,
  VOICE_BAND_COUNT,
  type VoiceActivityState,
  voiceDrive,
} from './voice-levels';

/** Everything the clock carries from one frame to the next. */
export interface FrameClockState {
  /** Seconds since the arrival began, added up frame by frame. All motion derives from this. */
  time: number;
  /** His voice's level, eased toward the latest reading. */
  level: number;
  /** His voice's bands, eased toward the latest reading in place, so no frame allocates them. */
  bands: number[];
  /** Whether he is speaking, as opposed to the conversation merely being open. */
  speaking: boolean;
  /** 0–1: how far into a thought he is, faded at the rate THOUGHT_FADE_SECONDS sets. */
  thinking: number;
  /** 0–1: how much of him is here, faded at the rate LEAVING_SECONDS sets; 0 once he has gone. */
  presence: number;
  /** 0–1: the listening lattice, eased toward the latest voice-activity score. */
  hearing: number;
  /** 0–1: how hard the lattice breathes, eased toward the latest microphone level. */
  hearingLevel: number;
  /**
   * The voice tracker: what no single frame can see, such as whether the voice just started or
   * stopped and how long ago the rim last threw chips. See `advanceVoiceActivity`.
   */
  activity: VoiceActivityState;
}

/**
 * A clock at the very start of an arrival, fully present, with nothing heard yet.
 *
 * `quietestSpeech` is the floor the voice tracker judges speech against, on the scale of the voice
 * being followed; `speaking` is what the voice says before the first frame has read it.
 */
export function createFrameClockState(quietestSpeech = QUIETEST_SPEECH, speaking = false): FrameClockState {
  return {
    time: 0,
    level: 0,
    bands: new Array<number>(VOICE_BAND_COUNT).fill(0),
    speaking,
    thinking: 0,
    presence: 1,
    hearing: 0,
    hearingLevel: 0,
    activity: createVoiceActivityState(quietestSpeech),
  };
}

/**
 * How far a frame moves the clock once `waitingSeconds` have been offered since the last step: all
 * of it, or nought while that is still under MINIMUM_FRAME_SECONDS and the frame is held back.
 *
 * The caller adds up what each frame offers and starts again from nought after a step, so a held
 * frame's time is carried into the next rather than lost. It keeps that sum itself because on the
 * phone it must not live in the clock's state: every write to the shared value holding that state
 * rebuilds the picture, and a held frame is precisely one that should not.
 */
export function frameStepSeconds(waitingSeconds: number): number {
  'worklet';
  return waitingSeconds < MINIMUM_FRAME_SECONDS ? 0 : waitingSeconds;
}

/**
 * Moves a 0–1 share toward one end or the other at a fixed rate, taking `fullSeconds` to cross the
 * whole way: a fade, where easing would slow to a crawl as it arrived.
 */
function fadeToward(current: number, rising: boolean, deltaSeconds: number, fullSeconds: number): number {
  'worklet';
  return Math.min(1, Math.max(0, current + (rising ? 1 : -1) * (deltaSeconds / fullSeconds)));
}

/**
 * One step of the clock, `deltaSeconds` long, toward the latest readings.
 *
 * The readings are what the voice last said, not what it says now: the level and bands as
 * `perceivedLevel` and `foldSpectrum` give them, the listening lattice's two targets as
 * `hearingFromPresence` and `hearingLevelFromVolume` give them, and nought for a voice that is not
 * being listened to or a person who is not there. The tracker is stepped on the raw level rather
 * than the eased one, because easing is what would smear an onset into a slope.
 *
 * A step is deliberately not capped: a slow frame has to move him as far as the time it stood for,
 * or he turns slower wherever frames are slow.
 */
export function advanceFrameClock(
  state: FrameClockState,
  deltaSeconds: number,
  targetLevel: number,
  targetBands: number[],
  speaking: boolean,
  thinking: boolean,
  leaving: boolean,
  targetHearing: number,
  targetHearingLevel: number,
): FrameClockState {
  'worklet';
  state.time += deltaSeconds;
  state.level = easeLevel(state.level, targetLevel, deltaSeconds);
  state.bands = easeBands(state.bands, targetBands, deltaSeconds);
  state.speaking = speaking;
  state.thinking = fadeToward(state.thinking, thinking, deltaSeconds, THOUGHT_FADE_SECONDS);
  state.presence = fadeToward(state.presence, !leaving, deltaSeconds, LEAVING_SECONDS);
  state.hearing = easeHearing(state.hearing, targetHearing, deltaSeconds);
  state.hearingLevel = easeHearingLevel(state.hearingLevel, targetHearingLevel, deltaSeconds);
  advanceVoiceActivity(state.activity, targetLevel, deltaSeconds);
  return state;
}

/**
 * Back to the start of the arrival vortex, fully present.
 *
 * The arrival is derived from the clock, so winding it back is the whole of it. The voice tracker,
 * the thought and the lattice carry on as they were, since none of them is part of arriving.
 */
export function restartArrival(state: FrameClockState): FrameClockState {
  'worklet';
  state.time = 0;
  state.presence = 1;
  return state;
}

/**
 * What the drawing is to show now, with `density` of the particles.
 *
 * The level is judged against how loud this voice actually gets rather than against full scale: a
 * phone microphone in a quiet room never comes near 1, and the sphere answering the absolute
 * number is why the user once saw almost no change however far the answer was turned up. The
 * materialisation plays once, from the start of the arrival. The bands are the clock's own array,
 * not a copy, so the frame is only good until the next step.
 */
export function hologramFrameOf(state: FrameClockState, density: number): HologramFrame {
  'worklet';
  const activity = state.activity;
  return {
    time: state.time,
    level: voiceDrive(state.level, activity.loudest),
    bands: state.bands,
    speaking: state.speaking,
    agitation: activity.agitation,
    burstAge: activity.burstAge,
    burstStrength: activity.burstStrength,
    burstCount: activity.burstCount,
    appearance: Math.min(1, state.time / MATERIALISE_SECONDS),
    thinking: state.thinking,
    hearing: state.hearing,
    hearingLevel: state.hearingLevel,
    presence: state.presence,
    density,
  };
}
