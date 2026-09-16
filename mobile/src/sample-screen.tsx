import { useEffect, useState } from 'react';
import { StatusBar as NativeStatusBar, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

/**
 * What the microphone is actually giving the hologram, sampled for the line below it.
 *
 * Here because three rounds of making the sphere answer more loudly to speech did not change
 * what the user saw, which points at the reading rather than at the drawing: a sphere told
 * about a level of zero looks the same however hard it is told to react. This says what the
 * level is, what the loudest reading so far was, and whether that clears the threshold speech
 * has to clear — enough to tell "the microphone is quiet" from "the drawing is too subtle"
 * without a cable and a laptop.
 */
function useHeardLevel(voice: JarvisVoice) {
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
    const timer = setInterval(read, 100);
    return () => clearInterval(timer);
  }, [voice]);

  return heard;
}

/** The reading, and whether it is enough to stir the sphere. */
function describeHeard({ level, loudest }: { level: number; loudest: number }): string {
  const speech = loudest >= SPEECH_LEVEL ? 'loud enough' : 'too quiet to count as speech';
  return `level ${level.toFixed(2)} · loudest ${loudest.toFixed(2)} · ${speech}`;
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
  const heard = useHeardLevel(voice);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>J.A.R.V.I.S.</Text>
      <Text style={styles.status} testID="sample-status">
        {describeListening(voice.listening, problem)}
      </Text>
      <Text style={styles.heard} testID="sample-heard">
        {describeHeard(heard)}
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
          Sample mode. The hologram stirs with your voice the way it will with Jarvis's. Nothing is recorded or sent
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
  heard: {
    color: theme.colors.mutedText,
    fontSize: 13,
    opacity: 0.75,
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
