import type { Pairing } from 'hologram';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ServerPairing } from './server-pairing';
import { theme } from './theme';
import { WatchCard } from './watch-card';

interface SettingsScreenProps {
  /** The Jarvis server's address as it was read, if one was. See `jarvis-server.ts`. */
  serverAddress: string | undefined;
  /** This device's pairing with the server, if it has one: what the watch card hands the watch. */
  pairing: Pairing | undefined;
  /** A browser was paired with the server there and then (`server-pairing.tsx`). */
  onPaired: (pairing: Pairing) => void;
  /** The phone app is opening the server's pairing page for this address. */
  onPairingAddress: (address: string) => void;
  /** Forgets the server and the pairing with it. Only offered while there is a server to forget. */
  onForgetServer: () => void;
  onCancel: (() => void) | undefined;
  /** Opens sample mode. Only offered before the app is set up, when there is nothing else to look at. */
  onTrySample: (() => void) | undefined;
}

/**
 * Where the phone is told which Jarvis it talks to: the one on sir's own Jarvis server, which this
 * device is paired with. That is the only setting there is — no ElevenLabs key or agent is typed
 * into any app; the server holds them (see `paired-device.ts` in `hologram`).
 *
 * **A new pairing reaches the next conversation.** Holding the conversation screen to come here
 * ends the conversation on it, since the session lasts only as long as its screen
 * (`useJarvisSession` in `hologram`), and the screen this returns to opens a new one, asked of the
 * server as it is then.
 *
 * **This is not the first thing a new install sees** — `onboarding-screen.tsx` is. This is the
 * screen you come back to, reached by holding the conversation screen, and where an install lands
 * whose pairing has gone but whose tour has been walked, which is why it keeps its own way into
 * sample mode.
 */
export function SettingsScreen({
  serverAddress,
  pairing,
  onPaired,
  onPairingAddress,
  onForgetServer,
  onCancel,
  onTrySample,
}: SettingsScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Jarvis server</Text>

      <ServerPairing
        storedAddress={serverAddress}
        paired={pairing !== undefined}
        onPaired={onPaired}
        onPairingAddress={onPairingAddress}
      />

      {/* The way to hand the pairing to a watch that was out of range when the phone sent it. */}
      <WatchCard pairing={pairing} />

      {serverAddress === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={onForgetServer}
          testID="forget-server"
        >
          <Text style={styles.secondaryButtonLabel}>Forget this server</Text>
        </Pressable>
      )}

      {onCancel ? (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={onCancel}
          testID="cancel-settings"
        >
          <Text style={styles.secondaryButtonLabel}>Cancel</Text>
        </Pressable>
      ) : null}

      {onTrySample ? (
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onTrySample} testID="try-sample">
          <Text style={styles.secondaryButtonLabel}>Not paired yet? Try the hologram on its own</Text>
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
  secondaryButton: {
    paddingVertical: theme.spacing.small,
    alignItems: 'center',
  },
  secondaryButtonLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
