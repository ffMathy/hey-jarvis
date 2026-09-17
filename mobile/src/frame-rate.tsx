import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { theme } from './theme';

/** How often the number on screen is re-read. Twice a second: fast enough to watch, slow enough to read. */
const READ_INTERVAL_MS = 500;

/**
 * How many frames a second Jarvis is actually being drawn at, in the corner.
 *
 * The hologram counts them on the UI thread, where they happen, and leaves the answer in a shared
 * value; this reads it twice a second. That is the whole reason it is a component of its own: a
 * number that changes on screen has to re-render *something*, and every render of the screen
 * builds a new drawing worklet — which Reanimated then re-serialises, scene and all. Held here,
 * the re-render stops at this line, which is how the microphone readout had to be arranged for the
 * same reason and why the lesson is worth repeating in the file rather than in a commit message.
 *
 * It says what is achieved, not what is asked for: the cap is forty (`MINIMUM_FRAME_SECONDS`), so
 * forty means the phone is keeping up and anything less is what it managed. On a 60 Hz screen the
 * most it can read is thirty, which is not the phone struggling — a frame gate can only produce the
 * refresh rate divided by a whole number, and 60 Hz has no forty in it.
 *
 * Beside it is how long *building* one picture takes, which is the half of a frame that is
 * JavaScript, and how many particles are being drawn. The phone is the instrument here: the same
 * drawing ran at 58 frames a second in this phone's browser and 11 in the app, and no measurement
 * that can be taken on a desktop explained the difference.
 *
 * The spark count is not a setting. The hologram steers it to hold the frame rate — see
 * `density-control.ts` — so watching it settle is watching the phone being measured.
 */
export function FrameRate({
  frameRate,
  buildMilliseconds,
  particleShare,
  particles,
}: {
  frameRate: SharedValue<number>;
  buildMilliseconds: SharedValue<number>;
  particleShare: SharedValue<number>;
  /** How many there are when none are held back, so the share can be said as a count. */
  particles: number;
}) {
  const [shown, setShown] = useState({ rate: 0, build: 0, share: 1 });

  useEffect(() => {
    const timer = setInterval(
      () => setShown({ rate: frameRate.value, build: buildMilliseconds.value, share: particleShare.value }),
      READ_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [frameRate, buildMilliseconds, particleShare]);

  return (
    <Text accessibilityElementsHidden pointerEvents="none" style={styles.readout} testID="frame-rate">
      {`${Math.round(shown.rate)} fps · build ${shown.build.toFixed(1)} ms · ${Math.round(shown.share * particles)} sparks`}
    </Text>
  );
}

const styles = StyleSheet.create({
  /** Out of the way, and shadowed rather than boxed: this is drawn over whatever was on screen. */
  readout: {
    position: 'absolute',
    left: theme.spacing.large,
    bottom: theme.spacing.large,
    color: theme.colors.mutedText,
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.7,
    textShadowColor: 'rgba(3, 5, 11, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
