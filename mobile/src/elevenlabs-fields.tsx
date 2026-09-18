import { type ElevenLabsSettings, parseElevenLabsSettings } from 'conversation';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from './theme';

interface ElevenLabsFieldsProps {
  /** What to start with, when there is already something stored. */
  settings: ElevenLabsSettings | undefined;
  /** What the button says. "Save" on the settings screen; "Continue" on the tour. */
  submitLabel: string;
  /** Called with values that parsed. Nothing is reported upwards until they do. */
  onSubmit: (settings: ElevenLabsSettings) => void;
}

/**
 * The two values, the note about where they are kept, and the button that accepts them.
 *
 * Extracted because there are now two screens that ask for them — the settings screen and the
 * credentials step of the first-run tour — and two copies of a field that must not autofill, must
 * not autocorrect and must be validated the same way is two copies of four decisions that are easy
 * to get subtly different. The test IDs live here too, so the end-to-end suite sees one form
 * whichever screen is showing it.
 */
export function ElevenLabsFields({ settings, submitLabel, onSubmit }: ElevenLabsFieldsProps) {
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [agentId, setAgentId] = useState(settings?.agentId ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const submit = () => {
    const result = parseElevenLabsSettings(apiKey, agentId);

    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }

    setProblem(undefined);
    onSubmit(result.settings);
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
