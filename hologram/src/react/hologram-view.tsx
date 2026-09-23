import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  advanceVoiceActivity,
  createDensityControl,
  createHologramResources,
  createHologramScene,
  createVoiceActivityState,
  type DensityPace,
  drawHologram,
  easeBands,
  easeHearing,
  easeHearingLevel,
  easeLevel,
  foldSpectrum,
  hearingFromPresence,
  hearingLevelFromVolume,
  MATERIALISE_SECONDS,
  PARTICLE_COUNT,
  perceivedLevel,
  seedFromRemembered,
  steerDensity,
  VOICE_BAND_COUNT,
  voiceDrive,
} from '../index';
import type { JarvisVoice, UserVoice } from '../voice-contract';
import { useIsForeground } from './is-foreground';
import { LEAVING_SECONDS } from './leaving';

export interface JarvisHologramProps {
  /** Width and height of the square it is drawn in, in points. */
  size: number;
  /** The voice it follows — Jarvis's, or the user's in sample mode: whether to listen, and how to read it. */
  voice: JarvisVoice;
  /**
   * The quietest a reading can be and still count as speech, on this voice's scale.
   *
   * Left out, the tracker's own default applies. It is a prop because a volume is not the same
   * quantity in a browser as on a phone — see `QUIETEST_SPEECH` — and the app knows which it is
   * handing over.
   */
  quietestSpeech?: number;
  /**
   * The person talking to him, if anyone is: while they speak his particles snap onto a
   * lattice that turns inside him, breathing with how loud they are. Left out, he never shows it.
   */
  user?: UserVoice;
  /**
   * Whether Jarvis is working on something rather than listening or talking — a tool call, say.
   *
   * Not a voice. It is a separate thing he can be doing, and it looks like nothing else he does:
   * see `SCAN_SECONDS` in the drawing. Eased in and out over {@link THOUGHT_FADE_SECONDS} here, so
   * that starting and finishing a thought is a fade rather than a switch.
   */
  thinking?: boolean;
  /**
   * Whether Jarvis is on his way out — the screen closing, the back button pressed.
   *
   * He does not vanish: he shrinks and fades over {@link LEAVING_SECONDS}, which is the arrival
   * run backwards without its ceremony. Whoever sets this is responsible for waiting that long
   * before actually closing anything; see `sample-screen.tsx`.
   */
  leaving?: boolean;
  /**
   * Somewhere to put how many frames a second are actually being drawn, if anyone is watching.
   *
   * A shared value rather than a callback, because this is written on the UI thread every time a
   * picture is built and calling back into React from there — thirty times a second — would cost
   * more than the number is worth. It measures what is achieved rather than what is asked for: the
   * frame callback fires with the screen, so a device that cannot keep up reports what it managed.
   */
  frameRate?: SharedValue<number>;
  /**
   * Somewhere to put the share of the particles being drawn, if anyone is watching.
   *
   * It is not set from outside: the hologram decides it, by measuring what the phone manages and
   * moving it until that is the target frame rate. See `density-control.ts`. This is only so the
   * readout can say what it settled on.
   */
  particleShare?: SharedValue<number>;
  /**
   * Somewhere to put the most this phone has been seen drawing at the cap, for keeping.
   *
   * Different from {@link particleShare}, which is what is being drawn now and falls whenever
   * something else on the phone gets busy. This only rises, and it is the one worth writing down.
   */
  provenShare?: SharedValue<number>;
  /**
   * What share to begin at, from whatever was written down last time — half of it.
   *
   * Left out, the loop starts at the floor and climbs, which is what a phone that has never been
   * measured does and what every phone does after an update that moves the drawing's cost. Given,
   * it is `startFromRemembered` of a count this phone was seen holding, which is deliberately only
   * half: see `REMEMBERED_SHARE`. Either way the first second is spent going up, never down.
   */
  startingShare?: number;
  /**
   * The frame rate the density loop holds, and the build budget it steers by. Left out, it is the
   * phone's forty; the watch asks for thirty, and spends what that frees on particles. See
   * `DensityPace`.
   */
  pace?: DensityPace;
  /**
   * How many fragments the scene is built from at all — the ceiling the density share is a share
   * *of*, rather than how many are drawn right now.
   *
   * Left alone it is {@link PARTICLE_COUNT}, which is what a phone gets. A watch should ask for far
   * fewer, and this is the only way to give it them: the share in `density-control.ts` thins the
   * scene by skipping fragments *inside* the loop, so however low it goes the loop still visits
   * every one. Building the scene is not free either — that many fragments times `BODY_STRIDE`
   * numbers, serialised into the worklet runtime when the view mounts. Neither cost can be steered
   * away from, on any device, which is why it is a parameter and not a measurement.
   */
  particleCount?: number;
  /**
   * Somewhere to put how long *building* one picture takes, in milliseconds, if anyone is watching.
   *
   * The companion to {@link frameRate}, and together they say where a slow frame goes. A frame has
   * two halves: this one, which is JavaScript on the UI thread, and painting the picture, which is
   * Skia. Headlessly they are 3.7 ms and 17 ms — but headlessly is a desktop with a JIT and a
   * software rasteriser, and the phone is neither. On a phone the same drawing runs at 58 frames a
   * second in Chrome and 11 in the app, so something in the native path costs far more than
   * anything that can be measured here, and this is the only instrument that can say which half.
   *
   * The same timing is what the density loop now steers by, whether or not this is passed: see
   * `BUILD_BUDGET_MS`. This is only where the readout finds it.
   */
  buildMilliseconds?: SharedValue<number>;
  /**
   * Whether there is anything behind the canvas worth seeing through it.
   *
   * It is not a look, it is which Android view Skia draws into. Left alone, `<Canvas>` uses a
   * `TextureView`: an extra copy of every frame into a texture, and a sync with the UI thread to
   * composite it. Told it is opaque, it uses a `SurfaceView`, which SurfaceFlinger puts on the
   * screen directly.
   *
   * So pass it wherever the hologram sits on something solid — the sheet, the conversation screen
   * — and leave it alone where the point is to see through to what is behind. And do not pass it
   * on anything that slides: a SurfaceView is its own layer and does not move with the view tree,
   * which is why the sheet finishes arriving before Jarvis appears in it.
   */
  opaque?: boolean;
  /**
   * What colour to paint the canvas before drawing on it.
   *
   * Needed because of {@link opaque}. A `SurfaceView` is its own hardware layer with nothing behind
   * it, so an opaque canvas that paints no background is a black rectangle sitting on whatever it
   * was placed on — which is exactly how it looked in the sheet. Given a colour it paints that, and
   * the canvas can fill the sheet with no seam between them.
   */
  background?: string;
}

