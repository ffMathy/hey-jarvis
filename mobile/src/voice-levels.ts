/**
 * Turning Jarvis's voice into the numbers the hologram is drawn from.
 *
 * The conversation SDK reports the agent's audio two ways: an RMS volume, and a
 * byte frequency spectrum — 1024 values, 0–255, spanning 100–8000 Hz in equal
 * steps, refreshed natively about every 40 ms. Neither is usable as it comes.
 * Speech puts nearly all of its energy in the bottom few hundred hertz, so equal
 * steps would light the first two bands and leave the rest dark; and a value that
 * updates 25 times a second, drawn at 60, visibly steps.
 *
 * So the spectrum is folded into a few log-spaced bands, and both it and the
 * volume are eased toward their latest reading every frame. Everything here is a
 * plain function, and the per-frame ones are worklets, so the same code runs on
 * the UI thread in the app and under `bun test`.
 *
 * Easing alone is not enough for the film's Jarvis, though. He does not brighten
 * or swell as he gets louder; he shows speech as activity — the sphere grows
 * agitated while he talks, and chips break off its rim as a syllable starts and
 * in the gap after one. Onsets and gaps are changes over time, which no single
 * frame can see, so a small tracker remembers the recent past from frame to
 * frame: see {@link advanceVoiceActivity}.
 *
 * **Keeping that state in the view.** {@link advanceVoiceActivity} writes into
 * the state object it is given, so the view has to hand it one that lives on from
 * frame to frame — and a shared value assigned from the JS runtime is not that
 * object. Reanimated gives the UI runtime's copy a getter and a warning-only
 * setter for every property, so in a development build each write would be
 * dropped in silence: agitation would stay at 0 and no burst would ever fire,
 * while release builds worked. Advance it the way the eased bands are advanced,
 * inside `modify`, which hands the worklet the object the UI runtime owns:
 *
 * ```ts
 * activity.modify((state) => {
 *   'worklet';
 *   return advanceVoiceActivity(state, targetLevel.value, deltaSeconds);
 * });
 * ```
 */

/** How many bands the hologram is given. */
export const VOICE_BAND_COUNT = 24;

/** The span the SDK's spectrum covers. Only the ratio matters for the folding. */
const LOWEST_FREQUENCY = 100;
const HIGHEST_FREQUENCY = 8000;

/**
 * Where each band starts, as an index into a spectrum of `binCount` values.
 *
 * Log-spaced, so each band covers the same musical interval, with every band at
 * least one bin wide — at the bottom the log spacing would otherwise ask for
 * fractions of a bin, and a band with no bins is a band that never lights.
 */
export function bandEdges(binCount: number, bandCount: number = VOICE_BAND_COUNT): number[] {
  const ratio = HIGHEST_FREQUENCY / LOWEST_FREQUENCY;
  const edges: number[] = [0];

  for (let band = 1; band < bandCount; band++) {
    const fraction = (ratio ** (band / bandCount) - 1) / (ratio - 1);
    const previous = edges[band - 1] ?? 0;
    const remainingBands = bandCount - band;
    // At least one bin per band, and never so far that later bands run out.
    const edge = Math.min(Math.max(Math.round(fraction * binCount), previous + 1), binCount - remainingBands);
    edges.push(edge);
  }

  edges.push(binCount);
  return edges;
}

/**
 * Folds a 0–255 byte spectrum into `bandCount` values between 0 and 1.
 *
 * Each band is the mean of its bins, lifted by a square root: a spoken vowel
 * sits well below full scale, and a linear map leaves the hologram barely
 * moving while Jarvis is plainly talking. An empty spectrum — no conversation,
 * or no data yet — folds to silence rather than to garbage.
 */
export function foldSpectrum(spectrum: ArrayLike<number>, bandCount: number = VOICE_BAND_COUNT): number[] {
  if (spectrum.length < bandCount) {
    return new Array<number>(bandCount).fill(0);
  }

  const edges = bandEdges(spectrum.length, bandCount);
  const bands: number[] = [];

  for (let band = 0; band < bandCount; band++) {
    const start = edges[band] ?? 0;
    const end = edges[band + 1] ?? spectrum.length;
    let sum = 0;
    for (let index = start; index < end; index++) {
      sum += spectrum[index] ?? 0;
    }
    const mean = sum / Math.max(1, end - start) / 255;
    bands.push(Math.sqrt(Math.min(1, Math.max(0, mean))));
  }

  return bands;
}

