import { useConversationControls } from '@elevenlabs/react-native';
import type { ElevenLabsSettings } from 'hologram';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ElevenLabsFields } from './elevenlabs-fields';
import type { PhotoUploadKeyChange } from './photo-upload-key';
import { theme } from './theme';

interface SettingsScreenProps {
  settings: ElevenLabsSettings | undefined;
  /** The photo upload key as it was read, if one was. See `photo-upload-key.ts`. */
  photoUploadKey: string | undefined;
  /** Called once everything on the screen parses — with the photo upload key's change, if sir made one. */
  onSave: (settings: ElevenLabsSettings, photoUploadKeyChange: PhotoUploadKeyChange | undefined) => void;
  onCancel: (() => void) | undefined;
  /** Opens sample mode. Only offered before the app is set up, when there is nothing else to look at. */
  onTrySample: (() => void) | undefined;
}

/**
 * Where the phone is told which Jarvis it talks to — and, if it is to show him photos, the key his
 * server asks for before it takes one.
 *
 * Every value is typed in rather than compiled in. Shipping the API key inside
 * the app would put a live credential in every copy of the bundle.
 *
 * **The photo upload key is asked for here and not on the tour.** It is optional — without it
 * Jarvis works as he always did, with no camera — and it belongs to a server of sir's own, which
 * somebody meeting Jarvis for the first time does not have yet. Somebody who does comes back here
 * for it, which is also where the agent sends him when he asks for a photo it cannot have.
 *
 * **Changing it ends the conversation still running beneath this screen.** Holding the conversation
 * screen to come here unmounts it, but not its session: ElevenLabs keeps the `openCamera` tool and
 * the MCP handler it was started with, which belong to the screen that started it and read the key
 * that screen had. Nothing else can reach them, so a key added here was answered with "sir has not
 * given this phone the key", and one cleared here was still sent with a photo. So a save that
 * changes the key hangs that conversation up, and the conversation screen it returns to opens a new
 * one, built with the new key — and told of a camera, or not, to match. A save that leaves the key
 * alone leaves the conversation alone too.
 *
 * **This is no longer the first thing a new install sees** — `onboarding-screen.tsx` is, and it
 * explains what an ElevenLabs agent is before asking for one. What is left here is the screen you
 * come back to: the same two fields with no tour around them, reached by holding the conversation
 * screen. It is also still where an install lands whose credentials have gone but whose tour has
 * been walked, which is why it keeps its own way into sample mode.
 */
export function SettingsScreen({ settings, photoUploadKey, onSave, onCancel, onTrySample }: SettingsScreenProps) {
  const { endSession } = useConversationControls();

  const save = (saved: ElevenLabsSettings, photoUploadKeyChange: PhotoUploadKeyChange | undefined) => {
    if (photoUploadKeyChange) {
      // Before `onSave` swaps the screens, in the same event: the SDK reports the session gone as
      // soon as it is told, so the conversation screen mounts on no conversation and opens its own.
      endSession();
    }
    onSave(saved, photoUploadKeyChange);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>ElevenLabs</Text>
      <Text style={styles.explanation}>
        Jarvis is an ElevenLabs agent, and this app talks to it directly. Use an API key made for this app alone, so
        that a lost phone means revoking one key.
      </Text>

      <ElevenLabsFields settings={settings} photos={{ storedKey: photoUploadKey }} submitLabel="Save" onSubmit={save} />

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