/** How long it takes to fall into a thought, and to come out of one. */
const THOUGHT_FADE_SECONDS = 0.45;

/**
 * How long the canvas is covered for when it first appears, in milliseconds.
 *
 * **An opaque canvas is a `SurfaceView`, and a `SurfaceView` starts black.** It is a hardware layer
 * of its own: the window is punched through where it sits, and until the first frame has been
 * drawn into it what shows is an empty buffer — a black square, for as long as it takes Skia to
 * build a picture and hand it over. Against a dark sheet that is a flash of something squarer and
 * blacker than everything round it, arriving exactly when the sheet has finished sliding up and the
 * eye is already there.
 *
 * So a plain view of the background colour is laid over the canvas and faded off once there is
 * something underneath it. Nothing is hidden by that: it is over in a sixth of a second and the
 * sphere spends its first {@link MATERIALISE_SECONDS} coming out of nothing anyway.
 */
const UNCOVER_MS = 160;

/** How long to wait for a first frame before taking the cover off regardless. See its use. */
const GIVE_UP_COVERING_MS = 900;

/**
 * What share of the screen's own resolution the sphere is drawn at, before being scaled back up.
 *
 * **This is the frame rate, and nothing else here comes close.** Split apart, a frame is 1.2 ms of
 * building the picture and forty-odd of painting it: the drawing is fill-bound, not
 * JavaScript-bound, and fill is pixels. Measured with the same picture at three sizes — 384 px
 * costs 49 ms, 269 px costs 28 ms, 230 px costs 22 ms — while the building stays at 1.2 ms
 * throughout, which is the proof that resolution is the whole of it.
 *
 * So the canvas is laid out at this share and scaled up. It went in at 0.7, which halved the
 * pixels; the user asked for "a lot" more, and this is a fifth of what a full-resolution canvas
 * would cost. What it buys is worth the sharpness because of what this drawing is: soft glowing
 * strokes over a soft shadow, with no text and no hard edges anywhere in it. On a phone at three
 * device pixels to the point it is still drawn at better than one and a half.
 *
 * One number, and the only one worth touching for speed.
 */
