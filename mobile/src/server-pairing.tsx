import * as Linking from 'expo-linking';
import { type Pairing, pairWithServer, serverSignInUrl } from 'hologram';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from './theme';

/** What this browser is listed as among the server's paired devices. */
export const WEB_APP_DEVICE_NAME = 'Phone web app';

interface ServerPairingProps {
  /** The server's address as it was read, to start the field from. */
  storedAddress: string | undefined;
  /** Whether this browser is paired already. */
  paired: boolean;
  /** Called once the server has paired this browser, with where it is and the token it gave. */
  onPaired: (pairing: Pairing) => void;
}

/**
 * Pairing the web build with sir's Jarvis server: in place of an ElevenLabs key, which a browser
 * keeps in `localStorage` where anything on the page's origin can read it, and of Access's cookie
 * for the line, which runs out with Access's session. The server holds the key and starts every
 * conversation, and the line opens with the browser's own token. See `paired-device.ts` in
 * `hologram`, which the headset's page pairs with too — the two pages share an origin, so a browser
 * paired on either is paired on both.
 *
 * Only in a browser: the phone app and the watch hold a Cloudflare Access service token instead,
 * which a browser cannot send on a WebSocket.
 */
export function ServerPairing({ storedAddress, paired, onPaired }: ServerPairingProps) {
  const [address, setAddress] = useState(storedAddress ?? '');
  const [pairing, setPairing] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [signIn, setSignIn] = useState<string | undefined>(undefined);

  const pair = async () => {
    setPairing(true);
    setProblem(undefined);
    setSignIn(undefined);
    const result = await pairWithServer(address, WEB_APP_DEVICE_NAME, fetch);
    setPairing(false);
    if ('problem' in result) {
      setProblem(result.problem);
      setSignIn(result.signIn === undefined ? undefined : serverSignInUrl(result.signIn));
      return;
    }
    onPaired(result.pairing);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Pair this browser with your Jarvis server</Text>
      <Text style={styles.explanation}>
        {paired
          ? 'This browser is paired: your Jarvis server starts his conversations, so it needs no ElevenLabs key. Pair it again if the server forgot it.'
          : 'Instead of an ElevenLabs key: your Jarvis server holds the key and starts his conversations, and this browser keeps only a token of the server’s own. If Cloudflare Access is in front of the server, you sign in to it once.'}
      </Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        autoComplete="off"
        importantForAutofill="no"
        placeholder="https://jarvis.example.com"
        testID="pairing-server"
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
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => void pair()}
        disabled={pairing}
        testID="pair-browser"
      >
        <Text style={styles.buttonLabel}>{pairing ? 'Pairing…' : paired ? 'Pair again' : 'Pair this browser'}</Text>
      </Pressable>
    </View>
  );
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
    borderColor: theme.colors.accent,
    borderWidth: 1,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.medium,
    alignItems: 'center',
  },
  buttonLabel: {
    color: theme.colors.accent,
    fontWeight: '700',
  },
});
