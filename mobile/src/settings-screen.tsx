import type { ElevenLabsSettings } from 'hologram';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ElevenLabsFields } from './elevenlabs-fields';
import type { JarvisServerChange } from './jarvis-server';
import { theme } from './theme';

interface SettingsScreenProps {
  settings: ElevenLabsSettings | undefined;
  /** The Jarvis server's address as it was read, if one was. See `jarvis-server.ts`. */
  serverAddress: string | undefined;
  /** The token for the server as it was read, if one was. See `jarvis-server.ts`. */
  serverToken: string | undefined;
  /** Called once everything on the screen parses — with the server address's change, if sir made one. */
  onSave: (settings: ElevenLabsSettings, serverChange: JarvisServerChange | undefined) => void;
  onCancel: (() => void) | undefined;
  /** Opens sample mode. Only offered before the app is set up, when there is nothing else to look at. */
  onTrySample: (() => void) | undefined;
}

/**
 * Where the phone is told which Jarvis it talks to — and, if it is to send him photos, where his
 * Jarvis server is.
 *
 * Every value is typed in rather than compiled in. Shipping the API key inside
 * the app would put a live credential in every copy of the bundle.
 *
 * **The Jarvis server is asked for here and not on the tour.** It is optional — without it Jarvis
 * works as he always did, with no camera — and it is a server of sir's own, which somebody meeting
 * Jarvis for the first time does not have yet. Somebody who does comes back here for it.
 *
 * **A changed address reaches the next conversation.** Holding the conversation screen to come here
 * ends the conversation on it, since the session lasts only as long as its screen
 * (`useJarvisSession` in `hologram`), and the screen this returns to opens a new one — told of a
 * camera button, or not, to match the address as it is then.
 *
 * **This is no longer the first thing a new install sees** — `onboarding-screen.tsx` is, and it
 * explains what an ElevenLabs agent is before asking for one. What is left here is the screen you
 * come back to: the same two fields with no tour around them, and the Jarvis server's beside them,
 * reached by holding the conversation screen. It is also still where an install lands whose
 * credentials have gone but whose tour has been walked, which is why it keeps its own way into
 * sample mode.
 */
export function SettingsScreen({
  settings,
  serverAddress,
  serverToken,
  onSave,
  onCancel,
  onTrySample,
}: SettingsScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>ElevenLabs</Text>
      <Text style={styles.explanation}>
        Jarvis is an ElevenLabs agent, and this app talks to it directly. Use an API key made for this app alone, so
        that a lost phone means revoking one key.
      </Text>

      <ElevenLabsFields
        settings={settings}
        server={{ storedAddress: serverAddress, storedToken: serverToken }}
        submitLabel="Save"
        onSubmit={onSave}
      />

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
