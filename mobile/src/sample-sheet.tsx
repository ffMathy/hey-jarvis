import { useCallback, useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { theme } from './theme';

/** How much of the screen's height the sheet takes. The screen it covers is still the user's. */
export const SHEET_SHARE = 0.4;

/**
 * What the sheet is made of: very dark, and not quite the near-black everything else sits on.
 *
 * The canvas paints this too — see the `background` prop on the hologram — so that the two meet
 * with no seam where the drawing's square ends.
 */
export const SHEET_INK = '#0b1220';

/**
 * How far the canvas is held back from the sheet's edge.
 *
 * Not decoration. An opaque canvas is a `SurfaceView`, a hardware layer of its own that a parent
 * cannot clip — not with `overflow: hidden`, not with a corner radius. Anything it draws outside
 * the sheet stays outside the sheet, and the border ends up drawn across the middle of it. Holding
 * it back by more than the radius is what keeps the edge clean.
 */
export const SHEET_INSET = 14;

/** The hairline that gives it an edge against a dark wallpaper. */
const SHEET_EDGE = '#243043';

/** How long it takes to arrive, and to go. */
const ARRIVE_MS = 260;
const LEAVE_MS = 200;

/**
 * The panel Jarvis is summoned into: solid, along the bottom, sliding up from under the screen.
 *
 * **Its shape is a performance decision as much as a look.** Jarvis used to be drawn straight onto
 * a see-through window over the home screen, which costs twice: Skia's canvas falls back to a
 * `TextureView` when it cannot be told it is opaque — an extra copy of every frame — and the
 * compositor blends the whole screen against whatever is behind it. On something solid, neither
 * happens.
 *
 * **And it is why Jarvis waits.** The fast path is a `SurfaceView`, which is its own hardware layer
 * and does not move with the view tree — animate one and it tears or lags behind. So the sheet
 * arrives first, as an ordinary view, and only once it has stopped does anything ask for a canvas.
 * `onSettled` is that moment. He materialises after it, which he was going to do anyway.
 *
 * The scrim above the sheet stays see-through on purpose: what is behind is the app the user was
 * in, and an assistant that blacks it out has replaced it rather than come to help.
 */
export function SampleSheet({
  leaving,
  onSettled,
  onGone,
  onTapBeside,
  children,
}: {
  /** Set when Jarvis has started to go: the sheet follows him down once he has faded. */
  leaving: boolean;
  /** Called once the sheet has finished arriving, which is when it is safe to draw into it. */
  onSettled: () => void;
  /** Called once the sheet has finished leaving, which is when it is safe to close anything. */
  onGone: () => void;
  onTapBeside: () => void;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  const sheetHeight = Math.round(height * SHEET_SHARE);
  const below = useSharedValue(sheetHeight);

  useEffect(() => {
    below.value = withTiming(0, { duration: ARRIVE_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onSettled)();
      }
    });
    // Once, on the way in. The height is read at mount and a phone does not turn while an
    // assistant is being summoned into it.
  }, [below, onSettled]);

  const slideAway = useCallback(() => {
    below.value = withTiming(sheetHeight, { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onGone)();
      }
    });
  }, [below, sheetHeight, onGone]);

  useEffect(() => {
    if (leaving) {
      slideAway();
    }
  }, [leaving, slideAway]);

  const sliding = useAnimatedStyle(() => ({ transform: [{ translateY: below.value }] }));

  return (
    <View style={styles.screen}>
      {/* Beside him is still the way out, and what shows through it is what you were doing. */}
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.beside}
        onTouchEnd={onTapBeside}
      />
      <Animated.View style={[styles.sheet, { height: sheetHeight }, sliding]} testID="sample-sheet">
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  beside: {
    flex: 1,
  },
  /**
   * Solid, and rounded only at the top, so it reads as having come up from the edge of the screen
   * rather than as a card floating on it.
   *
   * `SHEET_INK` rather than the app's own background: very dark, but not the near-black the rest
   * of the app sits on, so that it reads as a surface with Jarvis on it rather than as a hole cut
   * in the screen. The hairline along the top and sides is what gives it an edge against a dark
   * wallpaper, where otherwise the sheet and the screen behind it run into each other.
   *
   * `overflow: hidden` does *not* hold the canvas in, whatever it says: an opaque canvas is a
   * `SurfaceView` and no parent can clip one. `SHEET_INSET` is what keeps it inside.
   */
  sheet: {
    backgroundColor: SHEET_INK,
    borderTopLeftRadius: theme.radius.card * 1.75,
    borderTopRightRadius: theme.radius.card * 1.75,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderLeftWidth: StyleSheet.hairlineWidth * 2,
    borderRightWidth: StyleSheet.hairlineWidth * 2,
    borderColor: SHEET_EDGE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