const DRAWN_RESOLUTION = 0.45;

/**
 * The shortest gap between two drawn frames: a hundred and twenty a second at most.
 *
 * **This is a safety rail, not the frame rate.** What Jarvis actually runs at is decided by
 * `density-control.ts`, which adds particles until the frame rate falls to the rate it is aiming
 * for — see `TARGET_FRAMES_PER_SECOND`. This only stops a very fast phone with very few particles
 * from redrawing faster than any screen can show.
 *
 * **It was a forty-eighth for an hour, and that was a real mistake**: capping at the rate the loop
 * was aiming for made the loop blind, because a measurement can never come back above its own cap,
 * so "exactly fast enough" and "could draw three times as much" read identically. On a 60 Hz screen
 * it was worse than blind. A gate can only produce the refresh divided by a whole number, so a
 * forty-eighth yields thirty there — and the loop, told to hold forty, read thirty as the phone
 * struggling and stripped the particles to the floor. Two hundred and fifty of the five thousand
 * there were then, at a rate the cap itself had imposed.
 *
 * A hundred-and-twenty-eighth rather than a hundred-and-twentieth so the arithmetic lands on the
 * right side of a real screen's timing: at 120 Hz frames arrive every 8.3 ms, which clears 7.8 and
 * draws every one.
 *
 * The clock is not tied to it either way. Time keeps adding up every frame the screen offers and
 * the whole of it is handed over when a picture is built, so this changes how often Jarvis is drawn
 * and never how fast he moves.
 */
const MINIMUM_FRAME_SECONDS = 1 / 128;

/** How long the frame rate is averaged over before it is reported. Long enough not to flicker. */
const FRAME_RATE_OVER_SECONDS = 0.5;

/**
 * The most of a single frame that counts as *drawing*, when the rate is being measured.
 *
 * A frame rate is frames over the time they took, and a mean is destroyed by one outlier. When a
 * phone stalls — a re-render rebuilding the drawing worklet, a collection, another app waking up —
 * one gap can be two seconds long, and a window containing it reports half a frame a second: not
 * because the drawing is expensive, but because for two of those seconds nothing was drawing at
 * all. `density-control.ts` then has to defend itself against a reading that was never a
 * measurement of anything it can change, and no amount of care there can put back information the
 * measurement threw away.
 *
 * So a gap longer than this is counted as this. A fifth of a second is five frames a second, which
 * is already far past anything the controller distinguishes — it treats everything below half the
 * target as simply "too slow" — so nothing real is lost, and a freeze stops being reported as
 * though it were the cost of the particles.
 *
 * **Only the measurement is capped.** `deltaSeconds` below is the real time that passed and stays
 * that way, because that is what Jarvis moves by: shortening the clock would make him stutter
 * through a gap instead of arriving where the wall clock says he should be.
 */
const LONGEST_FRAME_WORTH_MEASURING = 0.2;

/**
 * How often the voice is read. The SDK's native processors refresh every 40 ms,
 * so reading faster only re-reads the same value; the UI thread eases between
 * readings every frame, which is where the smoothness comes from.
 */
const READ_INTERVAL_MS = 40;

