import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseServerSettings, type ServerSettings } from './server-settings';
import { theme } from './theme';

interface SettingsScreenProps {
  settings: ServerSettings | undefined;
  onSave: (settings: ServerSettings) => void;
  onCancel: (() => void) | undefined;
}

/**
 * Where the phone is told which Jarvis it belongs to.
 *
 * Both values are typed in rather than compiled in. The alternative — shipping
 * the server address and a credential inside the app — would put a live key to
 * the house in every copy of the bundle.
 */
export function SettingsScreen({ settings, onSave, onCancel }: SettingsScreenProps) {
  const [serverUrl, setServerUrl] = useState(settings?.serverUrl ?? 'https://');
  const [accessToken, setAccessToken] = useState(settings?.accessToken ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const save = () => {
    const result = parseServerSettings(serverUrl, accessToken);

    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }

    setProblem(undefined);
    onSave(result.settings);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Server settings</Text>
      <Text style={styles.explanation}>
        Jarvis runs on your own server. This app never holds an ElevenLabs key — it asks the server for one conversation
        at a time.
      </Text>
      <Text style={styles.explanation} testID="storage-note">
        {Platform.OS === 'web'
          ? 'In a browser the access token is kept in local storage, which is not a keystore: anything running on this page can read it. On Android it goes in the keystore instead.'
          : 'The access token is kept in the Android keystore.'}
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://jarvis.example.com"
          testID="server-url"
          placeholderTextColor={theme.colors.mutedText}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Access token</Text>
        <TextInput
          style={styles.input}
          value={accessToken}
          onChangeText={setAccessToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN"
          testID="access-token"
          placeholderTextColor={theme.colors.mutedText}
        />
      </View>

      {problem ? (
        <Text style={styles.problem} testID="settings-problem">
          {problem}
        </Text>
      ) : null}

      <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={save} testID="save-settings">
        <Text style={styles.primaryButtonLabel}>Save</Text>
      </Pressable>

      {onCancel ? (
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonLabel}>Cancel</Text>
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
  secondaryButton: {
    paddingVertical: theme.spacing.small,
    alignItems: 'center',
  },
  secondaryButtonLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
