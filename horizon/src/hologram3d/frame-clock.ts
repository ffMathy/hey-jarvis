import {
  advanceFrameClock,
  createFrameClockState,
  foldSpectrum,
  frameStepSeconds,
  type HologramFrame,
  hearingFromPresence,
  hearingLevelFromVolume,
  hologramFrameOf,
  type JarvisVoice,
  perceivedLevel,
  QUIETEST_SPEECH,
  READ_INTERVAL_MS,
  restartArrival,
  type UserVoice,
  VOICE_BAND_COUNT,
} from 'hologram';

/**
 * What the hologram is told each frame: whose voice to follow, whether someone is talking to him,
 * whether he is thinking, and whether he is on his way out.
 */
export interface HologramDrive {
  voice: JarvisVoice;
  user?: UserVoice;
  thinking: boolean;
  leaving: boolean;
}

/**
 * The phone's frame clock, on the headset's time.
 *
 * The stepping is not this file's: it is hologram's `advanceFrameClock`, the very function
 * `hologram/src/react/hologram-view.tsx` calls in its frame callback, over the same state, behind
 * the same hundred-and-twenty-eighth-of-a-second gate (`frameStepSeconds`), drawn through the same
 * `hologramFrameOf`. So a frame here is the frame the phone would draw at the same moment, and
 * hologram's `frame-clock.spec.ts` holds that function to the phone's frames.
 *
 * What is left here is what the headset does differently, which is when things happen rather than
 * what they do. The voice is read on the clock's own time rather than on a wall-clock timer on
 * another thread, so a preview that steps it at a fixed rate gets the same frame every time; and
 * the arrival restarts on `arrive()`, which the headset calls on every summon, where the phone
 * restarts it when the app comes back to the foreground.
 */
export interface FrameClock {
  /** Back to the start of the arrival vortex, fully present — what every summon does. */
  arrive(): void;
  /** Moves the clock on by one frame's worth of time, reading the voice when a reading is due. */
  advance(deltaSeconds: number, drive: HologramDrive): void;
  /** What the drawing is to show now, with `density` of the particles. */
  frame(density: number): HologramFrame;
  /** Seconds since the last arrival. */
  readonly time: number;
  /** 0–1: how much of him is here; 0 once he has gone. */
  readonly presence: number;
}

/** No voice in any band. */
function silentBands(): number[] {
  return new Array<number>(VOICE_BAND_COUNT).fill(0);
}

/**
 * A clock that starts at the beginning of an arrival.
 *
 * `quietestSpeech` is the floor the voice tracker judges speech against, as the phone's view is
 * handed it; the phone and its web build both pass QUIETEST_SPEECH.
 */
export function createFrameClock(quietestSpeech: number = QUIETEST_SPEECH): FrameClock {
  const readInterval = READ_INTERVAL_MS / 1000;
  const state = createFrameClockState(quietestSpeech);
  // What the last reading said, which the frames between readings ease toward.
  let targetLevel = 0;
  let targetBands = silentBands();
  let targetHearing = 0;
  let targetHearingLevel = 0;
  // Time the clock has run since the last beat of readings, and what was read then: a new voice, a
  // new listener, or the voice starting or stopping is read at once rather than up to 40 ms late,
  // as a React effect re-running on a changed prop reads at once on the phone.
  let sinceReading = 0;
  let readVoice: JarvisVoice | undefined;
  let readUser: UserVoice | undefined;
  let readListening = false;
  // Time offered since the last step, held back below MINIMUM_FRAME_SECONDS as the phone's is.
  let waiting = 0;

  function read(drive: HologramDrive) {
    const { voice, user } = drive;
    if (voice.listening) {
      targetLevel = perceivedLevel(voice.getVolume());
      targetBands = foldSpectrum(voice.getSpectrum());
    } else {
      targetLevel = 0;
      targetBands = silentBands();
    }
    if (user === undefined) {
      targetHearing = 0;
      targetHearingLevel = 0;
    } else {
      targetHearing = hearingFromPresence(user.getPresence());
      targetHearingLevel = hearingLevelFromVolume(user.getVolume());
    }
    readVoice = voice;
    readUser = user;
    readListening = voice.listening;
  }

  function readIfDue(drive: HologramDrive, deltaSeconds: number) {
    const changed = drive.voice !== readVoice || drive.user !== readUser || drive.voice.listening !== readListening;
    if (changed) {
      sinceReading = 0;
      read(drive);
      return;
    }
    sinceReading += deltaSeconds;
    if (sinceReading >= readInterval) {
      // On the beat, like the phone's interval timer: what a frame overshoots it by counts toward
      // the next reading, so readings come 25 times a second at any frame rate. A long stall
      // costs the readings it missed rather than bunching them up.
      sinceReading %= readInterval;
      read(drive);
    }
  }

  return {
    arrive() {
      // What the phone's view does on coming back to the foreground, with the same function.
      restartArrival(state);
    },
    advance(deltaSeconds, drive) {
      if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) return;
      readIfDue(drive, deltaSeconds);
      waiting += deltaSeconds;
      const stepSeconds = frameStepSeconds(waiting);
      if (stepSeconds === 0) return;
      waiting = 0;
      advanceFrameClock(
        state,
        stepSeconds,
        targetLevel,
        targetBands,
        drive.voice.speaking,
        drive.thinking,
        drive.leaving,
        targetHearing,
        targetHearingLevel,
      );
    },
    frame(density) {
      return hologramFrameOf(state, density);
    },
    get time() {
      return state.time;
    },
    get presence() {
      return state.presence;
    },
  };
}
