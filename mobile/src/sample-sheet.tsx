import { useCallback, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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

/**
 * Whether there is a sheet at all.
 *
 * **There is not one on the web, and the reason is that the sheet is not a design — it is a thing
 * Android made necessary.** It exists because an assistant is summoned over the app you were using,
 * so it has to leave that app visible; and because an opaque Skia canvas is a `SurfaceView`, which
 * has to sit still on something solid. Neither is true in a browser. There is no app behind the
 * page to preserve, and there is no `SurfaceView` — so a sheet along the bottom is forty per cent of
 * the window doing the work of a full screen, with Jarvis stuck in the lower third of it and the
 * rest of the page black. Which is exactly how it looked.
 *
 * On the web he is simply in the middle, as big as the window allows.
 */
const HAS_SHEET = Platform.OS !== 'web';

/**
 * How big the square Jarvis is drawn in should be, given the window.
 *
 * Here rather than in the screen above, because it is the same decision as whether there is a sheet
 * and the two must not be able to disagree. In a sheet it is the sheet's shorter side, held back by
 * {@link SHEET_INSET}; on the web it is the window's shorter side, with a margin so that what he
 * throws outward is not clipped by the edge of the page.
 */
export function sampleHologramSize(width: number, height: number): number {
  if (!HAS_SHEET) {
    return Math.round(Math.min(width, height) * WEB_SHARE);
  }
  return Math.min(width, Math.round(height * SHEET_SHARE)) - SHEET_INSET * 2;
}

/** How much of the window's shorter side the square takes, on the web. */
const WEB_SHARE = 0.92;

/**
 * How the canvas should be set up, which also follows from whether there is a sheet.
 *
 * On a phone it is told it is opaque, which is what makes Skia use a `SurfaceView` instead of a
 * `TextureView` and is most of the frame rate — and an opaque canvas has nothing behind it, so it
 * has to paint the sheet's own colour or it is a black rectangle sitting on the sheet.
 *
 * On the web neither applies: there is no `SurfaceView` to opt into, and painting a background
 * would put a visible dark square on a page that is already dark. So it stays clear and the page
 * shows through.
 */
export const SAMPLE_CANVAS: { opaque: boolean; background?: string } = HAS_SHEET
  ? { opaque: true, background: SHEET_INK }
  : { opaque: false };

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
  const below = useSharedValue(HAS_SHEET ? sheetHeight : 0);

  /**
   * The two callbacks, held where their identity cannot start an animation.
   *
   * They arrive as fresh closures on every render of the screen above, and the effect below has to
   * depend on *something* to call them. Depending on the closures meant the effect re-ran on every
   * render — so the moment `leaving` became true and the screen re-rendered, the arrival animation
   * started again and drove the sheet back up underneath the departure. Jarvis faded out and the
   * sheet stayed exactly where it was, for ever.
   */
  const announce = useRef({ settled: onSettled, gone: onGone });
  useEffect(() => {
    announce.current = { settled: onSettled, gone: onGone };
  }, [onSettled, onGone]);

  const tellSettled = useCallback(() => announce.current.settled(), []);
  const tellGone = useCallback(() => announce.current.gone(), []);

  /**
   * One effect for both directions, so they cannot fight.
   *
   * It also has to handle arriving *again*: retracting the assistant's window does not unmount
   * this screen, so a second summoning finds a sheet that is already off the bottom of the screen
   * and a `leaving` that has just gone back to false. Driven from `leaving` rather than from
   * mounting, that is simply the other branch.
   */
  useEffect(() => {
    // Nothing slides on the web, so the two moments the sheet exists to announce have to be
    // announced anyway: it is safe to draw as soon as there is a screen, and it is over as soon as
    // Jarvis has faded. The screen above waits `LEAVING_SECONDS` for that either way.
    if (!HAS_SHEET) {
      if (leaving) {
        const done = setTimeout(tellGone, LEAVE_MS);
        return () => clearTimeout(done);
      }
      tellSettled();
      return;
    }
    if (leaving) {
      below.value = withTiming(sheetHeight, { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        'worklet';
        if (finished) {
          runOnJS(tellGone)();
        }
      });
      return;
    }
    below.value = withTiming(0, { duration: ARRIVE_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(tellSettled)();
      }
    });
  }, [leaving, below, sheetHeight, tellGone, tellSettled]);

  const sliding = useAnimatedStyle(() => ({ transform: [{ translateY: below.value }] }));

  if (!HAS_SHEET) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.page}
        onPress={onTapBeside}
        testID="sample-sheet"
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      {/*
        Beside him is still the way out, and what shows through it is what you were doing.

        A `Pressable` rather than a bare view with `onTouchEnd`, which is what this was and which
        worked everywhere except the one place anyone could check it: react-native-web turns
        `onPress` into a click handler, but it passes `onTouchEnd` straight through to the DOM
        event of that name — and a mouse does not raise one. So on the web the scrim was inert and
        sample mode had no way out at all. The e2e suite caught it; a phone never would.
      */}
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.beside} onPress={onTapBeside} />
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
  /** The web: Jarvis in the middle of the window, and the rest of it the way out. */
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
