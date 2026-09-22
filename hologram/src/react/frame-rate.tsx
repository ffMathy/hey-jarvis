import { useEffect, useState } from 'react';
import { type StyleProp, StyleSheet, Text, type TextStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { describeFrameRate, type FrameRateReading } from '../sample-mode';

/** How often the number on screen is re-read. Twice a second: fast enough to watch, slow enough to read. */
const READ_INTERVAL_MS = 500;

/**
 * How many frames a second Jarvis is actually being drawn at, and how many particles, in sample
 * mode. Only in sample mode: a screen that is the assistant has nothing on it but him.
 *
 * The hologram counts frames on the UI thread, where they happen, and leaves the answer in a shared
 * value; this reads it twice a second. That is the whole reason it is a component of its own: a
 * number that changes on screen has to re-render *something*, and every render of the screen
 * builds a new drawing worklet — which Reanimated then re-serialises, scene and all. Held here,
 * the re-render stops at this line.
 *
 * It says what is achieved, not what is asked for: the cap is forty (`MINIMUM_FRAME_SECONDS`), so
 * forty means the device is keeping up and anything less is what it managed. On a 60 Hz screen the
 * most it can read is thirty, which is not the device struggling — a frame gate can only produce
 * the refresh rate divided by a whole number, and 60 Hz has no forty in it.
 *
 * The spark count is not a setting. The hologram steers it to hold the frame rate — see
 * `density-control.ts` — so watching it settle is watching the device being measured.
 *
 * Where it sits and what colour it is are the app's to say, through `style`.
 */
export function FrameRate({
  frameRate,
  buildMilliseconds,
  particleShare,
  particles,
  withBuildTime = true,
  style,
}: {
  frameRate: SharedValue<number>;
  buildMilliseconds: SharedValue<number>;
  particleShare: SharedValue<number>;
  /** How many there are when none are held back, so the share can be said as a count. */
  particles: number;
  /** Whether to say how long building a picture takes. A watch face has no room for it. */
  withBuildTime?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const [shown, setShown] = useState<FrameRateReading>({ rate: 0, buildMilliseconds: 0, share: 1 });

  useEffect(() => {
    const timer = setInterval(
      () => setShown({ rate: frameRate.value, buildMilliseconds: buildMilliseconds.value, share: particleShare.value }),
      READ_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [frameRate, buildMilliseconds, particleShare]);

  return (
    <Text accessibilityElementsHidden pointerEvents="none" style={[styles.readout, style]} testID="frame-rate">
      {describeFrameRate(shown, particles, { withBuildTime })}
    </Text>
  );
}

const styles = StyleSheet.create({
  /** Shadowed rather than boxed: it may be drawn over whatever was on screen. */
  readout: {
    position: 'absolute',
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.7,
    textShadowColor: 'rgba(3, 5, 11, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
