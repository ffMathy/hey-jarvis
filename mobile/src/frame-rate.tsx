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
 * It says what is achieved, not what is asked for. The drawing is capped at thirty
 * (`MINIMUM_FRAME_SECONDS`), so thirty means the phone is keeping up and anything less is what it
 * managed.
 */
export function FrameRate({ frameRate }: { frameRate: SharedValue<number> }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setShown(frameRate.value), READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [frameRate]);

  return (
    <Text accessibilityElementsHidden pointerEvents="none" style={styles.readout} testID="frame-rate">
      {`${Math.round(shown)} fps`}
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
