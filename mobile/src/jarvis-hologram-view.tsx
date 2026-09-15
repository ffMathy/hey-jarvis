import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { createHologramResources, createHologramScene, drawHologram } from './hologram-drawing';
import type { JarvisVoice } from './platform-contracts';
import { easeBands, easeLevel, foldSpectrum, perceivedLevel, VOICE_BAND_COUNT } from './voice-levels';

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
 * Jarvis, drawn: a golden holographic sphere that turns on its own and swells
 * with his voice.
 *
 * Three clocks keep each other honest. The JS thread reads the voice every
 * 40 ms and stores it as a target. The UI thread, every frame, eases the drawn
 * level toward that target and advances time. And the picture is re-recorded
 * from those values on the UI thread, so neither a busy JS thread nor a slow
 * reading can make the animation stutter — at worst the pulse lags a frame.
 */
export default function JarvisHologramView({ size, voice }: JarvisHologramProps) {
  const { listening, speaking, getVolume, getSpectrum } = voice;
  const scene = useMemo(() => createHologramScene(SCENE_SEED), []);
  const resources = useMemo(() => createHologramResources(Skia, scene), [scene]);

  const time = useSharedValue(0);
  const level = useSharedValue(0);
  const bands = useSharedValue<number[]>(new Array(VOICE_BAND_COUNT).fill(0));
  const targetLevel = useSharedValue(0);
  const targetBands = useSharedValue<number[]>(new Array(VOICE_BAND_COUNT).fill(0));
  const speakingNow = useSharedValue(speaking);

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
  useFrameCallback((frame) => {
    const deltaSeconds = (frame.timeSincePreviousFrame ?? DEFAULT_FRAME_MS) / 1000;
    time.value += deltaSeconds;
    level.value = easeLevel(level.value, targetLevel.value, deltaSeconds);
    bands.modify((current) => {
      'worklet';
      return easeBands(current, targetBands.value, deltaSeconds);
    });
  });

  const picture = useDerivedValue(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, size, size));
    drawHologram(
      canvas,
      size,
      { time: time.value, level: level.value, bands: bands.value, speaking: speakingNow.value },
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
