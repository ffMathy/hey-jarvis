import { StatusBar as NativeStatusBar, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { useSampleVoice } from './sample-voice';
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

/**
 * Sample mode: the hologram, listening to the user instead of Jarvis.
 *
 * Offered before the app is set up, so there is something to see — and a way to
 * check the hologram really follows a voice — without an ElevenLabs account.
 * Nothing leaves the device: no conversation is started and no audio is kept.
 */
export function SampleScreen({ onLeave }: SampleScreenProps) {
  const { voice, problem } = useSampleVoice();
  const hologramSize = useHologramSize();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>J.A.R.V.I.S.</Text>
      <Text style={styles.status} testID="sample-status">
        {describeListening(voice.listening, problem)}
      </Text>

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
      ) : (
        <Text style={styles.explanation}>
          Sample mode. The hologram pulses to your voice the way it will to Jarvis's. Nothing is recorded or sent
          anywhere.
        </Text>
      )}

      <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onLeave} testID="leave-sample">
        <Text style={styles.secondaryButtonLabel}>Back to setup</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.large,
    // Edge to edge, as on the conversation screen: without this the title would
    // sit under the status bar when scrolled to the top.
    paddingTop: theme.spacing.large + (NativeStatusBar.currentHeight ?? 0),
    gap: theme.spacing.large,
  },
  title: {
    color: theme.colors.text,
    fontSize: 28,
    letterSpacing: 6,
    fontWeight: '600',
  },
  status: {
    color: theme.colors.mutedText,
    fontSize: 16,
  },
  explanation: {
    color: theme.colors.mutedText,
    lineHeight: 20,
    textAlign: 'center',
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