/**
 * Maps the SDK's RMS volume onto 0–1 as the hologram should feel it.
 *
 * RMS of normal speech is small — roughly 0.05 to 0.3 of full scale — so the raw
 * value would make even a raised voice look like a whisper. A square root with
 * some gain spreads that range across the useful part of 0–1, and anything
 * louder simply saturates.
 */
export function perceivedLevel(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) {
    return 0;
  }
  return Math.min(1, Math.sqrt(volume) * 1.8);
}

/** How quickly the drawn value catches up with a louder reading, in seconds. */
export const ATTACK_SECONDS = 0.045;
/**
 * How quickly it falls back when the reading drops.
 *
 * Still slower than the attack, so a syllable keeps its shape rather than flickering, but down
 * from 0.28: the glow rides this, and at 0.28 it smoothed the gaps between words away and left
 * the sphere lit evenly through a sentence instead of moving with it.
 */
export const RELEASE_SECONDS = 0.12;

/**
 * Moves `current` toward `target` over `deltaSeconds`, attacking fast and
 * releasing slowly.
 *
 * Exponential, so the result does not depend on frame rate: two 8 ms steps land
 * where one 16 ms step does. That matters because the UI thread's frame interval
 * varies, and bands that moved further on a 120 Hz screen would be wrong.
 */
export function easeLevel(current: number, target: number, deltaSeconds: number): number {
  'worklet';
  if (!(deltaSeconds > 0)) {
    return current;
  }
  const seconds = target > current ? ATTACK_SECONDS : RELEASE_SECONDS;
  return current + (target - current) * (1 - Math.exp(-deltaSeconds / seconds));
}

/** {@link easeLevel} for every band at once, written into `current` to avoid an allocation per frame. */
export function easeBands(current: number[], target: number[], deltaSeconds: number): number[] {
  'worklet';
  for (let band = 0; band < current.length; band++) {
    current[band] = easeLevel(current[band] ?? 0, target[band] ?? 0, deltaSeconds);
  }
  return current;
}

/**
 * The level, as {@link perceivedLevel} gives it, from which the voice counts as
 * speech. Below it is silence, the tail of a word, or a quiet room's hiss
 * through the microphone in sample mode — none of which should stir the sphere.
 */
export const SPEECH_LEVEL = 0.15;
/**
 * The quietest a reading can be and still count as speech, however quiet the voice is.
 *
 * Below this is a room, not a person, whatever the room's hiss is doing relative to the voice.
 *
 * Set where the user asked for it. Their microphone is a quiet one — an ordinary speaking voice
 * arrives at 0.08 to 0.11, about -54 dBFS, through WebRTC's recorder and a plain `AudioRecord`
 * alike, so it is the device rather than the code reading it — and their quiet room sits around
 * 0.04. A floor here keeps the room out; the share above it is what lets a voice this quiet still
 * count once it speaks.
 */
export const QUIETEST_SPEECH = 0.1;
/**
 * And how much of this voice's own loudest it has to reach.
 *
 * What separates talking from a room is not a fixed loudness — that is what broke — but how a
 * moment compares with how loud this voice gets. A voice that peaks at 0.08 is talking at 0.03;
 * one that peaks at 0.8 is not. Above {@link QUIETEST_SPEECH}, which keeps a hiss from talking
 * its way in by being the loudest hiss in the room.
 *
 * A quarter, not the 0.4 this started at. Speech is not level within a sentence — a quiet
 * syllable sits well under half of the loudest one — and at 0.4 the tail of the spoken line the
 * frame-rate checks replay stopped counting as speech at all, which swallowed the gap burst at
 * its end. A room's hiss sits far below a quarter of a voice, so the separation survives it.
 */
export const SPEAKING_SHARE = 0.25;

