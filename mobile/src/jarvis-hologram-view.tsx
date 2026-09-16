import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { createHologramResources, createHologramScene, drawHologram, MATERIALISE_SECONDS } from './hologram-drawing';
import type { JarvisVoice } from './platform-contracts';
import {
  advanceVoiceActivity,
  createVoiceActivityState,
  easeBands,
  easeLevel,
  foldSpectrum,
  perceivedLevel,
  VOICE_BAND_COUNT,
} from './voice-levels';

export interface JarvisHologramProps {
  /** Width and height of the square it is drawn in, in points. */
  size: number;
  /** The voice it follows — Jarvis's, or the user's in sample mode: whether to listen, and how to read it. */
  voice: JarvisVoice;
}

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
export default function JarvisHologramView({ size, voice }: JarvisHologramProps) {
  const { listening, speaking, getVolume, getSpectrum } = voice;
  const scene = useMemo(() => createHologramScene(SCENE_SEED), []);
  const resources = useMemo(() => createHologramResources(Skia, scene), [scene]);

  const targetLevel = useSharedValue(0);
  const targetBands = useSharedValue<number[]>(new Array(VOICE_BAND_COUNT).fill(0));
  const speakingNow = useSharedValue(speaking);
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
    activity: createVoiceActivityState(),
  });

  useEffect(() => {
    speakingNow.value = speaking;
  }, [speaking, speakingNow]);

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
  useFrameCallback((info) => {
    const deltaSeconds = (info.timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
    frame.modify((current) => {
      'worklet';
      current.time += deltaSeconds;
      current.level = easeLevel(current.level, targetLevel.value, deltaSeconds);
      current.bands = easeBands(current.bands, targetBands.value, deltaSeconds);
      current.speaking = speakingNow.value;
      advanceVoiceActivity(current.activity, targetLevel.value, deltaSeconds);
      return current;
    });
  });

  const picture = useDerivedValue(() => {
    // Read once: this is a copy out of the UI runtime, and the drawing wants nine
    // fields of it.
    const current = frame.value;
    const activity = current.activity;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, size, size));
    drawHologram(
      canvas,
      size,
      {
        time: current.time,
        level: current.level,
        bands: current.bands,
        speaking: current.speaking,
        agitation: activity.agitation,
        burstAge: activity.burstAge,
        burstStrength: activity.burstStrength,
        burstCount: activity.burstCount,
        // The materialisation plays once, from the moment this canvas mounted.
        appearance: Math.min(1, current.time / MATERIALISE_SECONDS),
      },
      scene,
      resources,
    );
    return recorder.finishRecordingAsPicture();
  });

  return (
    <Canvas style={{ width: size, height: size }}>
      <Picture picture={picture} />
    </Canvas>
  );
}
