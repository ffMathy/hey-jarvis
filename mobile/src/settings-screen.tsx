import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { type ElevenLabsSettings, parseElevenLabsSettings } from './elevenlabs-settings';
import { theme } from './theme';

interface SettingsScreenProps {
  settings: ElevenLabsSettings | undefined;
  onSave: (settings: ElevenLabsSettings) => void;
  onCancel: (() => void) | undefined;
}

/**
 * Where the phone is told which Jarvis it talks to.
 *
 * Both values are typed in rather than compiled in. Shipping the API key inside
 * the app would put a live credential in every copy of the bundle.
 */
export function SettingsScreen({ settings, onSave, onCancel }: SettingsScreenProps) {
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [agentId, setAgentId] = useState(settings?.agentId ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const save = () => {
    const result = parseElevenLabsSettings(apiKey, agentId);

    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }

    setProblem(undefined);
    onSave(result.settings);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>ElevenLabs</Text>
      <Text style={styles.explanation}>
        Jarvis is an ElevenLabs agent, and this app talks to it directly. Use an API key made for this app alone, so
        that a lost phone means revoking one key.
      </Text>
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
          placeholder="agent_…"
          testID="agent-id"
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