/** The level at which this voice counts as talking, given how loud it has been getting. */
export function speakingThreshold(loudest: number): number {
  'worklet';
  return Math.max(QUIETEST_SPEECH, loudest * SPEAKING_SHARE);
}
/** How long the memory of a voice's loudest moment takes to fade. */
export const LOUDEST_MEMORY_SECONDS = 12;
/**
 * The quietest a voice's loudest moment is taken to be.
 *
 * Without a floor, a silent room's hiss would become its own loudest moment and the sphere
 * would answer the hiss at full strength. With it, the most a quiet voice can be amplified is
 * about eight times, and anything quieter than this simply stays quiet.
 */
export const QUIETEST_LOUD_VOICE = 0.12;

/**
 * How loud this voice is for its own range, 0-1: what the glow and the swell answer to.
 *
 * {@link SPEECH_LEVEL} still decides whether it counts as speech at all, on the raw reading, so
 * a hiss cannot talk its way past the gate by being the loudest hiss around.
 */
export function voiceDrive(level: number, loudest: number): number {
  'worklet';
  if (!(level > 0) || !Number.isFinite(level)) {
    return 0;
  }
  return Math.min(1, level / Math.max(QUIETEST_LOUD_VOICE, loudest));
}

/**
 * How long agitation takes to build once speech is present. The film's sphere
 * loosens within a few frames of Jarvis starting to talk.
 */
export const AGITATION_RISE_SECONDS = 0.15;
/**
 * How long it takes to settle once speech is gone.
 *
 * Down from 0.4, which was chosen to ride over the short silences between words so the sphere
 * would not calm a dozen times a sentence. Calming a dozen times a sentence turns out to be the
 * point: held up across the gaps the sphere sat at a plateau while anyone spoke, which read as
 * one long state rather than as an answer to a voice. Dropping inside a syllable's gap is what
 * makes it pulse with the talking.
 *
 * The ramp is linear, so this is the whole way down: a fifth of a second from full to calm, and
 * less from wherever a gap catches it.
 */
export const AGITATION_RELEASE_SECONDS = 0.15;
/**
 * How long the voice has to be gone before a flurry is over and the next word starts a new one.
 *
 * This used to be "agitation has reached zero", which was the same thing while agitation took
 * 0.4 s to fall. Now that it falls in 0.15 s — so the sphere pulses with the talking rather than
 * sitting at a plateau — that would make every gap between syllables a fresh flurry and the rest
 * between them would never be waited out. The film's rim throws chips in flurries and then leaves
 * off; a stream of them is the one thing it never does. So the two are separate now, and this is
 * what the old release time was really measuring.
 */
export const FLURRY_ENDS_AFTER_SECONDS = 0.4;

/**
 * How far back an onset or a gap may reach. A syllable lasts about a quarter of a
 * second and its rise develops over the first few readings of it; a change spread
 * over longer than this window is a swell or a fade, and throws no chips.
 *
 * Half a syllable, rather than the reading or two it was. In connected speech a
 * syllable rarely jumps {@link ONSET_RISE} between two 40 ms readings, so the
 * shorter window found an onset only about every second and a half of talking and
 * the rim was still for most of a sentence; reaching back five readings finds the
 * same rise spread over three or four of them. On the check's recorded line, a
 * window of one reading throws 0.68 bursts a second of speech against the 1.33
 * this one throws. It is as far back as the window can reach and still ignore a
 * fade: a voice falling from 0.6 to silence over two seconds — the slowest thing
 * that still must not burst — loses 10 dB across a window of 0.22 s or wider.
 */
export const CHANGE_WINDOW_SECONDS = 0.2;
/**
 * How much the level must rise within {@link CHANGE_WINDOW_SECONDS} to be an
 * onset. From an ordinary spoken level of about 0.3 this is close to an 8 dB jump.
 *
 * This is what decides how often the rim throws chips, far more than the spacing
 * rules below: on the recorded line it throws 1.33 bursts a second of speech, which
 * puts chips on screen for about a third of the frames he speaks in — the density
 * of the film's "Doctor.", where they show in 10 of its 37 frames. A threshold low
 * enough to take every reading as an onset would throw 3.2 a second through the
 * same flurry gate, so the gate still has headroom and this is the limit.
 *
 * It cannot fall much further. At this value a swell must climb faster than about
 * 0.93 a second before it counts as an onset, and the swell the tests hold it to
 * climbs to 0.9 in a second — a 3% margin. A swell is exactly what must never
 * throw chips, so the room below is already thin.
 */
