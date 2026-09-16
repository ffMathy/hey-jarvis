import { useEffect, useState } from 'react';
import { StatusBar as NativeStatusBar, Pressable, StyleSheet, Text, View } from 'react-native';
import { useHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import type { JarvisVoice } from './platform-contracts';
import { useSampleVoice } from './sample-voice';
import { theme } from './theme';
import { perceivedLevel, SPEECH_LEVEL } from './voice-levels';

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

  const speech = heard.loudest >= SPEECH_LEVEL ? 'loud enough' : 'too quiet to count as speech';
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
          <JarvisHologram size={hologramSize} voice={voice} />
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

const styles = StyleSheet.create({
  /** Dim enough to read the card against, clear enough to see the home screen through. */
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.large,
    // The card is tall enough to reach the top of the screen, and the window is
    // edge to edge, so without this the title sits under the clock.
    paddingTop: theme.spacing.large + (NativeStatusBar.currentHeight ?? 0),
    backgroundColor: 'rgba(3, 5, 11, 0.55)',
  },
  /** No card behind it: the hologram and its two lines sit straight on the scrim. */
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.large,
  },
  status: {
    color: theme.colors.mutedText,
    fontSize: 16,
  },
  heard: {
    color: theme.colors.mutedText,
    fontSize: 13,
    opacity: 0.75,
  },
  problem: {
    color: theme.colors.danger,
    textAlign: 'center',
  },
  secondaryButton: {
    paddingVertical: theme.spacing.small,
  },
  secondaryButtonLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
