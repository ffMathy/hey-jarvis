/**
 * Driving the sphere from a simulated voice, for anything that renders him headlessly.
 *
 * This is the part `render-showcase.ts` and `render-play-assets.ts` genuinely share: the five
 * things the drawing carries from one frame to the next, advanced exactly the way
 * `hologram-view.tsx` advances them in its `frame` shared value. What differs between the two
 * scripts is only what they do with the frames — one stitches them into a clip, the other keeps a
 * single one — so the simulation lives here and neither owns it.
 *
 * Nothing in here touches Skia or the file system. It answers one question: given a moment, what
 * is Jarvis doing.
 */
import {
  advanceVoiceActivity,
  createSimulatedSpectrum,
  createVoiceActivityState,
  easeBands,
  easeLevel,
  fillSimulatedSpectrum,
  foldSpectrum,
  MATERIALISE_SECONDS,
  perceivedLevel,
  type SimulatedMood,
  simulatedVolume,
  VOICE_BAND_COUNT,
  voiceDrive,
} from '../src/index';
import { LEAVING_SECONDS } from '../src/react/leaving';

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
  opened?: number;
  showing?: boolean;
}

function clamp(value: number, lowest: number, highest: number): number {
  return value < lowest ? lowest : value > highest ? highest : value;
}

/**
 * Everything the drawing reads that is carried from one frame to the next.
 *
 * The same five things `hologram-view.tsx` keeps in its `frame` shared value, advanced the same
 * way, so the sphere behaves here exactly as it does in the app.
 *
 * @param frameSeconds - How long each frame is, which the easing and the fades are measured in.
 * @param thoughtFadeSeconds - How long a thought takes to come up and go down.
 */
export function createPerformance(frameSeconds: number, thoughtFadeSeconds: number) {
  const spectrum = createSimulatedSpectrum();
  const activity = createVoiceActivityState();
  let level = 0;
  let bands: number[] = new Array(VOICE_BAND_COUNT).fill(0);
  let thinking = 0;
  let presence = 1;

  return (moment: SimulatedMoment) => {
    // What the app reads off the voice every 40 ms, read here every frame: same two questions.
    const heard =
      moment.mood === undefined
        ? 0
        : perceivedLevel(simulatedVolume(fillSimulatedSpectrum(moment.mood, moment.moodSeconds, spectrum)));
    const heardBands = moment.mood === undefined ? new Array<number>(VOICE_BAND_COUNT).fill(0) : foldSpectrum(spectrum);

    level = easeLevel(level, heard, frameSeconds);
    bands = easeBands(bands, heardBands, frameSeconds);
    advanceVoiceActivity(activity, heard, frameSeconds);
    thinking = clamp(thinking + ((moment.thinkingWanted ? 1 : -1) * frameSeconds) / thoughtFadeSeconds, 0, 1);
    presence = clamp(presence + ((moment.leaving ? -1 : 1) * frameSeconds) / LEAVING_SECONDS, 0, 1);

    return {
      time: moment.hologramSeconds,
      // Judged against how loud this voice actually gets, as the view does.
      level: voiceDrive(level, activity.loudest),
      bands,
      // True for both moods: a simulated voice is always "on", and it is `thinking` that tells
      // them apart. See `useSimulatedVoice`, which does exactly this.
      speaking: moment.mood !== undefined,
      agitation: activity.agitation,
      burstAge: activity.burstAge,
      burstStrength: activity.burstStrength,
      burstCount: activity.burstCount,
      appearance: Math.min(1, moment.hologramSeconds / MATERIALISE_SECONDS),
      thinking,
      presence,
      // All of them. Nothing here is racing a screen.
      density: 1,
    };
  };
}

/** One frame's worth of everything the drawing reads. */
export type SimulatedFrame = ReturnType<ReturnType<typeof createPerformance>>;

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
