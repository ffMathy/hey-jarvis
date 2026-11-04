import * as Linking from 'expo-linking';
import type { Pairing } from 'hologram';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { pairWithServer } from './pair-with-server';
import { theme } from './theme';

interface ServerPairingProps {
  /** The server's address as it was read, to start the field from. */
  storedAddress: string | undefined;
  /** Whether this device is paired already. */
  paired: boolean;
  /** A browser was paired there and then, with where the server is and the token it gave. */
  onPaired: (pairing: Pairing) => void;
  /**
   * The phone app is about to open the server's pairing page in the browser for this address, which
   * is kept now: the token comes back later, on a link that names no server.
   */
  onPairingAddress: (address: string) => void;
}

/** Where this device is: the words differ only by what it is called. */
const THIS_DEVICE = Platform.OS === 'web' ? 'this browser' : 'this phone';

/**
 * Pairing with sir's Jarvis server, which is the whole of setting Jarvis up: the server holds the
 * ElevenLabs key and starts every conversation, the camera sends its photos there, the glance comes
 * from it, and the line to it opens with the token it gives this device. Nothing else is typed in.
 * See `paired-device.ts` in `hologram`.
 *
 * How it pairs is the platform's (`pair-with-server.ts` against `pair-with-server.web.ts`): a
 * browser sends the request itself, through Access's cookie; the phone app opens the server's
 * pairing page in the browser, and the token comes back on the app's own link.
 *
 * One form on the settings screen and on the tour's server step, so the test IDs are the same
 * wherever it is showing.
 */
export function ServerPairing({ storedAddress, paired, onPaired, onPairingAddress }: ServerPairingProps) {
  const [address, setAddress] = useState(storedAddress ?? '');
  const [pairing, setPairing] = useState(false);
  const [inTheBrowser, setInTheBrowser] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [signIn, setSignIn] = useState<string | undefined>(undefined);

  const pair = async () => {
    setPairing(true);
    setInTheBrowser(false);
    setProblem(undefined);
    setSignIn(undefined);
    const outcome = await pairWithServer(address, onPairingAddress);
    setPairing(false);
    if ('problem' in outcome) {
      setProblem(outcome.problem);
      setSignIn(outcome.signIn);
      return;
    }
    if ('inTheBrowser' in outcome) {
      setInTheBrowser(true);
      return;
    }
    onPaired(outcome.paired);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Your Jarvis server</Text>
      <Text style={styles.explanation}>
        {paired
          ? `${capitalised(THIS_DEVICE)} is paired with your Jarvis server. Pair it again if the server forgot it; pairing with another server forgets this one.`
          : `Jarvis lives on your own Jarvis server: it holds the ElevenLabs key and starts every conversation, so ${THIS_DEVICE} keeps only a token of the server’s own. Its address is the public https address of the server. If Cloudflare Access is in front of it, you sign in to it once.`}
      </Text>
      <Text style={styles.explanation}>
        The server is also where the camera button beside him sends photos, where the page you see when you open Jarvis
        comes from, and what this phone, your watch and your headset stay in touch with.
      </Text>
      <Text style={styles.explanation} testID="storage-note">
        {Platform.OS === 'web'
          ? 'In a browser the token is kept in local storage, which is not a keystore: anything running on this page can read it. On Android it goes in the keystore instead.'
          : 'The token is kept in the Android keystore.'}
      </Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        // Not a secret, but not a login either, and nothing for a password manager to keep.
        autoComplete="off"
        importantForAutofill="no"
        placeholder="https://jarvis.example.com"
        testID="jarvis-server"
        placeholderTextColor={theme.colors.mutedText}
      />
      {problem ? (
        <Text style={styles.problem} testID="pairing-problem">
          {problem}
        </Text>
      ) : null}
      {signIn ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(signIn)} testID="pairing-sign-in">
          <Text style={styles.link}>Sign in to your server, then pair again</Text>
        </Pressable>
      ) : null}
      {inTheBrowser ? (
        <Text style={styles.explanation} testID="pairing-in-the-browser">
          Your browser has your server’s pairing page open. Sign in if it asks, press Pair there, and it brings you back
          here.
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => void pair()}
        disabled={pairing}
        testID="pair-with-server"
      >
        <Text style={styles.buttonLabel}>
          {pairing ? 'Pairing…' : paired ? 'Pair again' : `Pair ${THIS_DEVICE} with your server`}
        </Text>
      </Pressable>
    </View>
  );
}

function capitalised(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

const styles = StyleSheet.create({
  field: {
    gap: theme.spacing.small,
  },
  label: {
    color: theme.colors.text,
    fontWeight: '600',
  },
  explanation: {
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.button,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.medium,
    paddingVertical: theme.spacing.small,
  },
  problem: {
    color: theme.colors.danger,
  },
  link: {
    color: theme.colors.accent,
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.medium,
    alignItems: 'center',
  },
  buttonLabel: {
    color: theme.colors.accentText,
    fontWeight: '700',
  },
});
