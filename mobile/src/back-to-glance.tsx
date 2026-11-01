import type { SessionPhase } from 'hologram';
import { useEffect } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { theme } from './theme';

/**
 * Whether a summoning is under way — greeting, connecting or talking — and so is shown again rather
 * than replaced when he is summoned once more, and not swapped for a glance.
 */
export function isUnderWay(phase: SessionPhase): boolean {
  return phase === 'greeting' || phase === 'connecting' || phase === 'live';
}

/**
 * What the conversation screen tells the app about going back to the glance, and the way back itself.
 *
 * The app shows a glance when it is opened rather than summoned (`app-screen.ts`), and never in the
 * middle of a conversation: so this screen reports whether one is under way — from the moment it
 * starts asking for the microphone until he has gone — and when he has gone, which is when the app
 * goes back to the glance. Back, across the whole screen, goes back at once when there is one; in the
 * sheet back is the sheet's, and hangs up.
 */
export function useBackToGlance({
  starting,
  phase,
  hangingUp,
  ended,
  gone,
  inSheet,
  onUnderWayChange,
  onGone,
  onBackToGlance,
}: {
  starting: boolean;
  phase: SessionPhase;
  hangingUp: boolean;
  ended: boolean;
  gone: boolean;
  inSheet: boolean;
  onUnderWayChange: ((underWay: boolean) => void) | undefined;
  onGone: (() => void) | undefined;
  onBackToGlance: (() => void) | undefined;
}) {
  const underWay = starting || isUnderWay(phase) || hangingUp || (ended && !gone);
  useEffect(() => {
    onUnderWayChange?.(underWay);
    // A screen that goes holds nothing under way.
    return () => onUnderWayChange?.(false);
  }, [underWay, onUnderWayChange]);

  useEffect(() => {
    if (gone) onGone?.();
  }, [gone, onGone]);

  useEffect(() => {
    if (inSheet || onBackToGlance === undefined) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackToGlance();
      return true;
    });
    return () => subscription.remove();
  }, [inSheet, onBackToGlance]);
}

/** The browser's way back to the glance, at the top of the screen; a phone uses back. */
export function BackToGlanceLink({ onBackToGlance }: { onBackToGlance: (() => void) | undefined }) {
  if (Platform.OS !== 'web' || onBackToGlance === undefined) return null;
  return (
    <Pressable accessibilityRole="button" onPress={onBackToGlance} style={styles.link} testID="back-to-glance">
      <Text style={styles.label}>Back to the glance</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    position: 'absolute',
    top: theme.spacing.large,
    padding: theme.spacing.small,
  },
  label: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
