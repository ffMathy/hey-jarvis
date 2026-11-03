import {
  type ElevenLabsSettings,
  type JarvisServerServiceToken,
  parseElevenLabsSettings,
  parseJarvisServerAddress,
  parseJarvisServerServiceToken,
} from 'hologram';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { JarvisServerChange } from './jarvis-server';
import { theme } from './theme';

interface ElevenLabsFieldsProps {
  /** What to start with, when there is already something stored. */
  settings: ElevenLabsSettings | undefined;
  /**
   * Whether to ask for the Jarvis server's address and its service token as well, and the ones read
   * if they were — which is not always the ones stored, since a read can fail. The settings screen
   * and the tour's credentials step both ask: the server is optional, but a phone set up without it
   * never shows the glance, and nothing on the tour said where it was set.
   */
  server?: { storedAddress: string | undefined; storedServiceToken: JarvisServerServiceToken | undefined };
  /** What the button says. "Save" on the settings screen; "Continue" on the tour. */
  submitLabel: string;
  /**
   * Called with values that parsed — and, where the Jarvis server is asked for and sir changed it,
   * the change. Nothing is reported upwards until everything on the form parses, so a form with one
   * bad field saves none of them.
   */
  onSubmit: (settings: ElevenLabsSettings, serverChange: JarvisServerChange | undefined) => void;
}

/**
 * The two values, the note about where they are kept, and the button that accepts them — and, on
 * where asked for, the Jarvis server's address and service token beside them.
 *
 * Extracted because there are now two screens that ask for them — the settings screen and the
 * credentials step of the first-run tour — and two copies of a field that must not autofill, must
 * not autocorrect and must be validated the same way is two copies of four decisions that are easy
 * to get subtly different. The test IDs live here too, so the end-to-end suite sees one form
 * whichever screen is showing it.
 *
 * **The Jarvis server is here rather than on a form of its own** so that one button saves the
 * screen and one line says what is wrong with it. It is sir's own server rather than ElevenLabs',
 * it is no secret, and it goes nowhere near the watch: see `jarvis-server.ts`.
 */
export function ElevenLabsFields({ settings, server, submitLabel, onSubmit }: ElevenLabsFieldsProps) {
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [agentId, setAgentId] = useState(settings?.agentId ?? '');
  const [serverAddress, setServerAddress] = useState(server?.storedAddress ?? '');
  const [clientId, setClientId] = useState(server?.storedServiceToken?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(server?.storedServiceToken?.clientSecret ?? '');
  /** What the fields started from, which is what a save is measured against. See `submit`. */
  const [startingServerAddress] = useState(server?.storedAddress);
  const [startingServiceToken] = useState(server?.storedServiceToken);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const submit = () => {
    const result = parseElevenLabsSettings(apiKey, agentId);

    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }

    // Read only where it was asked for, so the tour can never overwrite an address it did not show.
    const serverResult = server ? parseJarvisServerAddress(serverAddress) : { address: undefined };
    if ('problem' in serverResult) {
      setProblem(serverResult.problem);
      return;
    }

    const tokenResult = server ? parseJarvisServerServiceToken(clientId, clientSecret) : { serviceToken: undefined };
    if ('problem' in tokenResult) {
      setProblem(tokenResult.problem);
      return;
    }

    // And reported only if either differs from what its field started from. An address that could
    // not be read starts the field empty, so saving the field as it stood would erase an address that
    // had only failed to load, when sir came here to change the agent ID.
    const serverChange =
      server &&
      (serverResult.address !== startingServerAddress ||
        !isSameServiceToken(tokenResult.serviceToken, startingServiceToken))
        ? { address: serverResult.address, serviceToken: tokenResult.serviceToken }
        : undefined;

    setProblem(undefined);
    onSubmit(result.settings, serverChange);
  };

  return (
    <>
      <Text style={styles.explanation} testID="storage-note">
        {Platform.OS === 'web'
          ? 'In a browser the API key is kept in local storage, which is not a keystore: anything running on this page can read it. On Android it goes in the keystore instead.'
          : 'The API key is kept in the Android keystore.'}
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>API key</Text>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          // Kept out of password managers and autofill: saving the key there would
          // copy it off the device, out of the keystore it is meant to live in.
          autoComplete="off"
          importantForAutofill="no"
          placeholder="sk_…"
          testID="api-key"
          placeholderTextColor={theme.colors.mutedText}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Agent ID</Text>
        <TextInput
          style={styles.input}
          value={agentId}
          onChangeText={setAgentId}
          autoCapitalize="none"
          autoCorrect={false}
          // Not autofill either, or it gets offered as the "username" for the key.
          autoComplete="off"
          importantForAutofill="no"
          placeholder="agent_…"
          testID="agent-id"
          placeholderTextColor={theme.colors.mutedText}
        />
      </View>

      {server ? (
        <View style={styles.field}>
          <Text style={styles.label}>Jarvis server</Text>
          <Text style={styles.explanation}>
            Optional: the address of your own Jarvis server. With it, opening Jarvis shows the page it made for you, the
            camera button beside him sends him photos, and this phone, your watch and your headset stay in touch with
            it. Leave it empty and he works without it.
          </Text>
          <TextInput
            style={styles.input}
            value={serverAddress}
            onChangeText={setServerAddress}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            // Not a secret, but not a login either: autofill would offer it as the key's username.
            autoComplete="off"
            importantForAutofill="no"
            placeholder="https://jarvis.example.com"
            testID="jarvis-server"
            placeholderTextColor={theme.colors.mutedText}
          />
        </View>
      ) : null}

      {server ? (
        <View style={styles.field}>
          <Text style={styles.label}>Cloudflare Access service token</Text>
          <Text style={styles.explanation}>
            Optional: only if Cloudflare Zero Trust protects your Jarvis server. Make one under Access → Service Auth,
            allow it with a Service Auth policy on the server's application, and paste its Client ID and Client Secret.
            This phone and your watch send it when they connect. A browser cannot, so the web build and the headset
            connect without it.
          </Text>
          <TextInput
            style={styles.input}
            value={clientId}
            onChangeText={setClientId}
            autoCapitalize="none"
            autoCorrect={false}
            // Part of a credential, kept out of password managers like the API key.
            autoComplete="off"
            importantForAutofill="no"
            placeholder="Client ID: 1a2b3c….access"
            testID="jarvis-server-client-id"
            placeholderTextColor={theme.colors.mutedText}
          />
          <TextInput
            style={styles.input}
            value={clientSecret}
            onChangeText={setClientSecret}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            autoComplete="off"
            importantForAutofill="no"
            placeholder="Client Secret"
            testID="jarvis-server-client-secret"
            placeholderTextColor={theme.colors.mutedText}
          />
        </View>
      ) : null}

      {problem ? (
        <Text style={styles.problem} testID="settings-problem">
          {problem}
        </Text>
      ) : null}

      <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={submit} testID="save-settings">
        <Text style={styles.primaryButtonLabel}>{submitLabel}</Text>
      </Pressable>
    </>
  );
}

/** Whether two service tokens are the same pair, either of them perhaps none. */
function isSameServiceToken(
  first: JarvisServerServiceToken | undefined,
  second: JarvisServerServiceToken | undefined,
): boolean {
  return first?.clientId === second?.clientId && first?.clientSecret === second?.clientSecret;
}

const styles = StyleSheet.create({
  explanation: {
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  field: {
    gap: theme.spacing.small,
  },
  label: {
    color: theme.colors.text,
    fontWeight: '600',
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
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.medium,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: theme.colors.accentText,
    fontWeight: '700',
  },
});
