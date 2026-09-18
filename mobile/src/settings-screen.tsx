import type { ElevenLabsSettings } from 'conversation';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ElevenLabsFields } from './elevenlabs-fields';
import { theme } from './theme';

interface SettingsScreenProps {
  settings: ElevenLabsSettings | undefined;
  onSave: (settings: ElevenLabsSettings) => void;
  onCancel: (() => void) | undefined;
  /** Opens sample mode. Only offered before the app is set up, when there is nothing else to look at. */
  onTrySample: (() => void) | undefined;
}

/**
 * Where the phone is told which Jarvis it talks to.
 *
 * Both values are typed in rather than compiled in. Shipping the API key inside
 * the app would put a live credential in every copy of the bundle.
 *
 * **This is no longer the first thing a new install sees** — `onboarding-screen.tsx` is, and it
 * explains what an ElevenLabs agent is before asking for one. What is left here is the screen you
 * come back to: the same two fields with no tour around them, reached by holding the conversation
 * screen. It is also still where an install lands whose credentials have gone but whose tour has
 * been walked, which is why it keeps its own way into sample mode.
 */
export function SettingsScreen({ settings, onSave, onCancel, onTrySample }: SettingsScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>ElevenLabs</Text>
      <Text style={styles.explanation}>
        Jarvis is an ElevenLabs agent, and this app talks to it directly. Use an API key made for this app alone, so
        that a lost phone means revoking one key.
      </Text>

      <ElevenLabsFields settings={settings} submitLabel="Save" onSubmit={onSave} />

      {onCancel ? (
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonLabel}>Cancel</Text>
        </Pressable>
      ) : null}

      {onTrySample ? (
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onTrySample} testID="try-sample">
          <Text style={styles.secondaryButtonLabel}>No key yet? Try the hologram with your own voice</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.large,
    gap: theme.spacing.medium,
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  explanation: {
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  secondaryButton: {
    paddingVertical: theme.spacing.small,
    alignItems: 'center',
  },
  secondaryButtonLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