export const ONSET_RISE = 0.17;
/** How far the voice must fall within {@link CHANGE_WINDOW_SECONDS}, straight after speech, to be a gap. */
export const GAP_DROP_DECIBELS = 10;
/**
 * The shortest time between two bursts. The film's two bursts in "Doctor." are
 * about a quarter of a second apart, and a chip takes about a fifth of a second
 * to fade, so closer bursts would pile up into a continuous spray.
 */
export const MINIMUM_BURST_SPACING_SECONDS = 0.25;
/**
 * How many bursts come in quick succession before the rim rests. The film throws
 * its chips in flurries and then leaves the rim alone for the rest of the scene —
 * "no continuous particle stream" — so this caps a flurry rather than setting a
 * cadence. On the recorded line it binds only in the densest passages: the gate
 * would pass 3.2 bursts a second and the onsets ask for 1.33.
 */
export const BURSTS_PER_FLURRY = 4;
/**
 * How long the rim rests after a flurry. It is a ceiling rather than a cadence:
 * on the check's recorded line, onsets sharp enough to throw a burst come about
 * three quarters of a second apart of speech, so the rest is only reached where
 * he runs syllables together. With the flurry size above it would allow 3.2 bursts
 * a second; that the line settles at 1.33 is how we know {@link ONSET_RISE} and
 * not this is the limit.
 */
export const BURST_REST_SECONDS = 0.6;
/** A rise or fall this large, in level, throws a full-strength burst; smaller ones throw weaker bursts in proportion. */
export const FULL_BURST_CHANGE = 0.6;
/** The burst age reported before the first burst: long enough ago that any burst would have finished. */
export const NO_BURST_AGE_SECONDS = 10;

/**
 * The level is the square root of the RMS amplitude, and an amplitude in
 * decibels is 20·log10 of it, so falling by D decibels multiplies the level by
 * 10^(−D/40): about 0.56 for a 10 dB gap.
 */
const GAP_LEVEL_RATIO = 10 ** (-GAP_DROP_DECIBELS / 40);

/**
 * The change window is kept as four slices, each holding only the quietest and
 * loudest level seen in it; remembering every reading instead would take a
 * buffer whose length depends on the frame rate. The slice being filled and the
 * three before it reach back between three quarters of the window and all of
 * it. At least 150 ms always takes in the fourth reading back at 30 Hz or faster
 * — a reading lasts 40 ms, and a change is seen at most a frame late — so a
 * syllable that rises over three or four readings is caught wherever the slice
 * boundaries happen to fall.
 */
const CHANGE_WINDOW_SLICES = 4;
const SLICE_SECONDS = CHANGE_WINDOW_SECONDS / CHANGE_WINDOW_SLICES;

/**
 * Slack for comparing summed frame steps with a duration. Sixtieths of a second
 * rarely add up to exactly a quarter, and without a little slack the same
 * spacing would end a frame later at some frame rates than at others.
 */
const TIME_SLACK_SECONDS = 1e-6;

/**
 * What the hologram remembers about the voice from one frame to the next.
 *
 * Plain numbers only, so it can live in a Reanimated shared value and cross
 * between the JS and UI runtimes; {@link advanceVoiceActivity} updates it in
 * place, so a frame allocates nothing.
 */