/** The step assumed for a frame with no previous one to measure from. */
const DEFAULT_FRAME_MS = 16;

/** A mean, or nought when there is nothing to take one of — which the density loop reads as "untimed". */
function meanOf(total: number, count: number): number {
  'worklet';
  return count > 0 ? total / count : 0;
}

/** Fixed, so the hologram has the same shape every time the app opens. */
const SCENE_SEED = 1337;

/**
 * Jarvis, drawn: a golden holographic sphere that turns on its own and grows
 * agitated while he speaks.
 *
 * Three clocks keep each other honest. The JS thread reads the voice every
 * 40 ms and stores it as a target. The UI thread, every frame, eases the drawn
 * level toward that target, advances the voice-activity tracker and advances
 * time. And the picture is re-recorded from those values on the UI thread, so
 * neither a busy JS thread nor a slow reading can make the animation stutter —
 * at worst the sphere reacts a frame late.
 */
function JarvisHologramView({
  size,
  voice,
  quietestSpeech,
  user,
  thinking = false,
  leaving = false,
  frameRate,
  particleShare,
  provenShare,
  startingShare,
  pace,
  particleCount = PARTICLE_COUNT,
  buildMilliseconds,
  opaque = false,
  background,
}: JarvisHologramProps) {
  const { listening, speaking, getVolume, getSpectrum } = voice;
  const isForeground = useIsForeground();
  const drawnSize = Math.round(size * DRAWN_RESOLUTION);
  const scene = useMemo(() => createHologramScene(SCENE_SEED, particleCount), [particleCount]);
  const resources = useMemo(() => createHologramResources(Skia, scene), [scene]);

  const targetLevel = useSharedValue(0);
  // The person talking to him, as last read: see `user`.
  const targetHearing = useSharedValue(0);
  const targetHearingLevel = useSharedValue(0);
  const targetBands = useSharedValue<number[]>(new Array(VOICE_BAND_COUNT).fill(0));
  const speakingNow = useSharedValue(speaking);
  const thinkingNow = useSharedValue(thinking);
  const leavingNow = useSharedValue(leaving);
  // Everything the drawing reads, in one value, advanced once a frame.
  //
  // These were six shared values — the clock, the level, the bands, and the
  // tracker's agitation, burst age and burst count. Each write is a reason for the
  // picture below to be recorded again, and each `.value` read of an object copies
  // it out of the UI runtime, so a frame that wrote four of them and read the
  // tracker's four fields separately paid for both several times over. What one
  // frame cannot see — whether the voice just started or stopped, and how long ago
  // the rim last threw chips — is the tracker's state, which rides along here so it
  // is advanced in place by the same `modify`.
  const frame = useSharedValue({
    time: 0,
    level: 0,
    bands: new Array(VOICE_BAND_COUNT).fill(0) as number[],
    speaking,
    thinking: 0,
    presence: 1,
    hearing: 0,
    hearingLevel: 0,
    activity: createVoiceActivityState(quietestSpeech),
  });

  useEffect(() => {
    speakingNow.value = speaking;
  }, [speaking, speakingNow]);

  useEffect(() => {
    thinkingNow.value = thinking;
  }, [thinking, thinkingNow]);

  useEffect(() => {
    leavingNow.value = leaving;
  }, [leaving, leavingNow]);

  useEffect(() => {
    if (!listening) {
      targetLevel.value = 0;
      targetBands.value = new Array(VOICE_BAND_COUNT).fill(0);
      return;
    }

    const read = () => {
      targetLevel.value = perceivedLevel(getVolume());
      targetBands.value = foldSpectrum(getSpectrum());
    };
    read();
    const timer = setInterval(read, READ_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      // Silence, not a reset: the tracker is left to settle on its own over its
      // release, so a conversation ending looks like Jarvis stopping talking
      // rather than the sphere going slack between two frames.
      targetLevel.value = 0;
      targetBands.value = new Array(VOICE_BAND_COUNT).fill(0);
    };
  }, [listening, getVolume, getSpectrum, targetLevel, targetBands]);

  // Read on the same beat as his voice, and only while there is someone to hear. Eased on the UI
  // thread, per frame, like everything else the drawing reads.
  const getPresence = user?.getPresence;
  const getUserVolume = user?.getVolume;
  useEffect(() => {
    if (getPresence === undefined || getUserVolume === undefined) {
      targetHearing.value = 0;
      targetHearingLevel.value = 0;
      return;
    }
    const read = () => {
      targetHearing.value = hearingFromPresence(getPresence());
      targetHearingLevel.value = hearingLevelFromVolume(getUserVolume());
    };
    read();
    const timer = setInterval(read, READ_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      targetHearing.value = 0;
      targetHearingLevel.value = 0;
    };
  }, [getPresence, getUserVolume, targetHearing, targetHearingLevel]);

  // The clock adds up each frame's step rather than reading the callback's own
  // start time. The callback is a new function on every render — the worklets
  // plugin builds it inline — and Reanimated re-registers a new one from zero,
  // so reading `timeSinceFirstFrame` would snap the sphere back to its opening
  // pose whenever the screen re-renders, which is exactly when Jarvis starts or
  // stops talking. A step is deliberately not capped: a slow frame has to
  // move the hologram as far as the time it stood for, or it turns slower
  // wherever frames are slow.
  // Inside `modify` for the reason voice-levels.ts explains: the tracker writes
  // into the state object it is given, and only `modify` hands the worklet the one
  // the UI runtime owns. Assigning a state from the JS runtime would leave every
  // write silently dropped in a development build. The rest of the frame is
  // advanced in the same call, so the picture is asked for once.
  // Time the screen has offered since the last picture was built. Held outside the frame value on
  // purpose: writing it there would be the very thing this is trying not to do.
  const waiting = useSharedValue(0);
  // Frames drawn since the rate was last worked out, and how long that has taken.
  const drawn = useSharedValue(0);
  const measuring = useSharedValue(0);
  // Pictures built in that time, and how long building them took in all. Their mean is what the
  // density loop steers by — see `steerDensity` — so it is timed whether or not anyone is watching.
  const built = useSharedValue(0);
  const buildingFor = useSharedValue(0);
  // How many of the particles this phone can afford, worked out while it draws them.
  //
  // Started from half of what this phone was last seen *holding*, and from the floor when there is
  // no such number — never from what it happened to be drawing a moment ago. It used to read the
  // live share back out of `particleShare`, on the reasoning that a view built again is the same
  // phone and should not have to re-measure. The reasoning is sound and the value is not: a shared
  // value outlives the view, and the assistant's window keeps its React surface between summonings
  // precisely so the second summoning has something to draw. So "built again" meant every
  // summoning after the first, and Jarvis opened at whatever count he had been dismissed at — on a
  // phone that had spent the time since doing something else entirely. The cost of dropping it is
  // a second of climbing after a re-render; the cost of keeping it was an entrance at a thousand
  // particles a phone could no longer afford. See `createDensityControl`.
  const density = useSharedValue(createDensityControl(startingShare, pace));

  // And again when it arrives, because it does not arrive in time to be the initial value above.
  // Reading it back is a promise and `useSharedValue` only ever uses its argument once, so without
  // this the count written down last time is read and then thrown away. See `seedFromRemembered`.
  useEffect(() => {
    if (startingShare === undefined) {
      return;
    }
    density.modify((control) => {
      'worklet';
      seedFromRemembered(control, startingShare);
      return control;
    });
  }, [startingShare, density]);

  // Whether the black of a fresh `SurfaceView` is still showing; see UNCOVER_MS. One per mount, so
  // a hologram built again — which is what a second summoning does — covers itself again.
  const covering = useSharedValue(1);
  const covered = useAnimatedStyle(() => ({ opacity: covering.value }));

  // And a way out of it that does not depend on anything else working.
  //
  // The cover is removed by the frame callback below, because the honest signal is a frame having
  // been asked for. But a cover that is only ever lifted by something else running is a cover that
  // hides Jarvis completely if that something else does not — an opaque square exactly where he
  // should be, which is a far worse failure than the flash it exists to hide. So it also comes off
  // on a timer, whatever happened. Whichever fires first wins; the second finds it already going.
  useEffect(() => {
    const anyway = setTimeout(() => {
      if (covering.value === 1) {
        covering.value = withTiming(0, { duration: UNCOVER_MS });
      }
    }, GIVE_UP_COVERING_MS);
    return () => clearTimeout(anyway);
  }, [covering]);

  const clock = useFrameCallback((info) => {
    waiting.value += (info.timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
    if (waiting.value < MINIMUM_FRAME_SECONDS) {
      return;
    }
    const deltaSeconds = waiting.value;
    waiting.value = 0;
    // A frame has been asked for, so a picture is about to exist. Exactly 1 only before the fade
    // has started, so this runs once.
    if (covering.value === 1) {
      covering.value = withTiming(0, { duration: UNCOVER_MS });
    }
    frame.modify((current) => {
      'worklet';
      current.time += deltaSeconds;
      current.level = easeLevel(current.level, targetLevel.value, deltaSeconds);
      current.bands = easeBands(current.bands, targetBands.value, deltaSeconds);
      current.speaking = speakingNow.value;
      // Toward whichever end the app is asking for, at a fixed rate: see THOUGHT_FADE_SECONDS.
      const towardThought = (thinkingNow.value ? 1 : -1) * (deltaSeconds / THOUGHT_FADE_SECONDS);
      current.thinking = Math.min(1, Math.max(0, current.thinking + towardThought));
      const towardGone = (leavingNow.value ? -1 : 1) * (deltaSeconds / LEAVING_SECONDS);
      current.presence = Math.min(1, Math.max(0, current.presence + towardGone));
      current.hearing = easeHearing(current.hearing, targetHearing.value, deltaSeconds);
      current.hearingLevel = easeHearingLevel(current.hearingLevel, targetHearingLevel.value, deltaSeconds);
      advanceVoiceActivity(current.activity, targetLevel.value, deltaSeconds);
      return current;
    });

    if (frameRate === undefined) {
      return;
    }
    drawn.value += 1;
    measuring.value += Math.min(deltaSeconds, LONGEST_FRAME_WORTH_MEASURING);
    if (measuring.value >= FRAME_RATE_OVER_SECONDS) {
      const measured = drawn.value / measuring.value;
      const meanBuild = meanOf(buildingFor.value, built.value);
      frameRate.value = measured;
      // Steered once per measurement rather than once a frame, because a rate averaged over half a
      // second is the only honest thing to steer by — and the controller's rate limits are written
      // in shares per second, so it does not care how often it is asked.
      density.modify((control) => {
        'worklet';
        steerDensity(control, measured, measuring.value, meanBuild);
        return control;
      });
      if (particleShare !== undefined) {
        particleShare.value = density.value.density;
      }
      if (provenShare !== undefined) {
        provenShare.value = density.value.proven;
      }
      drawn.value = 0;
      measuring.value = 0;
      built.value = 0;
      buildingFor.value = 0;
    }
  });

  // Nothing to draw for, so nothing is drawn.
  //
  // The frame callback is what moves the clock, and the picture below is rebuilt whenever it
  // does. Left running behind a backgrounded app that is a phone building a hologram nobody can
  // see, on every frame, for as long as the app stays in memory.
  useEffect(() => {
    // Back in front after being away: he materialises again rather than picking up mid-turn.
    //
    // The clock is what the whole materialisation is derived from, so winding it back to zero is
    // the whole of it. This matters most where it is least obvious: the assistant's window keeps
    // its React surface between summonings — it has to, or the second summoning has nothing to
    // draw — so without this the second time you press the button Jarvis is simply *there*, mid
    // rotation, with no arrival at all. Which is exactly what the user saw.
    if (isForeground) {
      frame.modify((current) => {
        'worklet';
        current.time = 0;
        current.presence = 1;
        return current;
      });
    }
    clock.setActive(isForeground);
  }, [clock, isForeground, frame]);

  // Building the picture, timed on the thread that does it. `performance.now` exists in the UI
  // runtime; the cost of asking it twice is nothing against what it is measuring.
  const picture = useDerivedValue(() => {
    const startedAt = performance.now();
    // Read once: this is a copy out of the UI runtime, and the drawing wants nine
    // fields of it.
    const current = frame.value;
    const activity = current.activity;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, drawnSize, drawnSize));
    if (background !== undefined) {
      canvas.drawColor(Skia.Color(background));
    }
    drawHologram(
      canvas,
      drawnSize,
      {
        time: current.time,
        // Judged against how loud this voice actually gets, not against full scale. A phone
        // microphone in a quiet room never comes near 1, and the sphere answering the absolute
        // number is why the user saw almost no change however far the answer was turned up.
        level: voiceDrive(current.level, activity.loudest),
        bands: current.bands,
        speaking: current.speaking,
        agitation: activity.agitation,
        burstAge: activity.burstAge,
        burstStrength: activity.burstStrength,
        burstCount: activity.burstCount,
        // The materialisation plays once, from the moment this canvas mounted.
        appearance: Math.min(1, current.time / MATERIALISE_SECONDS),
        thinking: current.thinking,
        hearing: current.hearing,
        hearingLevel: current.hearingLevel,
        presence: current.presence,
        density: density.value.density,
      },
      scene,
      resources,
    );
    const recorded = recorder.finishRecordingAsPicture();
    const took = performance.now() - startedAt;
    built.value += 1;
    buildingFor.value += took;
    if (buildMilliseconds !== undefined) {
      // Eased, because one frame's figure jumps about and what is wanted is the shape of it.
      buildMilliseconds.value = buildMilliseconds.value * 0.9 + took * 0.1;
    }
    return recorded;
  });

  // Laid out small and scaled up: see DRAWN_RESOLUTION. The scale is about the canvas's own
  // centre, which is the container's centre too, so the sphere lands exactly where a full-sized
  // canvas would have put it.
  //
  // The scale is on a plain `View` wrapped round the canvas rather than on the canvas itself,
  // which looks like a needless layer and is not: Skia's web canvas does not pass an arbitrary
  // style through to the element, so put there the transform is silently dropped — the sphere is
  // drawn at 45% of its size in a browser and full size on a phone. Found by measuring the element
  // in a real page, because nothing about it fails.
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: drawnSize, height: drawnSize, transform: [{ scale: 1 / DRAWN_RESOLUTION }] }}>
        <Canvas opaque={opaque} style={{ width: drawnSize, height: drawnSize }}>
          <Picture picture={picture} />
        </Canvas>
      </View>
      {/*
        Over the canvas rather than under it, and after it in the tree so that it is: a `SurfaceView`
        composites below the window, and anything drawn into the window after the hole was punched
        lands on top of it. Only where there is a colour to cover it *with* — on the web there is no
        `SurfaceView`, nothing starts black, and a square of anything would be the only bug here.

        The scaled canvas above comes back to exactly `size` across, so this covers it exactly.
      */}
      {background === undefined ? null : (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: background }, covered]}
        />
      )}
    </View>
  );
}

/**
 * Held still against its parent re-rendering.
 *
 * Every render of this component builds a new worklet for the picture below, and Reanimated
 * serialises what a worklet captures when it is created — here that includes the scene, which is
 * the largest thing the app owns. A screen that re-rendered a few times a second for some
 * unrelated reason therefore cost frames, which is exactly what a live readout of the microphone
 * level did. The props are a number and a memoised object, so this holds.
 */
export const JarvisHologram = memo(JarvisHologramView);

// Also as the default, because the browser build reaches this module through a lazy
// `import()` — `WithSkiaWeb` renders whatever the imported module's default is.
export default JarvisHologram;
