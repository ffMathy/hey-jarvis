/**
 * Driving the sphere from a simulated voice, for anything that renders him headlessly.
 *
 * This is the part the render scripts genuinely share: the frame clock every device steps him on,
 * stepped here as `hologram-view.tsx` steps it, on a voice read as the app reads it. What differs
 * between the scripts is only what they do with the frames — one stitches them into a clip, another
 * keeps a single one — so the simulation lives here and none of them owns it.
 *
 * Nothing in here touches the GPU, the browser or the file system. It answers one question: given a
 * moment, what is Jarvis doing.
 */
import {
  advanceFrameClock,
  createFrameClockState,
  createSimulatedSpectrum,
  easeLevel,
  fillGreetingSpectrum,
  fillSimulatedSpectrum,
  foldSpectrum,
  type HologramFrame,
  hearingFromPresence,
  hearingLevelFromVolume,
  hologramFrameOf,
  MATERIALISE_SECONDS,
  perceivedLevel,
  READ_INTERVAL_MS,
  type SimulatedMood,
  simulatedUserAt,
  simulatedVolume,
  VOICE_BAND_COUNT,
} from '../src/index';

/**
 * What is happening at one instant, as far as the sphere is concerned.
 *
 * `opened` and `showing` are the clip's business rather than the drawing's — they say how far the
 * assistant sheet has risen and whether there is yet anywhere to draw him — so they are optional
 * here. A still has neither.
 */
export interface SimulatedMoment {
  mood: SimulatedMood | undefined;
  /** Timed from when the mood was chosen, so speech opens on a syllable — as `useSimulatedVoice` does. */
  moodSeconds: number;
  hologramSeconds: number;
  thinkingWanted: boolean;
  leaving: boolean;
  /** Seconds into the greeting recording, while it plays: his voice is the greeting, not the mood. */
  greetingSeconds?: number;
  /** Seconds into someone talking to him, while they do: sample mode's listening phase. */
  userSeconds?: number;
  opened?: number;
  showing?: boolean;
}

/** Writes his voice at this moment into `spectrum` — the greeting while it plays, else the mood — and says whether there is one. */
function readVoice(moment: SimulatedMoment, spectrum: Uint8Array): boolean {
  if (moment.greetingSeconds !== undefined) {
    fillGreetingSpectrum(moment.greetingSeconds, spectrum);
    return true;
  }
  if (moment.mood !== undefined) {
    fillSimulatedSpectrum(moment.mood, moment.moodSeconds, spectrum);
    return true;
  }
  return false;
}

function silentBands(): number[] {
  return new Array<number>(VOICE_BAND_COUNT).fill(0);
}

/**
 * Everything the drawing reads that is carried from one frame to the next: the frame clock every
 * device steps him on (`frame-clock.ts`), stepped here once a frame, so the sphere behaves here
 * exactly as it does in the app.
 *
 * The voice is read as the app reads it, on a beat of READ_INTERVAL_MS of clock time, and at once
 * when it starts or stops or someone starts or stops talking to him — the headset's rule
 * (`vr/src/hologram3d/frame-clock.ts`). Read every frame instead, as this once did, an onset landed
 * up to 40 ms earlier and sharper here than on a device, so a render showed a livelier Jarvis than
 * a phone draws.
 *
 * The clock's time is the moment's own (`hologramSeconds`), so a clip can start him anywhere in his
 * arrival; everything else is the clock's.
 *
 * @param frameSeconds - How long each frame is, which the easing and the fades are measured in.
 */
export function createPerformance(frameSeconds: number) {
  const readSeconds = READ_INTERVAL_MS / 1000;
  const spectrum = createSimulatedSpectrum();
  const clock = createFrameClockState();
  let targetLevel = 0;
  let targetBands = silentBands();
  let targetHearing = 0;
  let targetHearingLevel = 0;
  let sinceReading = 0;
  let readOnce = false;
  let readVoiced = false;
  let readHeard = false;

  function read(moment: SimulatedMoment, voiced: boolean) {
    targetLevel = voiced ? perceivedLevel(simulatedVolume(spectrum)) : 0;
    targetBands = voiced ? foldSpectrum(spectrum) : silentBands();
    const user = moment.userSeconds === undefined ? undefined : simulatedUserAt(moment.userSeconds);
    targetHearing = user ? hearingFromPresence(user.presence) : 0;
    targetHearingLevel = user ? hearingLevelFromVolume(user.volume) : 0;
    readOnce = true;
    readVoiced = voiced;
    readHeard = user !== undefined;
  }

  return (moment: SimulatedMoment): HologramFrame => {
    const voiced = readVoice(moment, spectrum);
    const heard = moment.userSeconds !== undefined;
    if (!readOnce || voiced !== readVoiced || heard !== readHeard) {
      sinceReading = 0;
      read(moment, voiced);
    } else {
      sinceReading += frameSeconds;
      if (sinceReading >= readSeconds) {
        sinceReading %= readSeconds;
        read(moment, voiced);
      }
    }
    advanceFrameClock(
      clock,
      frameSeconds,
      targetLevel,
      targetBands,
      // True for both moods: a simulated voice is always "on", and it is `thinking` that tells
      // them apart. See `useSimulatedVoice`, which does exactly this.
      voiced,
      moment.thinkingWanted,
      moment.leaving,
      targetHearing,
      targetHearingLevel,
    );
    const frame = hologramFrameOf(clock);
    return {
      ...frame,
      time: moment.hologramSeconds,
      appearance: Math.min(1, moment.hologramSeconds / MATERIALISE_SECONDS),
      // The clock's own arrays, good only until its next step: a frame kept is a frame copied.
      bands: [...frame.bands],
    };
  };
}

/** One frame's worth of everything the drawing reads. */
export type SimulatedFrame = HologramFrame;

/**
 * A moment for a still: formed, present, and in one mood with nothing else going on.
 *
 * The same shape the clip's script produces, so that {@link createPerformance} can advance it
 * without knowing it is being used for a still rather than for a clip.
 */
export function stillMoment(seconds: number, mood: SimulatedMood | undefined = 'speaking'): SimulatedMoment {
  return {
    mood,
    moodSeconds: seconds,
    opened: 1,
    showing: true,
    // Long past materialising, so `appearance` is 1 and he is simply there.
    hologramSeconds: MATERIALISE_SECONDS + seconds,
    thinkingWanted: mood === 'thinking',
    leaving: false,
  };
}

/**
 * When, in the first `over` seconds of speech, the simulated voice is at its loudest.
 *
 * Deterministic, so the caller can start again from nothing and walk to exactly that moment. There
 * is no way to snapshot the state instead: the tracker, the easing and the clock all carry from one
 * frame to the next, and half of what makes a loud moment look loud is what came before it.
 */
export function findLoudestMoment(over: number, frameSeconds: number): number {
  const spectrum = createSimulatedSpectrum();
  let level = 0;
  let loudest = 0;
  let at = 0;
  for (let seconds = 0; seconds < over; seconds += frameSeconds) {
    level = easeLevel(
      level,
      perceivedLevel(simulatedVolume(fillSimulatedSpectrum('speaking', seconds, spectrum))),
      frameSeconds,
    );
    if (level > loudest) {
      loudest = level;
      at = seconds;
    }
  }
  return at;
}