export interface VoiceActivityState {
  /** 0–1: how agitated the sphere is. Ramps up while speech is present and back down once it is gone. */
  agitation: number;
  /** Seconds since the latest chip burst began; {@link NO_BURST_AGE_SECONDS} or more before the first. */
  burstAge: number;
  /** 0–1: how strong the latest burst was. Kept as the burst ages; the drawing fades chips by age. */
  burstStrength: number;
  /** How many bursts there have been, so each can throw its chips from a different, repeatable place. */
  burstCount: number;
  /** How long there has been no speech, in seconds: what ends a flurry. */
  quietSeconds: number;
  /**
   * The loudest this voice has been lately, which is what its own loudness is judged against.
   *
   * A phone microphone in a quiet room and a tone injected into an emulator are nowhere near
   * the same loudness, and the sphere answered the absolute number: the user, whose microphone
   * is evidently at the quiet end, saw almost nothing however hard the answer was turned up.
   * Judged against this instead, a quiet voice fills the sphere as completely as a loud one.
   * It rises the moment a reading beats it and falls back over LOUDEST_MEMORY_SECONDS, so it
   * follows whoever is talking now rather than the loudest thing it ever heard.
   */
  loudest: number;
  /** How many bursts the flurry in progress has thrown. Resets when the rim rests, and when speech stops. */
  burstsInFlurry: number;
  /** The level the previous frame saw, which has held from then until now. */
  heldLevel: number;
  /** The quietest level in the slice of the change window being filled now. */
  quietestInThisSlice: number;
  /** The loudest level in the slice being filled now. */
  loudestInThisSlice: number;
  /** The quietest level in the slice before it. */
  quietestOneSliceAgo: number;
  /** The loudest level in the slice before it. */
  loudestOneSliceAgo: number;
  /** The quietest level in the slice before that. */
  quietestTwoSlicesAgo: number;
  /** The loudest level in the slice before that. */
  loudestTwoSlicesAgo: number;
  /** The quietest level in the oldest slice still in the window. */
  quietestThreeSlicesAgo: number;
  /** The loudest level in the oldest slice still in the window. */
  loudestThreeSlicesAgo: number;
  /** How long the slice being filled has been filling, in seconds. */
  thisSliceSeconds: number;
}

/** A calm sphere that has heard nothing yet: no agitation, no burst, and silence throughout the change window. */
export function createVoiceActivityState(): VoiceActivityState {
  return {
    agitation: 0,
    burstAge: NO_BURST_AGE_SECONDS,
    burstStrength: 0,
    burstCount: 0,
    loudest: 0,
    quietSeconds: 0,
    burstsInFlurry: 0,
    heldLevel: 0,
    quietestInThisSlice: 0,
    loudestInThisSlice: 0,
    quietestOneSliceAgo: 0,
    loudestOneSliceAgo: 0,
    quietestTwoSlicesAgo: 0,
    loudestTwoSlicesAgo: 0,
    quietestThreeSlicesAgo: 0,
    loudestThreeSlicesAgo: 0,
    thisSliceSeconds: 0,
  };
}

// The helpers below come before advanceVoiceActivity on purpose: the worklets
// plugin captures the functions a worklet calls at the moment it is defined.

/**
 * Agitation after `deltaSeconds` in which `heldLevel` held: up a linear ramp if
 * that was speech, down one if it was not.
 */
/** The loudest this voice has been lately: up at once to anything louder, back down slowly. */
function rememberLoudest(loudest: number, level: number, deltaSeconds: number): number {
  'worklet';
  if (level > loudest) {
    return level;
  }
  // Exponential, like easeLevel, so the same stretch of quiet forgets the same amount however
  // the frames are sliced. A plain fraction of the step is frame-rate dependent, and since the
  // speech gate is judged against this, that made the whole tracker answer differently at 30 Hz
  // and at 120 — which is what the frame-rate checks are there to catch, and did.
  return loudest + (level - loudest) * (1 - Math.exp(-deltaSeconds / LOUDEST_MEMORY_SECONDS));
}

function rampAgitation(agitation: number, heldLevel: number, loudest: number, deltaSeconds: number): number {
  'worklet';
  return heldLevel >= speakingThreshold(loudest)
    ? Math.min(1, agitation + deltaSeconds / AGITATION_RISE_SECONDS)
    : Math.max(0, agitation - deltaSeconds / AGITATION_RELEASE_SECONDS);
}

/**
 * Slides the change window on by `deltaSeconds`. The held level filled the rest
 * of the slice being filled and every slice that began before now; `level`
 * starts in the newest.
 */
