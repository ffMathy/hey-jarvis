import { perceivedLevel, speakingThreshold } from 'hologram';
import { useEffect, useState } from 'react';
import { StatusBar as NativeStatusBar, Pressable, StyleSheet, Text, View } from 'react-native';
import { useHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import type { JarvisVoice } from './platform-contracts';
import { useSampleVoice } from './sample-voice';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
import { theme } from './theme';

interface SampleScreenProps {
  onLeave: () => void;
}

/** One line of what the microphone is doing. */
function describeListening(listening: boolean, problem: string | undefined): string {
  if (problem) {
    return 'Not listening.';
  }
  return listening ? 'Listening to you — say something.' : 'Opening the microphone…';
}

/** How often the line below re-reads the microphone. */
const READOUT_INTERVAL_MS = 250;

/**
 * What the microphone is actually giving the hologram, as a line under the status.
 *
 * A component of its own, and not a hook on the screen, because the reading changes several
 * times a second and whatever holds it re-renders that often. Held by the screen, that re-made
 * the hologram's drawing worklet ten times a second — Reanimated re-serialises a worklet's
 * captured values when it is created, and this one captures the whole scene — and the frame
 * rate fell off a cliff. Held here, the re-render stops at this line of text.
 *
 * Here because three rounds of making the sphere answer more loudly to speech did not change
 * what the user saw, which points at the reading rather than at the drawing: a sphere told
 * about a level of zero looks the same however hard it is told to react. This says what the
 * level is, what the loudest reading so far was, and whether that clears the threshold speech
 * has to clear — enough to tell "the microphone is quiet" from "the drawing is too subtle"
 * without a cable and a laptop.
 */
function HeardLevel({ voice }: { voice: JarvisVoice }) {
  const [heard, setHeard] = useState({ level: 0, loudest: 0 });

  useEffect(() => {
    if (!voice.listening) {
      setHeard({ level: 0, loudest: 0 });
      return;
    }
    const read = () =>
      setHeard((previous) => {
        const level = perceivedLevel(voice.getVolume());
        return { level, loudest: Math.max(previous.loudest, level) };
      });
    const timer = setInterval(read, READOUT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [voice]);

  // Against the gate actually in force, which is relative to this voice — it said "too quiet"
  // while the sphere was reacting, because it was still comparing with the fixed level the gate
  // stopped using.
  const speech =
    heard.loudest >= speakingThreshold(heard.loudest, QUIETEST_SPEECH_HERE)
      ? 'loud enough'
      : 'too quiet to count as speech';
  return (
    <Text style={styles.heard} testID="sample-heard">
      {`level ${heard.level.toFixed(2)} · loudest ${heard.loudest.toFixed(2)} · ${speech}`}
    </Text>
  );
}

/**
 * Sample mode: the hologram, listening to the user instead of Jarvis.
 *
 * Offered before the app is set up, so there is something to see — and a way to
 * check the hologram really follows a voice — without an ElevenLabs account.
 * Nothing leaves the device: no conversation is started and no audio is kept.
 *
 * Drawn as a sheet over whatever is behind the app rather than as a screen of its
 * own. The app's window is see-through (`withTransparentWindow` in
 * `app.config.ts`) and the root leaves sample mode unpainted, so what shows
 * through the scrim is the home screen. Tapping the scrim leaves, as it does in
 * any dialog; the card itself does not, so a stray tap on the hologram is not an
 * exit.
 */
export function SampleScreen({ onLeave }: SampleScreenProps) {
  const { voice, problem } = useSampleVoice();
  const hologramSize = useHologramSize();

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.scrim} onPress={onLeave}>
      {/* Swallows its own taps, so watching the hologram is not a way to leave by accident. */}
      <Pressable style={styles.content} onPress={() => {}} testID="sample-content">
        <Text style={styles.status} testID="sample-status">
          {describeListening(voice.listening, problem)}
        </Text>
        <HeardLevel voice={voice} />

        <View
          accessible
          accessibilityLabel="Jarvis hologram, following your voice"
          style={{ width: hologramSize, height: hologramSize }}
          testID="hologram"
        >
          <JarvisHologram size={hologramSize} voice={voice} quietestSpeech={QUIETEST_SPEECH_HERE} />
        </View>

        {problem ? (
          <Text style={styles.problem} testID="sample-problem">
            {problem}
          </Text>
        ) : null}

        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onLeave} testID="leave-sample">
          <Text style={styles.secondaryButtonLabel}>Back to setup</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

/**
 * What keeps pale text readable now that nothing dims the wallpaper behind it.
 *
 * A soft dark halo around each glyph, which costs the picture a few pixels per letter instead of
 * the 55% wash the whole screen used to carry.
 */
const legible = {
  textShadowColor: 'rgba(3, 5, 11, 0.9)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

const styles = StyleSheet.create({
  /**
   * Nothing at all between the hologram and what is behind the app.
   *
   * It used to be a 55% dark wash, to read the text against. That works, and it also announces
   * itself: the wallpaper came through visibly dimmed, which is not what an assistant hovering
   * over your home screen should look like. The text keeps its legibility from a shadow of its
   * own instead — that darkens the few pixels under each letter rather than the whole screen.
   */
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.large,
    // The content is tall enough to reach the top of the screen, and the window is
    // edge to edge, so without this the status line sits under the clock.
    paddingTop: theme.spacing.large + (NativeStatusBar.currentHeight ?? 0),
    backgroundColor: 'transparent',
  },
  /** No card behind it: the hologram and its two lines sit straight on the scrim. */
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.large,
  },
  status: {
    ...legible,
    color: theme.colors.mutedText,
    fontSize: 16,
  },
  heard: {
    ...legible,
    color: theme.colors.mutedText,
    fontSize: 13,
    opacity: 0.75,
  },
  problem: {
    ...legible,
    color: theme.colors.danger,
    textAlign: 'center',
  },
  secondaryButton: {
    paddingVertical: theme.spacing.small,
  },
  secondaryButtonLabel: {
    ...legible,
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
