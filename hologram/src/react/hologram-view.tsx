import { memo, useContext, useEffect, useMemo } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { createFlatCamera, drawGpuFrame, placeFlatCamera, STRAIGHT_ON, tiltedView } from '../gpu';
import {
  advanceFrameClock,
  advanceTiltBy,
  analyseFrame,
  arrivalOf,
  createDensityControl,
  createFrameClockState,
  createHologramScene,
  createTiltState,
  type DensityPace,
  type FrameClockState,
  foldSpectrum,
  frameStepSeconds,
  type Gravity,
  hearingFromPresence,
  hearingLevelFromVolume,
  hologramFrameOf,
  MATERIALISE_SECONDS,
  PARTICLE_COUNT,
  perceivedLevel,
  READ_INTERVAL_MS,
  resetTilt,
  restartArrival,
  type SatelliteOrbit,
  SCENE_SEED,
  steerDensity,
  VOICE_BAND_COUNT,
} from '../index';
import type { JarvisVoice, UserVoice } from '../voice-contract';
import { AgentSatellitesContext } from './agent-satellites';
import { drawingBufferSide } from './gl-context';
import { type GpuDrawing, useGpuLayer } from './gpu-layer';
import { useIsForeground } from './is-foreground';
import { NO_GRAVITY, TiltSensor } from './tilt-sensor';

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
   * frame is drawn and calling back into React from there — thirty times a second — would cost
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
   * The frame rate the density loop holds, and the build budget it steers by. Left out, it is the
   * phone's forty; the watch asks for thirty, and spends what that frees on particles. See
   * `DensityPace`.
   */
  pace?: DensityPace;
  /**
   * How many fragments the scene is built from at all — the ceiling the density share is a share
   * *of*, rather than how many are drawn right now.
   *
   * Left alone it is {@link PARTICLE_COUNT}, which is what the phone and the watch get. A renderer
   * that wants fewer has only this way to ask: building the scene is not free — that many fragments
   * times `BODY_STRIDE` numbers, built into the GPU's rows when the view mounts — and that cost
   * cannot be steered away from on any device, which is why it is a parameter and not a
   * measurement.
   */
  particleCount?: number;
  /**
   * Somewhere to put how long *building* one frame takes, in milliseconds, if anyone is watching:
   * the calls that issue the GPU's frame of him, body and all.
   *
   * The companion to {@link frameRate}, and together they say where a slow frame goes: this half
   * is JavaScript on the UI thread, and the rest is the GPU drawing. The same timing is what the
   * density loop steers by, whether or not this is passed: see `BUILD_BUDGET_MS`. This is only
   * where the readout finds it.
   */
  buildMilliseconds?: SharedValue<number>;
  /**
   * The colour he is drawn on, where he is not drawn over whatever is behind the view.
   *
   * The view behind the canvas paints it, and the canvas paints nothing behind him: it is faded by
   * his arrival and, on anything but black, Screened onto this colour, as every part of him is drawn.
   * The canvas painting it would put the colour into what is faded, and the fade would take it with
   * him.
   */
  background?: string;
  /**
   * The satellites to draw round him: which of his agents a request is using (`useAgentSatellites`).
   * Left out, the nearest {@link AgentSatellitesContext}'s, and none without one.
   */
  satellites?: SharedValue<SatelliteOrbit[]>;
  /**
   * Whether tilting the device turns the view round him, by up to `TILT_LARGEST_DEGREES` from a
   * rest pose that follows how it is held, so a device held still shows him straight on. Only while
   * his body is drawn, which is what can show him from the side. The phone and the watch both ask
   * for it. See `tilt.ts`.
   */
  tilt?: boolean;
  /**
   * What share of the screen's own resolution the canvas is drawn at, before being scaled back
   * up. Left out, {@link DRAWN_RESOLUTION}, which is what a phone gets. A watch asks for 1: its
   * sphere is a few hundred pixels across, so at the phone's share each spark is drawn a pixel or
   * less wide and smeared by the scale-up, where a phone's canvas still has the pixels to hide it.
   */
  drawnResolution?: number;
}

/**
 * What share of the screen's own resolution the sphere is drawn at, before being scaled back up.
 *
 * It went in when a CPU rasterised the picture, where the painting scaled with area and nothing else
 * came close; on the GPU the fragments shaded still scale with it, and the body's halos most of all.
 * What it buys is worth the sharpness because of what this drawing is: soft glowing strokes, with no
 * text and no hard edges anywhere in it. On a phone at three device pixels to the point it is drawn at
 * 1.35. That is the phone's share; a watch passes its own (`drawnResolution`).
 */
