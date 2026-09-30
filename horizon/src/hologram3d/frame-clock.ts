import {
  advanceVoiceActivity,
  createVoiceActivityState,
  easeBands,
  easeHearing,
  easeHearingLevel,
  easeLevel,
  foldSpectrum,
  type HologramFrame,
  hearingFromPresence,
  hearingLevelFromVolume,
  type JarvisVoice,
  LEAVING_SECONDS,
  MATERIALISE_SECONDS,
  MINIMUM_FRAME_SECONDS,
  perceivedLevel,
  QUIETEST_SPEECH,
  READ_INTERVAL_MS,
  THOUGHT_FADE_SECONDS,
  type UserVoice,
  VOICE_BAND_COUNT,
  voiceDrive,
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
 * The phone's frame loop, on the headset's clock.
 *
 * `hologram/src/react/hologram-view.tsx` is the reference, and this composes the same exported
 * pieces in the same order, so a frame here is the frame the phone would draw at the same moment:
 * the voice read every READ_INTERVAL_MS, eased every frame, the tracker stepped on the raw reading,
 * thinking and leaving faded at their fixed rates, the listening lattice eased, and the drawn level
 * judged against the loudest this voice has been. The view's loop itself is not shared (see
 * hologram/AGENTS.md, "A second renderer"), so this is where the two could drift, and
 * `frame-clock.spec.ts` pins a step against the formulas.
 *
 * Two things differ, both on purpose. The voice is read on the clock's own time rather than on a
 * wall-clock timer, so a preview that steps it at a fixed rate gets the same frame every time; and
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
  let time = 0;
  let presence = 1;
  let thinking = 0;
  let level = 0;
  let bands = silentBands();
  let hearing = 0;
  let hearingLevel = 0;
  let speaking = false;
  const activity = createVoiceActivityState(quietestSpeech);
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

  function step(deltaSeconds: number, drive: HologramDrive) {
    time += deltaSeconds;
    level = easeLevel(level, targetLevel, deltaSeconds);
    bands = easeBands(bands, targetBands, deltaSeconds);
    speaking = drive.voice.speaking;
    // Toward whichever end is asked for, at a fixed rate: see THOUGHT_FADE_SECONDS and LEAVING_SECONDS.
    thinking = Math.min(1, Math.max(0, thinking + (drive.thinking ? 1 : -1) * (deltaSeconds / THOUGHT_FADE_SECONDS)));
    presence = Math.min(1, Math.max(0, presence + (drive.leaving ? -1 : 1) * (deltaSeconds / LEAVING_SECONDS)));
    hearing = easeHearing(hearing, targetHearing, deltaSeconds);
    hearingLevel = easeHearingLevel(hearingLevel, targetHearingLevel, deltaSeconds);
    // The raw reading, not the eased level: easing is what would smear an onset into a slope.
    advanceVoiceActivity(activity, targetLevel, deltaSeconds);
  }

  return {
    arrive() {
      // What the phone's view does on coming back to the foreground: the arrival is derived from
      // the clock, so winding it back is the whole of it. The voice tracker, the thought and the
      // lattice carry on, as they do there.
      time = 0;
      presence = 1;
    },
    advance(deltaSeconds, drive) {
      if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) return;
      readIfDue(drive, deltaSeconds);
      waiting += deltaSeconds;
      if (waiting < MINIMUM_FRAME_SECONDS) return;
      const stepSeconds = waiting;
      waiting = 0;
      step(stepSeconds, drive);
    },
    frame(density) {
      return {
        time,
        // Judged against how loud this voice actually gets, as the phone's view does.
        level: voiceDrive(level, activity.loudest),
        bands,
        speaking,
        agitation: activity.agitation,
        burstAge: activity.burstAge,
        burstStrength: activity.burstStrength,
        burstCount: activity.burstCount,
        appearance: Math.min(1, time / MATERIALISE_SECONDS),
        thinking,
        hearing,
        hearingLevel,
        presence,
        density,
      };
    },
    get time() {
      return time;
    },
    get presence() {
      return presence;
    },
  };
}
