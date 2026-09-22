import { useEffect, useRef } from 'react';
import { type StyleProp, StyleSheet, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SAMPLE_MODE_NAMES, type SampleMode } from '../sample-mode';

const FADE_IN_MS = 160;
const HOLD_MS = 1200;
const FADE_OUT_MS = 420;

/**
 * The name of the mood, for a moment, after a tap changes it.
 *
 * Sample mode has next to no words on it — that was asked for, and it is what makes Jarvis a
 * presence rather than a dialog — but the three moods are only worth walking through if you can
 * tell which one you have landed on. So the name appears on the tap and takes itself away again,
 * the way a toast does, and the screen goes back to being wordless.
 *
 * **Nothing here re-renders the screen.** The fade runs on the UI thread as a shared value, not as
 * React state, and this is a component of its own so that even its own re-render stops at this line
 * of text. That is not fussiness: every render of the screen builds a new drawing worklet, and
 * Reanimated serialises what a worklet captured when it was made — which here is the whole scene.
 * A readout that re-rendered the screen ten times a second is what cost the frame rate once
 * before, and a toast fading over half a second would have been thirty of them.
 *
 * It does not show on arrival, only on a change: the first thing sample mode should be is Jarvis.
 *
 * Where it sits and what colour it is are the app's to say, through `style`: a phone puts it clear
 * of the gesture bar, a round watch face somewhere its bezel does not cut it off.
 */
export function ModeToast({ mode, style }: { mode: SampleMode; style?: StyleProp<TextStyle> }) {
  const shown = useSharedValue(0);
  const showing = useRef<SampleMode | undefined>(undefined);

  useEffect(() => {
    if (showing.current === mode) {
      return;
    }
    const arriving = showing.current === undefined;
    showing.current = mode;
    if (arriving) {
      return;
    }
    shown.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withDelay(HOLD_MS, withTiming(0, { duration: FADE_OUT_MS })),
    );
  }, [mode, shown]);

  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <Animated.Text
      accessibilityElementsHidden
      pointerEvents="none"
      style={[styles.toast, style, fade]}
      testID="mode-toast"
    >
      {SAMPLE_MODE_NAMES[mode]}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  /**
   * Absolutely placed so that it cannot move the hologram off centre when it appears, and
   * shadowed rather than boxed: it may be drawn over a home screen that is any colour at all.
   */
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    fontSize: 15,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(3, 5, 11, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
});