function slideChangeWindow(state: VoiceActivityState, heldLevel: number, level: number, deltaSeconds: number): void {
  'worklet';
  state.quietestInThisSlice = Math.min(state.quietestInThisSlice, heldLevel);
  state.loudestInThisSlice = Math.max(state.loudestInThisSlice, heldLevel);
  const filledSeconds = state.thisSliceSeconds + deltaSeconds;
  const slicesEnded = Math.floor((filledSeconds + TIME_SLACK_SECONDS) / SLICE_SECONDS);
  for (let slice = 0; slice < Math.min(slicesEnded, CHANGE_WINDOW_SLICES); slice++) {
    state.quietestThreeSlicesAgo = state.quietestTwoSlicesAgo;
    state.loudestThreeSlicesAgo = state.loudestTwoSlicesAgo;
    state.quietestTwoSlicesAgo = state.quietestOneSliceAgo;
    state.loudestTwoSlicesAgo = state.loudestOneSliceAgo;
    state.quietestOneSliceAgo = state.quietestInThisSlice;
    state.loudestOneSliceAgo = state.loudestInThisSlice;
    state.quietestInThisSlice = heldLevel;
    state.loudestInThisSlice = heldLevel;
    state.loudest = rememberLoudest(state.loudest, state.loudestOneSliceAgo, SLICE_SECONDS);
  }
  state.thisSliceSeconds = Math.max(0, filledSeconds - slicesEnded * SLICE_SECONDS);
  if (slicesEnded > 0 && state.thisSliceSeconds <= TIME_SLACK_SECONDS) {
    // The newest slice begins this very moment, so the held level never reached it.
    state.quietestInThisSlice = level;
    state.loudestInThisSlice = level;
  }
  state.quietestInThisSlice = Math.min(state.quietestInThisSlice, level);
  state.loudestInThisSlice = Math.max(state.loudestInThisSlice, level);
}

/** Forgets the quiet a rise came from, throughout the window, so that rise cannot count again. */
function forgetQuietest(state: VoiceActivityState, level: number): void {
  'worklet';
  state.quietestInThisSlice = level;
  state.quietestOneSliceAgo = level;
  state.quietestTwoSlicesAgo = level;
  state.quietestThreeSlicesAgo = level;
}

/**
 * How long the rim must wait before the next burst: the spacing while a flurry is still filling,
 * the longer rest once it is full.
 */
function burstSpacing(state: VoiceActivityState): number {
  'worklet';
  return state.burstsInFlurry >= BURSTS_PER_FLURRY ? BURST_REST_SECONDS : MINIMUM_BURST_SPACING_SECONDS;
}

/**
 * Throws a burst now, as strong as the change that caused it, and counts it into the flurry —
 * beginning a new one if the rim had already rested through a full flurry.
 */
function beginBurst(state: VoiceActivityState, change: number): void {
  'worklet';
  state.burstAge = 0;
  state.burstStrength = Math.min(1, change / FULL_BURST_CHANGE);
  state.burstCount += 1;
  state.burstsInFlurry = state.burstsInFlurry >= BURSTS_PER_FLURRY ? 1 : state.burstsInFlurry + 1;
}

/** Forgets the loud a fall came from, throughout the window, so that fall cannot count again. */
function forgetLoudest(state: VoiceActivityState, level: number): void {
  'worklet';
  state.loudestInThisSlice = level;
  state.loudestOneSliceAgo = level;
  state.loudestTwoSlicesAgo = level;
  state.loudestThreeSlicesAgo = level;
}

/**
 * Counts how long the voice has been gone, and ends the flurry once it has been gone long enough,
 * so the next word starts a fresh one.
 *
 * The comparison carries the same slack the burst spacing does: sixtieths and
 * hundred-and-twentieths of a second do not add up to four tenths identically, and without it the
 * flurry ends a frame apart at different frame rates and every burst after it diverges.
 */
function endFlurryAfterSilence(state: VoiceActivityState, level: number, deltaSeconds: number): void {
  'worklet';
  state.quietSeconds = level >= speakingThreshold(state.loudest) ? 0 : state.quietSeconds + deltaSeconds;
  if (state.quietSeconds + TIME_SLACK_SECONDS >= FLURRY_ENDS_AFTER_SECONDS) {
    state.burstsInFlurry = 0;
  }
}