const DRAWN_RESOLUTION = 0.45;

/**
 * Whether a background is black, which the canvas is laid straight over rather than Screened onto:
 * the same thing there, for one layer less. A colour this cannot read is taken as not black, so it
 * is Screened onto, which is right whatever it is.
 */
function isBlack(background: string): boolean {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(background)?.[1];
  if (hex === undefined) return false;
  const digits = hex.length === 3 ? 1 : 2;
  for (let channel = 0; channel < 3; channel++) {
    if (Number.parseInt(hex.slice(channel * digits, channel * digits + digits), 16) > 0) return false;
  }
  return true;
}

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

/** The step assumed for a frame with no previous one to measure from. */
const DEFAULT_FRAME_MS = 16;

/** A mean, or nought when there is nothing to take one of — which the density loop reads as "untimed". */
function meanOf(total: number, count: number): number {
  'worklet';
  return count > 0 ? total / count : 0;
}

/**
 * Jarvis, drawn: a golden holographic sphere that turns on its own and grows
 * agitated while he speaks.
 *
 * Three clocks keep each other honest. The JS thread reads the voice every
 * 40 ms and stores it as a target. The UI thread, every frame, eases the drawn
 * level toward that target, advances the voice-activity tracker and advances
 * time. And the frame is drawn from those values on the UI thread, so
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
  pace,
  particleCount = PARTICLE_COUNT,
  buildMilliseconds,
  background,
  satellites,
  tilt = false,
  drawnResolution = DRAWN_RESOLUTION,
}: JarvisHologramProps) {
  const { listening, speaking, getVolume, getSpectrum } = voice;
  const isForeground = useIsForeground();
  // On the pixel grid. React Native rounds where a view's edges land to whole pixels, not its size,
  // so a view a fraction of a pixel across comes out a pixel wider or narrower depending on where
  // it is laid out — and expo-gl sizes the canvas from the view, which would then not be square. A
  // whole number of pixels is that number wherever it lands.
  const drawnSize = PixelRatio.roundToNearestPixel(size * drawnResolution);
  // The canvas in pixels, which on a device is the size it is laid out at, and whole by
  // construction: see `drawingBufferSide`.
  const laidOutPixels = Math.round(drawnSize * PixelRatio.get());
  const scene = useMemo(() => createHologramScene(SCENE_SEED, particleCount), [particleCount]);
  // What `analyseFrame` reads of the scene, which is all the GPU's frame needs of it: the frame
  // callback carries this rather than the whole scene, which is the largest thing the app owns.
  const script = useMemo(() => ({ epochs: scene.epochs, scriptPeriod: scene.scriptPeriod }), [scene]);
  const noSatellites = useSharedValue<SatelliteOrbit[]>([]);
  const shared = useContext(AgentSatellitesContext);
  const orbits = satellites ?? shared ?? noSatellites;

  const targetLevel = useSharedValue(0);
  // The person talking to him, as last read: see `user`.
  const targetHearing = useSharedValue(0);
  const targetHearingLevel = useSharedValue(0);
  const targetBands = useSharedValue<number[]>(new Array(VOICE_BAND_COUNT).fill(0));
  const speakingNow = useSharedValue(speaking);
  const thinkingNow = useSharedValue(thinking);
  const leavingNow = useSharedValue(leaving);
  // Everything the drawing reads, in one value, advanced once a frame: the frame clock the headset
  // steps too (see `frame-clock.ts` in the main entry).
  //
  // These were six shared values — the clock, the level, the bands, and the
  // tracker's agitation, burst age and burst count. Each `.value` read of an object
  // copies it out of the UI runtime, so a frame that wrote four of them and read the
  // tracker's four fields separately paid for it several times over. What one
  // frame cannot see — whether the voice just started or stopped, and how long ago
  // the rim last threw chips — is the tracker's state, which rides along here so it
  // is advanced in place by the same `modify`.
  const frame = useSharedValue(createFrameClockState(quietestSpeech, speaking));

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
  // advanced in the same call, so the frame is drawn from one state.
  // Time the screen has offered since the last frame was drawn. Held outside the frame value on
  // purpose: writing it there would be the very thing this is trying not to do.
  const waiting = useSharedValue(0);
  // Frames drawn since the rate was last worked out, and how long that has taken.
  const drawn = useSharedValue(0);
  const measuring = useSharedValue(0);
  // Frames built in that time, and how long building them took in all. Their mean is what the
  // density loop steers by — see `steerDensity` — so it is timed whether or not anyone is watching.
  const built = useSharedValue(0);
  const buildingFor = useSharedValue(0);
  // How many of the particles this device can afford, worked out while it draws them, from
  // `STARTING_SHARE`. Never from what it happened to be drawing a moment ago: a shared value outlives
  // the view, and the assistant's window keeps its React surface between summonings, so carrying
  // the share over would open Jarvis at whatever count he was dismissed at. See `createDensityControl`.
  const density = useSharedValue(createDensityControl(pace));
  const { layer, glView, glMounted, drawingThisFrame, gpuReady } = useGpuLayer({ scene, isForeground });

  // How much of him is here, for the canvas to be faded by. He is drawn unfaded and the view fades
  // him, as one picture: his body and the rest of him each faded before being Screened together
  // would come out brighter wherever they overlap.
  const arrivalNow = useSharedValue(0);
  const faded = useAnimatedStyle(() => ({ opacity: arrivalNow.value }));
  // On anything but black the canvas is Screened onto the background as every part of him is drawn;
  // on black, laying it on top is the same thing, for one layer less.
  const screensOntoBackground = background !== undefined && !isBlack(background);
  // Filled in every frame the GPU draws, so a frame allocates no matrices.
  const camera = useSharedValue(createFlatCamera());

  // One frame's build counted toward the density loop and the readout.
  const countBuild = (took: number) => {
    'worklet';
    built.value += 1;
    buildingFor.value += took;
    if (buildMilliseconds !== undefined) {
      // Eased, because one frame's figure jumps about and what is wanted is the shape of it.
      buildMilliseconds.value = buildMilliseconds.value * 0.9 + took * 0.1;
    }
  };
  // Tilt to look around: the eye round him, stepped once a frame the GPU draws, and the latest
  // gravity reading, which only the sensor writes. See `tilt.ts`.
  const tiltState = useSharedValue(createTiltState());
  const gravity = useSharedValue<Gravity>(NO_GRAVITY);

  // One frame of him on the GPU, from the clock as it has just been stepped, counted toward the
  // density loop and the readout. The wait for the previous frame is the GPU's time and is left out
  // of what is timed here: see `finishPreviousFrame`.
  const drawOnGpu = (drawing: GpuDrawing, current: FrameClockState, deltaSeconds: number) => {
    'worklet';
    const startedAt = performance.now();
    let view = STRAIGHT_ON;
    if (tilt) {
      const reading = gravity.value;
      tiltState.modify((state) => {
        'worklet';
        return advanceTiltBy(state, deltaSeconds, reading, current.hearing);
      });
      view = tiltedView(tiltState.value, camera.value.basis);
    }
    const share = density.value.density;
    const state = analyseFrame(hologramFrameOf(current), 1, script);
    // His square is the whole canvas.
    const side = drawingBufferSide(drawing.gl, laidOutPixels);
    const screen = { width: side, height: side, squareX: side / 2, squareY: side / 2, squareSide: side };
    camera.modify((placed) => {
      'worklet';
      return placeFlatCamera(placed, screen, state.radius, view.basis, view.eyeSquares);
    });
    // Unfaded: the view the canvas is in is faded by the arrival. The satellites round him, on his
    // clock, so they go round as smoothly as he turns, and arrive and leave with him.
    drawGpuFrame(
      drawing.gl,
      drawing.body,
      drawing.picture,
      { state, density: share, fade: 1, alphaFromLight: 1, camera: camera.value },
      orbits.value,
    );
    drawing.gl.endFrameEXP();
    countBuild(performance.now() - startedAt);
  };

  // A frame: the view's fade, and him where there is a GPU to draw him.
  const show = (deltaSeconds: number) => {
    'worklet';
    const current = frame.value;
    // The drawing's own arrival, without a frame built for it: `hologramFrameOf`'s appearance.
    arrivalNow.value = arrivalOf(Math.min(1, current.time / MATERIALISE_SECONDS), current.presence);
    const drawing = drawingThisFrame();
    if (drawing !== undefined) {
      drawOnGpu(drawing, current, deltaSeconds);
    }
  };

  // The frame counted toward the rate, and every FRAME_RATE_OVER_SECONDS the density steered by it.
  const measureFrame = (deltaSeconds: number) => {
    'worklet';
    drawn.value += 1;
    measuring.value += Math.min(deltaSeconds, LONGEST_FRAME_WORTH_MEASURING);
    if (measuring.value < FRAME_RATE_OVER_SECONDS) {
      return;
    }
    const measured = drawn.value / measuring.value;
    const meanBuild = meanOf(buildingFor.value, built.value);
    if (frameRate !== undefined) {
      frameRate.value = measured;
    }
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
    drawn.value = 0;
    measuring.value = 0;
    built.value = 0;
    buildingFor.value = 0;
  };

  const clock = useFrameCallback((info) => {
    // Held at the start of the arrival, where nothing of him shows, while the GPU is pending; and
    // the time that passes meanwhile is not his. See `useGpuLayer`.
    if (layer.value === 'pending' && !gpuReady()) {
      waiting.value = 0;
      return;
    }
    waiting.value += (info.timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
    // Nought while what has waited is still under MINIMUM_FRAME_SECONDS, and then the whole of it.
    const deltaSeconds = frameStepSeconds(waiting.value);
    if (deltaSeconds === 0) {
      return;
    }
    waiting.value = 0;
    frame.modify((current) => {
      'worklet';
      return advanceFrameClock(
        current,
        deltaSeconds,
        targetLevel.value,
        targetBands.value,
        speakingNow.value,
        thinkingNow.value,
        leavingNow.value,
        targetHearing.value,
        targetHearingLevel.value,
      );
    });
    show(deltaSeconds);
    // The density loop only runs for a view that is told where to put the frame rate.
    if (frameRate !== undefined) {
      measureFrame(deltaSeconds);
    }
  });

  // Nothing to draw for, so nothing is drawn.
  //
  // The frame callback is what moves the clock and draws him. Left running behind a backgrounded app that is a phone building a hologram nobody can
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
        return restartArrival(current);
      });
      // And straight on, with the first reading from here the rest pose, wherever the phone went.
      tiltState.modify((state) => {
        'worklet';
        return resetTilt(state);
      });
    }
    clock.setActive(isForeground);
  }, [clock, isForeground, frame, tiltState]);

  // Laid out small and scaled up: see `drawnResolution`. The scale is about the canvas's own
  // centre, which is the container's centre too, so the sphere lands exactly where a full-sized
  // canvas would have put it. It is on a view round the GL view, which takes no transform of its own
  // on every platform, and that view is also what the arrival fades and, on a background that is
  // not black, what is Screened onto it, which the outer view then paints, and bounds as the
  // backdrop of the Screen.
  return (
    <View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: background },
        screensOntoBackground ? styles.screenedBackdrop : null,
      ]}
    >
      <Animated.View
        renderToHardwareTextureAndroid
        style={[
          { width: drawnSize, height: drawnSize, transform: [{ scale: 1 / drawnResolution }] },
          screensOntoBackground ? styles.screenedOntoBackground : null,
          faded,
        ]}
      >
        {glView}
      </Animated.View>
      {/* Only while there is something to tilt: nothing else stops the sensor. See `TiltSensor`. */}
      {tilt && isForeground && glMounted ? <TiltSensor gravity={gravity} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Screened onto the view behind it, which paints the background. */
  screenedOntoBackground: { isolation: 'isolate', mixBlendMode: 'screen' },
  /**
   * That view behind, as the backdrop the canvas is Screened onto and nothing wider. With only a
   * background colour Fabric flattens a view away and mounts its children in the nearest view that
   * groups anything — in the conversation sheet, the pressable that fills it — and Android then
   * draws the Screen in two layers that size, rather than his square, whenever it redraws them.
   */
  screenedBackdrop: { isolation: 'isolate' },
});

/**
 * Held still against its parent re-rendering.
 *
 * Every render of this component builds a new frame callback, and Reanimated serialises what a
 * worklet captures when it is created — the scene's script and the GPU's handles here, and before
 * the GPU drew all of him the scene itself. A screen that re-rendered a few times a second for some
 * unrelated reason therefore cost frames, which is exactly what a live readout of the microphone
 * level did. The props are numbers, flags, shared values and memoised objects, so this holds.
 */
export const JarvisHologram = memo(JarvisHologramView);
