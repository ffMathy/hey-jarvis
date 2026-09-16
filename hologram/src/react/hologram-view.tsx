import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import {
  advanceVoiceActivity,
  createHologramResources,
  createHologramScene,
  createVoiceActivityState,
  drawHologram,
  easeBands,
  easeLevel,
  foldSpectrum,
  MATERIALISE_SECONDS,
  perceivedLevel,
  VOICE_BAND_COUNT,
  voiceDrive,
} from '../index';
import type { JarvisVoice } from '../voice-contract';
import { useIsForeground } from './is-foreground';

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
}

/** How long Jarvis takes to go. Shorter than he takes to arrive: leaving should not be a ceremony. */
export const LEAVING_SECONDS = 0.45;

/** How long it takes to fall into a thought, and to come out of one. */
const THOUGHT_FADE_SECONDS = 0.45;

/**
 * What share of the screen's own resolution the sphere is drawn at, before being scaled back up.
 *
 * **This is the frame rate, and nothing else here comes close.** Split apart, a frame at 384 px is
 * 1.2 ms of building the picture and 49 ms of painting it: the drawing is fill-bound, not
 * JavaScript-bound, and fill is pixels. Measured at three sizes with the same picture — 384 px
 * costs 49 ms, 269 px costs 28 ms, 230 px costs 22 ms — while the building stays at 1.2 ms
 * throughout, which is the proof that resolution is the whole of it.
 *
 * So the canvas is laid out at seven tenths and scaled up, which halves the pixels. What it costs
 * is sharpness, and this drawing has less to lose there than most: it is soft glowing strokes over
 * a soft shadow, and on a phone at three device pixels to the point it is still drawn at more than
 * two. It was raised from a half to seven tenths as a compromise between the two, and it is one
 * number to change if the trade wants moving either way.
 */
const DRAWN_RESOLUTION = 0.7;

/**
 * How often the voice is read. The SDK's native processors refresh every 40 ms,
 * so reading faster only re-reads the same value; the UI thread eases between
 * readings every frame, which is where the smoothness comes from.
 */
const READ_INTERVAL_MS = 40;

/** The step assumed for a frame with no previous one to measure from. */
const DEFAULT_FRAME_MS = 16;

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
function JarvisHologramView({ size, voice, quietestSpeech, thinking = false, leaving = false }: JarvisHologramProps) {
  const { listening, speaking, getVolume, getSpectrum } = voice;
  const isForeground = useIsForeground();
  const drawnSize = Math.round(size * DRAWN_RESOLUTION);
  const scene = useMemo(() => createHologramScene(SCENE_SEED), []);
  const resources = useMemo(() => createHologramResources(Skia, scene), [scene]);

  const targetLevel = useSharedValue(0);
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
  const clock = useFrameCallback((info) => {
    const deltaSeconds = (info.timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
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
      advanceVoiceActivity(current.activity, targetLevel.value, deltaSeconds);
      return current;
    });
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

  const picture = useDerivedValue(() => {
    // Read once: this is a copy out of the UI runtime, and the drawing wants nine
    // fields of it.
    const current = frame.value;
    const activity = current.activity;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, drawnSize, drawnSize));
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
        presence: current.presence,
      },
      scene,
      resources,
    );
    return recorder.finishRecordingAsPicture();
  });

  // Laid out small and scaled up: see DRAWN_RESOLUTION. The scale is about the canvas's own
  // centre, which is the container's centre too, so the sphere lands exactly where a full-sized
  // canvas would have put it.
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Canvas style={{ width: drawnSize, height: drawnSize, transform: [{ scale: 1 / DRAWN_RESOLUTION }] }}>
        <Picture picture={picture} />
      </Canvas>
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