/**
 * Moves the voice activity on by one frame, in place, and returns the same state.
 *
 * `rawLevel` is the latest reading through {@link perceivedLevel}, before any
 * easing: easing is exactly what smears an onset or a gap into a slope.
 *
 * - **Agitation** climbs to 1 over {@link AGITATION_RISE_SECONDS} while the level
 *   is speech and falls to 0 over {@link AGITATION_RELEASE_SECONDS} while it is
 *   not. It is the same for a whisper as for a shout: the film shows speech as a
 *   change of state, not as a loudness meter.
 * - **A burst** begins on an onset — the level has risen by {@link ONSET_RISE}
 *   from the quietest point in the change window — or on a gap — it has fallen by
 *   more than {@link GAP_DROP_DECIBELS} from the loudest point, and that point was
 *   speech. Its strength is the size of the change.
 * - **Each rise and each fall counts once.** Once seen, the quiet it rose from or
 *   the loud it fell from is forgotten, so the same change cannot throw another
 *   burst on the frames after, while it is still in the window.
 * - **Bursts are at least {@link MINIMUM_BURST_SPACING_SECONDS} apart.** A change
 *   that comes sooner is let go rather than saved for later, so a burst always
 *   marks a moment the voice actually changed, never merely the moment the
 *   spacing ran out.
 * - **Bursts come in flurries, not in a stream.** After
 *   {@link BURSTS_PER_FLURRY} of them the rim rests for
 *   {@link BURST_REST_SECONDS} before another can fly, and speech falling silent
 *   ends the flurry. Left at the spacing floor, dense speech would throw three a
 *   second and chips would be on screen more often than not; the film throws two
 *   and then none.
 *
 * A frame cannot know when, since the one before, a new reading arrived, so it
 * takes the level the previous frame saw to have held until now and the new one
 * to start now. A change therefore counts from the frame that first sees it —
 * at most a frame after it happened — for agitation and bursts alike, and with
 * linear ramps and a window measured in seconds, that frame is the only way the
 * frame rate shows: a change that lands on a frame gives the same result at
 * 30 Hz as at 120 Hz. In dense speech a frame of lateness can decide whether a
 * change falls just inside the spacing or just outside it, so which syllables
 * throw bursts can differ between frame rates, but how often they come and how
 * strong they are does not.
 *
 * A step that is not a positive, finite number of seconds changes nothing, and a
 * level that is not a finite number, or is below zero, counts as silence.
 */
export function advanceVoiceActivity(
  state: VoiceActivityState,
  rawLevel: number,
  deltaSeconds: number,
): VoiceActivityState {
  'worklet';
  if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) {
    return state;
  }
  const level = rawLevel > 0 && Number.isFinite(rawLevel) ? Math.min(1, rawLevel) : 0;
  // Read before the window slides, so the gate this frame is judged against the memory as it
  // stood at the last slice boundary rather than one that moves under it. A threshold that
  // creeps between frames is crossed at a different moment at 30 Hz than at 120, and the whole
  // tracker then answers differently at different frame rates — which is what the frame-rate
  // checks exist to catch, and did.
  state.agitation = rampAgitation(state.agitation, state.heldLevel, state.loudest, deltaSeconds);
  slideChangeWindow(state, state.heldLevel, level, deltaSeconds);
  state.heldLevel = level;

  const quietest = Math.min(
    state.quietestInThisSlice,
    state.quietestOneSliceAgo,
    state.quietestTwoSlicesAgo,
    state.quietestThreeSlicesAgo,
  );
  const loudest = Math.max(
    state.loudestInThisSlice,
    state.loudestOneSliceAgo,
    state.loudestTwoSlicesAgo,
    state.loudestThreeSlicesAgo,
  );
  const rise = level - quietest;
  const drop = loudest - level;
  const isOnset = rise >= ONSET_RISE;
  const isGap = loudest >= speakingThreshold(state.loudest) && level < loudest * GAP_LEVEL_RATIO;

  state.burstAge += deltaSeconds;
  endFlurryAfterSilence(state, level, deltaSeconds);
  if ((isOnset || isGap) && state.burstAge + TIME_SLACK_SECONDS >= burstSpacing(state)) {
    beginBurst(state, Math.max(isOnset ? rise : 0, isGap ? drop : 0));
  }

  if (isOnset) {
    forgetQuietest(state, level);
  }
  if (isGap) {
    forgetLoudest(state, level);
  }
  return state;
}
